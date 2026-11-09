import { describe, it, expect } from "vitest";
import { mergeTimeline, type TimelineEvent } from "./timeline";

const ev = (id: string, kind: TimelineEvent["kind"], at: string): TimelineEvent =>
  ({ id, kind, at, summary: `${kind}:${id}` });

describe("debtor timeline merge (F1: mixed events in correct order)", () => {
  it("sorts invoices, payments, messages, disputes newest-first regardless of input order", () => {
    const merged = mergeTimeline([
      ev("old-invoice", "invoice", "2026-11-01T09:00:00.000Z"),
      ev("payment", "payment", "2026-11-05T12:00:00.000Z"),
      ev("msg", "message", "2026-11-03T10:00:00.000Z"),
      ev("dispute", "dispute", "2026-11-07T08:00:00.000Z"),
      ev("new-invoice", "invoice", "2026-11-06T09:00:00.000Z"),
    ]);
    expect(merged.map((e) => e.id)).toEqual(["dispute", "new-invoice", "payment", "msg", "old-invoice"]);
  });
  it("is deterministic on equal timestamps (kind order, then id)", () => {
    const at = "2026-11-05T12:00:00.000Z";
    const merged = mergeTimeline([ev("b", "invoice", at), ev("a", "payment", at), ev("c", "payment", at)]);
    // payments before invoices at the same instant (money settles the invoice), then id asc
    expect(merged.map((e) => e.id)).toEqual(["a", "c", "b"]);
  });
  it("does not mutate its input and handles empty input", () => {
    const input = [ev("x", "invoice", "2026-11-01T00:00:00.000Z")];
    expect(mergeTimeline(input)).toHaveLength(1);
    expect(input[0]?.id).toBe("x");
    expect(mergeTimeline([])).toEqual([]);
  });
});
