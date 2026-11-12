import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  buildCollectionsBriefing,
  buildInstallmentPlan,
  computeOptimalReminderWindow,
  planCopilotToolCalls,
  formatEgp,
  sanitizePromptData,
  scoreDebtorIntelligence,
  type ConcentrationLevel,
  type DebtorActionKind,
  type DebtorIntelligence,
  type NotificationTone,
  type RiskTier,
  type UrgencyLevel,
} from "@tahseel/core";
import { withTenant, type Db } from "@tahseel/db";
import {
  auditLog,
  cheques,
  debtors,
  disputes,
  invoices,
  messageIntents,
  optOuts,
  payments,
  tenants,
} from "@tahseel/db/schema";
import { getForecast, getKpis } from "./reports";
import { getDashboardSummary } from "./services";
import { syncWorkspaceNotifications } from "./notifications";
import { aiDeps } from "./engine";

export interface DebtorIntelligenceView {
  debtorId: string;
  displayName: string;
  phoneE164: string;
  whatsappCapable: boolean;
  optedOut: boolean;
  riskFlag: boolean;
  outstandingMinor: string;
  overdueMinor: string;
  maxDaysOverdue: number;
  openInvoicesCount: number;
  paidInvoicesCount: number;
  healthScore: number;
  tier: RiskTier;
  priorityScore: number;
  recommendation: {
    actionKind: DebtorActionKind;
    titleAr: string;
    titleEn: string;
    reasonAr: string;
    reasonEn: string;
    suggestedTone: NotificationTone;
    urgency: UrgencyLevel;
  };
}

export interface PortfolioRiskView {
  topDebtorSharePct: number;
  topDebtorName: string | null;
  top3ConcentrationPct: number;
  concentrationLevel: ConcentrationLevel;
  overdueSeverityRatioPct: number;
  atRiskReceivablesMinor: string;
  expectedNext14DaysMinor: string;
  velocityScore: number;
  insightsAr: string[];
  insightsEn: string[];
}

export interface WorkspaceIntelligenceView {
  todayIso: string;
  businessName: string;
  healthStatus: "strong" | "attention" | "urgent";
  headlineAr: string;
  headlineEn: string;
  summaryAr: string;
  summaryEn: string;
  metrics: {
    totalOutstandingMinor: string;
    overdueMinor: string;
    collectedThisMonthMinor: string;
    collectionRate: number;
    dsoDays: number;
    pendingClaimsCount: number;
    openDisputesCount: number;
    humanIntentsCount: number;
    upcomingChequesCount: number;
    bouncedChequesCount: number;
  };
  portfolioRisk: PortfolioRiskView;
  topActions: DebtorIntelligenceView[];
  debtorScores: DebtorIntelligenceView[];
}

function toView(d: DebtorIntelligence): DebtorIntelligenceView {
  return {
    ...d,
    outstandingMinor: d.outstandingMinor.toString(),
    overdueMinor: d.overdueMinor.toString(),
  };
}

function addDaysIso(iso: string, days: number): string {
  const dt = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * Loads all single-tenant debtors, open/recent invoices, cheques, disputes,
 * receipt claims, and opt-outs in a single RLS-scoped transaction (zero N+1),
 * scores every debtor deterministically, synthesizes the executive briefing
 * and portfolio risk concentration metrics, and optionally triggers idempotent
 * operational notifications.
 */
export async function getWorkspaceIntelligence(
  app: Db,
  tenantId: string,
  businessName: string,
  todayIso: string,
  opts: { syncNotifications?: boolean } = {},
): Promise<WorkspaceIntelligenceView> {
  const dueWindowEnd = addDaysIso(todayIso, 3);

  const [summary, kpis, snapshot] = await Promise.all([
    getDashboardSummary(app, tenantId, todayIso),
    getKpis(app, tenantId, todayIso),
    withTenant(app, tenantId, async (tx) => {
      const [debtorRows, invoiceRows, chequeRows, disputeRows, claimRows, optOutRows, intentCountRows] =
        await Promise.all([
          tx.select().from(debtors).where(isNull(debtors.deletedAt)).limit(500),
          tx
            .select({
              id: invoices.id,
              debtorId: invoices.debtorId,
              reference: invoices.reference,
              amountMinor: invoices.amountMinor,
              paidMinor: invoices.paidMinor,
              dueOn: invoices.dueOn,
              status: invoices.status,
            })
            .from(invoices),
          tx
            .select({
              id: cheques.id,
              debtorId: cheques.debtorId,
              number: cheques.number,
              dueDate: cheques.dueDate,
              status: cheques.status,
              amountMinor: cheques.amountMinor,
            })
            .from(cheques),
          tx
            .select({ debtorId: disputes.debtorId })
            .from(disputes)
            .where(eq(disputes.status, "open")),
          tx
            .select({ debtorId: payments.debtorId })
            .from(payments)
            .where(eq(payments.status, "claimed")),
          tx.select({ debtorId: optOuts.debtorId }).from(optOuts),
          tx
            .select({ count: sql<number>`count(*)::int` })
            .from(messageIntents)
            .where(and(eq(messageIntents.resolvedBy, "human"), eq(messageIntents.actionTaken, "human_inbox"))),
        ]);

      return { debtorRows, invoiceRows, chequeRows, disputeRows, claimRows, optOutRows, intentCountRows };
    }),
  ]);

  const optedOutSet = new Set(snapshot.optOutRows.map((o) => o.debtorId));
  const invByDebtor = new Map<string, typeof snapshot.invoiceRows>();
  for (const inv of snapshot.invoiceRows) {
    const arr = invByDebtor.get(inv.debtorId) ?? [];
    arr.push(inv);
    invByDebtor.set(inv.debtorId, arr);
  }
  const chqByDebtor = new Map<string, typeof snapshot.chequeRows>();
  let upcomingChequesCount = 0;
  let bouncedChequesCount = 0;
  for (const chq of snapshot.chequeRows) {
    const arr = chqByDebtor.get(chq.debtorId) ?? [];
    arr.push(chq);
    chqByDebtor.set(chq.debtorId, arr);
    if (chq.status === "bounced") bouncedChequesCount += 1;
    else if ((chq.status === "held" || chq.status === "deposited") && chq.dueDate <= dueWindowEnd) {
      upcomingChequesCount += 1;
    }
  }
  const dispCount = new Map<string, number>();
  for (const d of snapshot.disputeRows) dispCount.set(d.debtorId, (dispCount.get(d.debtorId) ?? 0) + 1);
  const claimCount = new Map<string, number>();
  for (const c of snapshot.claimRows) claimCount.set(c.debtorId, (claimCount.get(c.debtorId) ?? 0) + 1);

  const scored = snapshot.debtorRows.map((d) =>
    scoreDebtorIntelligence({
      debtor: {
        id: d.id,
        displayName: d.displayName,
        phoneE164: d.phoneE164,
        whatsappStatus: d.whatsappStatus,
        optedOut: optedOutSet.has(d.id),
        riskFlag: d.riskFlag,
      },
      invoices: invByDebtor.get(d.id) ?? [],
      cheques: chqByDebtor.get(d.id) ?? [],
      openDisputesCount: dispCount.get(d.id) ?? 0,
      pendingClaimsCount: claimCount.get(d.id) ?? 0,
      todayIso,
    }),
  );

  scored.sort((a, b) => {
    if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
    return b.outstandingMinor > a.outstandingMinor ? 1 : b.outstandingMinor < a.outstandingMinor ? -1 : 0;
  });

  const briefing = buildCollectionsBriefing({
    todayIso,
    businessName,
    totalOutstandingMinor: BigInt(summary.totalOutstandingMinor),
    overdueMinor: BigInt(summary.overdueMinor),
    collectedThisMonthMinor: BigInt(summary.collectedThisMonthMinor),
    collectionRate: kpis.collectionRate,
    dsoDays: kpis.dsoDays,
    pendingClaimsCount: snapshot.claimRows.length,
    openDisputesCount: snapshot.disputeRows.length,
    humanIntentsCount: Number(snapshot.intentCountRows[0]?.count ?? 0),
    upcomingChequesCount,
    bouncedChequesCount,
    debtors: scored,
  });

  if (opts.syncNotifications) {
    await syncWorkspaceNotifications(app, tenantId, todayIso, {
      summaryAr: briefing.summaryAr,
      summaryEn: briefing.summaryEn,
    }).catch(() => {});
  }

  return {
    todayIso: briefing.todayIso,
    businessName: briefing.businessName,
    healthStatus: briefing.healthStatus,
    headlineAr: briefing.headlineAr,
    headlineEn: briefing.headlineEn,
    summaryAr: briefing.summaryAr,
    summaryEn: briefing.summaryEn,
    metrics: {
      totalOutstandingMinor: briefing.metrics.totalOutstandingMinor.toString(),
      overdueMinor: briefing.metrics.overdueMinor.toString(),
      collectedThisMonthMinor: briefing.metrics.collectedThisMonthMinor.toString(),
      collectionRate: Math.round(briefing.metrics.collectionRate * 100),
      dsoDays: Math.round(briefing.metrics.dsoDays),
      pendingClaimsCount: briefing.metrics.pendingClaimsCount,
      openDisputesCount: briefing.metrics.openDisputesCount,
      humanIntentsCount: briefing.metrics.humanIntentsCount,
      upcomingChequesCount: briefing.metrics.upcomingChequesCount,
      bouncedChequesCount: briefing.metrics.bouncedChequesCount,
    },
    portfolioRisk: {
      ...briefing.portfolioRisk,
      atRiskReceivablesMinor: briefing.portfolioRisk.atRiskReceivablesMinor.toString(),
      expectedNext14DaysMinor: briefing.portfolioRisk.expectedNext14DaysMinor.toString(),
    },
    topActions: briefing.topActions.map(toView),
    debtorScores: scored.map(toView),
  };
}

export async function getDebtorIntelligence(
  app: Db,
  tenantId: string,
  debtorId: string,
  todayIso: string,
): Promise<DebtorIntelligenceView | null> {
  return withTenant(app, tenantId, async (tx) => {
    const [debtor] = await tx
      .select()
      .from(debtors)
      .where(and(eq(debtors.id, debtorId), isNull(debtors.deletedAt)));
    if (!debtor) return null;

    const [invRows, chqRows, dispRows, claimRows, optRow] = await Promise.all([
      tx.select().from(invoices).where(eq(invoices.debtorId, debtorId)),
      tx.select().from(cheques).where(eq(cheques.debtorId, debtorId)),
      tx.select({ id: disputes.id }).from(disputes).where(and(eq(disputes.debtorId, debtorId), eq(disputes.status, "open"))),
      tx.select({ id: payments.id }).from(payments).where(and(eq(payments.debtorId, debtorId), eq(payments.status, "claimed"))),
      tx.select({ id: optOuts.id }).from(optOuts).where(eq(optOuts.debtorId, debtorId)).limit(1),
    ]);

    return toView(
      scoreDebtorIntelligence({
        debtor: {
          id: debtor.id,
          displayName: debtor.displayName,
          phoneE164: debtor.phoneE164,
          whatsappStatus: debtor.whatsappStatus,
          optedOut: optRow.length > 0,
          riskFlag: debtor.riskFlag,
        },
        invoices: invRows,
        cheques: chqRows,
        openDisputesCount: dispRows.length,
        pendingClaimsCount: claimRows.length,
        todayIso,
      }),
    );
  });
}

export const copilotQueryInput = z.object({
  intent: z.enum([
    "daily_summary",
    "priority_customers",
    "action_plan",
    "inbox_triage",
    "forecast_and_risk",
    "settlement_options",
    "optimize_reminders",
    "custom_question",
  ]),
  question: z.string().trim().max(400).optional(),
  locale: z.enum(["ar", "en"]).default("ar"),
});
export type CopilotQueryInput = z.input<typeof copilotQueryInput>;

export interface CopilotToolCallTrace {
  toolName: string;
  titleAr: string;
  titleEn: string;
  status: "completed";
  summaryAr: string;
  summaryEn: string;
}

export interface CopilotOptimalWindowView {
  canSend: boolean;
  isImmediateAllowed: boolean;
  localDateFormatted: string;
  localTimeFormatted: string;
  windowLabelAr: string;
  windowLabelEn: string;
  recommendedTone: NotificationTone;
  strategyReasonAr: string;
  strategyReasonEn: string;
  blockReasonAr: string | null;
  blockReasonEn: string | null;
}

export interface CopilotResponse {
  answerAr: string;
  answerEn: string;
  toolCalls: CopilotToolCallTrace[];
  matchedDebtor: (DebtorIntelligenceView & { optimalWindow: CopilotOptimalWindowView }) | null;
  suggestedDebtors: DebtorIntelligenceView[];
  quickLinks: { labelAr: string; labelEn: string; href: string }[];
}

/**
 * Dynamic Agentic AI Copilot: plans and executes allowlisted function calls (`toolCalls`)
 * over live single-tenant metrics, customer ledgers, cash-flow forecasts, concentration risk,
 * optimal-time reminder windows, and settlement restructurings (Hard Rule #4: untrusted text
 * is sanitized data, never raw SQL or instructions). Logs every execution to `audit_log`.
 */
export async function askWorkspaceCopilot(
  app: Db,
  tenantId: string,
  actorUserId: string,
  businessName: string,
  todayIso: string,
  rawInput: CopilotQueryInput,
): Promise<CopilotResponse> {
  const input = copilotQueryInput.parse(rawInput);
  const safeQuestion = sanitizePromptData(input.question ?? "");
  const intel = await getWorkspaceIntelligence(app, tenantId, businessName, todayIso);
  const now = new Date();

  const tenantPolicy = await withTenant(app, tenantId, async (tx) => {
    const [row] = await tx
      .select({ timezone: tenants.timezone, settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    return {
      timezone: row?.timezone ?? "Africa/Cairo",
      quietStart: row?.settings?.quietStart ?? "21:00",
      quietEnd: row?.settings?.quietEnd ?? "09:00",
      fridayMorningSkip: row?.settings?.fridayMorningSkip ?? false,
    };
  });

  // 1. Dynamic Function-Calling Planner
  const plan = planCopilotToolCalls({
    intent: input.intent,
    question: safeQuestion,
    debtors: intel.debtorScores.map((d) => ({
      debtorId: d.debtorId,
      displayName: d.displayName,
      phoneE164: d.phoneE164,
    })),
  });

  const effectiveIntent = plan.effectiveIntent;
  const toolCalls: CopilotToolCallTrace[] = [];
  let matchedDebtor: (DebtorIntelligenceView & { optimalWindow: CopilotOptimalWindowView }) | null = null;

  if (plan.matchedDebtorId) {
    const found = intel.debtorScores.find((d) => d.debtorId === plan.matchedDebtorId);
    if (found) {
      const win = computeOptimalReminderWindow({
        now,
        policy: tenantPolicy,
        daysOverdue: found.maxDaysOverdue,
        riskTier: found.tier,
        optedOut: found.optedOut,
        openDisputesCount: found.recommendation.actionKind === "resolve_dispute" ? 1 : 0,
        hasOpenInvoice: found.openInvoicesCount > 0 && BigInt(found.outstandingMinor) > 0n,
      });
      matchedDebtor = {
        ...found,
        optimalWindow: {
          canSend: win.canSend,
          isImmediateAllowed: win.isImmediateAllowed,
          localDateFormatted: win.localDateFormatted,
          localTimeFormatted: win.localTimeFormatted,
          windowLabelAr: win.windowLabelAr,
          windowLabelEn: win.windowLabelEn,
          recommendedTone: win.recommendedTone,
          strategyReasonAr: win.strategyReasonAr,
          strategyReasonEn: win.strategyReasonEn,
          blockReasonAr: win.blockReasonAr,
          blockReasonEn: win.blockReasonEn,
        },
      };

      toolCalls.push({
        toolName: "lookup_customer_ledger",
        titleAr: `استعلام سجل العميل: ${found.displayName}`,
        titleEn: `Lookup Customer Ledger: ${found.displayName}`,
        status: "completed",
        summaryAr: `الرصيد المفتوح ${formatEgp(BigInt(found.outstandingMinor))} ج.م (${found.openInvoicesCount} فاتورة) · التقييم الصحي ${found.healthScore}/100`,
        summaryEn: `Open balance ${formatEgp(BigInt(found.outstandingMinor))} EGP (${found.openInvoicesCount} inv) · Health ${found.healthScore}/100`,
      });
    }
  }

  let answerAr = intel.summaryAr;
  let answerEn = intel.summaryEn;
  const quickLinks: { labelAr: string; labelEn: string; href: string }[] = [];

  if (effectiveIntent === "customer_lookup" && matchedDebtor) {
    const outStr = formatEgp(BigInt(matchedDebtor.outstandingMinor));
    const ovStr = formatEgp(BigInt(matchedDebtor.overdueMinor));
    toolCalls.push({
      toolName: "optimize_reminder_schedule",
      titleAr: "حساب التوقيت الأمثل للتذكير",
      titleEn: "Compute Optimal Reminder Window",
      status: "completed",
      summaryAr: matchedDebtor.optimalWindow.windowLabelAr,
      summaryEn: matchedDebtor.optimalWindow.windowLabelEn,
    });
    answerAr = [
      `تحليل حساب العميل «${matchedDebtor.displayName}»:`,
      `• الرصيد المفتوح: ${outStr} ج.م (منها ${ovStr} ج.م متأخرة منذ ${matchedDebtor.maxDaysOverdue} يوم).`,
      `• المؤشر الائتماني: ${matchedDebtor.healthScore}/100 — التوصية: ${matchedDebtor.recommendation.titleAr}.`,
      `• التوقيت الأمثل للتذكير: ${matchedDebtor.optimalWindow.windowLabelAr}.`,
    ].join("\n");
    answerEn = [
      `Account analysis for "${matchedDebtor.displayName}":`,
      `• Open balance: ${outStr} EGP (${ovStr} EGP overdue, max ${matchedDebtor.maxDaysOverdue}d).`,
      `• Credit Health: ${matchedDebtor.healthScore}/100 — Next Best Action: ${matchedDebtor.recommendation.titleEn}.`,
      `• Optimal Reminder Window: ${matchedDebtor.optimalWindow.windowLabelEn}.`,
    ].join("\n");
    quickLinks.push({
      labelAr: `فتح ملف ${matchedDebtor.displayName}`,
      labelEn: `Open ${matchedDebtor.displayName}`,
      href: `/debtors/${matchedDebtor.debtorId}`,
    });
    quickLinks.push({
      labelAr: "قائمة العملاء",
      labelEn: "All Debtors",
      href: "/debtors",
    });
  } else if (effectiveIntent === "optimize_reminders") {
    const eligibleOverdue = intel.debtorScores.filter(
      (d) => BigInt(d.overdueMinor) > 0n && !d.optedOut && d.recommendation.actionKind !== "resolve_dispute",
    );
    const sampleWin = computeOptimalReminderWindow({
      now,
      policy: tenantPolicy,
      daysOverdue: eligibleOverdue[0]?.maxDaysOverdue ?? 7,
      riskTier: eligibleOverdue[0]?.tier ?? "watch",
      optedOut: false,
      openDisputesCount: 0,
      hasOpenInvoice: true,
    });

    toolCalls.push({
      toolName: "optimize_reminder_schedule",
      titleAr: "محرك جدولة التذكيرات في الوقت المناسب",
      titleEn: "Optimal-Time Reminder Schedule Engine",
      status: "completed",
      summaryAr: `${eligibleOverdue.length} عميل مؤهل للتذكير · ${sampleWin.windowLabelAr}`,
      summaryEn: `${eligibleOverdue.length} eligible overdue debtor(s) · ${sampleWin.windowLabelEn}`,
    });

    if (matchedDebtor) {
      answerAr = [
        `جدولة التذكير الذكي للعميل «${matchedDebtor.displayName}»:`,
        `• الحالة: ${matchedDebtor.optimalWindow.windowLabelAr}.`,
        `• النبرة المقترحة: ${matchedDebtor.optimalWindow.recommendedTone === "urgent" ? "عاجلة" : matchedDebtor.optimalWindow.recommendedTone === "firm" ? "حازمة" : "مهذبة"}.`,
        `• السبب: ${matchedDebtor.optimalWindow.strategyReasonAr}`,
        `يمكنك الضغط على زر «إرسال/جدولة تذكير ذكي» بالأسفل للتنفيذ الفوري.`,
      ].join("\n");
      answerEn = [
        `Smart reminder schedule for "${matchedDebtor.displayName}":`,
        `• Window: ${matchedDebtor.optimalWindow.windowLabelEn}.`,
        `• Recommended Tone: ${matchedDebtor.optimalWindow.recommendedTone}.`,
        `• Strategy: ${matchedDebtor.optimalWindow.strategyReasonEn}`,
        `Click "Dispatch Smart Reminder" below to execute immediately.`,
      ].join("\n");
    } else {
      const listAr = eligibleOverdue
        .slice(0, 3)
        .map((d, i) => `${i + 1}. ${d.displayName} (${formatEgp(BigInt(d.overdueMinor))} ج.م — متأخر ${d.maxDaysOverdue} يوم)`)
        .join("\n");
      const listEn = eligibleOverdue
        .slice(0, 3)
        .map((d, i) => `${i + 1}. ${d.displayName} (${formatEgp(BigInt(d.overdueMinor))} EGP — ${d.maxDaysOverdue}d overdue)`)
        .join("\n");
      answerAr = [
        `تحليل أوقات الإرسال المثلى للتذكيرات (${sampleWin.windowLabelAr}):`,
        `• عدد الحسابات المتأخرة المؤهلة للإرسال الآمن (خارج الإيقاف والاعتراضات): ${eligibleOverdue.length} عميل.`,
        listAr ? `أهم الحسابات الجاهزة للتذكير:\n${listAr}` : "لا توجد حسابات متأخرة حالياً.",
        `• يمكنك تشغيل «تحسين وجدولة جميع التذكيرات» بضغطة واحدة بالأسفل.`,
      ].join("\n");
      answerEn = [
        `Optimal Reminder Dispatch Analysis (${sampleWin.windowLabelEn}):`,
        `• Eligible overdue debtors (passing opt-out & dispute guards): ${eligibleOverdue.length}.`,
        listEn ? `Top ready accounts:\n${listEn}` : "No overdue accounts right now.",
        `• Use the 1-click "Optimize All Reminders" action below to queue/dispatch.`,
      ].join("\n");
    }
    quickLinks.push({ labelAr: "العملاء المتأخرون", labelEn: "Overdue Debtors", href: "/debtors" });
  } else if (effectiveIntent === "priority_customers") {
    const top = intel.topActions.slice(0, 3);
    toolCalls.push({
      toolName: "query_workspace_overview",
      titleAr: "ترتيب أولويات التحصيل حسب التأثير النقدي",
      titleEn: "Rank Collection Priorities by Cash Impact",
      status: "completed",
      summaryAr: `تم تحليل ${intel.debtorScores.length} عميل وتحديد أعلى ${top.length} أولويات`,
      summaryEn: `Scored ${intel.debtorScores.length} debtors and ranked top ${top.length} priorities`,
    });
    if (top.length === 0) {
      answerAr = "جميع حسابات العملاء منتظمة حالياً ولا توجد مديونيات متأخرة تتطلب متابعة عاجلة.";
      answerEn = "All customer accounts are currently in good standing with no urgent follow-ups.";
    } else {
      const listAr = top
        .map((d, i) => `${i + 1}. ${d.displayName} — مستحق ${formatEgp(BigInt(d.outstandingMinor))} ج.م (${d.recommendation.titleAr})`)
        .join("\n");
      const listEn = top
        .map((d, i) => `${i + 1}. ${d.displayName} — ${formatEgp(BigInt(d.outstandingMinor))} EGP (${d.recommendation.titleEn})`)
        .join("\n");
      answerAr = `أعلى العملاء أولوية للتحصيل اليوم:\n${listAr}`;
      answerEn = `Top priority customers to follow up today:\n${listEn}`;
    }
    quickLinks.push({ labelAr: "فتح قائمة العملاء", labelEn: "Open Debtors", href: "/debtors" });
  } else if (effectiveIntent === "action_plan") {
    const overdueCount = intel.debtorScores.filter((d) => BigInt(d.overdueMinor) > 0n).length;
    const optedOutCount = intel.debtorScores.filter((d) => d.optedOut && BigInt(d.outstandingMinor) > 0n).length;
    toolCalls.push({
      toolName: "query_workspace_overview",
      titleAr: "توليد خطة العمل التشغيلية اليومية",
      titleEn: "Generate Daily Operational Action Plan",
      status: "completed",
      summaryAr: `${overdueCount} حساب متأخر · ${intel.metrics.pendingClaimsCount} إيصال · ${intel.metrics.openDisputesCount} اعتراض`,
      summaryEn: `${overdueCount} overdue · ${intel.metrics.pendingClaimsCount} claim(s) · ${intel.metrics.openDisputesCount} dispute(s)`,
    });
    answerAr = `خطة العمل المقترحة اليوم:\n• متابعة ${overdueCount} عميل لديهم مستحقات متأخرة (البدء بالأعلى تأثراً على السيولة).\n• مراجعة ${intel.metrics.pendingClaimsCount} إيصال سداد و${intel.metrics.openDisputesCount} اعتراض مفتوح.${optedOutCount > 0 ? `\n• توجد ${optedOutCount} حسابات موقوفة التذكير ولها أرصدة مفتوحة.` : ""}`;
    answerEn = `Recommended action plan today:\n• Follow up ${overdueCount} overdue customer(s) prioritized by cash impact.\n• Clear ${intel.metrics.pendingClaimsCount} receipt claim(s) and ${intel.metrics.openDisputesCount} dispute(s).${optedOutCount > 0 ? `\n• ${optedOutCount} debtor(s) have paused reminders despite open balances.` : ""}`;
    quickLinks.push({ labelAr: "صندوق المراجعة", labelEn: "Review Inbox", href: "/ai-inbox" });
  } else if (effectiveIntent === "inbox_triage") {
    const { pendingClaimsCount, openDisputesCount, humanIntentsCount, upcomingChequesCount, bouncedChequesCount } = intel.metrics;
    toolCalls.push({
      toolName: "triage_inbox_and_disputes",
      titleAr: "فرز الإيصالات والاعتراضات والشيكات",
      titleEn: "Triage Receipts, Disputes & Cheques Queue",
      status: "completed",
      summaryAr: `${pendingClaimsCount} إيصال · ${openDisputesCount} اعتراض · ${humanIntentsCount} رد واتساب`,
      summaryEn: `${pendingClaimsCount} claims · ${openDisputesCount} disputes · ${humanIntentsCount} replies`,
    });
    answerAr = `ملخص العناصر التي تتطلب مراجعة بشرية:\n• إيصالات سداد بانتظار التأكيد: ${pendingClaimsCount}\n• اعتراضات فواتير مفتوحة: ${openDisputesCount}\n• ردود واتساب للمراجعة: ${humanIntentsCount}\n• شيكات قريبة/مرتدة: ${upcomingChequesCount + bouncedChequesCount}`;
    answerEn = `Human review queue summary:\n• Pending receipt claims: ${pendingClaimsCount}\n• Open invoice disputes: ${openDisputesCount}\n• WhatsApp replies awaiting triage: ${humanIntentsCount}\n• Upcoming/bounced cheques: ${upcomingChequesCount + bouncedChequesCount}`;
    quickLinks.push(
      { labelAr: "صندوق الوارد الذكي", labelEn: "AI Inbox", href: "/ai-inbox" },
      { labelAr: "إدارة الشيكات", labelEn: "Cheques", href: "/cheques" },
    );
  } else if (effectiveIntent === "forecast_and_risk") {
    const fc = await getForecast(app, tenantId, todayIso).catch(() => null);
    const totalExpected8w = fc?.enoughData
      ? fc.weeks.reduce((acc, w) => acc + BigInt(w.expectedMinor), 0n)
      : BigInt(intel.portfolioRisk.expectedNext14DaysMinor);
    const risk = intel.portfolioRisk;
    toolCalls.push({
      toolName: "analyze_cashflow_and_risk",
      titleAr: "تحليل التوقعات النقدية ومخاطر التركز",
      titleEn: "Analyze Cashflow Forecast & Concentration Risk",
      status: "completed",
      summaryAr: `سرعة التحصيل ${risk.velocityScore}/100 · تركز أعلى 3 عملاء ${risk.top3ConcentrationPct}%`,
      summaryEn: `Velocity ${risk.velocityScore}/100 · Top-3 concentration ${risk.top3ConcentrationPct}%`,
    });
    answerAr = [
      `تحليل السيولة ومخاطر المحفظة الائتمانية:`,
      `• مؤشر سرعة التحصيل (Velocity): ${risk.velocityScore}/100 (متوسط التحصيل ${intel.metrics.dsoDays} يوم).`,
      `• السيولة المتوقعة قريباً: ${formatEgp(totalExpected8w)} ج.م.`,
      ...risk.insightsAr.map((line) => `• ${line}`),
    ].join("\n");
    answerEn = [
      `Liquidity & Portfolio Risk Analysis:`,
      `• Collection Velocity Score: ${risk.velocityScore}/100 (Avg DSO ${intel.metrics.dsoDays} days).`,
      `• Projected Inflow: ${formatEgp(totalExpected8w)} EGP.`,
      ...risk.insightsEn.map((line) => `• ${line}`),
    ].join("\n");
    quickLinks.push(
      { labelAr: "نظرة عامة والتوقعات", labelEn: "Overview & Forecast", href: "/dashboard" },
      { labelAr: "العملاء ذوو الأولوية", labelEn: "Priority Debtors", href: "/debtors" },
    );
  } else if (effectiveIntent === "settlement_options") {
    const candidate =
      matchedDebtor ??
      intel.topActions.find((d) => BigInt(d.outstandingMinor) > 0n) ??
      intel.debtorScores.find((d) => BigInt(d.outstandingMinor) > 0n);
    if (!candidate) {
      answerAr = "لا توجد أرصدة متأخرة حالياً تتطلب جدولة أو تقسيط.";
      answerEn = "No overdue balances currently require installment restructuring.";
    } else {
      const samplePlan = buildInstallmentPlan({
        debtorName: candidate.displayName,
        businessName,
        totalMinor: BigInt(candidate.outstandingMinor),
        installmentsCount: 3,
        interval: "monthly",
        startDateIso: todayIso,
        downPaymentPct: 25,
      });
      toolCalls.push({
        toolName: "propose_installment_plan",
        titleAr: `بناء جدول تقسيط ذكي: ${candidate.displayName}`,
        titleEn: `Build Installment Plan: ${candidate.displayName}`,
        status: "completed",
        summaryAr: `${samplePlan.installmentsCount} دفعات لإجمالي ${samplePlan.formattedTotal} ج.م (مقدم ${samplePlan.downPaymentPct}%)`,
        summaryEn: `${samplePlan.installmentsCount} tranches for ${samplePlan.formattedTotal} EGP (${samplePlan.downPaymentPct}% down)`,
      });
      const linesAr = samplePlan.tranches
        .map((t) => `• ${t.labelAr}: ${t.formattedAmount} ج.م (${t.dueDate})`)
        .join("\n");
      const linesEn = samplePlan.tranches
        .map((t) => `• ${t.labelEn}: ${t.formattedAmount} EGP (${t.dueDate})`)
        .join("\n");
      answerAr = `مقترح جدولة ذكي للمديونية (${candidate.displayName} — ${samplePlan.formattedTotal} ج.م):\n${linesAr}\nيمكنك تخصيص عدد الأقساط وإرسال العرض مباشرة من تبويب «صياغة رسالة / جدولة».`;
      answerEn = `Smart settlement schedule for (${candidate.displayName} — ${samplePlan.formattedTotal} EGP):\n${linesEn}\nCustomize installments and send via WhatsApp in the Smart Draft tab.`;
      quickLinks.push({
        labelAr: `ملف ${candidate.displayName}`,
        labelEn: `Open ${candidate.displayName}`,
        href: `/debtors/${candidate.debtorId}`,
      });
    }
  } else {
    toolCalls.push({
      toolName: "query_workspace_overview",
      titleAr: "استعلام الملخص التنفيذي والمؤشرات الحية",
      titleEn: "Query Executive Briefing & Live KPIs",
      status: "completed",
      summaryAr: `إجمالي المستحقات ${formatEgp(BigInt(intel.metrics.totalOutstandingMinor))} ج.م · التحصيل ${intel.metrics.collectionRate}%`,
      summaryEn: `Open receivables ${formatEgp(BigInt(intel.metrics.totalOutstandingMinor))} EGP · Collection rate ${intel.metrics.collectionRate}%`,
    });
    answerAr = `${intel.headlineAr}\n${intel.summaryAr}`;
    answerEn = `${intel.headlineEn}\n${intel.summaryEn}`;
    quickLinks.push({ labelAr: "الفواتير", labelEn: "Invoices", href: "/invoices" });
  }

  // 3. Dynamic Gemini GenAI Intelligence invocation for user inquiries
  if (safeQuestion.length > 0) {
    const ai = aiDeps();
    if (!ai.usingFakeLlm && ai.llm.generateText) {
      try {
        const topDebtorsSummary = intel.debtorScores.slice(0, 5).map((d, i) =>
          `${i + 1}. ${d.displayName}: مستحق ${formatEgp(BigInt(d.outstandingMinor))} ج.م (متأخر ${d.maxDaysOverdue} يوم، تصنيف مخاطر: ${d.tier}، إجراء مقترح: ${d.recommendation.titleAr})`
        ).join("\n");

        const prompt = [
          `بيانات دفاتر منشأة «${businessName}» بتاريخ اليوم (${todayIso}):`,
          `- إجمالي المستحقات: ${formatEgp(BigInt(intel.metrics.totalOutstandingMinor))} ج.م`,
          `- المتأخرات: ${formatEgp(BigInt(intel.metrics.overdueMinor))} ج.م`,
          `- المحصل هذا الشهر: ${formatEgp(BigInt(intel.metrics.collectedThisMonthMinor))} ج.م (نسبة التحصيل: ${intel.metrics.collectionRate}%)`,
          `- متوسط فترة التحصيل (DSO): ${intel.metrics.dsoDays} يوم`,
          `- الشيكات: ${intel.metrics.upcomingChequesCount} قادمة للتحصيل، ${intel.metrics.bouncedChequesCount} مرتدة`,
          `- الإيصالات والاعتراضات: ${intel.metrics.pendingClaimsCount} إيصال بانتظار التأكيد، ${intel.metrics.openDisputesCount} اعتراض مفتوح`,
          `- أهم العملاء في المحفظة:\n${topDebtorsSummary || "لا توجد مديونيات متأخرة حالياً"}`,
          matchedDebtor
            ? `- العميل المستعلم عنه: ${matchedDebtor.displayName} (رصيد: ${formatEgp(BigInt(matchedDebtor.outstandingMinor))} ج.م، متأخر: ${matchedDebtor.maxDaysOverdue} يوم، أفضل وقت للتذكير: ${matchedDebtor.optimalWindow.windowLabelAr})`
            : "",
          "",
          `استفسار صاحب المنشأة: "${safeQuestion}"`,
        ].filter(Boolean).join("\n");

        const systemInstruction = [
          "أنت المستشار المالي والائتماني الذكي لمنصة «دفقلي» (DAFQLY).",
          "مهمتك مساعدة صاحب المنشأة على متابعة وتحصيل مستحقاته وتقديم نصائح مالية مبنية على الأرقام الحقيقية في الدفاتر.",
          "القواعد:",
          "1. أجب بلغة عربية احترافية، دقيقة، وقوية كخبير مالي متمرس (CFO) بدون حشو إنشائي.",
          "2. اذكر الأرقام والأسماء المحددة من الدفاتر بدقة.",
          "3. اقترح إجراءات عملية قابلة للتنفيذ الفوري (تذكير واتساب بنبرة معينة، جدولة أقساط، إيداع شيك).",
          input.locale === "en" ? "4. Please respond in professional English." : "4. أجب باللغة العربية الفصحى البسيطة والمهنية.",
        ].join("\n");

        const res = await ai.llm.generateText(prompt, systemInstruction);
        if (res.text && res.text.trim().length > 10) {
          answerAr = res.text.trim();
          answerEn = res.text.trim();
        }
      } catch {
        // Fall back gracefully to synthesized response
      }
    }
  }

  await withTenant(app, tenantId, async (tx) => {
    await tx.insert(auditLog).values({
      tenantId,
      actorUserId,
      action: "ai.copilot_queried",
      entity: "ai_workspace",
      entityId: tenantId,
      after: {
        intent: effectiveIntent,
        hasQuestion: safeQuestion.length > 0,
        toolsExecuted: toolCalls.map((t) => t.toolName),
        matchedDebtorId: matchedDebtor?.debtorId ?? null,
      } as never,
    });
  });

  return {
    answerAr,
    answerEn,
    toolCalls,
    matchedDebtor,
    suggestedDebtors: intel.topActions.slice(0, 3),
    quickLinks,
  };
}
