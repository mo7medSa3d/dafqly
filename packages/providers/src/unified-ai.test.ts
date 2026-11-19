import { describe, expect, it } from "vitest";
import { LlmNotConfiguredError } from "./llm";
import { resolveAiConfig, hasUsableLlmConfig } from "./config";
import { UnifiedAiProvider, createAiProvider } from "./unified-ai";

describe("UnifiedAiProvider", () => {
  it("requires an API key for remote providers but not local Ollama", () => {
    expect(() => createAiProvider({ provider: "gemini", apiKey: "" })).toThrow(LlmNotConfiguredError);
    expect(() => createAiProvider({ provider: "anthropic", apiKey: "  " })).toThrow(LlmNotConfiguredError);
    expect(() => createAiProvider({ provider: "ollama" })).not.toThrow();
  });

  it("executes OpenAI-compatible (Gemini/OpenAI/Groq/etc.) text & tool-calling agent", async () => {
    let calls = 0;
    const provider = new UnifiedAiProvider({
      provider: "gemini",
      apiKey: "test-key",
      fetchFn: async (url, init) => {
        calls += 1;
        expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
        expect((init.headers as Record<string, string>).authorization).toBe("Bearer test-key");
        if (calls === 1) {
          return new Response(JSON.stringify({
            choices: [{ message: { content: null, tool_calls: [{ id: "tc_1", function: { name: "get_summary", arguments: "{}" } }] } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }), { status: 200 });
        }
        return new Response(JSON.stringify({
          choices: [{ message: { content: "Summary ready." } }],
          usage: { prompt_tokens: 12, completion_tokens: 4 },
        }), { status: 200 });
      },
    });

    const out = await provider.runAgent({
      systemInstruction: "You are a helpful assistant.",
      messages: [{ role: "user", content: "Status?" }],
      tools: [{ name: "get_summary", description: "Get summary", inputSchema: { type: "object", properties: {} } }],
      executeTool: async () => ({ outstandingMinor: "50000" }),
    });

    expect(out.text).toBe("Summary ready.");
    expect(out.toolExecutions).toHaveLength(1);
    expect(out.inputTokens).toBe(22);
    expect(out.outputTokens).toBe(9);
  });

  it("executes Anthropic Messages API seamlessly through the same unified interface", async () => {
    const provider = createAiProvider({
      provider: "anthropic",
      apiKey: "sk-ant-test",
      fetchFn: async (url, init) => {
        expect(url).toBe("https://api.anthropic.com/v1/messages");
        expect((init.headers as Record<string, string>)["x-api-key"]).toBe("sk-ant-test");
        return new Response(JSON.stringify({
          content: [{ type: "text", text: "Hello from Claude" }],
          usage: { input_tokens: 8, output_tokens: 3 },
        }), { status: 200 });
      },
    });

    const res = await provider.generateText!("Hi");
    expect(res.text).toBe("Hello from Claude");
    expect(res.inputTokens).toBe(8);
  });

  it("resolves single AI_PROVIDER + AI_API_KEY config cleanly", () => {
    const cfg = resolveAiConfig({ AI_PROVIDER: "openai", AI_API_KEY: "sk-123" });
    expect(cfg).toEqual({ provider: "openai", apiKey: "sk-123", model: undefined, baseUrl: undefined });
    expect(hasUsableLlmConfig({ AI_PROVIDER: "openai", AI_API_KEY: "sk-123" })).toBe(true);
    expect(hasUsableLlmConfig({ AI_PROVIDER: "gemini" })).toBe(false);
    // Never leak one vendor's legacy key to a different provider.
    expect(resolveAiConfig({ AI_PROVIDER: "openai", GEMINI_API_KEY: "gem-secret" }).apiKey).toBeUndefined();
    expect(resolveAiConfig({ AI_PROVIDER: "gemini", GEMINI_API_KEY: "gem-secret" }).apiKey).toBe("gem-secret");
  });
});
