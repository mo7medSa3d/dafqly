import { z } from "zod";
import { sanitizePromptData, type NotificationTone, type ReplyIntent } from "./ai";
import { formatEgp } from "./money";
import { isInQuietHours, nextAllowedSlot, localDateOf, DEFAULT_POLICY, type SchedulePolicy } from "./time";

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

function addDaysIsoPure(iso: string, days: number): string {
  const dt = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return iso.slice(0, 10);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
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

// =============================================================================
// Portfolio Concentration & Liquidity Risk Engine (Single-Tenant Only)
// =============================================================================

export type ConcentrationLevel = "diversified" | "moderate" | "high_concentration";

export interface PortfolioRiskInput {
  totalOutstandingMinor: bigint;
  overdueMinor: bigint;
  collectedThisMonthMinor: bigint;
  collectionRate: number;
  dsoDays: number;
  debtors: readonly DebtorIntelligence[];
}

export interface PortfolioRiskAnalysis {
  topDebtorSharePct: number;
  topDebtorName: string | null;
  top3ConcentrationPct: number;
  concentrationLevel: ConcentrationLevel;
  overdueSeverityRatioPct: number;
  atRiskReceivablesMinor: bigint;
  expectedNext14DaysMinor: bigint;
  velocityScore: number; // 0-100 composite liquidity velocity index
  insightsAr: string[];
  insightsEn: string[];
}

export function analyzePortfolioRisk(input: PortfolioRiskInput): PortfolioRiskAnalysis {
  const openDebtors = [...input.debtors]
    .filter((d) => d.outstandingMinor > 0n)
    .sort((a, b) => (b.outstandingMinor > a.outstandingMinor ? 1 : b.outstandingMinor < a.outstandingMinor ? -1 : 0));

  const totalOut = input.totalOutstandingMinor > 0n
    ? input.totalOutstandingMinor
    : openDebtors.reduce((acc, d) => acc + d.outstandingMinor, 0n);

  const topDebtor = openDebtors[0] ?? null;
  const topDebtorSharePct =
    totalOut > 0n && topDebtor
      ? clampInt(Number((topDebtor.outstandingMinor * 100n) / totalOut), 0, 100)
      : 0;

  const top3Sum = openDebtors.slice(0, 3).reduce((acc, d) => acc + d.outstandingMinor, 0n);
  const top3ConcentrationPct =
    totalOut > 0n ? clampInt(Number((top3Sum * 100n) / totalOut), 0, 100) : 0;

  const concentrationLevel: ConcentrationLevel =
    openDebtors.length >= 2 && (topDebtorSharePct >= 50 || top3ConcentrationPct >= 85)
      ? "high_concentration"
      : topDebtorSharePct >= 35 || top3ConcentrationPct >= 70
        ? "moderate"
        : "diversified";

  const overdueSeverityRatioPct =
    totalOut > 0n ? clampInt(Number((input.overdueMinor * 100n) / totalOut), 0, 100) : 0;

  const atRiskReceivablesMinor = openDebtors
    .filter((d) => d.tier === "critical" || d.tier === "at_risk")
    .reduce((acc, d) => acc + d.outstandingMinor, 0n);

  const expectedNext14DaysMinor = openDebtors
    .filter((d) => (d.tier === "healthy" || d.tier === "watch") && d.maxDaysOverdue <= 14 && !d.optedOut)
    .reduce((acc, d) => acc + d.outstandingMinor, 0n);

  const rateComponent = clampInt(input.collectionRate * 100, 0, 100);
  const dsoPenalty = clampInt(Math.max(0, input.dsoDays - 15) * 1.2, 0, 45);
  const overduePenalty = Math.round(overdueSeverityRatioPct * 0.35);
  const velocityScore = clampInt(100 - dsoPenalty - overduePenalty + Math.round(rateComponent * 0.2), 10, 100);

  const insightsAr: string[] = [];
  const insightsEn: string[] = [];

  if (totalOut === 0n) {
    insightsAr.push("المحفظة الائتمانية خالية من أي متأخرات أو مخاطر تركز حالياً.");
    insightsEn.push("Receivables portfolio currently has zero overdue exposure or concentration risk.");
  } else {
    if (concentrationLevel === "high_concentration" && topDebtor) {
      insightsAr.push(
        `تركز ائتماني مرتفع: العميل «${topDebtor.displayName}» يمثل ${topDebtorSharePct}% من إجمالي المديونية المفتوحة (${formatEgp(topDebtor.outstandingMinor)} ج.م).`,
      );
      insightsEn.push(
        `High concentration risk: "${topDebtor.displayName}" accounts for ${topDebtorSharePct}% of total open receivables (${formatEgp(topDebtor.outstandingMinor)} EGP).`,
      );
    } else if (topDebtor) {
      insightsAr.push(
        `توزيع المحفظة متوازن: أعلى عميل مدين يمثل ${topDebtorSharePct}% من الإجمالي (${topDebtor.displayName}).`,
      );
      insightsEn.push(
        `Balanced portfolio distribution: largest debtor represents ${topDebtorSharePct}% of total AR (${topDebtor.displayName}).`,
      );
    }

    if (atRiskReceivablesMinor > 0n) {
      insightsAr.push(
        `سيولة معرضة للمخاطرة: ${formatEgp(atRiskReceivablesMinor)} ج.م ضمن فئة المخاطر المرتفعة/الحرجة يُوصى بجدولتها أو متابعتها فوراً.`,
      );
      insightsEn.push(
        `Receivables at risk: ${formatEgp(atRiskReceivablesMinor)} EGP in high/critical tiers recommended for immediate follow-up or restructuring.`,
      );
    }

    if (expectedNext14DaysMinor > 0n) {
      insightsAr.push(
        `تدفقات متوقعة قريباً: يُتوقع تحصيل نحو ${formatEgp(expectedNext14DaysMinor)} ج.م خلال ١٤ يوماً من الحسابات المنتظمة.`,
      );
      insightsEn.push(
        `Near-term liquidity: ~${formatEgp(expectedNext14DaysMinor)} EGP projected within 14 days from healthy/watch accounts.`,
      );
    }
  }

  return {
    topDebtorSharePct,
    topDebtorName: topDebtor?.displayName ?? null,
    top3ConcentrationPct,
    concentrationLevel,
    overdueSeverityRatioPct,
    atRiskReceivablesMinor,
    expectedNext14DaysMinor,
    velocityScore,
    insightsAr,
    insightsEn,
  };
}

// =============================================================================
// Smart Installment / Settlement Restructuring Engine (Pure Integer Minor Units)
// =============================================================================

export type InstallmentInterval = "weekly" | "biweekly" | "monthly";

export interface InstallmentTranche {
  sequence: number;
  labelAr: string;
  labelEn: string;
  dueDate: string;
  amountMinor: bigint;
  formattedAmount: string;
  isDownPayment: boolean;
}

export interface InstallmentPlanInput {
  debtorName: string;
  businessName: string;
  totalMinor: bigint;
  installmentsCount: 2 | 3 | 4 | 6;
  interval: InstallmentInterval;
  startDateIso: string;
  downPaymentPct?: 0 | 10 | 20 | 25 | 30 | 50;
  reference?: string;
  paymentLink?: string;
}

export interface InstallmentPlanResult {
  debtorName: string;
  businessName: string;
  totalMinor: bigint;
  formattedTotal: string;
  installmentsCount: number;
  interval: InstallmentInterval;
  downPaymentPct: number;
  tranches: InstallmentTranche[];
  proposalTextAr: string;
  proposalTextEn: string;
}

export function buildInstallmentPlan(input: InstallmentPlanInput): InstallmentPlanResult {
  if (input.totalMinor <= 0n) {
    throw new Error("totalMinor must be > 0n (Hard Rule #1)");
  }
  const safeDebtor = sanitizePromptData(input.debtorName) || "العميل";
  const safeBiz = sanitizePromptData(input.businessName) || "دفقلي";
  const count = input.installmentsCount;
  const downPct = input.downPaymentPct ?? 0;
  const stepDays = input.interval === "weekly" ? 7 : input.interval === "biweekly" ? 14 : 30;
  const startIso = input.startDateIso.slice(0, 10);

  const tranches: InstallmentTranche[] = [];

  if (downPct > 0 && count >= 2) {
    const downMinor = (input.totalMinor * BigInt(downPct)) / 100n;
    const remainingMinor = input.totalMinor - downMinor;
    const remCount = BigInt(count - 1);
    const baseTranche = remainingMinor / remCount;
    const remainder = remainingMinor % remCount;

    tranches.push({
      sequence: 1,
      labelAr: `دفعة مقدمة (${downPct}%)`,
      labelEn: `Upfront Down Payment (${downPct}%)`,
      dueDate: startIso,
      amountMinor: downMinor,
      formattedAmount: formatEgp(downMinor),
      isDownPayment: true,
    });

    for (let i = 1; i < count; i++) {
      const isLast = i === count - 1;
      const amt = isLast ? baseTranche + remainder : baseTranche;
      tranches.push({
        sequence: i + 1,
        labelAr: `القسط ${i}`,
        labelEn: `Installment #${i}`,
        dueDate: addDaysIsoPure(startIso, i * stepDays),
        amountMinor: amt,
        formattedAmount: formatEgp(amt),
        isDownPayment: false,
      });
    }
  } else {
    const countBig = BigInt(count);
    const baseTranche = input.totalMinor / countBig;
    const remainder = input.totalMinor % countBig;

    for (let i = 0; i < count; i++) {
      const isLast = i === count - 1;
      const amt = isLast ? baseTranche + remainder : baseTranche;
      tranches.push({
        sequence: i + 1,
        labelAr: `القسط ${i + 1}`,
        labelEn: `Installment #${i + 1}`,
        dueDate: addDaysIsoPure(startIso, i * stepDays),
        amountMinor: amt,
        formattedAmount: formatEgp(amt),
        isDownPayment: false,
      });
    }
  }

  const formattedTotal = formatEgp(input.totalMinor);
  const refNoteAr = input.reference ? ` (${sanitizePromptData(input.reference)})` : "";
  const refNoteEn = input.reference ? ` (${sanitizePromptData(input.reference)})` : "";

  const scheduleLinesAr = tranches
    .map((t) => `• ${t.labelAr}: ${t.formattedAmount} ج.م — بتاريخ ${t.dueDate}`)
    .join("\n");
  const scheduleLinesEn = tranches
    .map((t) => `• ${t.labelEn}: ${t.formattedAmount} EGP — due ${t.dueDate}`)
    .join("\n");

  const linkLineAr = input.paymentLink ? `\nرابط السداد وكشف الحساب الآمن: ${input.paymentLink}` : "";
  const linkLineEn = input.paymentLink ? `\nSecure Payment & Statement Link: ${input.paymentLink}` : "";

  const proposalTextAr = [
    `مرحباً ${safeDebtor}، تحية طيبة من ${safeBiz}.`,
    `حرصاً منا على تيسير سداد المستحقات المفتوحة${refNoteAr} والبالغ إجماليها ${formattedTotal} ج.م، نقترح عليكم خطة جدولة ميسّرة على ${count} دفعات كالتالي:`,
    scheduleLinesAr,
    `يرجى تأكيد الموافقة على الجدول المقترح لاعتماده وإيقاف التذكيرات التلقائية خلال فترة الالتزام.${linkLineAr}`,
  ].join("\n");

  const proposalTextEn = [
    `Hello ${safeDebtor}, greetings from ${safeBiz}.`,
    `To facilitate settling your open balance${refNoteEn} of ${formattedTotal} EGP, we propose the following ${count}-part payment schedule:`,
    scheduleLinesEn,
    `Please reply to confirm this schedule so we can lock it in and pause automated reminders while on track.${linkLineEn}`,
  ].join("\n");

  return {
    debtorName: safeDebtor,
    businessName: safeBiz,
    totalMinor: input.totalMinor,
    formattedTotal,
    installmentsCount: count,
    interval: input.interval,
    downPaymentPct: downPct,
    tranches,
    proposalTextAr,
    proposalTextEn,
  };
}

// =============================================================================
// Smart AI Inbox Reply Composer (Context-Grounded Response to Customer Intents)
// =============================================================================

export interface SmartInboxReplyInput {
  intent: ReplyIntent | "unclassified" | "receipt_image_pending" | string;
  debtorName: string;
  businessName: string;
  outstandingMinor: bigint;
  customerMessage?: string | null;
  promisedDate?: string | null;
  offeredAmountMinor?: bigint | null;
  paymentLink?: string;
  statementLink?: string;
}

export interface SmartInboxReplyResult {
  intent: string;
  replyAr: string;
  replyEn: string;
  recommendedActionAr: string;
  recommendedActionEn: string;
  followUpDays: number;
}

export function generateSmartInboxReply(input: SmartInboxReplyInput): SmartInboxReplyResult {
  const safeDebtor = sanitizePromptData(input.debtorName) || "عميلنا العزيز";
  const safeBiz = sanitizePromptData(input.businessName) || "دفقلي";
  const totalStr = formatEgp(input.outstandingMinor > 0n ? input.outstandingMinor : 0n);
  const promised = input.promisedDate ? sanitizePromptData(input.promisedDate) : null;
  const offeredStr =
    input.offeredAmountMinor && input.offeredAmountMinor > 0n
      ? formatEgp(input.offeredAmountMinor)
      : null;

  let replyAr = "";
  let replyEn = "";
  let recommendedActionAr = "";
  let recommendedActionEn = "";
  let followUpDays = 3;

  switch (input.intent) {
    case "promise_to_pay":
      replyAr = promised
        ? `شكراً لتواصلكم أستاذ/ة ${safeDebtor}. تم تسجيل وعد السداد بتاريخ ${promised} لمبلغ ${totalStr} ج.م لدى ${safeBiz}، وتأجيل التذكيرات التلقائية حتى ذلك الموعد.${input.paymentLink ? `\nرابط الدفع المباشر: ${input.paymentLink}` : ""}`
        : `شكراً لتواصلكم أستاذ/ة ${safeDebtor} مع ${safeBiz}. نرجو تحديد اليوم المتوقع للسداد لتسجيله في الحساب وتعليق التذكيرات التلقائية مؤقتاً.`;
      replyEn = promised
        ? `Thank you ${safeDebtor}. We have logged your promise to pay ${totalStr} EGP on ${promised} at ${safeBiz} and paused reminders until then.${input.paymentLink ? `\nDirect payment link: ${input.paymentLink}` : ""}`
        : `Thank you for reaching out to ${safeBiz}, ${safeDebtor}. Please confirm the exact date you plan to settle ${totalStr} EGP so we can schedule accordingly.`;
      recommendedActionAr = promised ? `تأكيد جدولة المتابعة بعد ${promised}` : "طلب تحديد تاريخ سداد محدد";
      recommendedActionEn = promised ? `Confirm follow-up after ${promised}` : "Ask customer for specific payment date";
      followUpDays = 5;
      break;

    case "already_paid":
    case "receipt_image_pending":
      replyAr = `شكراً لك أستاذ/ة ${safeDebtor}. لتأكيد التسوية وإغلاق الرصيد المفتوح (${totalStr} ج.م) لدى ${safeBiz}، نرجو إرسال صورة إيصال التحويل أو رقم العملية المرجعي لمطابقته مع البنك فوراً.`;
      replyEn = `Thank you ${safeDebtor}. To reconcile and close your open balance (${totalStr} EGP) at ${safeBiz}, please share a screenshot of the transfer receipt or the reference number.`;
      recommendedActionAr = "طلب صورة إيصال التحويل أو رقم المرجع للمطابقة";
      recommendedActionEn = "Request receipt screenshot or transfer reference number";
      followUpDays = 1;
      break;

    case "dispute":
      replyAr = `نشكركم على الملاحظة أستاذ/ة ${safeDebtor}. تم إيقاف التذكيرات التلقائية فوراً ووضع الفاتورة قيد المراجعة المحاسبية في ${safeBiz}. سنتواصل معكم بتفاصيل المطابقة خلال ساعات العمل.${input.statementLink ? `\nرابط كشف الحساب التفصيلي: ${input.statementLink}` : ""}`;
      replyEn = `Thank you for flagging this, ${safeDebtor}. We have paused automated reminders and placed your invoice under accounting review at ${safeBiz}. We will follow up shortly with the reconciliation details.${input.statementLink ? `\nDetailed statement link: ${input.statementLink}` : ""}`;
      recommendedActionAr = "مراجعة بنود الفاتورة وكشف الحساب وحسم الاعتراض";
      recommendedActionEn = "Audit invoice line items and resolve dispute";
      followUpDays = 1;
      break;

    case "request_extension":
      replyAr = promised
        ? `أهلاً بك أستاذ/ة ${safeDebtor}. تمت الموافقة على تمديد مهلة السداد لرصيد ${totalStr} ج.م لدى ${safeBiz} حتى تاريخ ${promised}. نقدر التزامكم وتعاونكم الدائم.`
        : `أهلاً بك أستاذ/ة ${safeDebtor}. يسعدنا في ${safeBiz} التيسير عليكم؛ يرجى إفادتنا بالموعد المقترح للسداد أو إمكانية تقسيم المبلغ (${totalStr} ج.م) على دفعتين لاعتماده.`;
      replyEn = promised
        ? `Hello ${safeDebtor}. We have approved your extension request for ${totalStr} EGP at ${safeBiz} until ${promised}. Thank you for your cooperation.`
        : `Hello ${safeDebtor}. We are happy to accommodate a short extension at ${safeBiz}; please share your target payment date or let us know if a 2-part installment plan for ${totalStr} EGP works best.`;
      recommendedActionAr = "اعتماد المهلة الإضافية أو عرض خطة تقسيط";
      recommendedActionEn = "Approve extension or offer a 2-part installment schedule";
      followUpDays = 7;
      break;

    case "partial_payment_offer":
      replyAr = offeredStr
        ? `مرحباً ${safeDebtor}، نرحب باستلام دفعة جزئية بقيمة ${offeredStr} ج.م تحت الحساب لدى ${safeBiz}، على أن يتم جدولة المتبقي من إجمالي ${totalStr} ج.م في موعد محدد.${input.paymentLink ? `\nرابط السداد: ${input.paymentLink}` : ""}`
        : `مرحباً ${safeDebtor}، لا مانع لدى ${safeBiz} من سداد دفعة جزئية الآن من إجمالي المستحق (${totalStr} ج.م) وجدولة المتبقي. يرجى إرسال إيصال الدفعة الأولى فور التحويل.`;
      replyEn = offeredStr
        ? `Hello ${safeDebtor}, we gladly accept a partial payment of ${offeredStr} EGP toward your ${totalStr} EGP balance at ${safeBiz}, with the remainder scheduled on an agreed date.${input.paymentLink ? `\nPayment link: ${input.paymentLink}` : ""}`
        : `Hello ${safeDebtor}, ${safeBiz} can accept a partial payment now toward your ${totalStr} EGP balance and schedule the rest. Please share the receipt once transferred.`;
      recommendedActionAr = "قبول الدفعة الجزئية وجدولة الرصيد المتبقي";
      recommendedActionEn = "Accept partial payment and schedule remaining balance";
      followUpDays = 3;
      break;

    case "question":
    default:
      replyAr = `مرحباً ${safeDebtor}، بخصوص استفساركم لدى ${safeBiz}: إجمالي الرصيد المفتوح حالياً هو ${totalStr} ج.م.${input.statementLink ? ` يمكنكم الاطلاع على كشف الحساب الكامل والفواتير عبر الرابط: ${input.statementLink}` : " يسعدنا توضيح أي تفاصيل إضافية عبر هذه المحادثة."}`;
      replyEn = `Hello ${safeDebtor}, regarding your inquiry with ${safeBiz}: your current open balance is ${totalStr} EGP.${input.statementLink ? ` You can view your full itemized statement here: ${input.statementLink}` : " Please let us know if you need any invoice details."}`;
      recommendedActionAr = "إرسال كشف الحساب التفصيلي والرد على استفسار العميل";
      recommendedActionEn = "Share itemized statement link and answer customer inquiry";
      followUpDays = 2;
      break;
  }

  return {
    intent: input.intent,
    replyAr,
    replyEn,
    recommendedActionAr,
    recommendedActionEn,
    followUpDays,
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
  portfolioRisk: PortfolioRiskAnalysis;
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

  const portfolioRisk = analyzePortfolioRisk({
    totalOutstandingMinor: input.totalOutstandingMinor,
    overdueMinor: input.overdueMinor,
    collectedThisMonthMinor: input.collectedThisMonthMinor,
    collectionRate: input.collectionRate,
    dsoDays: input.dsoDays,
    debtors: input.debtors,
  });

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
    if (input.bouncedChequesCount > 0) {
      headlineAr = `تنبيه مصرفي عاجل: ${input.bouncedChequesCount} شيك مرتد يتطلب متابعة فورية`;
      headlineEn = `Urgent Banking Alert: ${input.bouncedChequesCount} bounced cheque(s) require action`;
    } else if (input.overdueMinor > 0n) {
      headlineAr = `أولوية تحصيل عاجلة: ${ovStr} ج.م متأخرات تتطلب متابعة اليوم`;
      headlineEn = `Urgent Collections Priority: ${ovStr} EGP overdue requires action today`;
    } else if (input.openDisputesCount > 0) {
      headlineAr = `أولوية متابعة: ${input.openDisputesCount} اعتراض مفتوح على فاتورة يتطلب الحسم`;
      headlineEn = `Action Required: ${input.openDisputesCount} open invoice dispute(s) require resolution`;
    } else if (input.pendingClaimsCount > 0) {
      headlineAr = `مراجعة إيصالات: ${input.pendingClaimsCount} إيصال سداد بانتظار الاعتماد`;
      headlineEn = `Receipt Review: ${input.pendingClaimsCount} payment claim(s) awaiting confirmation`;
    } else if (healthStatus === "urgent") {
      headlineAr = `أولوية تحصيل عاجلة: متابعة حسابات العملاء الحرجة اليوم`;
      headlineEn = `Urgent Collections Priority: follow up high-risk accounts today`;
    } else if (attentionCount > 0) {
      headlineAr = `متابعة تشغيلية: توجد إجراءات مقترحة لتحسين التدفقات النقدية`;
      headlineEn = `Operational Briefing: proactive actions recommended to protect cash flow`;
    } else {
      headlineAr = `ملخص التحصيل اليومي: ${outStr} ج.م إجمالي المستحقات النشطة`;
      headlineEn = `Daily Collections Briefing: ${outStr} EGP active receivables`;
    }

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
    portfolioRisk,
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


// =============================================================================
// Optimal-Time Reminder Window Calculator (Hard Rule #3 + Quiet Hours + Friday Skip)
// =============================================================================

export interface OptimalReminderWindowInput {
  now: Date;
  policy?: Partial<SchedulePolicy>;
  daysOverdue: number;
  riskTier: RiskTier;
  optedOut: boolean;
  openDisputesCount: number;
  hasOpenInvoice: boolean;
}

export interface OptimalReminderWindowResult {
  canSend: boolean;
  blockReasonAr: string | null;
  blockReasonEn: string | null;
  inQuietHoursNow: boolean;
  isImmediateAllowed: boolean;
  optimalSlotUtc: Date;
  optimalSlotIso: string;
  localDateFormatted: string;
  localTimeFormatted: string;
  recommendedTone: NotificationTone;
  windowLabelAr: string;
  windowLabelEn: string;
  strategyReasonAr: string;
  strategyReasonEn: string;
}

function formatLocalTimeHHMM(at: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return fmt.format(at);
}

/**
 * Computes the optimal reminder dispatch window for a debtor, enforcing Hard Rule #3:
 * - Never send to an opted-out debtor.
 * - Never send when an open dispute is active.
 * - Never send when no open/partially_paid invoice exists.
 * - Never send during quiet hours or Friday morning skip; automatically shifts to nextAllowedSlot.
 */
export function computeOptimalReminderWindow(input: OptimalReminderWindowInput): OptimalReminderWindowResult {
  const policy: SchedulePolicy = {
    timezone: input.policy?.timezone ?? DEFAULT_POLICY.timezone,
    quietStart: input.policy?.quietStart ?? DEFAULT_POLICY.quietStart,
    quietEnd: input.policy?.quietEnd ?? DEFAULT_POLICY.quietEnd,
    fridayMorningSkip: input.policy?.fridayMorningSkip ?? DEFAULT_POLICY.fridayMorningSkip,
  };

  const recommendedTone: NotificationTone =
    input.daysOverdue > 30 || input.riskTier === "critical"
      ? "urgent"
      : input.daysOverdue > 14 || input.riskTier === "at_risk"
        ? "firm"
        : input.daysOverdue > 0
          ? "polite"
          : "friendly";

  if (input.optedOut) {
    const slot = nextAllowedSlot(input.now, policy);
    return {
      canSend: false,
      blockReasonAr: "العميل أوقف استلام التذكيرات (Opt-out) — يُمنع الإرسال الآلي ويلزم تفعيل التذكيرات أولاً.",
      blockReasonEn: "Debtor opted out of automated reminders (Hard Rule #3) — re-enable reminders first.",
      inQuietHoursNow: isInQuietHours(input.now, policy),
      isImmediateAllowed: false,
      optimalSlotUtc: slot,
      optimalSlotIso: slot.toISOString(),
      localDateFormatted: localDateOf(slot, policy.timezone),
      localTimeFormatted: formatLocalTimeHHMM(slot, policy.timezone),
      recommendedTone,
      windowLabelAr: "موقوف — العميل طلب إيقاف التذكيرات",
      windowLabelEn: "Blocked — Customer opted out",
      strategyReasonAr: "احترام رغبة العميل في عدم الإزعاج وفق قواعد الحوكمة.",
      strategyReasonEn: "Respects customer opt-out guard (Hard Rule #3).",
    };
  }

  if (input.openDisputesCount > 0) {
    const slot = nextAllowedSlot(input.now, policy);
    return {
      canSend: false,
      blockReasonAr: "يوجد اعتراض مفتوح على الحساب — التذكيرات متوقفة تلقائياً لحين حسم الاعتراض.",
      blockReasonEn: "Open invoice dispute active — automated reminders are paused until resolved.",
      inQuietHoursNow: isInQuietHours(input.now, policy),
      isImmediateAllowed: false,
      optimalSlotUtc: slot,
      optimalSlotIso: slot.toISOString(),
      localDateFormatted: localDateOf(slot, policy.timezone),
      localTimeFormatted: formatLocalTimeHHMM(slot, policy.timezone),
      recommendedTone,
      windowLabelAr: "معلّق — يوجد اعتراض مفتوح قيد المراجعة",
      windowLabelEn: "Paused — Open dispute under review",
      strategyReasonAr: "إيقاف التذكير أثناء وجود نزاع محاسبي يحمي علاقة التاجر بالعميل.",
      strategyReasonEn: "Pausing reminders during an active dispute protects merchant-customer trust.",
    };
  }

  if (!input.hasOpenInvoice) {
    const slot = nextAllowedSlot(input.now, policy);
    return {
      canSend: false,
      blockReasonAr: "لا توجد فواتير مفتوحة أو متأخرة على هذا العميل حالياً.",
      blockReasonEn: "No open or partially paid invoices exist for this customer.",
      inQuietHoursNow: isInQuietHours(input.now, policy),
      isImmediateAllowed: false,
      optimalSlotUtc: slot,
      optimalSlotIso: slot.toISOString(),
      localDateFormatted: localDateOf(slot, policy.timezone),
      localTimeFormatted: formatLocalTimeHHMM(slot, policy.timezone),
      recommendedTone,
      windowLabelAr: "غير مطلوب — الحساب مسدد بالكامل",
      windowLabelEn: "Not needed — Account is fully settled",
      strategyReasonAr: "يُمنع إرسال تذكيرات لفواتير مسددة أو ملغاة.",
      strategyReasonEn: "Hard Rule #3: never send reminders for settled invoices.",
    };
  }

  const inQuiet = isInQuietHours(input.now, policy);
  const optimalSlotUtc = nextAllowedSlot(input.now, policy);
  const localDateFormatted = localDateOf(optimalSlotUtc, policy.timezone);
  const localTimeFormatted = formatLocalTimeHHMM(optimalSlotUtc, policy.timezone);

  const windowLabelAr = inQuiet
    ? `مجدول لأول وقت مسموح (${localDateFormatted} الساعة ${localTimeFormatted} — بعد ساعات الهدوء)`
    : `متاح للإرسال الذكي الآن (${localTimeFormatted} — ضمن ساعات العمل النشطة)`;
  const windowLabelEn = inQuiet
    ? `Scheduled for next allowed window (${localDateFormatted} at ${localTimeFormatted} — post quiet hours)`
    : `Ready for immediate smart dispatch (${localTimeFormatted} — active business hours)`;

  const strategyReasonAr =
    input.daysOverdue > 14
      ? `تأخر ${input.daysOverdue} يوماً يستدعي نبرة «${recommendedTone === "urgent" ? "عاجلة" : "حازمة"}» مع رابط سداد مباشر في ذروة ساعات العمل.`
      : input.daysOverdue > 0
        ? `تأخر ${input.daysOverdue} يوم — إرسال تذكير مهذب مع رابط الدفع يرفع احتمالية التحصيل السريع.`
        : "الفاتورة ضمن فترة السماح؛ تذكير ودي استباقي يضمن السداد في الموعد.";

  const strategyReasonEn =
    input.daysOverdue > 14
      ? `${input.daysOverdue} days overdue warrants a ${recommendedTone} tone with a direct payment link during business hours.`
      : input.daysOverdue > 0
        ? `${input.daysOverdue}d overdue — a polite reminder with checkout link maximizes same-day settlement.`
        : "Invoice is upcoming/current; a friendly heads-up keeps cashflow on schedule.";

  return {
    canSend: true,
    blockReasonAr: null,
    blockReasonEn: null,
    inQuietHoursNow: inQuiet,
    isImmediateAllowed: !inQuiet,
    optimalSlotUtc,
    optimalSlotIso: optimalSlotUtc.toISOString(),
    localDateFormatted,
    localTimeFormatted,
    recommendedTone,
    windowLabelAr,
    windowLabelEn,
    strategyReasonAr,
    strategyReasonEn,
  };
}

// =============================================================================
// Dynamic AI Copilot Function-Calling Planner (Agentic Tool Router)
// =============================================================================

export type CopilotToolName =
  | "query_workspace_overview"
  | "lookup_customer_ledger"
  | "analyze_cashflow_and_risk"
  | "propose_installment_plan"
  | "optimize_reminder_schedule"
  | "triage_inbox_and_disputes";

export interface PlannedCopilotToolCall {
  toolName: CopilotToolName;
  titleAr: string;
  titleEn: string;
  args: Record<string, string | number | boolean | null>;
}

export interface CopilotToolPlanInput {
  intent:
    | "daily_summary"
    | "priority_customers"
    | "action_plan"
    | "inbox_triage"
    | "forecast_and_risk"
    | "settlement_options"
    | "optimize_reminders"
    | "custom_question";
  question?: string | null;
  debtors: readonly {
    debtorId: string;
    displayName: string;
    phoneE164?: string | null;
  }[];
}

export interface CopilotToolPlanResult {
  effectiveIntent: CopilotToolPlanInput["intent"] | "customer_lookup";
  matchedDebtorId: string | null;
  matchedDebtorName: string | null;
  plannedTools: PlannedCopilotToolCall[];
}

function normalizeArabicSearch(text: string): string {
  return text
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[ً-ٰٟ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Determines which dynamic backend tools the AI Copilot should invoke for a user turn,
 * extracting customer entities by name or phone and chaining relevant analysis/action tools.
 */
export function planCopilotToolCalls(input: CopilotToolPlanInput): CopilotToolPlanResult {
  const safeQ = sanitizePromptData(input.question ?? "");
  const normQ = normalizeArabicSearch(safeQ);

  // 1. Check if the user query mentions a specific customer in the tenant ledger
  let matchedDebtor: { debtorId: string; displayName: string } | null = null;
  if (normQ.length >= 2) {
    const digitsInQ = safeQ.replace(/\D+/g, "");
    for (const d of input.debtors) {
      const normName = normalizeArabicSearch(d.displayName);
      if (!normName) continue;
      if (normQ.includes(normName)) {
        matchedDebtor = { debtorId: d.debtorId, displayName: d.displayName };
        break;
      }
      // Also match significant multi-character tokens (e.g. "الأمل" from "شركة الأمل للتجارة")
      const stopWords = new Set(["شركه", "مؤسسه", "مكتب", "عميل", "عملاء", "حساب", "فاتوره", "فواتير", "مديونيه", "مديونيات", "متاخر", "متاخرين", "متأخر", "متأخرين", "للتجاره", "والتوزيع", "المتحده"]);
      const tokens = normName.split(/\s+/).filter((t) => t.length >= 3 && !stopWords.has(t));
      if (tokens.some((tok) => normQ.includes(tok))) {
        matchedDebtor = { debtorId: d.debtorId, displayName: d.displayName };
        break;
      }
      if (digitsInQ.length >= 6 && d.phoneE164 && d.phoneE164.replace(/\D+/g, "").includes(digitsInQ)) {
        matchedDebtor = { debtorId: d.debtorId, displayName: d.displayName };
        break;
      }
    }
  }

  let effectiveIntent: CopilotToolPlanResult["effectiveIntent"] = input.intent;

  if (input.intent === "custom_question" && safeQ) {
    if (/تذكير|ابعت|أرسل|ارسال|وقت|مواعيد|جدول.*تذكير|remind|dispatch|send.*message|optimal.*time|schedule.*reminder/i.test(safeQ)) {
      effectiveIntent = "optimize_reminders";
    } else if (/تقسيط|أقساط|اقساط|دفعات|تسوية|installment|settle|restructur/i.test(safeQ)) {
      effectiveIntent = "settlement_options";
    } else if (/سيولة|توقعات|تدفق|تركز|مخاطر|forecast|cash|liquidity|risk|concentration|dso/i.test(safeQ)) {
      effectiveIntent = "forecast_and_risk";
    } else if (/إيصال|ايصال|اعتراض|صندوق|شيك|inbox|receipt|dispute|cheque/i.test(safeQ)) {
      effectiveIntent = "inbox_triage";
    } else if (matchedDebtor) {
      effectiveIntent = "customer_lookup";
    } else if (/متأخر|أولوية|اولويه|أهم|عميل|عملاء|priority|overdue|top|who/i.test(safeQ)) {
      effectiveIntent = "priority_customers";
    } else if (/خطة|خطوات|ماذا أفعل|عمل|plan|follow|action/i.test(safeQ)) {
      effectiveIntent = "action_plan";
    } else {
      effectiveIntent = "daily_summary";
    }
  }

  const plannedTools: PlannedCopilotToolCall[] = [];

  if (matchedDebtor) {
    plannedTools.push({
      toolName: "lookup_customer_ledger",
      titleAr: `فحص سجل العميل: ${matchedDebtor.displayName}`,
      titleEn: `Lookup Customer Ledger: ${matchedDebtor.displayName}`,
      args: { debtorId: matchedDebtor.debtorId, debtorName: matchedDebtor.displayName },
    });
  }

  switch (effectiveIntent) {
    case "customer_lookup":
      plannedTools.push({
        toolName: "optimize_reminder_schedule",
        titleAr: "حساب التوقيت الأمثل للتذكير والتحقق من ساعات الهدوء",
        titleEn: "Compute Optimal Reminder Window & Quiet-Hours Guard",
        args: { debtorId: matchedDebtor?.debtorId ?? null },
      });
      break;

    case "optimize_reminders":
      plannedTools.push({
        toolName: "optimize_reminder_schedule",
        titleAr: "تحليل وجدولة التذكيرات في أفضل وقت للعملاء المتأخرين",
        titleEn: "Optimize & Schedule Overdue Reminders in Allowed Windows",
        args: { debtorId: matchedDebtor?.debtorId ?? null, respectQuietHours: true },
      });
      break;

    case "settlement_options":
      plannedTools.push({
        toolName: "propose_installment_plan",
        titleAr: "بناء خطة تقسيط وتسوية ذكية بالوحدات الصغرى (قرش)",
        titleEn: "Build Minor-Unit Installment Settlement Schedule",
        args: { debtorId: matchedDebtor?.debtorId ?? null, installmentsCount: 3, interval: "monthly" },
      });
      break;

    case "forecast_and_risk":
      plannedTools.push({
        toolName: "analyze_cashflow_and_risk",
        titleAr: "تحليل التوقعات النقدية ومخاطر تركز المحفظة وسرعة التحصيل",
        titleEn: "Analyze 8-Week Cashflow Forecast & Portfolio Concentration Risk",
        args: { horizonWeeks: 8 },
      });
      break;

    case "inbox_triage":
      plannedTools.push({
        toolName: "triage_inbox_and_disputes",
        titleAr: "فرز صندوق الوارد الذكي والاعتراضات والشيكات",
        titleEn: "Triage AI Inbox Claims, Disputes & Cheques",
        args: { includeCheques: true },
      });
      break;

    case "priority_customers":
    case "action_plan":
    case "daily_summary":
    default:
      plannedTools.push({
        toolName: "query_workspace_overview",
        titleAr: "استعلام مؤشرات الأداء والأولويات الحية للمنشأة",
        titleEn: "Query Live Workspace KPIs & Priority Queue",
        args: { intent: effectiveIntent },
      });
      break;
  }

  return {
    effectiveIntent,
    matchedDebtorId: matchedDebtor?.debtorId ?? null,
    matchedDebtorName: matchedDebtor?.displayName ?? null,
    plannedTools,
  };
}
