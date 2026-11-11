import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  buildCollectionsBriefing,
  formatEgp,
  sanitizePromptData,
  scoreDebtorIntelligence,
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
} from "@tahseel/db/schema";
import { getKpis } from "./reports";
import { getDashboardSummary } from "./services";
import { syncWorkspaceNotifications } from "./notifications";

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
 * scores every debtor deterministically, synthesizes the executive briefing,
 * and optionally triggers idempotent operational notifications.
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
      collectionRate: briefing.metrics.collectionRate,
      dsoDays: briefing.metrics.dsoDays,
      pendingClaimsCount: briefing.metrics.pendingClaimsCount,
      openDisputesCount: briefing.metrics.openDisputesCount,
      humanIntentsCount: briefing.metrics.humanIntentsCount,
      upcomingChequesCount: briefing.metrics.upcomingChequesCount,
      bouncedChequesCount: briefing.metrics.bouncedChequesCount,
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
  intent: z.enum(["daily_summary", "priority_customers", "action_plan", "inbox_triage", "custom_question"]),
  question: z.string().trim().max(400).optional(),
  locale: z.enum(["ar", "en"]).default("ar"),
});
export type CopilotQueryInput = z.input<typeof copilotQueryInput>;

export interface CopilotResponse {
  answerAr: string;
  answerEn: string;
  suggestedDebtors: DebtorIntelligenceView[];
  quickLinks: { labelAr: string; labelEn: string; href: string }[];
}

/**
 * Grounded AI Copilot assistant: routes allowlisted query intents over live
 * single-tenant metrics & scores (Hard Rule #4: untrusted text is sanitized data,
 * never raw SQL or instructions). Logs every execution to `audit_log`.
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

  // Determine effective intent for custom free-text questions via deterministic keyword routing
  let effectiveIntent = input.intent;
  if (effectiveIntent === "custom_question" && safeQuestion) {
    if (/متأخر|أولوية|أهم|عميل|عملاء|priority|overdue|top|who/i.test(safeQuestion)) {
      effectiveIntent = "priority_customers";
    } else if (/خطة|خطوات|تذكير|رسالة|plan|follow|remind|draft/i.test(safeQuestion)) {
      effectiveIntent = "action_plan";
    } else if (/إيصال|اعتراض|صندوق|شيك|inbox|receipt|dispute|cheque/i.test(safeQuestion)) {
      effectiveIntent = "inbox_triage";
    } else {
      effectiveIntent = "daily_summary";
    }
  }

  let answerAr = intel.summaryAr;
  let answerEn = intel.summaryEn;
  const quickLinks: { labelAr: string; labelEn: string; href: string }[] = [];

  if (effectiveIntent === "priority_customers") {
    const top = intel.topActions.slice(0, 3);
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
    answerAr = `خطة العمل المقترحة اليوم:\n• متابعة ${overdueCount} عميل لديهم مستحقات متأخرة (البدء بالأعلى تأثراً على السيولة).\n• مراجعة ${intel.metrics.pendingClaimsCount} إيصال سداد و${intel.metrics.openDisputesCount} اعتراض مفتوح.${optedOutCount > 0 ? `\n• توجد ${optedOutCount} حسابات موقوفة التذكير ولها أرصدة مفتوحة.` : ""}`;
    answerEn = `Recommended action plan today:\n• Follow up ${overdueCount} overdue customer(s) prioritized by cash impact.\n• Clear ${intel.metrics.pendingClaimsCount} receipt claim(s) and ${intel.metrics.openDisputesCount} dispute(s).${optedOutCount > 0 ? `\n• ${optedOutCount} debtor(s) have paused reminders despite open balances.` : ""}`;
    quickLinks.push({ labelAr: "صندوق المراجعة", labelEn: "Review Inbox", href: "/ai-inbox" });
  } else if (effectiveIntent === "inbox_triage") {
    const { pendingClaimsCount, openDisputesCount, humanIntentsCount, upcomingChequesCount, bouncedChequesCount } = intel.metrics;
    answerAr = `ملخص العناصر التي تتطلب مراجعة بشرية:\n• إيصالات سداد بانتظار التأكيد: ${pendingClaimsCount}\n• اعتراضات فواتير مفتوحة: ${openDisputesCount}\n• ردود واتساب للمراجعة: ${humanIntentsCount}\n• شيكات قريبة/مرتدة: ${upcomingChequesCount + bouncedChequesCount}`;
    answerEn = `Human review queue summary:\n• Pending receipt claims: ${pendingClaimsCount}\n• Open invoice disputes: ${openDisputesCount}\n• WhatsApp replies awaiting triage: ${humanIntentsCount}\n• Upcoming/bounced cheques: ${upcomingChequesCount + bouncedChequesCount}`;
    quickLinks.push(
      { labelAr: "صندوق الوارد الذكي", labelEn: "AI Inbox", href: "/ai-inbox" },
      { labelAr: "إدارة الشيكات", labelEn: "Cheques", href: "/cheques" },
    );
  } else {
    answerAr = `${intel.headlineAr}\n${intel.summaryAr}`;
    answerEn = `${intel.headlineEn}\n${intel.summaryEn}`;
    quickLinks.push({ labelAr: "الفواتير", labelEn: "Invoices", href: "/invoices" });
  }

  await withTenant(app, tenantId, async (tx) => {
    await tx.insert(auditLog).values({
      tenantId,
      actorUserId,
      action: "ai.copilot_queried",
      entity: "ai_workspace",
      entityId: tenantId,
      after: { intent: effectiveIntent, hasQuestion: safeQuestion.length > 0 } as never,
    });
  });

  return {
    answerAr,
    answerEn,
    suggestedDebtors: intel.topActions.slice(0, 3),
    quickLinks,
  };
}
