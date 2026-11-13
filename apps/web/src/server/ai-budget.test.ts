import { describe, expect, it } from "vitest";
import { parseEnv } from "@tahseel/core";
import { estimateAiCostUsdMicros } from "./ai-budget";

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
    const defaults = new Map([
      [env.AI_MODEL, 4_500_000n],
      [env.GEMINI_MODEL_FAST, 2_800_000n],
      [env.GEMINI_MODEL_VISION, 4_500_000n],
      [env.LLM_MODEL_AGENT, 12_000_000n],
      [env.LLM_MODEL_FAST, 600_000n],
      [env.LLM_MODEL_VISION, 12_000_000n],
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

  it("uses a deliberately conservative fallback for unknown model ids", () => {
    expect(estimateAiCostUsdMicros("unlisted-model", 1_000_000, 1_000_000)).toBe(50_000_000n);
  });
});
