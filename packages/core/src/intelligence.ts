import { z } from "zod";
import { sanitizePromptData, type NotificationTone } from "./ai";
import { formatEgp } from "./money";

/**
 * Pure single-tenant AI & Collections Intelligence engine.
 * - Strictly scoped to ONE tenant's own ledger/operational state (Hard Rule #9: no cross-tenant aggregation).
 * - All money stays integer minor units (`bigint`). Never floats.
 * - All external/LLM text outputs are validated via Zod and sanitized against prompt injection (Hard Rule #4).
 */

export type DebtorActionKind =
  | "review_receipt_claim"
  | "resolve_dispute"
  | "follow_up_cheque"
  | "call_or_update_phone"
  | "resume_reminders"
  | "offer_installment_plan"
  | "send_smart_reminder"
  | "no_action";

export type RiskTier = "healthy" | "watch" | "at_risk" | "critical";
export type UrgencyLevel = "low" | "medium" | "high" | "critical";
export type NotificationSeverity = "info" | "warning" | "urgent" | "success";

export interface DebtorScoreInvoiceInput {
  id: string;
  reference: string | null;
  amountMinor: bigint;
  paidMinor: bigint;
  dueOn: string;
  status: string;
}

export interface DebtorScoreChequeInput {
  id: string;
  number: string;
  dueDate: string;
  status: string;
  amountMinor: bigint;
}

export interface DebtorScoreInput {
  debtor: {
    id: string;
    displayName: string;
    phoneE164: string;
    whatsappStatus: string;
    optedOut: boolean;
    riskFlag: boolean;
  };
  invoices: readonly DebtorScoreInvoiceInput[];
  cheques: readonly DebtorScoreChequeInput[];
  openDisputesCount: number;
  pendingClaimsCount: number;
  todayIso: string;
}

export interface DebtorRecommendation {
  actionKind: DebtorActionKind;
  titleAr: string;
  titleEn: string;
  reasonAr: string;
  reasonEn: string;
  suggestedTone: NotificationTone;
  urgency: UrgencyLevel;
}

export interface DebtorIntelligence {
  debtorId: string;
  displayName: string;
  phoneE164: string;
  whatsappCapable: boolean;
  optedOut: boolean;
  riskFlag: boolean;
  outstandingMinor: bigint;
  overdueMinor: bigint;
  maxDaysOverdue: number;
  openInvoicesCount: number;
  paidInvoicesCount: number;
  healthScore: number;
  tier: RiskTier;
  priorityScore: number;
  recommendation: DebtorRecommendation;
}

function isoDayDiff(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.floor((b - a) / 86_400_000);
}

function clampInt(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function scoreDebtorIntelligence(input: DebtorScoreInput): DebtorIntelligence {
  const { debtor, invoices, cheques, openDisputesCount, pendingClaimsCount, todayIso } = input;
  const safeName = sanitizePromptData(debtor.displayName) || debtor.displayName;
  const whatsappCapable = debtor.whatsappStatus !== "unreachable";

  let outstandingMinor = 0n;
  let overdueMinor = 0n;
  let maxDaysOverdue = 0;
  let openInvoicesCount = 0;
  let paidInvoicesCount = 0;

  for (const inv of invoices) {
    if (inv.status === "paid") {
      paidInvoicesCount += 1;
      continue;
    }
    if (inv.status === "cancelled" || inv.status === "written_off") continue;
    const rem = inv.amountMinor - inv.paidMinor;
    if (rem <= 0n) continue;
    outstandingMinor += rem;
    openInvoicesCount += 1;
    const overdueDays = isoDayDiff(inv.dueOn, todayIso);
    if (overdueDays > 0 && inv.status !== "disputed") {
      overdueMinor += rem;
      if (overdueDays > maxDaysOverdue) maxDaysOverdue = overdueDays;
    }
  }

  const dueSoonCheque = cheques.find(
    (c) => (c.status === "held" || c.status === "deposited") && isoDayDiff(todayIso, c.dueDate) <= 3,
  );
  const hasBouncedCheque = cheques.some((c) => c.status === "bounced");

  // Deterministic health score (0-100) from single-tenant history only
  let health = 100;
  if (debtor.riskFlag || hasBouncedCheque) health -= 30;
  if (openDisputesCount > 0) health -= 20;
  if (debtor.optedOut && outstandingMinor > 0n) health -= 15;
  if (!whatsappCapable && outstandingMinor > 0n) health -= 10;
  if (maxDaysOverdue > 60) health -= 40;
  else if (maxDaysOverdue > 30) health -= 28;
  else if (maxDaysOverdue > 14) health -= 18;
  else if (maxDaysOverdue > 7) health -= 10;
  else if (maxDaysOverdue > 0) health -= 5;
  if (paidInvoicesCount >= 2 && maxDaysOverdue <= 7 && !debtor.riskFlag) health += 5;

  const healthScore = clampInt(health, 0, 100);
  const tier: RiskTier =
    outstandingMinor === 0n
      ? "healthy"
      : healthScore >= 80
        ? "healthy"
        : healthScore >= 60
          ? "watch"
          : healthScore >= 45
            ? "at_risk"
            : "critical";

  // Priority score ranks highest-impact actions first
  let priority = 0;
  if (outstandingMinor > 0n) {
    if (outstandingMinor >= 1_000_000n) priority += 30; // >= 10,000 EGP
    else if (outstandingMinor >= 250_000n) priority += 22; // >= 2,500 EGP
    else if (outstandingMinor >= 50_000n) priority += 14; // >= 500 EGP
    else priority += 8;

    priority += Math.min(35, Math.max(0, maxDaysOverdue));
  }
  if (pendingClaimsCount > 0) priority += 40;
  if (openDisputesCount > 0) priority += 30;
  if (dueSoonCheque) priority += 25;
  if (debtor.riskFlag || hasBouncedCheque) priority += 15;

  const priorityScore = clampInt(priority, 0, 100);
  const formattedOut = formatEgp(outstandingMinor);

  let recommendation: DebtorRecommendation;
  if (pendingClaimsCount > 0) {
    recommendation = {
      actionKind: "review_receipt_claim",
      titleAr: "مراجعة إيصال سداد معلق",
      titleEn: "Review pending receipt claim",
      reasonAr: `يوجد ${pendingClaimsCount} إيصال تحويل بانتظار مطابقته وتأكيده لـ ${safeName}.`,
      reasonEn: `${pendingClaimsCount} payment receipt claim(s) awaiting confirmation for ${safeName}.`,
      suggestedTone: "friendly",
      urgency: "high",
    };
  } else if (openDisputesCount > 0) {
    recommendation = {
      actionKind: "resolve_dispute",
      titleAr: "حسم اعتراض فاتورة مفتوح",
      titleEn: "Resolve open invoice dispute",
      reasonAr: `تم تعليق التذكيرات التلقائية لحين مراجعة الاعتراض المسجّل من العميل.`,
      reasonEn: `Automatic reminders paused pending resolution of customer dispute.`,
      suggestedTone: "polite",
      urgency: "high",
    };
  } else if (outstandingMinor === 0n) {
    recommendation = {
      actionKind: "no_action",
      titleAr: "حساب منتظم ومسدّد",
      titleEn: "Account in good standing",
      reasonAr: "لا توجد مستحقات مفتوحة حالياً.",
      reasonEn: "No open receivables requiring follow-up.",
      suggestedTone: "friendly",
      urgency: "low",
    };
  } else if (dueSoonCheque) {
    recommendation = {
      actionKind: "follow_up_cheque",
      titleAr: `متابعة تحصيل شيك #${dueSoonCheque.number}`,
      titleEn: `Follow up cheque #${dueSoonCheque.number}`,
      reasonAr: `شيك بقيمة ${formatEgp(dueSoonCheque.amountMinor)} ج.م يستحق بحلول ${dueSoonCheque.dueDate}.`,
      reasonEn: `Cheque of ${formatEgp(dueSoonCheque.amountMinor)} EGP due on ${dueSoonCheque.dueDate}.`,
      suggestedTone: "polite",
      urgency: "high",
    };
  } else if (!whatsappCapable) {
    recommendation = {
      actionKind: "call_or_update_phone",
      titleAr: "تحديث الهاتف أو اتصال مباشر",
      titleEn: "Call directly or update phone",
      reasonAr: `الرقم لا يستقبل رسائل واتساب، والمستحق ${formattedOut} ج.م.`,
      reasonEn: `Phone is unreachable on WhatsApp; ${formattedOut} EGP outstanding.`,
      suggestedTone: "polite",
      urgency: maxDaysOverdue > 7 ? "high" : "medium",
    };
  } else if (debtor.optedOut) {
    recommendation = {
      actionKind: "resume_reminders",
      titleAr: "مراجعة إيقاف التذكيرات أو التواصل الشخصي",
      titleEn: "Review paused reminders or contact directly",
      reasonAr: `التذكيرات التلقائية موقوفة مع وجود رصيد مفتوح ${formattedOut} ج.م.`,
      reasonEn: `Auto-reminders paused with ${formattedOut} EGP balance due.`,
      suggestedTone: "polite",
      urgency: maxDaysOverdue > 14 ? "high" : "medium",
    };
  } else if ((maxDaysOverdue > 30 || debtor.riskFlag || hasBouncedCheque) && outstandingMinor >= 500_000n) {
    recommendation = {
      actionKind: "offer_installment_plan",
      titleAr: "إشعار عاجل مع خيار جدولة السداد",
      titleEn: "Urgent notice with payment plan option",
      reasonAr: `تأخر ${maxDaysOverdue} يوماً على مستحقات ${formattedOut} ج.م — يُنصح بتأمين التزام مجدول.`,
      reasonEn: `${maxDaysOverdue}d overdue on ${formattedOut} EGP — structured settlement recommended.`,
      suggestedTone: "urgent",
      urgency: "critical",
    };
  } else if (maxDaysOverdue > 14 || debtor.riskFlag || hasBouncedCheque) {
    recommendation = {
      actionKind: "send_smart_reminder",
      titleAr: "إرسال تذكير حازم مع رابط سداد فوري",
      titleEn: "Send firm reminder with instant payment link",
      reasonAr: `مستحقات متأخرة منذ ${maxDaysOverdue} يوماً بقيمة ${formattedOut} ج.م.`,
      reasonEn: `${formattedOut} EGP overdue by ${maxDaysOverdue} days.`,
      suggestedTone: maxDaysOverdue > 30 ? "urgent" : "firm",
      urgency: maxDaysOverdue > 30 ? "critical" : "high",
    };
  } else if (maxDaysOverdue > 0) {
    recommendation = {
      actionKind: "send_smart_reminder",
      titleAr: "متابعة مهذبة عبر واتساب",
      titleEn: "Send polite WhatsApp follow-up",
      reasonAr: `تأخر طفيف (${maxDaysOverdue} يوم) على رصيد ${formattedOut} ج.م.`,
      reasonEn: `Recently due (${maxDaysOverdue}d) with ${formattedOut} EGP open.`,
      suggestedTone: "polite",
      urgency: "medium",
    };
  } else {
    recommendation = {
      actionKind: "send_smart_reminder",
      titleAr: "تذكير استباقي ودي قبل الاستحقاق",
      titleEn: "Friendly pre-due reminder",
      reasonAr: `رصيد مفتوح بقيمة ${formattedOut} ج.م ضمن فترة السماح.`,
      reasonEn: `${formattedOut} EGP open within terms.`,
      suggestedTone: "friendly",
      urgency: "low",
    };
  }

  return {
    debtorId: debtor.id,
    displayName: safeName,
    phoneE164: debtor.phoneE164,
    whatsappCapable,
    optedOut: debtor.optedOut,
    riskFlag: debtor.riskFlag,
    outstandingMinor,
    overdueMinor,
    maxDaysOverdue,
    openInvoicesCount,
    paidInvoicesCount,
    healthScore,
    tier,
    priorityScore,
    recommendation,
  };
}

export const BriefingNarrationSchema = z.object({
  headlineAr: z.string().trim().min(4).max(160),
  headlineEn: z.string().trim().min(4).max(160),
  summaryAr: z.string().trim().min(10).max(500),
  summaryEn: z.string().trim().min(10).max(500),
});
export type BriefingNarration = z.infer<typeof BriefingNarrationSchema>;

export interface CollectionsBriefingInput {
  todayIso: string;
  businessName: string;
  totalOutstandingMinor: bigint;
  overdueMinor: bigint;
  collectedThisMonthMinor: bigint;
  collectionRate: number;
  dsoDays: number;
  pendingClaimsCount: number;
  openDisputesCount: number;
  humanIntentsCount: number;
  upcomingChequesCount: number;
  bouncedChequesCount: number;
  debtors: readonly DebtorIntelligence[];
  llmNarration?: unknown;
}

export interface CollectionsBriefing {
  todayIso: string;
  businessName: string;
  healthStatus: "strong" | "attention" | "urgent";
  headlineAr: string;
  headlineEn: string;
  summaryAr: string;
  summaryEn: string;
  metrics: {
    totalOutstandingMinor: bigint;
    overdueMinor: bigint;
    collectedThisMonthMinor: bigint;
    collectionRate: number;
    dsoDays: number;
    pendingClaimsCount: number;
    openDisputesCount: number;
    humanIntentsCount: number;
    upcomingChequesCount: number;
    bouncedChequesCount: number;
  };
  topActions: DebtorIntelligence[];
}

export function buildCollectionsBriefing(input: CollectionsBriefingInput): CollectionsBriefing {
  const safeBiz = sanitizePromptData(input.businessName) || input.businessName;
  const actionable = [...input.debtors]
    .filter((d) => d.recommendation.actionKind !== "no_action")
    .sort((a, b) => {
      if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
      return b.outstandingMinor > a.outstandingMinor ? 1 : b.outstandingMinor < a.outstandingMinor ? -1 : 0;
    });
  const topActions = actionable.slice(0, 5);

  const attentionCount =
    input.pendingClaimsCount + input.openDisputesCount + input.humanIntentsCount + input.bouncedChequesCount;
  const overdueRatio =
    input.totalOutstandingMinor > 0n
      ? Number((input.overdueMinor * 100n) / input.totalOutstandingMinor)
      : 0;

  const healthStatus: "strong" | "attention" | "urgent" =
    input.bouncedChequesCount > 0 || overdueRatio >= 50 || input.openDisputesCount > 0
      ? "urgent"
      : input.overdueMinor > 0n || attentionCount > 0
        ? "attention"
        : "strong";

  const outStr = formatEgp(input.totalOutstandingMinor);
  const ovStr = formatEgp(input.overdueMinor);
  const colStr = formatEgp(input.collectedThisMonthMinor);

  let headlineAr = "";
  let headlineEn = "";
  let summaryAr = "";
  let summaryEn = "";

  if (input.totalOutstandingMinor === 0n && attentionCount === 0) {
    headlineAr = "السيولة مستقرة — لا توجد متأخرات عاجلة اليوم";
    headlineEn = "Healthy cash position — no urgent overdue items today";
    summaryAr = `تم تحصيل ${colStr} ج.م هذا الشهر بنجاح في ${safeBiz}. يمكنك إضافة فواتير جديدة أو استيراد كشوف الحسابات لجدولة المتابعة التلقائية.`;
    summaryEn = `${colStr} EGP collected this month at ${safeBiz}. Add new invoices or import ledgers to automate follow-ups.`;
  } else {
    headlineAr =
      healthStatus === "urgent"
        ? `أولوية تحصيل عاجلة: ${ovStr} ج.م متأخرات تتطلب متابعة اليوم`
        : `ملخص التحصيل اليومي: ${outStr} ج.م إجمالي المستحقات النشطة`;
    headlineEn =
      healthStatus === "urgent"
        ? `Urgent focus: ${ovStr} EGP overdue requires action today`
        : `Daily Collections Briefing: ${outStr} EGP active receivables`;

    const partsAr: string[] = [
      `إجمالي المستحقات الحالية ${outStr} ج.م (منها ${ovStr} ج.م متأخرة السداد)، بينما بلغ المحصّل هذا الشهر ${colStr} ج.م.`,
    ];
    const partsEn: string[] = [
      `Total open receivables stand at ${outStr} EGP (${ovStr} EGP overdue), with ${colStr} EGP collected this month.`,
    ];
    if (attentionCount > 0 || input.upcomingChequesCount > 0) {
      const pendingItemsAr: string[] = [];
      const pendingItemsEn: string[] = [];
      if (input.pendingClaimsCount > 0) {
        pendingItemsAr.push(`${input.pendingClaimsCount} إيصال بانتظار التأكيد`);
        pendingItemsEn.push(`${input.pendingClaimsCount} receipt claim(s)`);
      }
      if (input.openDisputesCount > 0) {
        pendingItemsAr.push(`${input.openDisputesCount} اعتراض مفتوح`);
        pendingItemsEn.push(`${input.openDisputesCount} open dispute(s)`);
      }
      if (input.humanIntentsCount > 0) {
        pendingItemsAr.push(`${input.humanIntentsCount} رد وارد للمراجعة`);
        pendingItemsEn.push(`${input.humanIntentsCount} inbox reply(ies)`);
      }
      if (input.upcomingChequesCount > 0) {
        pendingItemsAr.push(`${input.upcomingChequesCount} شيك قريب الاستحقاق`);
        pendingItemsEn.push(`${input.upcomingChequesCount} upcoming cheque(s)`);
      }
      partsAr.push(`يوجد حالياً: ${pendingItemsAr.join("، ")}.`);
      partsEn.push(`Action queue: ${pendingItemsEn.join(", ")}.`);
    }
    if (topActions[0]) {
      partsAr.push(`الخطوة الأهم الآن: ${topActions[0].displayName} (${topActions[0].recommendation.titleAr}).`);
      partsEn.push(`Top priority: ${topActions[0].displayName} (${topActions[0].recommendation.titleEn}).`);
    }
    summaryAr = partsAr.join(" ");
    summaryEn = partsEn.join(" ");
  }

  // Optional Zod-validated LLM narration override (Hard Rule #4)
  if (input.llmNarration !== undefined && input.llmNarration !== null) {
    const parsed = BriefingNarrationSchema.safeParse(input.llmNarration);
    if (parsed.success) {
      headlineAr = sanitizePromptData(parsed.data.headlineAr) || headlineAr;
      headlineEn = sanitizePromptData(parsed.data.headlineEn) || headlineEn;
      summaryAr = sanitizePromptData(parsed.data.summaryAr) || summaryAr;
      summaryEn = sanitizePromptData(parsed.data.summaryEn) || summaryEn;
    }
  }

  return {
    todayIso: input.todayIso,
    businessName: safeBiz,
    healthStatus,
    headlineAr,
    headlineEn,
    summaryAr,
    summaryEn,
    metrics: {
      totalOutstandingMinor: input.totalOutstandingMinor,
      overdueMinor: input.overdueMinor,
      collectedThisMonthMinor: input.collectedThisMonthMinor,
      collectionRate: input.collectionRate,
      dsoDays: input.dsoDays,
      pendingClaimsCount: input.pendingClaimsCount,
      openDisputesCount: input.openDisputesCount,
      humanIntentsCount: input.humanIntentsCount,
      upcomingChequesCount: input.upcomingChequesCount,
      bouncedChequesCount: input.bouncedChequesCount,
    },
    topActions,
  };
}

export interface NotificationCandidate {
  kind:
    | "receipt_claim"
    | "dispute"
    | "ai_inbox"
    | "cheque_alert"
    | "overdue_alert"
    | "quota_alert"
    | "ai_briefing"
    | "payment_confirmed";
  severity: NotificationSeverity;
  titleAr: string;
  titleEn: string;
  bodyAr: string;
  bodyEn: string;
  actionUrl: string;
  entityType?: string;
  entityId?: string;
  dedupeKey: string;
}

export interface OperationalSignalsInput {
  todayIso: string;
  pendingClaims: readonly { id: string; debtorId: string; debtorName: string; amountMinor: bigint }[];
  openDisputes: readonly { id: string; debtorId: string; debtorName: string; invoiceRef: string | null }[];
  humanIntents: readonly { id: string; intent: string; bodySnippet: string }[];
  upcomingCheques: readonly {
    id: string;
    number: string;
    debtorName: string;
    dueDate: string;
    amountMinor: bigint;
    status: string;
  }[];
  severeOverdueDebtors: readonly { debtorId: string; displayName: string; overdueMinor: bigint; maxDaysOverdue: number }[];
  quotaRatio: number | null;
  briefingSummaryAr?: string;
  briefingSummaryEn?: string;
}

export function buildOperationalNotificationCandidates(input: OperationalSignalsInput): NotificationCandidate[] {
  const out: NotificationCandidate[] = [];
  const monthKey = input.todayIso.slice(0, 7);

  for (const claim of input.pendingClaims.slice(0, 5)) {
    const safeName = sanitizePromptData(claim.debtorName) || claim.debtorName;
    const amt = formatEgp(claim.amountMinor);
    out.push({
      kind: "receipt_claim",
      severity: "warning",
      titleAr: `إيصال سداد بانتظار التأكيد — ${safeName}`,
      titleEn: `Payment receipt claim pending review — ${safeName}`,
      bodyAr: `تم تسجيل مطالبة سداد بقيمة ${amt} ج.م. راجع الإيصال واعتمد التسوية.`,
      bodyEn: `Receipt claim of ${amt} EGP awaiting bank verification and confirmation.`,
      actionUrl: "/ai-inbox",
      entityType: "payment",
      entityId: claim.id,
      dedupeKey: `receipt:${claim.id}`,
    });
  }

  for (const disp of input.openDisputes.slice(0, 5)) {
    const safeName = sanitizePromptData(disp.debtorName) || disp.debtorName;
    out.push({
      kind: "dispute",
      severity: "urgent",
      titleAr: `اعتراض مفتوح من ${safeName}`,
      titleEn: `Open invoice dispute from ${safeName}`,
      bodyAr: `الاعتراض${disp.invoiceRef ? ` على ${disp.invoiceRef}` : ""} أوقف التذكيرات التلقائية لحين المراجعة.`,
      bodyEn: `Dispute${disp.invoiceRef ? ` on ${disp.invoiceRef}` : ""} paused automated reminders until resolved.`,
      actionUrl: `/debtors/${disp.debtorId}`,
      entityType: "dispute",
      entityId: disp.id,
      dedupeKey: `dispute:${disp.id}`,
    });
  }

  for (const intent of input.humanIntents.slice(0, 5)) {
    const snippet = sanitizePromptData(intent.bodySnippet).slice(0, 70);
    out.push({
      kind: "ai_inbox",
      severity: "warning",
      titleAr: "رد وارد من عميل يحتاج مراجعة",
      titleEn: "Inbound customer reply needs review",
      bodyAr: snippet ? `الرسالة: «${snippet}»` : "رسالة واردة على واتساب بانتظار القرار البشري.",
      bodyEn: snippet ? `Message: "${snippet}"` : "Inbound WhatsApp reply awaiting human triage.",
      actionUrl: "/ai-inbox",
      entityType: "message_intent",
      entityId: intent.id,
      dedupeKey: `intent:${intent.id}`,
    });
  }

  for (const chq of input.upcomingCheques.slice(0, 5)) {
    const safeName = sanitizePromptData(chq.debtorName) || chq.debtorName;
    const amt = formatEgp(chq.amountMinor);
    const isBounced = chq.status === "bounced";
    out.push({
      kind: "cheque_alert",
      severity: isBounced ? "urgent" : "warning",
      titleAr: isBounced ? `تنبيه: ارتداد شيك #${chq.number}` : `استحقاق شيك #${chq.number} قريباً`,
      titleEn: isBounced ? `Alert: Cheque #${chq.number} bounced` : `Cheque #${chq.number} due soon`,
      bodyAr: `${safeName} — ${amt} ج.م (تاريخ الاستحقاق ${chq.dueDate}).`,
      bodyEn: `${safeName} — ${amt} EGP (due ${chq.dueDate}).`,
      actionUrl: "/cheques",
      entityType: "cheque",
      entityId: chq.id,
      dedupeKey: isBounced ? `cheque_bounced:${chq.id}` : `cheque_due:${chq.id}:${chq.dueDate}`,
    });
  }

  for (const deb of input.severeOverdueDebtors.slice(0, 3)) {
    const safeName = sanitizePromptData(deb.displayName) || deb.displayName;
    const amt = formatEgp(deb.overdueMinor);
    out.push({
      kind: "overdue_alert",
      severity: deb.maxDaysOverdue > 30 ? "urgent" : "warning",
      titleAr: `تأخر سداد (${deb.maxDaysOverdue} يوم) — ${safeName}`,
      titleEn: `Overdue alert (${deb.maxDaysOverdue}d) — ${safeName}`,
      bodyAr: `رصيد متأخر بقيمة ${amt} ج.م. يُنصح بإرسال تذكير حازم مع رابط سداد.`,
      bodyEn: `${amt} EGP overdue. Recommended: send firm reminder with payment link.`,
      actionUrl: `/debtors/${deb.debtorId}`,
      entityType: "debtor",
      entityId: deb.debtorId,
      dedupeKey: `overdue:${deb.debtorId}:${monthKey}`,
    });
  }

  if (input.quotaRatio !== null && input.quotaRatio >= 0.8) {
    const pct = Math.round(input.quotaRatio * 100);
    out.push({
      kind: "quota_alert",
      severity: input.quotaRatio >= 1 ? "urgent" : "warning",
      titleAr: input.quotaRatio >= 1 ? "استنفاد حصة التذكيرات الشهرية" : `استهلاك ${pct}% من حصة الرسائل`,
      titleEn: input.quotaRatio >= 1 ? "Monthly reminder quota reached" : `${pct}% of monthly quota used`,
      bodyAr: "قم بترقية الباقة لضمان استمرار إرسال التذكيرات الآلية دون انقطاع.",
      bodyEn: "Upgrade your plan to keep automated WhatsApp reminders active without interruption.",
      actionUrl: "/billing",
      dedupeKey: `quota:${monthKey}`,
    });
  }

  if (input.briefingSummaryAr && input.briefingSummaryEn) {
    out.push({
      kind: "ai_briefing",
      severity: "info",
      titleAr: `الملخص الذكي ليوم ${input.todayIso}`,
      titleEn: `Daily AI Briefing — ${input.todayIso}`,
      bodyAr: input.briefingSummaryAr,
      bodyEn: input.briefingSummaryEn,
      actionUrl: "/dashboard",
      dedupeKey: `briefing:${input.todayIso}`,
    });
  }

  return out;
}
