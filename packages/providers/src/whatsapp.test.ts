import { describe, it, expect } from "vitest";
import { WhatsAppCloudProvider } from "./whatsapp";
import { ProviderError } from "./messaging";

/**
 * The real adapter, tested ONLY with a mocked fetch returning Meta-shaped
 * responses (ADR-015). No network, no credentials — the sandbox send against
 * a real Meta number is a human RUNBOOK step.
 */
function stubFetch(response: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => response } as Response;
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const config = { apiVersion: "v24.0", phoneNumberId: "1234567890", accessToken: "test-token" };

describe("WhatsAppCloudProvider (mocked fetch, Meta-shaped responses)", () => {
  it("posts a template message in the documented shape and returns the wamid", async () => {
    const { calls, fetchImpl } = stubFetch({ messaging_product: "whatsapp", contacts: [{ wa_id: "201001234567" }], messages: [{ id: "wamid.TEST1" }] });
    const p = new WhatsAppCloudProvider({ ...config, fetchImpl });
    const r = await p.sendTemplate({
      toE164: "+201001234567", templateKey: "invoice_due_today",
      variables: { business: "محل النور", amount: "100.00 EGP" },
      parameters: ["محل النور", "100.00 EGP"],
      idempotencyKey: "rem-1", channel: "whatsapp",
    });
    expect(r.providerMessageId).toBe("wamid.TEST1");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://graph.facebook.com/v24.0/1234567890/messages");
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
    const body = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
    expect(body.messaging_product).toBe("whatsapp");
    expect(body.to).toBe("201001234567"); // digits only, no leading +
    expect(body.type).toBe("template");
    expect(body.template).toEqual({
      name: "invoice_due_today",
      language: { code: "ar" },
      components: [{ type: "body", parameters: [{ type: "text", text: "محل النور" }, { type: "text", text: "100.00 EGP" }] }],
    });
  });

  it("dedupes repeat calls with the same idempotency key without a second HTTP call", async () => {
    const { calls, fetchImpl } = stubFetch({ messages: [{ id: "wamid.X" }] });
    const p = new WhatsAppCloudProvider({ ...config, fetchImpl });
    const input = { toE164: "+201001234567", templateKey: "invoice_due_today", variables: {}, idempotencyKey: "k", channel: "whatsapp" as const };
    const a = await p.sendTemplate(input);
    const b = await p.sendTemplate(input);
    expect(b).toEqual(a);
    expect(calls).toHaveLength(1);
  });

  it("maps Meta error responses to ProviderError with the numeric code", async () => {
    const { fetchImpl } = stubFetch({ error: { code: 130429, message: "Throughput limit" } }, 400);
    const p = new WhatsAppCloudProvider({ ...config, fetchImpl });
    await expect(p.sendTemplate({ toE164: "+201001234567", templateKey: "x", variables: {}, idempotencyKey: "k2", channel: "whatsapp" }))
      .rejects.toMatchObject({ providerCode: 130429 });
    const { fetchImpl: fetch2 } = stubFetch({ error: { code: 131026, message: "Message undeliverable" } }, 400);
    const p2 = new WhatsAppCloudProvider({ ...config, fetchImpl: fetch2 });
    await expect(p2.sendTemplate({ toE164: "+201001234567", templateKey: "x", variables: {}, idempotencyKey: "k3", channel: "whatsapp" }))
      .rejects.toBeInstanceOf(ProviderError);
  });

  it("sends free-form text for the 24h window", async () => {
    const { calls, fetchImpl } = stubFetch({ messages: [{ id: "wamid.TXT" }] });
    const p = new WhatsAppCloudProvider({ ...config, fetchImpl });
    const r = await p.sendText({ toE164: "+201001234567", body: "تمام، تم إيقاف التذكيرات.", idempotencyKey: "txt-1" });
    expect(r.providerMessageId).toBe("wamid.TXT");
    const body = JSON.parse(String(calls[0]?.init.body)) as { type: string; text: { body: string } };
    expect(body.type).toBe("text");
    expect(body.text.body).toContain("إيقاف");
  });

  it("refuses loudly when not configured instead of pretending to send", async () => {
    const p = new WhatsAppCloudProvider({ apiVersion: "", phoneNumberId: "", accessToken: "" });
    await expect(p.sendTemplate({ toE164: "+201001234567", templateKey: "x", variables: {}, idempotencyKey: "k4", channel: "whatsapp" }))
      .rejects.toMatchObject({ providerCode: 0 });
  });
});
