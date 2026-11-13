import { describe, expect, it } from "vitest";
import { cleanSchemaForGemini, GeminiLlmProvider } from "./gemini";
import { LlmNotConfiguredError } from "./llm";

describe("cleanSchemaForGemini", () => {
  it("converts type union array with null into nullable property", () => {
    const input = {
      type: "object",
      properties: {
        note: { type: ["string", "null"] },
        amount: { type: "number" },
      },
    };
    const cleaned = cleanSchemaForGemini(input) as {
      type: string;
      properties: { note: { type: string; nullable?: boolean } };
    };
    expect(cleaned.properties.note.type).toBe("string");
    expect(cleaned.properties.note.nullable).toBe(true);
  });

  it("converts enum with null into enum without null plus nullable", () => {
    const input = {
      type: "object",
      properties: {
        method: {
          type: "string",
          enum: ["instapay", "bank", null],
        },
      },
    };
    const cleaned = cleanSchemaForGemini(input) as {
      properties: { method: { enum: string[]; nullable?: boolean } };
    };
    expect(cleaned.properties.method.enum).toEqual(["instapay", "bank"]);
    expect(cleaned.properties.method.nullable).toBe(true);
  });
});

describe("GeminiLlmProvider", () => {
  it("throws LlmNotConfiguredError if apiKey is empty", () => {
    expect(() => new GeminiLlmProvider({ apiKey: "" })).toThrow(LlmNotConfiguredError);
    expect(() => new GeminiLlmProvider({ apiKey: "   " })).toThrow(LlmNotConfiguredError);
  });

  it("calls Gemini generateContent with function calling and parses response", async () => {
    let capturedUrl = "";
    let capturedBody: unknown = null;

    const mockFetch = async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedBody = JSON.parse(init.body as string);
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: "classify_reply",
                      args: {
                        intent: "promise_to_pay",
                        confidence: 0.95,
                        promised_date: "2026-11-20",
                        amount_minor: 150000,
                      },
                    },
                  },
                ],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 25,
            candidatesTokenCount: 15,
            totalTokenCount: 40,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const provider = new GeminiLlmProvider({
      apiKey: "test-gemini-key",
      model: "gemini-3.5-flash-lite",
      fetchFn: mockFetch,
    });

    const res = await provider.classifyReply("هدفع الاسبوع الجاي", {
      todayIso: "2026-11-12",
      timezone: "Africa/Cairo",
    });

    expect(capturedUrl).toContain("models/gemini-3.5-flash-lite:generateContent?key=test-gemini-key");
    expect(capturedBody).toBeDefined();
    expect(res.model).toBe("gemini-3.5-flash-lite");
    expect(res.promptVersion).toBe("reply-v1");
    expect(res.inputTokens).toBe(25);
    expect(res.outputTokens).toBe(15);
    expect(res.data).not.toBeNull();
    expect(res.data?.intent).toBe("promise_to_pay");
    expect(res.data?.confidence).toBe(0.95);
  });

  it("returns null data if model output is malformed or invalid per Hard Rule 4", async () => {
    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    functionCall: {
                      name: "classify_reply",
                      args: {
                        intent: "UNKNOWN_INVALID_INTENT",
                        confidence: "not-a-number",
                      },
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );

    const provider = new GeminiLlmProvider({
      apiKey: "test-gemini-key",
      fetchFn: mockFetch,
    });

    const res = await provider.classifyReply("bla bla", {
      todayIso: "2026-11-12",
      timezone: "Africa/Cairo",
    });

    // Untrusted model outputs that fail Zod validation must return data: null
    expect(res.data).toBeNull();
  });
});

describe("Gemini native Agent tool loop", () => {
  it("calls an allowlisted server tool, returns its result to Gemini, then generates a final answer", async () => {
    const requests: Record<string, unknown>[] = [];
    const fetchFn = async (_url: string, init: RequestInit) => {
      requests.push(JSON.parse(init.body as string) as Record<string, unknown>);
      if (requests.length === 1) {
        return new Response(JSON.stringify({
          candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "get_workspace_summary", args: {} } }] } }],
          usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4 },
        }), { status: 200 });
      }
      return new Response(JSON.stringify({
        candidates: [{ content: { role: "model", parts: [{ text: "المتأخرات 12000 جنيه، وأعلى أولوية عميلان." }] } }],
        usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 15 },
      }), { status: 200 });
    };
    const provider = new GeminiLlmProvider({ apiKey: "test-key", model: "gemini-test", fetchFn });
    const out = await provider.runAgent!({
      systemInstruction: "Use tools for facts.",
      messages: [{ role: "user", content: "لخص التحصيل" }],
      tools: [{ name: "get_workspace_summary", description: "Read workspace summary", inputSchema: { type: "object", properties: {}, additionalProperties: false } }],
      executeTool: async (name) => ({ name, overdueMinor: "1200000" }),
    });
    expect(out.text).toContain("12000 جنيه");
    expect(out.toolExecutions).toHaveLength(1);
    expect(out.toolExecutions[0]?.name).toBe("get_workspace_summary");
    expect(out.inputTokens).toBe(32);
    expect(out.outputTokens).toBe(19);
    const secondContents = requests[1]?.contents as { role: string; parts: Record<string, unknown>[] }[];
    expect(secondContents.some((content) => content.parts.some((part) => "functionResponse" in part))).toBe(true);
  });
});


describe("Gemini model routing and tool budgets", () => {
  it("uses the fast route for generated copy", async () => {
    let requestedUrl = "";
    const provider = new GeminiLlmProvider({
      apiKey: "test-key", model: "gemini-3.8-flash", modelFast: "gemini-3.5-flash-lite",
      fetchFn: async (url) => {
        requestedUrl = url;
        return new Response(JSON.stringify({
          candidates: [{ content: { parts: [{ text: "Draft." }] } }],
          usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 },
        }), { status: 200 });
      },
    });
    await provider.generateText!("Rewrite safely.");
    expect(requestedUrl).toContain("/models/gemini-3.5-flash-lite:generateContent");
  });

  it("records each requested function call even when the tool budget rejects later calls", async () => {
    let requestCount = 0;
    const provider = new GeminiLlmProvider({
      apiKey: "test-key", model: "gemini-agent",
      fetchFn: async () => {
        requestCount += 1;
        const parts = requestCount === 1
          ? [
              { functionCall: { name: "read_one", args: {} } },
              { functionCall: { name: "read_two", args: {} } },
            ]
          : [{ text: "I could only run one tool." }];
        return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts } }] }), { status: 200 });
      },
    });
    const executed: string[] = [];
    const out = await provider.runAgent!({
      systemInstruction: "Read only.",
      messages: [{ role: "user", content: "Read two things." }],
      tools: [
        { name: "read_one", description: "First", inputSchema: { type: "object", properties: {} } },
        { name: "read_two", description: "Second", inputSchema: { type: "object", properties: {} } },
      ],
      executeTool: async (name) => { executed.push(name); return { ok: true }; },
      maxToolCalls: 1,
    });
    expect(executed).toEqual(["read_one"]);
    expect(out.toolExecutions).toHaveLength(2);
    expect(out.toolExecutions[1]?.result).toEqual({ error: "tool_call_limit_reached" });
  });
});


describe("Gemini native text streaming", () => {
  it("forwards incremental text deltas and reports final token usage", async () => {
    const chunks = [
      { candidates: [{ content: { parts: [{ text: "Hello " }] } }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 2 } },
      { candidates: [{ content: { parts: [{ text: "world." }] } }], usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4 } },
    ];
    const body = chunks.map((value) => `data: ${JSON.stringify(value)}\n\n`).join("");
    const provider = new GeminiLlmProvider({ apiKey: "test-key", modelFast: "gemini-3.5-flash-lite", fetchFn: async () => new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }) });
    const deltas: string[] = [];
    const result = await provider.streamText("Prompt", "System", (delta) => deltas.push(delta));
    expect(deltas).toEqual(["Hello ", "world."]);
    expect(result).toMatchObject({ text: "Hello world.", inputTokens: 12, outputTokens: 4, model: "gemini-3.5-flash-lite" });
  });
});
