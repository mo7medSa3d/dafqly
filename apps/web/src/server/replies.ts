import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  AppError, actionForIntent, canTransition, formatEgp, isOptOutText, localDateOf,
  nextAllowedSlot, resolveRelativeDate, zonedTimeToUtc, addDaysIso,
  type ReplyAction,
} from "@tahseel/core";
import {
  auditLog, debtors, disputes, invoices, messageIntents, messages, reminders, tenants, usageLedger,
} from "@tahseel/db/schema";
import { withTenant, type Db } from "@tahseel/db";
import type { OcrLlmProvider } from "@tahseel/providers";
import { applyOptOut, planForInvoice, policyFor, type EngineDeps } from "@tahseel/reminders";
import { renderTemplate } from "@tahseel/templates";

/**
 * F8 reply understanding service. Pipeline for one inbound text:
 * 1. Keyword opt-out FIRST (also enforced in the webhook processor; repeated
 *    here as defense in depth — it never reaches the LLM).
 * 2. LLM classification (providers seam), Zod-validated in core; invalid
 *    output routes to the human inbox.
 * 3. The core ALLOWLIST decides the action; below 0.8 confidence everything
 *    is human. Dates come from the model only when present, otherwise from
 *    core's deterministic resolver; an ambiguous date routes to a human.
 * Every classification writes a message_intents row (the AI inbox is the
 * list of rows resolved_by=human plus receipt claims).
 */
export interface ReplyDeps {
  llm: OcrLlmProvider;
  engine: EngineDeps;
}

export interface ReplyOutcome {
  intent: string;
  confidence: number;
  action: ReplyAction | "opt_out_keyword";
  resolvedBy: "auto" | "human";
  intentId: string;
  promisedDate: string | null;
}

async function audit(tx: Db, tenantId: string, action: string, entity: string, entityId: string, after: unknown) {
  await tx.insert(auditLog).values({
    tenantId, actorUserId: null, action, entity, entityId, after: (after ?? null) as never,
  });
}

export async function processInboundReply(
  app: Db, tenantId: string, deps: ReplyDeps,
  input: { messageId: string; debtorId: string; text: string },
  now = new Date(),
): Promise<ReplyOutcome> {
  // (1) Keyword opt-out first, independently of the LLM (F8 safety).
  if (isOptOutText(input.text)) {
    await applyOptOut(deps.engine, tenantId, input.debtorId, now, "keyword");
    const intentId = await withTenant(app, tenantId, async (tx) => {
      const [row] = await tx.insert(messageIntents).values({
        tenantId, messageId: input.messageId, intent: "opt_out",
        extracted: { source: "keyword" } as never, confidence: 1,
        resolvedBy: "auto", actionTaken: "opt_out",
      }).returning();
      return row!.id;
    });
    return { intent: "opt_out", confidence: 1, action: "opt_out_keyword", resolvedBy: "auto", intentId, promisedDate: null };
  }

  const setup = await withTenant(app, tenantId, async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant) throw new AppError("NOT_FOUND", "Tenant not found", 404);
    const [debtor] = await tx.select().from(debtors)
      .where(and(eq(debtors.id, input.debtorId), isNull(debtors.deletedAt)));
    if (!debtor) throw new AppError("NOT_FOUND", "Debtor not found", 404);
    const open = await tx.select().from(invoices)
      .where(and(eq(invoices.debtorId, input.debtorId), inArray(invoices.status, ["open", "partially_paid"])))
      .orderBy(asc(invoices.dueOn));
    return { tenant, debtor, openInvoices: open };
  });
  const todayIso = localDateOf(now, setup.tenant.timezone);

  // (2) Classify. The debtor's text is quoted data in the prompt (providers).
  const result = await deps.llm.classifyReply(input.text, {
    todayIso, timezone: setup.tenant.timezone, dueOn: setup.openInvoices[0]?.dueOn ?? null,
  });

  // (3) Allowlist + apply.
  return withTenant(app, tenantId, async (tx) => {
    await tx.insert(usageLedger).values({
      tenantId, kind: "llm_text", units: result.inputTokens + result.outputTokens, costEstimateMinor: 0n,
    });
    const classification = result.data;
    if (!classification) {
      const [row] = await tx.insert(messageIntents).values({
        tenantId, messageId: input.messageId, intent: "unclassified",
        extracted: { reason: "llm output failed validation" } as never, confidence: 0,
        resolvedBy: "human", actionTaken: "human_inbox",
      }).returning();
      return {
        intent: "unclassified", confidence: 0, action: "human_inbox" as ReplyAction,
        resolvedBy: "human" as const, intentId: row!.id, promisedDate: null,
      };
    }

    let { action, auto } = actionForIntent(classification.intent, classification.confidence);
    let promisedDate: string | null = classification.promised_date;
    if (action === "replan_after_promise") {
      if (!promisedDate) {
        const resolved = resolveRelativeDate(input.text, todayIso, setup.tenant.timezone);
        promisedDate = resolved.ambiguous ? null : resolved.date;
      }
      // A promise without a resolvable date cannot re-plan anything: human.
      if (!promisedDate) { action = "human_inbox"; auto = false; }
    }

    const [intentRow] = await tx.insert(messageIntents).values({
      tenantId, messageId: input.messageId, intent: classification.intent,
      extracted: {
        promised_date: promisedDate, amount_minor: classification.amount_minor,
        model: result.model, promptVersion: result.promptVersion,
      } as never,
      confidence: classification.confidence,
      resolvedBy: auto ? "auto" : "human", actionTaken: action,
    }).returning();

    const debtor = setup.debtor;
    if (action === "replan_after_promise" && promisedDate) {
      await audit(tx, tenantId, "debtor.promise_recorded", "debtor", debtor.id, {
        promisedDate, messageId: input.messageId, confidence: classification.confidence,
      });
      // Move the debtor's earliest future reminder to the day AFTER the
      // promised date; when none exists, re-plan the open invoices with the
      // planner's notBefore override so nothing fires before then either.
      const future = await tx.select().from(reminders)
        .where(and(eq(reminders.debtorId, debtor.id), eq(reminders.status, "scheduled")))
        .orderBy(asc(reminders.dueAt));
      const policy = policyFor(setup.tenant);
      const target = nextAllowedSlot(
        zonedTimeToUtc(addDaysIso(promisedDate, 1), policy.sendTimeLocal, policy.timezone), policy,
      );
      if (future.length > 0) {
        await tx.update(reminders).set({ dueAt: target, updatedAt: now }).where(eq(reminders.id, future[0]!.id));
      }
    }
    if (action === "replan_after_promise" && promisedDate) {
      const futureCount = await tx.select({ id: reminders.id }).from(reminders)
        .where(and(eq(reminders.debtorId, debtor.id), eq(reminders.status, "scheduled")));
      if (futureCount.length === 0) {
        const notBefore = zonedTimeToUtc(addDaysIso(promisedDate, 1), "00:00", setup.tenant.timezone);
        for (const inv of setup.openInvoices) {
          await planForInvoice(deps.engine, tenantId, inv.id, now, { notBefore }).catch(() => undefined);
        }
      }
    }
    if (action === "request_receipt") {
      // Flag for the merchant AND ask the debtor for the receipt — the
      // registry's invoice_overdue body is the approved text that asks for
      // a transfer receipt when payment was already made.
      await audit(tx, tenantId, "reply.receipt_requested", "debtor", debtor.id, { messageId: input.messageId });
      const first = setup.openInvoices[0];
      if (first) {
        const body = renderTemplate("invoice_overdue", "ar", {
          business: setup.tenant.businessNameAr,
          amount: formatEgp(first.amountMinor - first.paidMinor > 0n ? first.amountMinor - first.paidMinor : 0n),
          due_date: first.dueOn,
        });
        await tx.insert(messages).values({
          tenantId, debtorId: debtor.id, invoiceId: first.id, direction: "out",
          channel: "whatsapp", provider: "whatsapp", templateKey: "invoice_overdue",
          bodyText: body, status: "queued",
        });
        try {
          await deps.engine.providers.whatsapp.sendText({
            toE164: debtor.phoneE164, body, idempotencyKey: `receipt-ask:${input.messageId}`,
          });
        } catch { /* recorded; send failure never undoes the classification */ }
      }
    }
    if (action === "open_dispute") {
      const first = setup.openInvoices[0];
      if (first && canTransition(first.status, "disputed")) {
        await tx.insert(disputes).values({
          tenantId, invoiceId: first.id, debtorId: debtor.id,
          raisedBy: "debtor", reason: input.text.slice(0, 1000), status: "open",
        });
        await tx.update(invoices).set({ status: "disputed", updatedAt: now }).where(eq(invoices.id, first.id));
        await audit(tx, tenantId, "dispute.raised", "invoice", first.id, { via: "reply_ai", messageId: input.messageId });
        await audit(tx, tenantId, "invoice.disputed", "invoice", first.id, { via: "reply_ai" });
      } else {
        await audit(tx, tenantId, "reply.dispute_flagged", "debtor", debtor.id, { messageId: input.messageId });
      }
    }
    if (action === "mark_phone_invalid") {
      await tx.update(debtors).set({ phoneValid: false, whatsappStatus: "unreachable", updatedAt: now })
        .where(eq(debtors.id, debtor.id));
      await audit(tx, tenantId, "debtor.phone_marked_invalid", "debtor", debtor.id, { via: "reply_ai", messageId: input.messageId });
    }
    if (action === "opt_out") {
      // LLM-detected opt-out (keyword missed it): same recording path.
      await applyOptOut(deps.engine, tenantId, debtor.id, now, "llm");
    }
    return {
      intent: classification.intent, confidence: classification.confidence,
      action, resolvedBy: (auto ? "auto" : "human") as "auto" | "human",
      intentId: intentRow!.id, promisedDate,
    };
  });
}

/**
 * Inbound image hook (F7): WhatsApp media bytes are still media_pending
 * (the download needs the Meta token), so the hook records a pending
 * receipt intent for the merchant's AI inbox instead of pretending to read
 * the image. Merchant uploads and direct service calls are the tested
 * receipt path in M4.
 */
export async function recordPendingReceiptIntent(
  app: Db, tenantId: string,
  input: { messageId: string; debtorId: string; mediaId: string | null; mediaMime: string | null },
): Promise<void> {
  await withTenant(app, tenantId, async (tx) => {
    await tx.insert(messageIntents).values({
      tenantId, messageId: input.messageId, intent: "receipt_image_pending",
      extracted: { mediaId: input.mediaId, mediaMime: input.mediaMime, note: "media download pending Meta token" } as never,
      confidence: 0, resolvedBy: "human", actionTaken: "human_inbox",
    }).onConflictDoNothing();
  });
}

/** The AI inbox: classifications that need a human (plus pending receipt images). */
export async function listIntents(app: Db, tenantId: string, opts: { onlyHuman?: boolean } = {}) {
  return withTenant(app, tenantId, async (tx) => {
    let rows = await tx.select().from(messageIntents).orderBy(desc(messageIntents.createdAt)).limit(100);
    if (opts.onlyHuman) rows = rows.filter((r) => r.resolvedBy === "human");
    const out = [];
    for (const r of rows) {
      const [msg] = await tx.select().from(messages).where(eq(messages.id, r.messageId));
      const [debtor] = msg?.debtorId
        ? await tx.select().from(debtors).where(eq(debtors.id, msg.debtorId))
        : [undefined];
      out.push({
        id: r.id, messageId: r.messageId, intent: r.intent, confidence: r.confidence,
        resolvedBy: r.resolvedBy, actionTaken: r.actionTaken,
        extracted: r.extracted, createdAt: r.createdAt.toISOString(),
        text: msg?.bodyText ?? null, debtorId: msg?.debtorId ?? null,
        debtorName: debtor?.displayName ?? null,
      });
    }
    return out;
  });
}
