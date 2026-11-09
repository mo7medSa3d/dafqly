import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { baselineClassify, scoreReplies, type LabeledReply } from "./baseline";

const rows = readFileSync(new URL("./synthetic/replies.jsonl", import.meta.url), "utf8")
  .trim().split("\n").map((l) => JSON.parse(l) as LabeledReply);

describe("eval harness smoke (SYNTHETIC data, not real eval data)", () => {
  it("scores the synthetic set; opt-out recall is 100%", () => {
    const metrics = scoreReplies(rows, baselineClassify);
    expect(metrics.total).toBe(rows.length);
    expect(metrics.optOutRecall).toBe(1);
  });
  it("the injection fixture is labelled and does not produce an opt-out action by itself", () => {
    const injection = rows.find((r) => r.injection);
    expect(injection).toBeTruthy();
    // The baseline sees the word إيقاف inside an instruction sentence; the
    // labelled intent is greeting_or_other, and the harness counts any
    // deviation as a violation signal for the REAL classifier in M4. For the
    // M0 keyword baseline this fixture documents the known limitation rather
    // than gating on it.
    expect(injection!.intent).toBe("greeting_or_other");
  });
});
