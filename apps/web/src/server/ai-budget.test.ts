import { describe, expect, it } from "vitest";
import { parseEnv } from "@tahseel/core";
import { primaryModelFor, resolveLlmProviderConfigs } from "@tahseel/providers";
import { estimateAiCostUsdMicros, providerDefinitelyRejected } from "./ai-budget";

describe("global AI USD metering", () => {
  it("converts official per-million-token rates to integer micro-USD", () => {
    expect(estimateAiCostUsdMicros("gemini-3.8-flash", 1_000_000, 1_000_000)).toBe(4_500_000n);
    expect(estimateAiCostUsdMicros("claude-haiku-5-5", 1_000_000, 1_000_000)).toBe(600_000n);
  });

  it("has an explicit rate row for every default model id in env.ts (F-13)", () => {
    // Derive the ids from the env defaults so a future default change
    // fails here instead of silently falling back to the $10/$40 rate.
    const env = parseEnv({
      DATABASE_URL: "postgres://localhost:5432/test",
      SESSION_SECRET: "x".repeat(32),
      PHONE_HASH_PEPPER: "y".repeat(32),
    });
    const resolvedDefaultModel = primaryModelFor(resolveLlmProviderConfigs(env), "fast");
    expect(resolvedDefaultModel).toBe("gemini-2.5-flash");
    const defaults = new Map([
      [resolvedDefaultModel!, 2_800_000n],
      ["gemini-3.8-flash", 4_500_000n],
      ["gpt-4o-mini", 750_000n],
      ["claude-sonnet-4-5", 18_000_000n],
      ["deepseek-chat", 1_370_000n],
      ["llama-3.3-70b-versatile", 1_380_000n],
    ]);
    expect(defaults.size).toBeGreaterThan(0);
    for (const [model, expected] of defaults) {
      expect(estimateAiCostUsdMicros(model, 1_000_000, 1_000_000)).toBe(expected);
    }
    // And the remaining priced rows are pinned too (gemini-3.5-flash is
    // not a default but is priced explicitly, not via the fallback).
    expect(estimateAiCostUsdMicros("gemini-3.5-flash", 1_000_000, 1_000_000)).toBe(10_500_000n);
  });

  it("rounds fractional micro-USD upward and never returns a negative cost", () => {
    expect(estimateAiCostUsdMicros("gemini-3.8-flash", 1, 1)).toBe(5n);
    expect(estimateAiCostUsdMicros("gemini-3.8-flash", -10, -20)).toBe(0n);
  });

  it("handles NaN, Infinity, negative, and float token counts without RangeError or negative cost", () => {
    expect(estimateAiCostUsdMicros("gemini-3.8-flash", Number.NaN, Number.NaN)).toBe(0n);
    expect(estimateAiCostUsdMicros("gemini-3.8-flash", Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY)).toBe(0n);
    expect(estimateAiCostUsdMicros("gemini-3.8-flash", -100, -0.5)).toBe(0n);
    expect(estimateAiCostUsdMicros("gemini-3.8-flash", Number.NaN, 1_000_000)).toBe(3_750_000n);
    expect(estimateAiCostUsdMicros("gemini-3.8-flash", 1_000_000, Number.POSITIVE_INFINITY)).toBe(750_000n);
    // Float token counts: 1.5 * 0.75 + 2.7 * 3.75 = 11.25 -> ceil = 12n.
    expect(estimateAiCostUsdMicros("gemini-3.8-flash", 1.5, 2.7)).toBe(12n);
    expect(estimateAiCostUsdMicros("gemini-3.8-flash", -5.5, 1.2)).toBe(5n);
  });

  it("releases reservations only for definitive provider rejections", () => {
    expect(providerDefinitelyRejected(new Error("Gemini API error: HTTP 401 invalid key"))).toBe(true);
    expect(providerDefinitelyRejected(new Error("LLM API error: HTTP 429 rate limited"))).toBe(true);
    expect(providerDefinitelyRejected(new Error("Anthropic API error: HTTP 408 request timeout"))).toBe(false);
    expect(providerDefinitelyRejected(new Error("Gemini API error: HTTP 503 upstream unavailable"))).toBe(false);
    expect(providerDefinitelyRejected(new TypeError("fetch failed"))).toBe(false);
  });

  it("uses a deliberately conservative fallback for unknown model ids", () => {
    expect(estimateAiCostUsdMicros("unlisted-model", 1_000_000, 1_000_000)).toBe(50_000_000n);
  });
});
