import { describe, it, expect } from "vitest";
import {
  planReminders, isOptOutText, canAdvanceMessageStatus, classifyProviderError,
  backoffDelayMs, evaluateQualityGuard, groupDueReminders, DEFAULT_WEEKLY_CAP,
  type PlanPolicy,
} from "./reminders";

const policy: PlanPolicy = { timezone: "Africa/Cairo", quietStart: "21:00", quietEnd: "09:00", fridayMorningSkip: false, weeklyCap: DEFAULT_WEEKLY_CAP, sendTimeLocal: "10:00" };
const invoice = { id: "inv1", status: "open" as const, dueOn: "2026-11-20" };

describe("planReminders (F4 pure planner)", () => {
  it("produces d-3, d0, d+3, d+7, d+14 and one weekly step — capped at 6 — at 10:00 tenant-local", () => {
    const steps = planReminders(invoice, policy, new Date("2026-11-10T00:00:00Z"));
    expect(steps.map((s) => s.stepKey)).toEqual(["d-3", "d0", "d+3", "d+7", "d+14", "weekly"]);
    // 10:00 Africa/Cairo (UTC+2 in November) = 08:00Z.
    expect(steps.map((s) => s.dueAt.toISOString())).toEqual([
      "2026-11-17T08:00:00.000Z", "2026-11-20T08:00:00.000Z", "2026-11-23T08:00:00.000Z",
      "2026-11-27T08:00:00.000Z", "2026-12-04T08:00:00.000Z", "2026-12-11T08:00:00.000Z",
    ]);
    expect(steps.map((s) => s.templateKey)).toEqual([
      "invoice_upcoming", "invoice_due_today", "invoice_overdue", "invoice_overdue", "invoice_overdue", "invoice_overdue",
    ]);
    expect(steps.every((s) => s.channel === "whatsapp")).toBe(true);
  });

  it("skips steps already in the past relative to now (no catch-up spam)", () => {
    const steps = planReminders(invoice, policy, new Date("2026-11-21T00:00:00Z"));
    expect(steps.map((s) => s.stepKey)).toEqual(["d+3", "d+7", "d+14", "weekly"]);
  });

  it("plans nothing for paid/cancelled/written-off invoices", () => {
    for (const status of ["paid", "cancelled", "written_off"] as const) {
      expect(planReminders({ ...invoice, status }, policy, new Date("2026-11-10T00:00:00Z"))).toEqual([]);
    }
    expect(planReminders({ ...invoice, status: "partially_paid" }, policy, new Date("2026-11-10T00:00:00Z"))).toHaveLength(6);
    expect(planReminders({ ...invoice, status: "disputed" }, policy, new Date("2026-11-10T00:00:00Z"))).toEqual([]);
  });

  it("Friday-morning skip (when the tenant enables it) moves a Friday 10:00 step to 12:00 local", () => {
    const steps = planReminders(invoice, { ...policy, fridayMorningSkip: true }, new Date("2026-11-10T00:00:00Z"));
    // 2026-11-20 is a Friday: d0 moves 10:00 -> 12:00 local = 10:00Z.
    expect(steps[1]?.dueAt.toISOString()).toBe("2026-11-20T10:00:00.000Z");
  });

  it("quiet hours push a step to the next allowed slot instead of dropping it", () => {
    const steps = planReminders(invoice, { ...policy, sendTimeLocal: "22:30" }, new Date("2026-11-10T00:00:00Z"));
    // d-3 would be 17 Nov 22:30 local (quiet) -> next allowed 18 Nov 09:00 local = 07:00Z.
    expect(steps[0]?.dueAt.toISOString()).toBe("2026-11-18T07:00:00.000Z");
  });

  it("is deterministic: same inputs, same plan (idempotent re-planning relies on this)", () => {
    const a = planReminders(invoice, policy, new Date("2026-11-10T00:00:00Z"));
    const b = planReminders(invoice, policy, new Date("2026-11-10T00:00:00Z"));
    expect(a).toEqual(b);
  });
});

describe("isOptOutText (runs before any LLM — F4/F8)", () => {
  it.each(["إيقاف", "ايقاف", "إيقاف التذكيرات", "STOP", "stop", "إيقاف.", " إيقاف ", "unsubscribe", "إلغاء"])("treats %s as opt-out", (t) => {
    expect(isOptOutText(t)).toBe(true);
  });
  it.each(["هدفع بكرة", "شكرًا", "stop", "دفعت خلاص", "؟؟"])("does not misfire on %s (except exact stop)", (t) => {
    expect(isOptOutText(t)).toBe(t === "stop");
  });
  it("does not treat a long message containing the word as an opt-out", () => {
    expect(isOptOutText("من فضلك إيقاف مش عايز أكمل كلام عن الموضوع ده دلوقتي")).toBe(false);
  });
});

describe("message status ordering (out-of-order webhooks must not downgrade)", () => {
  it("advances queued -> sent -> delivered -> read only forward", () => {
    expect(canAdvanceMessageStatus("queued", "sent")).toBe(true);
    expect(canAdvanceMessageStatus("sent", "read")).toBe(true);
    expect(canAdvanceMessageStatus("read", "delivered")).toBe(false);
    expect(canAdvanceMessageStatus("delivered", "sent")).toBe(false);
    expect(canAdvanceMessageStatus("sent", "sent")).toBe(false);
  });
  it("failed lands from queued/sent but never overwrites delivered/read and is never overwritten", () => {
    expect(canAdvanceMessageStatus("sent", "failed")).toBe(true);
    expect(canAdvanceMessageStatus("read", "failed")).toBe(false);
    expect(canAdvanceMessageStatus("failed", "delivered")).toBe(false);
  });
});

describe("classifyProviderError (ADR-015 mapping)", () => {
  it("rate limits and temporary errors are retryable", () => {
    expect(classifyProviderError(130429)).toMatchObject({ retryable: true, kind: "rate_limit" });
    expect(classifyProviderError(131016)).toMatchObject({ retryable: true });
    expect(classifyProviderError(500)).toMatchObject({ retryable: true, kind: "temporary" });
  });
  it("policy/template/re-engagement errors are never retried", () => {
    for (const code of [131047, 131031, 131030, 132000, 132001, 132015, 132016]) {
      expect(classifyProviderError(code).retryable, String(code)).toBe(false);
    }
  });
  it("131026 means not reachable (SMS fallback candidate)", () => {
    expect(classifyProviderError(131026)).toMatchObject({ retryable: false, kind: "not_reachable" });
  });
  it("backoff grows exponentially with jitter and caps", () => {
    const zero = () => 0;
    expect(backoffDelayMs(0, zero)).toBe(1000);
    expect(backoffDelayMs(1, zero)).toBe(2000);
    expect(backoffDelayMs(3, zero)).toBe(8000);
    expect(backoffDelayMs(20, zero)).toBeLessThanOrEqual(60_001);
  });
});

describe("evaluateQualityGuard (F3 auto-pause)", () => {
  it("pauses sending when the failure rate crosses 20% over >=20 sends", () => {
    expect(evaluateQualityGuard({ sent: 30, failed: 8, blocked: 0 }).pause).toBe(true);
    expect(evaluateQualityGuard({ sent: 30, failed: 5, blocked: 0 }).pause).toBe(false);
    expect(evaluateQualityGuard({ sent: 5, failed: 5, blocked: 0 }).pause).toBe(false); // too few to judge
  });
  it("pauses when the block/opt-out rate crosses 5%", () => {
    expect(evaluateQualityGuard({ sent: 100, failed: 0, blocked: 6 }).pause).toBe(true);
    expect(evaluateQualityGuard({ sent: 100, failed: 0, blocked: 5 }).pause).toBe(false);
  });
});

describe("groupDueReminders (§6 consolidation)", () => {
  it("groups by debtor + channel + tenant-local day", () => {
    const at = (iso: string) => new Date(iso);
    const groups = groupDueReminders([
      { id: "r1", debtorId: "d1", channel: "whatsapp" as const, dueAt: at("2026-11-20T08:00:00Z") },
      { id: "r2", debtorId: "d1", channel: "whatsapp" as const, dueAt: at("2026-11-20T15:00:00Z") },
      { id: "r3", debtorId: "d1", channel: "sms" as const, dueAt: at("2026-11-20T08:00:00Z") },
      { id: "r4", debtorId: "d2", channel: "whatsapp" as const, dueAt: at("2026-11-20T08:00:00Z") },
      { id: "r5", debtorId: "d1", channel: "whatsapp" as const, dueAt: at("2026-11-21T08:00:00Z") },
    ], "Africa/Cairo");
    expect(groups).toHaveLength(4);
    expect(groups.find((g) => g.reminderIds.length === 2)?.reminderIds).toEqual(["r1", "r2"]);
  });
});
