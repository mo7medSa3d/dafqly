import { describe, it, expect } from "vitest";
import {
  scoreDebtorIntelligence,
  buildCollectionsBriefing,
  buildOperationalNotificationCandidates,
  BriefingNarrationSchema,
} from "./intelligence";

describe("intelligence: scoreDebtorIntelligence", () => {
  it("recommends review_receipt_claim as highest priority when a receipt claim is pending", () => {
    const res = scoreDebtorIntelligence({
      debtor: {
        id: "d-1", displayName: "شركة النور", phoneE164: "+201001112222",
        whatsappStatus: "reachable", optedOut: false, riskFlag: false,
      },
      invoices: [
        { id: "i-1", reference: "INV-1", amountMinor: 250_000n, paidMinor: 0n, dueOn: "2026-11-01", status: "open" },
      ],
      cheques: [],
      openDisputesCount: 0,
      pendingClaimsCount: 1,
      todayIso: "2026-11-11",
    });

    expect(res.outstandingMinor).toBe(250_000n);
    expect(res.overdueMinor).toBe(250_000n);
    expect(res.maxDaysOverdue).toBe(10);
    expect(res.recommendation.actionKind).toBe("review_receipt_claim");
    expect(res.recommendation.urgency).toBe("high");
    expect(res.priorityScore).toBeGreaterThan(60);
  });

  it("flags open disputes and pauses reminder suggestions", () => {
    const res = scoreDebtorIntelligence({
      debtor: {
        id: "d-2", displayName: "مكتب الأمل", phoneE164: "+201002223333",
        whatsappStatus: "reachable", optedOut: false, riskFlag: false,
      },
      invoices: [
        { id: "i-2", reference: "INV-2", amountMinor: 100_000n, paidMinor: 0n, dueOn: "2026-11-01", status: "disputed" },
      ],
      cheques: [],
      openDisputesCount: 1,
      pendingClaimsCount: 0,
      todayIso: "2026-11-11",
    });

    expect(res.recommendation.actionKind).toBe("resolve_dispute");
    expect(res.healthScore).toBeLessThan(85);
  });

  it("handles opted-out or WhatsApp-unreachable debtors safely", () => {
    const optedOut = scoreDebtorIntelligence({
      debtor: {
        id: "d-3", displayName: "عميل متوقف", phoneE164: "+201003334444",
        whatsappStatus: "reachable", optedOut: true, riskFlag: false,
      },
      invoices: [
        { id: "i-3", reference: "INV-3", amountMinor: 300_000n, paidMinor: 0n, dueOn: "2026-11-05", status: "open" },
      ],
      cheques: [],
      openDisputesCount: 0,
      pendingClaimsCount: 0,
      todayIso: "2026-11-11",
    });
    expect(optedOut.recommendation.actionKind).toBe("resume_reminders");

    const unreachable = scoreDebtorIntelligence({
      debtor: {
        id: "d-4", displayName: "عميل أرضي", phoneE164: "+20223456789",
        whatsappStatus: "unreachable", optedOut: false, riskFlag: false,
      },
      invoices: [
        { id: "i-4", reference: "INV-4", amountMinor: 300_000n, paidMinor: 0n, dueOn: "2026-11-05", status: "open" },
      ],
      cheques: [],
      openDisputesCount: 0,
      pendingClaimsCount: 0,
      todayIso: "2026-11-11",
    });
    expect(unreachable.recommendation.actionKind).toBe("call_or_update_phone");
  });

  it("recommends installment plan or urgent reminder for severely overdue risky debtors", () => {
    const res = scoreDebtorIntelligence({
      debtor: {
        id: "d-5", displayName: "مقاولات الفيروز", phoneE164: "+201005556666",
        whatsappStatus: "reachable", optedOut: false, riskFlag: true,
      },
      invoices: [
        { id: "i-5", reference: "INV-5", amountMinor: 1_500_000n, paidMinor: 200_000n, dueOn: "2026-09-15", status: "partially_paid" },
      ],
      cheques: [],
      openDisputesCount: 0,
      pendingClaimsCount: 0,
      todayIso: "2026-11-11",
    });

    expect(res.outstandingMinor).toBe(1_300_000n);
    expect(res.tier).toBe("critical");
    expect(res.recommendation.suggestedTone).toBe("urgent");
    expect(res.recommendation.actionKind).toBe("offer_installment_plan");
  });

  it("gives healthy 100 score and no_action when fully settled", () => {
    const res = scoreDebtorIntelligence({
      debtor: {
        id: "d-6", displayName: "عميل منتظم", phoneE164: "+201006667777",
        whatsappStatus: "reachable", optedOut: false, riskFlag: false,
      },
      invoices: [
        { id: "i-6", reference: "INV-6", amountMinor: 50_000n, paidMinor: 50_000n, dueOn: "2026-10-01", status: "paid" },
      ],
      cheques: [],
      openDisputesCount: 0,
      pendingClaimsCount: 0,
      todayIso: "2026-11-11",
    });

    expect(res.outstandingMinor).toBe(0n);
    expect(res.healthScore).toBe(100);
    expect(res.tier).toBe("healthy");
    expect(res.recommendation.actionKind).toBe("no_action");
  });
});

describe("intelligence: buildCollectionsBriefing & Zod safety", () => {
  it("synthesizes executive briefing with top prioritized actions and sanitized LLM override", () => {
    const d1 = scoreDebtorIntelligence({
      debtor: { id: "d-1", displayName: "شركة النور", phoneE164: "+201001112222", whatsappStatus: "reachable", optedOut: false, riskFlag: false },
      invoices: [{ id: "i-1", reference: "INV-1", amountMinor: 500_000n, paidMinor: 0n, dueOn: "2026-10-20", status: "open" }],
      cheques: [],
      openDisputesCount: 0,
      pendingClaimsCount: 0,
      todayIso: "2026-11-11",
    });
    const d2 = scoreDebtorIntelligence({
      debtor: { id: "d-2", displayName: "عميل مسدد", phoneE164: "+201009998888", whatsappStatus: "reachable", optedOut: false, riskFlag: false },
      invoices: [{ id: "i-2", reference: "INV-2", amountMinor: 100_000n, paidMinor: 100_000n, dueOn: "2026-10-01", status: "paid" }],
      cheques: [],
      openDisputesCount: 0,
      pendingClaimsCount: 0,
      todayIso: "2026-11-11",
    });

    const briefing = buildCollectionsBriefing({
      todayIso: "2026-11-11",
      businessName: "شركة النيل",
      totalOutstandingMinor: 500_000n,
      overdueMinor: 500_000n,
      collectedThisMonthMinor: 100_000n,
      collectionRate: 0.17,
      dsoDays: 42,
      pendingClaimsCount: 1,
      openDisputesCount: 0,
      humanIntentsCount: 1,
      upcomingChequesCount: 1,
      bouncedChequesCount: 0,
      debtors: [d2, d1],
    });

    expect(briefing.healthStatus).toBe("urgent");
    expect(briefing.topActions).toHaveLength(1);
    expect(briefing.topActions[0]!.debtorId).toBe("d-1");
    expect(briefing.summaryAr).toContain("5,000.00");

    // Rejects untrusted / malformed LLM narration cleanly
    const bad = BriefingNarrationSchema.safeParse({ headlineAr: 123 });
    expect(bad.success).toBe(false);
  });
});

describe("intelligence: buildOperationalNotificationCandidates", () => {
  it("generates deduplicated actionable notifications across receipts, disputes, cheques, and daily briefing", () => {
    const candidates = buildOperationalNotificationCandidates({
      todayIso: "2026-11-11",
      pendingClaims: [{ id: "p-1", debtorId: "d-1", debtorName: "شركة النور", amountMinor: 125_000n }],
      openDisputes: [{ id: "disp-1", debtorId: "d-2", debtorName: "مكتب الأمل", invoiceRef: "INV-2" }],
      humanIntents: [{ id: "int-1", intent: "question", bodySnippet: "هل يوجد خصم؟" }],
      upcomingCheques: [{ id: "chq-1", number: "88412", debtorName: "الفيروز", dueDate: "2026-11-12", amountMinor: 300_000n, status: "held" }],
      severeOverdueDebtors: [{ debtorId: "d-1", displayName: "شركة النور", overdueMinor: 125_000n, maxDaysOverdue: 20 }],
      quotaRatio: 0.85,
      briefingSummaryAr: "ملخص اليوم التنفيذي.",
      briefingSummaryEn: "Today's executive briefing.",
    });

    const keys = candidates.map((c) => c.dedupeKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toContain("receipt:p-1");
    expect(keys).toContain("dispute:disp-1");
    expect(keys).toContain("intent:int-1");
    expect(keys).toContain("cheque_due:chq-1:2026-11-12");
    expect(keys).toContain("quota:2026-11");
    expect(keys).toContain("briefing:2026-11-11");
  });
});
