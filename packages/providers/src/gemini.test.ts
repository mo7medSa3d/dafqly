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
      model: "gemini-3.1-flash-lite",
      fetchFn: mockFetch,
    });

    const res = await provider.classifyReply("هدفع الاسبوع الجاي", {
      todayIso: "2026-11-12",
      timezone: "Africa/Cairo",
    });

    expect(capturedUrl).toContain("models/gemini-3.1-flash-lite:generateContent?key=test-gemini-key");
    expect(capturedBody).toBeDefined();
    expect(res.model).toBe("gemini-3.1-flash-lite");
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
