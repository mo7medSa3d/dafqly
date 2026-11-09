import { describe, it, expect, vi } from "vitest";
import { AnthropicLlmProvider, FakeLlmProvider, LlmNotConfiguredError, SYNTHETIC_MARKER } from "./llm";
import { validateUpload, computeSha256, FakeStorageProvider, MAX_UPLOAD_BYTES } from "./storage";

/**
 * Anthropic adapter contract tests (ADR-022) with MOCKED fetch only — no
 * real API key exists and no real call is ever made from tests.
 */
function toolUseResponse(input: unknown, usage = { input_tokens: 111, output_tokens: 22 }) {
  return {
    ok: true, status: 200,
    json: async () => ({ content: [{ type: "tool_use", name: "classify_reply", input }], usage }),
  } as Response;
}

describe("AnthropicLlmProvider (mocked fetch, ADR-022 shapes)", () => {
  it("throws LlmNotConfiguredError without a key", () => {
    expect(() => new AnthropicLlmProvider({ apiKey: "", modelFast: "f", modelVision: "v" })).toThrow(LlmNotConfiguredError);
  });

  it("sends the documented request: URL, headers, forced tool use; parses tool_use + usage", async () => {
    const fetchFn = vi.fn(async () => toolUseResponse({ intent: "promise_to_pay", confidence: 0.91, promised_date: "2026-11-12", amount_minor: null }));
    const llm = new AnthropicLlmProvider({ apiKey: "sk-test", modelFast: "claude-haiku-5-5", modelVision: "claude-sonnet-5-5", fetchFn, now: (() => { let t = 1000; return () => (t += 5); })() });
    const out = await llm.classifyReply("هدفع الخميس", { todayIso: "2026-11-09", timezone: "Africa/Cairo", dueOn: "2026-11-10" });
    expect(out.data).toMatchObject({ intent: "promise_to_pay", confidence: 0.91, promised_date: "2026-11-12" });
    expect(out).toMatchObject({ model: "claude-haiku-5-5", promptVersion: "reply-v1", inputTokens: 111, outputTokens: 22 });
    const [url, init] = fetchFn.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.tool_choice).toEqual({ type: "tool", name: "classify_reply" });
    expect((body.tools as { name: string }[])[0]!.name).toBe("classify_reply");
    // customer text is quoted as data inside <customer_message> tags
    const content = (body.messages as { content: { text: string }[] }[])[0]!.content[0]!.text;
    expect(content).toContain("<customer_message>");
    expect(content).toContain("هدفع الخميس");
  });

  it("sends an image content block for vision calls (base64 source)", async () => {
    const fetchFn = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ content: [{ type: "tool_use", name: "extract_receipt", input: { is_receipt: true, amount_minor: 50000, confidence: 0.9, tamper_signals: [] } }], usage: { input_tokens: 10, output_tokens: 5 } }),
    }) as Response);
    const llm = new AnthropicLlmProvider({ apiKey: "sk-test", modelFast: "f", modelVision: "claude-sonnet-5-5", fetchFn });
    const out = await llm.extractReceipt(new Uint8Array([1, 2, 3]), "image/png");
    expect(out.data?.amount_minor).toBe(50000);
    const body = JSON.parse(((fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1]).body as string) as { messages: { content: { type: string; source?: { type: string; media_type: string; data: string } }[] }[] };
    const img = body.messages[0]!.content.find((c) => c.type === "image")!;
    expect(img.source).toMatchObject({ type: "base64", media_type: "image/png" });
    expect(img.source!.data).toBe(Buffer.from([1, 2, 3]).toString("base64"));
  });

  it("non-200 -> error; invalid tool input -> data null (routes to human)", async () => {
    const failing = new AnthropicLlmProvider({
      apiKey: "sk-test", modelFast: "f", modelVision: "v",
      fetchFn: async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response,
    });
    await expect(failing.classifyReply("x", { todayIso: "2026-11-09", timezone: "Africa/Cairo" })).rejects.toThrow(/500/);
    const invalid = new AnthropicLlmProvider({
      apiKey: "sk-test", modelFast: "f", modelVision: "v",
      fetchFn: async () => toolUseResponse({ intent: "do_anything", confidence: 3 }),
    });
    const out = await invalid.classifyReply("x", { todayIso: "2026-11-09", timezone: "Africa/Cairo" });
    expect(out.data).toBeNull();
  });
});

describe("FakeLlmProvider (FAKE, deterministic synthetic reader)", () => {
  const svgWith = (payload: unknown) => new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg"><text>${SYNTHETIC_MARKER}${Buffer.from(JSON.stringify(payload)).toString("base64")}</text></svg>`,
  );

  it("reads a synthetic ledger payload and applies the labelled error script", async () => {
    const fake = new FakeLlmProvider();
    const img = svgWith({
      kind: "ledger",
      rows: [{ name: "أحمد سامي", phone: null, amount_minor: 10000, date: null, note: null, confidence: 0.95, cellConfidence: { name: 0.95, amount: 0.95 } }],
      errors: { "0": { amount_minor: 70000, cellConfidence: { amount: 0.3 } } },
    });
    const out = await fake.extractLedgerPage(img, "image/svg+xml");
    expect(out.data?.rows[0]).toMatchObject({ amount_minor: 70000 });
    expect(out.data?.rows[0]?.cellConfidence.amount).toBe(0.3);
    expect(out.data?.rows[0]?.cellConfidence.name).toBe(0.95);
  });

  it("reads a synthetic cheque payload for the F9 pre-fill (and null without one)", async () => {
    const fake = new FakeLlmProvider();
    const img = svgWith({
      kind: "cheque",
      extraction: { number: "000123", bank: "CIB", amount_minor: 250000, issue_date: "2026-11-01", due_date: "2026-12-01", confidence: 0.93 },
    });
    expect((await fake.extractCheque(img, "image/svg+xml")).data).toMatchObject({ number: "000123", amount_minor: 250000 });
    expect((await fake.extractCheque(new Uint8Array([1, 2]), "image/jpeg")).data).toBeNull();
  });

  it("returns data null for a non-synthetic image (unreadable -> human)", async () => {
    const fake = new FakeLlmProvider();
    const out = await fake.extractLedgerPage(new Uint8Array([9, 9, 9]), "image/jpeg");
    expect(out.data).toBeNull();
  });

  it("classifies Egyptian replies by rules, resolving dates deterministically", async () => {
    const fake = new FakeLlmProvider();
    const ctx = { todayIso: "2026-11-09", timezone: "Africa/Cairo" };
    expect((await fake.classifyReply("هدفع يوم الخميس ان شاء الله", ctx)).data).toMatchObject({ intent: "promise_to_pay", promised_date: "2026-11-12" });
    expect((await fake.classifyReply("إيقاف", ctx)).data?.intent).toBe("opt_out");
    expect((await fake.classifyReply("أنا دفعت خلاص امبارح", ctx)).data?.intent).toBe("already_paid");
    expect((await fake.classifyReply("الرقم ده غلط، مش أنا", ctx)).data?.intent).toBe("wrong_person");
    expect((await fake.classifyReply("هدفع بعد العيد", ctx)).data).toMatchObject({ intent: "promise_to_pay", promised_date: null });
    expect((await fake.classifyReply("هدفع بعد العيد", ctx)).data!.confidence).toBeLessThan(0.8);
  });
});

describe("storage helpers", () => {
  it("validateUpload enforces the §3 allowlist and 8MB cap", () => {
    expect(validateUpload({ mime: "image/png", size: 100 })).toEqual({ ok: true });
    expect(validateUpload({ mime: "image/heic", size: 100 })).toEqual({ ok: true });
    expect(validateUpload({ mime: "application/pdf", size: 100 })).toMatchObject({ ok: false, code: "UNSUPPORTED_MIME" });
    expect(validateUpload({ mime: "image/png", size: MAX_UPLOAD_BYTES + 1 })).toMatchObject({ ok: false, code: "FILE_TOO_LARGE" });
    expect(validateUpload({ mime: "image/png", size: 0 })).toMatchObject({ ok: false, code: "EMPTY_FILE" });
  });
  it("computeSha256 is stable and the fake storage round-trips get/delete", async () => {
    const bytes = new TextEncoder().encode("receipt-bytes");
    expect(computeSha256(bytes)).toBe(computeSha256(new TextEncoder().encode("receipt-bytes")));
    expect(computeSha256(bytes)).toMatch(/^[0-9a-f]{64}$/);
    const store = new FakeStorageProvider();
    await store.put("k1", bytes, "image/png");
    expect(await store.get("k1")).toEqual(bytes);
    await store.delete("k1");
    expect(await store.get("k1")).toBeNull();
  });
});
