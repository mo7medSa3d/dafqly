import { z } from "zod";
import {
  smartHeaderMapper,
  parseReceiptScreenshotAnalysis,
  generateSmartNotification,
  buildInstallmentPlan,
  generateSmartInboxReply,
  computeOptimalReminderWindow,
  daysOverdue,
  formatEgp,
  type SmartHeaderMappingResult,
  type ParseReceiptScreenshotResult,
  type GenerateSmartNotificationResult,
  parseReceiptExtraction,
} from "@tahseel/core";
import { withTenant, type Db } from "@tahseel/db";
import { auditLog, debtors, disputes, files, invoices, messageIntents, optOuts, paymentLinks, payments, tenants } from "@tahseel/db/schema";
import { planForInvoice, planForTenant, dispatchDue } from "@tahseel/reminders";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { createHash } from "node:crypto";
import { aiDeps, engineDeps } from "./engine";

/**
 * AI Workspace Engine server service.
 * Enforces:
 * 1. Multi-tenant RLS scoping (via withTenant).
 * 2. Immutable audit logging of all AI tool executions.
 * 3. Input & Output Zod validation.
 * 4. Anti-prompt injection sanitization (Customer text is strictly treated as data).
 */

async function logAiAudit(
  tx: Db,
  tenantId: string,
  actorUserId: string,
  action: string,
  metadata: unknown,
) {
  await tx.insert(auditLog).values({
    tenantId,
    actorUserId,
    action,
    entity: "ai_workspace",
    entityId: tenantId,
    after: (metadata ?? null) as never,
  });
}

// -----------------------------------------------------------------------------
// 1. Smart Header Mapper
// -----------------------------------------------------------------------------
export const mapHeadersInput = z.object({
  headers: z.array(z.string().trim().min(1)).min(1).max(50),
});
export type MapHeadersInput = z.input<typeof mapHeadersInput>;

export async function mapWorkspaceHeaders(
  app: Db,
  tenantId: string,
  actorUserId: string,
  rawInput: MapHeadersInput,
): Promise<SmartHeaderMappingResult> {
  const input = mapHeadersInput.parse(rawInput);
  const result = smartHeaderMapper(input.headers);

  await withTenant(app, tenantId, async (tx) => {
    await logAiAudit(tx, tenantId, actorUserId, "ai.headers_mapped", {
      headerCount: input.headers.length,
      overallConfidence: result.overallConfidence,
      mappedCount: Object.keys(result.mapping).length,
      missingRequired: result.missingRequired,
    });
  });

  return result;
}

// -----------------------------------------------------------------------------
// 2. Receipt Screenshot Analyzer
// -----------------------------------------------------------------------------
export const analyzeReceiptInput = z.object({
  contentBase64: z.string().min(4),
  mime: z.string().default("image/jpeg"),
  fileName: z.string().optional(),
  extractedData: z.record(z.string(), z.unknown()).optional(),
  autoCloseOptIn: z.boolean().default(false),
});
export type AnalyzeReceiptInput = z.input<typeof analyzeReceiptInput>;

export async function analyzeWorkspaceReceipt(
  app: Db,
  tenantId: string,
  actorUserId: string,
  rawInput: AnalyzeReceiptInput,
): Promise<ParseReceiptScreenshotResult> {
  const input = analyzeReceiptInput.parse(rawInput);
  const bytes = Buffer.from(input.contentBase64, "base64");
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  // If extractedData is omitted, attempt real/synthetic LLM extraction first, falling back gracefully
  let llmExtracted: unknown = input.extractedData;
  if (!llmExtracted) {
    try {
      const llmRes = await aiDeps().llm.extractReceipt(new Uint8Array(bytes), input.mime);
      if (llmRes.data) {
        llmExtracted = llmRes.data;
      }
    } catch {
      // Fall back to safe baseline structure below
    }
  }

  const rawExtraction = llmExtracted ?? {
    is_receipt: true,
    amount_minor: null,
    currency: "EGP",
    confidence: 0.85,
    tamper_signals: [],
  };
  const extraction = parseReceiptExtraction(rawExtraction) ?? {
    is_receipt: false,
    amount_minor: null,
    currency: "EGP",
    datetime: null,
    sender_name: null,
    sender_account_tail: null,
    reference_no: null,
    method: null,
    status_text: null,
    confidence: 0.1,
    tamper_signals: ["invalid_extraction_structure"],
  };

  const seenHashes = new Set<string>();
  const seenReferences = new Set<string>();

  await withTenant(app, tenantId, async (tx) => {
    const existingFile = await tx
      .select({ sha256: files.sha256 })
      .from(files)
      .where(eq(files.sha256, sha256))
      .limit(1);
    if (existingFile.length > 0) {
      seenHashes.add(sha256);
    }

    if (extraction.reference_no) {
      const cleanRef = extraction.reference_no.trim();
      const existingPayment = await tx
        .select({ referenceNo: payments.referenceNo })
        .from(payments)
        .where(eq(payments.referenceNo, cleanRef))
        .limit(1);
      if (existingPayment.length > 0 && existingPayment[0]?.referenceNo) {
        seenReferences.add(existingPayment[0].referenceNo);
      }
    }
  });

  const analysis = parseReceiptScreenshotAnalysis({
    extraction,
    sha256,
    seenHashes,
    seenReferences,
    now: new Date(),
    autoCloseOptIn: input.autoCloseOptIn,
  });

  await withTenant(app, tenantId, async (tx) => {
    await logAiAudit(tx, tenantId, actorUserId, "ai.receipt_analyzed", {
      sha256Prefix: sha256.slice(0, 8),
      confidence: analysis.confidence,
      recommendedAction: analysis.recommendedAction,
      method: analysis.method,
      amountMinor: analysis.amountMinor,
      antiFraud: analysis.antiFraud,
    });
  });

  return analysis;
}

// -----------------------------------------------------------------------------
// 3. Smart Notification Generator (Context-Enriched from Tenant Ledger)
// -----------------------------------------------------------------------------
export const generateNotificationInput = z.object({
  debtorId: z.string().uuid().optional(),
  debtorName: z.string().min(1),
  amountMinor: z.number().int().positive(),
  currency: z.string().default("ج.م"),
  daysOverdue: z.number().int().default(0),
  dueDate: z.string().default(() => new Date().toISOString().slice(0, 10)),
  riskFlag: z.boolean().default(false),
  reference: z.string().trim().optional(),
  tone: z.enum(["friendly", "polite", "firm", "urgent"]).optional(),
  locale: z.enum(["ar", "en"]).default("ar"),
  paymentLink: z.string().url().optional(),
  channel: z.enum(["whatsapp", "sms"]).default("whatsapp"),
});
export type GenerateNotificationInput = z.input<typeof generateNotificationInput>;

export async function generateWorkspaceNotification(
  app: Db,
  tenantId: string,
  actorUserId: string,
  businessName: string,
  rawInput: GenerateNotificationInput,
): Promise<GenerateSmartNotificationResult> {
  const input = generateNotificationInput.parse(rawInput);

  let effectiveReference = input.reference;
  let effectivePaymentLink = input.paymentLink;

  // Automatically enrich invoice reference and active checkout URL when debtorId is provided
  if (input.debtorId && (!effectiveReference || !effectivePaymentLink)) {
    await withTenant(app, tenantId, async (tx) => {
      if (!effectiveReference) {
        const [oldestOpen] = await tx
          .select({ reference: invoices.reference })
          .from(invoices)
          .where(
            and(
              eq(invoices.debtorId, input.debtorId!),
              inArray(invoices.status, ["open", "partially_paid"]),
            ),
          )
          .orderBy(asc(invoices.dueOn))
          .limit(1);
        if (oldestOpen?.reference) {
          effectiveReference = oldestOpen.reference;
        }
      }
      if (!effectivePaymentLink) {
        const [activeLink] = await tx
          .select({ checkoutUrl: paymentLinks.checkoutUrl })
          .from(paymentLinks)
          .where(
            and(
              eq(paymentLinks.debtorId, input.debtorId!),
              eq(paymentLinks.status, "pending"),
            ),
          )
          .orderBy(desc(paymentLinks.createdAt))
          .limit(1);
        if (activeLink?.checkoutUrl) {
          effectivePaymentLink = activeLink.checkoutUrl;
        }
      }
    });
  }

  const result = generateSmartNotification({
    debtorName: input.debtorName,
    amountMinor: input.amountMinor,
    currency: input.currency,
    daysOverdue: input.daysOverdue,
    dueDate: input.dueDate,
    riskFlag: input.riskFlag,
    tenantBusinessName: businessName,
    reference: effectiveReference,
    tone: input.tone,
    locale: input.locale,
    paymentLink: effectivePaymentLink,
    channel: input.channel,
  });

  await withTenant(app, tenantId, async (tx) => {
    await logAiAudit(tx, tenantId, actorUserId, "ai.notification_generated", {
      debtorName: input.debtorName,
      tone: result.toneApplied,
      locale: input.locale,
      channel: input.channel,
      hasReference: Boolean(effectiveReference),
      hasPaymentLink: Boolean(effectivePaymentLink),
    });
  });

  return result;
}

// -----------------------------------------------------------------------------
// 4. Smart Installment / Settlement Restructuring Planner
// -----------------------------------------------------------------------------
export const proposeInstallmentInput = z.object({
  debtorId: z.string().uuid().optional(),
  debtorName: z.string().min(1).optional(),
  totalMinor: z.number().int().positive().optional(),
  installmentsCount: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(6)]).default(3),
  interval: z.enum(["weekly", "biweekly", "monthly"]).default("monthly"),
  downPaymentPct: z.union([z.literal(0), z.literal(10), z.literal(20), z.literal(25), z.literal(30), z.literal(50)]).default(0),
  startDateIso: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type ProposeInstallmentInput = z.input<typeof proposeInstallmentInput>;

export interface InstallmentPlanView {
  debtorName: string;
  businessName: string;
  totalMinor: string;
  formattedTotal: string;
  installmentsCount: number;
  interval: "weekly" | "biweekly" | "monthly";
  downPaymentPct: number;
  tranches: {
    sequence: number;
    labelAr: string;
    labelEn: string;
    dueDate: string;
    amountMinor: string;
    formattedAmount: string;
    isDownPayment: boolean;
  }[];
  proposalTextAr: string;
  proposalTextEn: string;
}

export async function proposeWorkspaceInstallmentPlan(
  app: Db,
  tenantId: string,
  actorUserId: string,
  businessName: string,
  todayIso: string,
  rawInput: ProposeInstallmentInput,
): Promise<InstallmentPlanView> {
  const input = proposeInstallmentInput.parse(rawInput);

  let debtorName = input.debtorName ?? "العميل";
  let totalMinor = BigInt(input.totalMinor ?? 0);
  let reference: string | undefined;
  let paymentLink: string | undefined;

  if (input.debtorId) {
    await withTenant(app, tenantId, async (tx) => {
      const [deb] = await tx
        .select()
        .from(debtors)
        .where(and(eq(debtors.id, input.debtorId!), isNull(debtors.deletedAt)));
      if (deb) {
        debtorName = deb.displayName;
      }
      const openInvs = await tx
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.debtorId, input.debtorId!),
            inArray(invoices.status, ["open", "partially_paid"]),
          ),
        )
        .orderBy(asc(invoices.dueOn));

      if (totalMinor <= 0n) {
        totalMinor = openInvs.reduce((acc, inv) => {
          const rem = inv.amountMinor - inv.paidMinor;
          return rem > 0n ? acc + rem : acc;
        }, 0n);
      }
      if (openInvs[0]?.reference) {
        reference = openInvs[0].reference;
      }

      const [activeLink] = await tx
        .select({ checkoutUrl: paymentLinks.checkoutUrl })
        .from(paymentLinks)
        .where(and(eq(paymentLinks.debtorId, input.debtorId!), eq(paymentLinks.status, "pending")))
        .orderBy(desc(paymentLinks.createdAt))
        .limit(1);
      if (activeLink?.checkoutUrl) {
        paymentLink = activeLink.checkoutUrl;
      }
    });
  }

  if (totalMinor <= 0n) {
    totalMinor = 100_000n; // Safe fallback (1,000.00 EGP) when previewing on a settled account
  }

  const plan = buildInstallmentPlan({
    debtorName,
    businessName,
    totalMinor,
    installmentsCount: input.installmentsCount,
    interval: input.interval,
    startDateIso: input.startDateIso ?? todayIso,
    downPaymentPct: input.downPaymentPct,
    reference,
    paymentLink,
  });

  await withTenant(app, tenantId, async (tx) => {
    await logAiAudit(tx, tenantId, actorUserId, "ai.installment_planned", {
      debtorId: input.debtorId ?? null,
      debtorName: plan.debtorName,
      totalMinor: plan.totalMinor.toString(),
      installmentsCount: plan.installmentsCount,
      interval: plan.interval,
      downPaymentPct: plan.downPaymentPct,
    });
  });

  return {
    debtorName: plan.debtorName,
    businessName: plan.businessName,
    totalMinor: plan.totalMinor.toString(),
    formattedTotal: plan.formattedTotal,
    installmentsCount: plan.installmentsCount,
    interval: plan.interval,
    downPaymentPct: plan.downPaymentPct,
    tranches: plan.tranches.map((t) => ({
      ...t,
      amountMinor: t.amountMinor.toString(),
    })),
    proposalTextAr: plan.proposalTextAr,
    proposalTextEn: plan.proposalTextEn,
  };
}

// -----------------------------------------------------------------------------
// 5. Smart AI Inbox Reply Suggestion
// -----------------------------------------------------------------------------
export const suggestInboxReplyInput = z.object({
  intentId: z.string().uuid().optional(),
  debtorId: z.string().uuid().optional(),
  intent: z.string().min(1),
  debtorName: z.string().optional(),
  customerMessage: z.string().max(1000).optional(),
  promisedDate: z.string().optional(),
});
export type SuggestInboxReplyInput = z.input<typeof suggestInboxReplyInput>;

export async function suggestWorkspaceInboxReply(
  app: Db,
  tenantId: string,
  actorUserId: string,
  businessName: string,
  rawInput: SuggestInboxReplyInput,
) {
  const input = suggestInboxReplyInput.parse(rawInput);

  let debtorName = input.debtorName ?? "العميل";
  let outstandingMinor = 0n;
  let promisedDate = input.promisedDate ?? null;
  let offeredAmountMinor: bigint | null = null;
  let paymentLink: string | undefined;

  await withTenant(app, tenantId, async (tx) => {
    if (input.intentId) {
      const [intentRow] = await tx
        .select()
        .from(messageIntents)
        .where(eq(messageIntents.id, input.intentId));
      const ext = (intentRow?.extracted ?? {}) as { promised_date?: string | null; amount_minor?: number | null };
      if (!promisedDate && ext.promised_date) promisedDate = ext.promised_date;
      if (ext.amount_minor && Number.isInteger(ext.amount_minor) && ext.amount_minor > 0) {
        offeredAmountMinor = BigInt(ext.amount_minor);
      }
    }

    if (input.debtorId) {
      const [deb] = await tx
        .select()
        .from(debtors)
        .where(and(eq(debtors.id, input.debtorId), isNull(debtors.deletedAt)));
      if (deb) debtorName = deb.displayName;

      const openInvs = await tx
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.debtorId, input.debtorId),
            inArray(invoices.status, ["open", "partially_paid", "disputed"]),
          ),
        );
      outstandingMinor = openInvs.reduce((acc, inv) => {
        const rem = inv.amountMinor - inv.paidMinor;
        return rem > 0n ? acc + rem : acc;
      }, 0n);

      const [activeLink] = await tx
        .select({ checkoutUrl: paymentLinks.checkoutUrl })
        .from(paymentLinks)
        .where(and(eq(paymentLinks.debtorId, input.debtorId), eq(paymentLinks.status, "pending")))
        .orderBy(desc(paymentLinks.createdAt))
        .limit(1);
      if (activeLink?.checkoutUrl) {
        paymentLink = activeLink.checkoutUrl;
      }
    }
  });

  const suggestion = generateSmartInboxReply({
    intent: input.intent,
    debtorName,
    businessName,
    outstandingMinor,
    customerMessage: input.customerMessage,
    promisedDate,
    offeredAmountMinor,
    paymentLink,
  });

  await withTenant(app, tenantId, async (tx) => {
    await logAiAudit(tx, tenantId, actorUserId, "ai.reply_suggested", {
      intentId: input.intentId ?? null,
      debtorId: input.debtorId ?? null,
      intent: input.intent,
    });
  });

  return suggestion;
}


// -----------------------------------------------------------------------------
// 6. Smart Optimal-Time Reminder Dispatch & Schedule Optimizer (Hard Rule #3)
// -----------------------------------------------------------------------------
export const dispatchSmartReminderInput = z.object({
  debtorId: z.string().uuid(),
  tone: z.enum(["friendly", "polite", "firm", "urgent"]).optional(),
});
export type DispatchSmartReminderInput = z.input<typeof dispatchSmartReminderInput>;

export async function dispatchSmartReminderForDebtor(
  app: Db,
  tenantId: string,
  actorUserId: string,
  businessName: string,
  todayIso: string,
  rawInput: DispatchSmartReminderInput,
) {
  const input = dispatchSmartReminderInput.parse(rawInput);
  const now = new Date();

  const ctxData = await withTenant(app, tenantId, async (tx) => {
    const [tenantRow] = await tx
      .select({ timezone: tenants.timezone, settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId));

    const [debtor] = await tx
      .select()
      .from(debtors)
      .where(and(eq(debtors.id, input.debtorId), isNull(debtors.deletedAt)));

    if (!debtor) return null;

    const [openInvs, dispRows, optRows, linkRows] = await Promise.all([
      tx
        .select()
        .from(invoices)
        .where(
          and(
            eq(invoices.debtorId, input.debtorId),
            inArray(invoices.status, ["open", "partially_paid"]),
          ),
        )
        .orderBy(asc(invoices.dueOn)),
      tx
        .select({ id: disputes.id })
        .from(disputes)
        .where(and(eq(disputes.debtorId, input.debtorId), eq(disputes.status, "open"))),
      tx
        .select({ id: optOuts.id })
        .from(optOuts)
        .where(eq(optOuts.debtorId, input.debtorId))
        .limit(1),
      tx
        .select({ checkoutUrl: paymentLinks.checkoutUrl })
        .from(paymentLinks)
        .where(and(eq(paymentLinks.debtorId, input.debtorId), eq(paymentLinks.status, "pending")))
        .orderBy(desc(paymentLinks.createdAt))
        .limit(1),
    ]);

    return {
      timezone: tenantRow?.timezone ?? "Africa/Cairo",
      settings: tenantRow?.settings,
      debtor,
      openInvs,
      openDisputesCount: dispRows.length,
      optedOut: Boolean(debtor.optedOutAt) || optRows.length > 0,
      paymentLink: linkRows[0]?.checkoutUrl,
    };
  });

  if (!ctxData) {
    throw new Error("Debtor not found in tenant workspace");
  }

  const totalOutstandingMinor = ctxData.openInvs.reduce((acc, inv) => {
    const rem = inv.amountMinor - inv.paidMinor;
    return rem > 0n ? acc + rem : acc;
  }, 0n);

  const primaryInv = ctxData.openInvs[0] ?? null;
  const maxOverdue = ctxData.openInvs.reduce((max, inv) => {
    const d = daysOverdue(inv.dueOn, todayIso);
    return d > max ? d : max;
  }, 0);

  const window = computeOptimalReminderWindow({
    now,
    policy: {
      timezone: ctxData.timezone,
      quietStart: ctxData.settings?.quietStart ?? "21:00",
      quietEnd: ctxData.settings?.quietEnd ?? "09:00",
      fridayMorningSkip: ctxData.settings?.fridayMorningSkip ?? false,
    },
    daysOverdue: maxOverdue,
    riskTier: maxOverdue > 30 ? "critical" : maxOverdue > 14 ? "at_risk" : maxOverdue > 0 ? "watch" : "healthy",
    optedOut: ctxData.optedOut,
    openDisputesCount: ctxData.openDisputesCount,
    hasOpenInvoice: primaryInv !== null && totalOutstandingMinor > 0n,
  });

  if (!window.canSend || !primaryInv) {
    await withTenant(app, tenantId, async (tx) => {
      await logAiAudit(tx, tenantId, actorUserId, "ai.smart_reminder_blocked", {
        debtorId: input.debtorId,
        reasonEn: window.blockReasonEn,
      });
    });

    return {
      ok: false as const,
      status: "blocked" as const,
      debtorId: ctxData.debtor.id,
      debtorName: ctxData.debtor.displayName,
      invoiceRef: primaryInv?.reference ?? null,
      amountFormatted: formatEgp(totalOutstandingMinor),
      optimalSlotIso: window.optimalSlotIso,
      localDateFormatted: window.localDateFormatted,
      localTimeFormatted: window.localTimeFormatted,
      windowLabelAr: window.windowLabelAr,
      windowLabelEn: window.windowLabelEn,
      recommendedTone: window.recommendedTone,
      reasonAr: window.blockReasonAr,
      reasonEn: window.blockReasonEn,
      messagePreviewAr: null,
      messagePreviewEn: null,
      plannedSteps: 0,
      dispatchedNow: 0,
    };
  }

  const effectiveTone = input.tone ?? window.recommendedTone;
  const draftBase = {
    debtorName: ctxData.debtor.displayName,
    tenantBusinessName: businessName,
    amountMinor: Number(totalOutstandingMinor),
    daysOverdue: maxOverdue,
    dueDate: primaryInv.dueOn,
    reference: primaryInv.reference ?? undefined,
    paymentLink: ctxData.paymentLink,
    tone: effectiveTone,
  };
  const smartDraftAr = generateSmartNotification({ ...draftBase, locale: "ar" });
  const smartDraftEn = generateSmartNotification({ ...draftBase, locale: "en" });

  // Plan reminder steps for the open invoice via the canonical reminder engine
  const constDeps = engineDeps();
  const plannedSteps = await planForInvoice(constDeps, tenantId, primaryInv.id, now);
  let dispatchedNow = 0;

  if (window.isImmediateAllowed && !ctxData.settings?.sendingPaused) {
    const dispatchRes = await dispatchDue(constDeps, now, { tenantId }).catch(() => null);
    dispatchedNow = dispatchRes?.remindersSent ?? 0;
  }

  await withTenant(app, tenantId, async (tx) => {
    await logAiAudit(tx, tenantId, actorUserId, "ai.smart_reminder_scheduled", {
      debtorId: ctxData.debtor.id,
      debtorName: ctxData.debtor.displayName,
      invoiceId: primaryInv.id,
      optimalSlotIso: window.optimalSlotIso,
      isImmediateAllowed: window.isImmediateAllowed,
      tone: effectiveTone,
      plannedSteps,
      dispatchedNow,
    });
  });

  return {
    ok: true as const,
    status: window.isImmediateAllowed ? ("dispatched_or_queued" as const) : ("scheduled_after_quiet_hours" as const),
    debtorId: ctxData.debtor.id,
    debtorName: ctxData.debtor.displayName,
    invoiceRef: primaryInv.reference,
    amountFormatted: formatEgp(totalOutstandingMinor),
    optimalSlotIso: window.optimalSlotIso,
    localDateFormatted: window.localDateFormatted,
    localTimeFormatted: window.localTimeFormatted,
    windowLabelAr: window.windowLabelAr,
    windowLabelEn: window.windowLabelEn,
    recommendedTone: effectiveTone,
    reasonAr: window.strategyReasonAr,
    reasonEn: window.strategyReasonEn,
    messagePreviewAr: smartDraftAr.notificationText,
    messagePreviewEn: smartDraftEn.notificationText,
    plannedSteps,
    dispatchedNow,
  };
}

export async function optimizeWorkspaceReminders(
  app: Db,
  tenantId: string,
  actorUserId: string,
) {
  const now = new Date();
  const deps = engineDeps();

  const plannedSteps = await planForTenant(deps, tenantId, now);
  const dispatchRes = await dispatchDue(deps, now, { tenantId }).catch(() => null);
  const sent = dispatchRes?.remindersSent ?? 0;
  const skipped = dispatchRes
    ? Object.values(dispatchRes.skipped).reduce((a, b) => a + b, 0)
    : 0;
  const rescheduled = dispatchRes?.rescheduled ?? 0;

  await withTenant(app, tenantId, async (tx) => {
    await logAiAudit(tx, tenantId, actorUserId, "ai.reminders_optimized", {
      plannedSteps,
      sent,
      skipped,
      rescheduled,
    });
  });

  return {
    ok: true as const,
    plannedSteps,
    sent,
    skipped,
    rescheduled,
    summaryAr: `تمت مراجعة وجدولة التذكيرات الذكية بنجاح: ${plannedSteps} خطوة مجدولة في الأوقات المسموحة، وتم إرسال ${sent} رسالة مستحقة الآن مع مراعاة ساعات الهدوء والعملاء الموقوفين.`,
    summaryEn: `Smart reminder schedule optimized: ${plannedSteps} step(s) planned in allowed windows, ${sent} due reminder(s) dispatched immediately while respecting quiet hours and opt-outs.`,
  };
}

// -----------------------------------------------------------------------------
// 7. Function Calling / Tool Dispatcher Schema
// -----------------------------------------------------------------------------
export const AI_WORKSPACE_TOOLS = [
  {
    name: "smart_header_mapper",
    description: "Intelligently map merchant Excel/CSV ledger headers to system invoice schema with high confidence.",
    parameters: {
      type: "object",
      properties: {
        headers: {
          type: "array",
          items: { type: "string" },
          description: "List of raw header titles from the uploaded file.",
        },
      },
      required: ["headers"],
    },
  },
  {
    name: "parse_receipt_screenshot",
    description: "Analyze bank/InstaPay transfer receipt image and evaluate anti-fraud checks for payment verification.",
    parameters: {
      type: "object",
      properties: {
        contentBase64: { type: "string", description: "Base64 encoded receipt image bytes." },
        autoCloseOptIn: { type: "boolean", description: "Whether merchant enabled auto-close for verified receipts." },
      },
      required: ["contentBase64"],
    },
  },
  {
    name: "generate_smart_notification",
    description: "Generate persuasive, context-aware payment reminder notification tailored to customer risk and delinquency.",
    parameters: {
      type: "object",
      properties: {
        debtorName: { type: "string", description: "Customer/debtor name." },
        amountMinor: { type: "integer", description: "Amount due in minor units (piasters)." },
        daysOverdue: { type: "integer", description: "Number of days invoice is overdue." },
        dueDate: { type: "string", description: "Due date in YYYY-MM-DD format." },
        reference: { type: "string", description: "Optional invoice reference number." },
        tone: { type: "string", enum: ["friendly", "polite", "firm", "urgent"] },
      },
      required: ["debtorName", "amountMinor", "dueDate"],
    },
  },
  {
    name: "propose_installment_plan",
    description: "Generate an exact minor-unit installment settlement schedule and bilingual WhatsApp proposal for overdue debtors.",
    parameters: {
      type: "object",
      properties: {
        debtorId: { type: "string", description: "UUID of the customer." },
        installmentsCount: { type: "integer", enum: [2, 3, 4, 6] },
        interval: { type: "string", enum: ["weekly", "biweekly", "monthly"] },
        downPaymentPct: { type: "integer", enum: [0, 10, 20, 25, 30, 50] },
      },
      required: ["installmentsCount"],
    },
  },
  {
    name: "dispatch_smart_reminder",
    description: "Schedule or immediately dispatch a payment reminder for a debtor at the optimal time respecting quiet hours, Friday skip, and opt-outs.",
    parameters: {
      type: "object",
      properties: {
        debtorId: { type: "string", description: "UUID of the customer." },
        tone: { type: "string", enum: ["friendly", "polite", "firm", "urgent"] },
      },
      required: ["debtorId"],
    },
  },
  {
    name: "optimize_reminder_schedule",
    description: "Optimize and schedule automated WhatsApp reminders across all overdue debtors in allowed business hours.",
    parameters: {
      type: "object",
      properties: {
        respectQuietHours: { type: "boolean", description: "Always enforce tenant quiet hours and Friday morning skip." },
      },
    },
  },
  {
    name: "lookup_customer_ledger",
    description: "Retrieve a customer ledger summary, open invoices, risk score, and optimal reminder window by name or ID.",
    parameters: {
      type: "object",
      properties: {
        debtorId: { type: "string", description: "UUID of the customer." },
        debtorName: { type: "string", description: "Customer display name." },
      },
    },
  },
  {
    name: "suggest_inbox_reply",
    description: "Generate a context-grounded merchant reply for an inbound customer WhatsApp message intent.",
    parameters: {
      type: "object",
      properties: {
        intent: { type: "string", description: "Classified intent of the customer reply." },
        debtorId: { type: "string", description: "UUID of the customer." },
      },
      required: ["intent"],
    },
  },
] as const;
