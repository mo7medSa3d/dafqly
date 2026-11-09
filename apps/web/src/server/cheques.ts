import { and, eq, isNull } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  AppError, assertChequeTransition, canTransitionCheque, dueAlertKind, groupChequesByWeek,
  localDateOf, parseEgp, planReversalAllocations,
  type ChequeAlertKind, type ChequeStatus, type ChequeExtraction,
} from "@tahseel/core";
import {
  auditLog, chequeAlerts, cheques, debtors, invoices, paymentAllocations, payments, tenants, usageLedger,
} from "@tahseel/db/schema";
import { withTenant, type Db } from "@tahseel/db";
import type { OcrLlmProvider, StorageProvider } from "@tahseel/providers";
import { confirmClaimedPayment, rejectClaimedPayment } from "./gateway";
import { recomputeInvoicePaid } from "./ledger";
import { replanLater } from "./engine";
import { storeUpload, getFileBytes } from "./files";

/**
 * F9 cheque service. State machine lives in core; payment effects:
 * - deposit (receivable): creates a CLAIMED payment (method=cheque) and,
 *   when the cheque is linked to an invoice, a stored allocation for the
 *   cheque amount capped at that invoice's outstanding. The money does NOT
 *   count until the cheque clears (only confirmed allocations move
 *   paid_minor, §6).
 * - clear: confirms the claimed payment through the M3 confirm path.
 * - bounce / return: a claimed payment is REJECTED (it never counted); a
 *   confirmed payment gets a reversing negative payment planned by core's
 *   planReversalAllocations, so the invoice reopens by exactly the cheque
 *   amount. Bounce additionally sets the debtor's risk flag (F9 flow).
 * - payable cheques never create payments here: they are tracked for the
 *   calendar/alerts; paying them out is the merchant's bank act.
 * Photo extraction is a pre-fill CLAIM only (see extractChequePhoto).
 */

const moneyString = z.string().trim().min(1).refine((s) => { try { return parseEgp(s) > 0n; } catch { return false; } }, "INVALID_AMOUNT");
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "INVALID_DATE");

export const registerChequeInput = z.object({
  debtorId: z.string().uuid(),
  direction: z.enum(["receivable", "payable"]),
  number: z.string().trim().min(1).max(40),
  bank: z.string().trim().min(1).max(160),
  amount: moneyString,
  issueDate: dateString,
  dueDate: dateString,
  invoiceId: z.string().uuid().optional(),
  imageFileId: z.string().uuid().optional(),
});
export type RegisterChequeInput = z.infer<typeof registerChequeInput>;

export interface ChequeView {
  id: string; debtorId: string; direction: string; number: string; bank: string;
  amountMinor: string; issueDate: string; dueDate: string; status: ChequeStatus;
  invoiceId: string | null; imageFileId: string | null; paymentId: string | null;
}

const toView = (r: typeof cheques.$inferSelect): ChequeView => ({
  id: r.id, debtorId: r.debtorId, direction: r.direction, number: r.number, bank: r.bank,
  amountMinor: r.amountMinor.toString(), issueDate: r.issueDate, dueDate: r.dueDate,
  status: r.status, invoiceId: r.invoiceId, imageFileId: r.imageFileId, paymentId: r.paymentId,
});

async function audit(tx: Db, tenantId: string, actor: string | null, action: string, entity: string, entityId: string, after: unknown) {
  await tx.insert(auditLog).values({
    tenantId, actorUserId: actor, action, entity, entityId,
    before: null, after: (after ?? null) as never,
  });
}

export async function registerCheque(app: Db, tenantId: string, actor: string, input: RegisterChequeInput): Promise<ChequeView> {
  const amountMinor = parseEgp(input.amount);
  return withTenant(app, tenantId, async (tx) => {
    const [debtor] = await tx.select().from(debtors).where(and(eq(debtors.id, input.debtorId), isNull(debtors.deletedAt)));
    if (!debtor) throw new AppError("NOT_FOUND", "Debtor not found", 404);
    if (input.invoiceId) {
      const [inv] = await tx.select().from(invoices).where(eq(invoices.id, input.invoiceId));
      if (!inv || inv.debtorId !== input.debtorId) throw new AppError("NOT_FOUND", "Invoice not found for this debtor", 404);
    }
    const [row] = await tx.insert(cheques).values({
      tenantId, debtorId: input.debtorId, direction: input.direction, number: input.number, bank: input.bank,
      amountMinor, issueDate: input.issueDate, dueDate: input.dueDate,
      invoiceId: input.invoiceId ?? null, imageFileId: input.imageFileId ?? null, status: "held",
    }).returning();
    await audit(tx, tenantId, actor, "cheque.registered", "cheque", row!.id, {
      direction: input.direction, amountMinor: amountMinor.toString(), dueDate: input.dueDate,
    });
    return toView(row!);
  });
}

export async function listCheques(app: Db, tenantId: string, opts: { status?: ChequeStatus } = {}): Promise<ChequeView[]> {
  return withTenant(app, tenantId, async (tx) => {
    const rows = await tx.select().from(cheques);
    return rows
      .filter((r) => !opts.status || r.status === opts.status)
      .sort((a, b) => (a.dueDate === b.dueDate ? (a.id < b.id ? -1 : 1) : a.dueDate < b.dueDate ? -1 : 1))
      .map(toView);
  });
}

export async function getChequeCalendar(app: Db, tenantId: string) {
  const all = await listCheques(app, tenantId);
  return groupChequesByWeek(all.map((c) => ({ ...c, dueDate: c.dueDate })))
    .map((g) => ({ weekStart: g.weekStart, cheques: g.cheques }));
}

/** Reverse a CONFIRMED cheque payment with a negative payment (bounce after clear). Returns affected invoice ids. */
async function reverseConfirmedPayment(tx: Db, tenantId: string, actor: string, payment: typeof payments.$inferSelect, reason: string): Promise<string[]> {
  const allocs = await tx.select().from(paymentAllocations).where(eq(paymentAllocations.paymentId, payment.id));
  const plan = planReversalAllocations(
    allocs.map((a) => ({ invoiceId: a.invoiceId, amountMinor: a.amountMinor })),
    payment.amountMinor,
  );
  if (plan.reversedMinor <= 0n) return [];
  const reversalId = uuidv7();
  await tx.insert(payments).values({
    id: reversalId, tenantId, debtorId: payment.debtorId, invoiceId: payment.invoiceId,
    amountMinor: -plan.reversedMinor, method: "cheque",
    receivedOn: payment.receivedOn, referenceNo: `reversal:${reason}`,
    status: "confirmed", source: "manual", reversalOf: payment.id, confirmedBy: actor,
  });
  for (const a of plan.allocations) {
    await tx.insert(paymentAllocations).values({ tenantId, paymentId: reversalId, invoiceId: a.invoiceId, amountMinor: a.amountMinor });
  }
  for (const a of plan.allocations) await recomputeInvoicePaid(tx, tenantId, a.invoiceId);
  await audit(tx, tenantId, actor, "payment.reversed", "payment", reversalId, {
    reversalOf: payment.id, reversedMinor: plan.reversedMinor.toString(), reason,
  });
  return plan.allocations.map((a) => a.invoiceId);
}

export async function transitionCheque(
  app: Db, tenantId: string, actor: string, chequeId: string, to: ChequeStatus, todayIso: string,
): Promise<ChequeView> {
  // Phase 1 (one tx): validate + apply the transition and any payment rows
  // that can be written atomically (deposit claim, bounce/return reversal).
  const prepared = await withTenant(app, tenantId, async (tx) => {
    const [cheque] = await tx.select().from(cheques).where(eq(cheques.id, chequeId));
    if (!cheque) throw new AppError("NOT_FOUND", "Cheque not found", 404);
    if (!canTransitionCheque(cheque.status, to)) {
      try { assertChequeTransition(cheque.status, to); } catch {
        throw new AppError("ILLEGAL_TRANSITION", `Cannot move cheque from ${cheque.status} to ${to}`, 409);
      }
    }

    let action: "confirm" | "reject" | null = null;
    let affectedInvoices: string[] = [];

    if (to === "deposited" && cheque.direction === "receivable") {
      // F9 acceptance: depositing creates a PENDING (claimed) payment.
      const paymentId = uuidv7();
      await tx.insert(payments).values({
        id: paymentId, tenantId, debtorId: cheque.debtorId, invoiceId: cheque.invoiceId,
        amountMinor: cheque.amountMinor, method: "cheque", receivedOn: todayIso,
        referenceNo: `cheque:${cheque.number}`, status: "claimed", source: "manual",
        evidenceFileId: cheque.imageFileId,
      });
      if (cheque.invoiceId) {
        const [inv] = await tx.select().from(invoices).where(eq(invoices.id, cheque.invoiceId));
        if (inv) {
          const outstanding = inv.amountMinor - inv.paidMinor;
          const allocAmount = cheque.amountMinor < outstanding ? cheque.amountMinor : outstanding;
          if (allocAmount > 0n) {
            await tx.insert(paymentAllocations).values({ tenantId, paymentId, invoiceId: inv.id, amountMinor: allocAmount });
          }
        }
      }
      await tx.update(cheques).set({ paymentId, updatedAt: new Date() }).where(eq(cheques.id, chequeId));
    }

    if ((to === "bounced" || to === "returned") && cheque.paymentId) {
      const [payment] = await tx.select().from(payments).where(eq(payments.id, cheque.paymentId));
      if (payment?.status === "claimed") action = "reject";
      else if (payment?.status === "confirmed") {
        affectedInvoices = await reverseConfirmedPayment(tx, tenantId, actor, payment, to);
      }
    }

    if (to === "cleared" && cheque.paymentId) action = "confirm";

    const [row] = await tx.update(cheques).set({ status: to, updatedAt: new Date() })
      .where(eq(cheques.id, chequeId)).returning();
    await audit(tx, tenantId, actor, `cheque.${to}`, "cheque", chequeId, {
      from: cheque.status, direction: cheque.direction, amountMinor: cheque.amountMinor.toString(),
    });
    if (to === "bounced" && cheque.direction === "receivable") {
      // F9 bounced flow: the debtor is flagged risky; the audit row above is
      // the merchant notification record surfaced in the UI/audit views.
      await tx.update(debtors).set({ riskFlag: true, updatedAt: new Date() }).where(eq(debtors.id, cheque.debtorId));
      await audit(tx, tenantId, actor, "cheque.bounced_notify", "cheque", chequeId, { debtorId: cheque.debtorId, riskFlag: true });
    }
    return { view: toView(row!), action, paymentId: cheque.paymentId, affectedInvoices };
  });

  // Phase 2: settle the linked payment through the M3 claim lifecycle
  // (its own transaction, like the gateway flows compose these services).
  if (prepared.action === "confirm" && prepared.paymentId) {
    await confirmClaimedPayment(app, tenantId, actor, prepared.paymentId);
  } else if (prepared.action === "reject" && prepared.paymentId) {
    await rejectClaimedPayment(app, tenantId, actor, prepared.paymentId);
  }
  const touched = new Set(prepared.affectedInvoices);
  if (prepared.view.invoiceId) touched.add(prepared.view.invoiceId);
  for (const id of touched) replanLater(tenantId, id);
  return prepared.view;
}

// ------------------------------------------------------------------ alerts
export interface ChequeAlertView { id: string; chequeId: string; alertKind: ChequeAlertKind; alertDate: string }

/**
 * F9 alert job: surface cheques due in exactly 3 days and due today.
 * Idempotent — the (cheque, kind) unique key + onConflictDoNothing mean a
 * second run on the same day creates nothing.
 */
export async function runChequeAlerts(app: Db, tenantId: string, todayIso: string): Promise<ChequeAlertView[]> {
  return withTenant(app, tenantId, async (tx) => {
    const rows = await tx.select().from(cheques);
    const created: ChequeAlertView[] = [];
    for (const cheque of rows) {
      const kind = dueAlertKind({ dueDate: cheque.dueDate, status: cheque.status }, todayIso);
      if (!kind) continue;
      const inserted = await tx.insert(chequeAlerts).values({
        tenantId, chequeId: cheque.id, alertKind: kind, alertDate: todayIso,
      }).onConflictDoNothing().returning();
      if (inserted.length > 0) {
        await audit(tx, tenantId, null, "cheque.alert", "cheque", cheque.id, {
          alertKind: kind, direction: cheque.direction, dueDate: cheque.dueDate,
        });
        created.push({ id: inserted[0]!.id, chequeId: cheque.id, alertKind: kind, alertDate: todayIso });
      }
    }
    return created;
  });
}

export async function listChequeAlerts(app: Db, tenantId: string): Promise<ChequeAlertView[]> {
  return withTenant(app, tenantId, async (tx) => {
    const rows = await tx.select().from(chequeAlerts);
    return rows
      .map((r) => ({ id: r.id, chequeId: r.chequeId, alertKind: r.alertKind as ChequeAlertKind, alertDate: r.alertDate }))
      .sort((a, b) => (a.alertDate < b.alertDate ? 1 : -1));
  });
}

// ------------------------------------------------------------ photo pre-fill
export interface ChequePhotoDeps { llm: OcrLlmProvider; storage: StorageProvider }

/**
 * F9 photo path (pre-fill design): store the photo as a file, run the
 * vision extraction, and return the fields + file id so the UI can
 * PRE-FILL the manual registration form. The merchant reviews and submits
 * the form — extraction alone NEVER registers a cheque.
 */
export async function extractChequePhoto(
  app: Db, tenantId: string, actor: string, deps: ChequePhotoDeps,
  input: { bytes: Uint8Array; mime: string },
): Promise<{ fileId: string; extraction: ChequeExtraction | null }> {
  const stored = await storeUpload(app, deps.storage, tenantId, actor, { bytes: input.bytes, mime: input.mime, kind: "other" });
  const got = await getFileBytes(app, deps.storage, tenantId, stored.id);
  const result = await deps.llm.extractCheque(got.bytes, got.file.mime);
  await withTenant(app, tenantId, async (tx) => {
    await tx.insert(usageLedger).values({
      tenantId, kind: "llm_vision",
      units: result.inputTokens + result.outputTokens, costEstimateMinor: 0n,
    });
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    void tenant;
    await audit(tx, tenantId, actor, "cheque.photo_extracted", "file", stored.id, {
      promptVersion: result.promptVersion, model: result.model, found: result.data !== null,
    });
  });
  return { fileId: stored.id, extraction: result.data };
}

export { localDateOf };
