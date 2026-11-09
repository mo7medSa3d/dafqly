import { and, asc, desc, eq, gt, ilike, inArray, isNull, or } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  AppError, allocatePayment, canTransition, deriveStatusFromPaid,
  isOverdue, agingBucket, mergeTimeline, normalizeEgPhone, parseEgp, parseLimit,
  resolveDueOn, resolveStatusAfterPayment, validateExplicitAllocations,
  type AllocationTarget, type Cursor, type InvoiceStatus, type TimelineEvent,
} from "@tahseel/core";
import {
  auditLog, debtors, invoices, messages, paymentAllocations, payments, tenants,
} from "@tahseel/db/schema";
import { withTenant, type Db } from "@tahseel/db";
import { replanLater } from "./engine";
import { hashPhone } from "./services";

/**
 * F1 ledger services: debtors, invoices, manual payments with allocation.
 * Every function runs inside withTenant (RLS) and writes audit rows for
 * state changes (BUILD_PLAN §2 definition of done). Money crosses the API
 * as decimal strings and is stored as bigint minor units — never floats.
 */

const moneyString = z.string().trim().min(1).refine((s) => { try { return parseEgp(s) > 0n; } catch { return false; } }, "INVALID_AMOUNT");
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "INVALID_DATE");

async function tenantSettings(tx: Db, tenantId: string) {
  const [t] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!t) throw new AppError("NOT_FOUND", "Tenant not found", 404);
  return t.settings;
}

async function audit(tx: Db, tenantId: string, actor: string, action: string, entity: string, entityId: string, before: unknown, after: unknown) {
  await tx.insert(auditLog).values({
    tenantId, actorUserId: actor, action, entity, entityId,
    before: (before ?? null) as never, after: (after ?? null) as never,
  });
}

// ------------------------------------------------------------------ debtors
export const createDebtorInput = z.object({
  displayName: z.string().trim().min(1).max(160),
  phone: z.string().trim().min(3).max(32),
  notes: z.string().trim().max(2000).optional(),
});
export type CreateDebtorInput = z.infer<typeof createDebtorInput>;

export interface DebtorView {
  id: string; displayName: string; phoneE164: string; phoneValid: boolean;
  whatsappStatus: string; optedOut: boolean; notes: string | null; riskFlag: boolean;
}

const toDebtorView = (r: typeof debtors.$inferSelect): DebtorView => ({
  id: r.id, displayName: r.displayName, phoneE164: r.phoneE164, phoneValid: r.phoneValid,
  whatsappStatus: r.whatsappStatus, optedOut: r.optedOutAt !== null, notes: r.notes, riskFlag: r.riskFlag,
});

export async function createDebtor(app: Db, tenantId: string, actor: string, input: CreateDebtorInput): Promise<DebtorView> {
  let normalized;
  try {
    normalized = normalizeEgPhone(input.phone);
  } catch {
    throw new AppError("INVALID_PHONE", "Phone number is not a valid Egyptian number", 400);
  }
  return withTenant(app, tenantId, async (tx) => {
    const [existing] = await tx.select().from(debtors)
      .where(and(eq(debtors.phoneE164, normalized.e164), isNull(debtors.deletedAt)));
    if (existing) throw new AppError("DUPLICATE_PHONE", "A debtor with this phone already exists for this tenant", 409);
    const [row] = await tx.insert(debtors).values({
      tenantId, displayName: input.displayName, phoneE164: normalized.e164,
      phoneValid: normalized.valid, whatsappStatus: normalized.whatsappCapable ? "unknown" : "unreachable",
      notes: input.notes ?? null, phoneHash: hashPhone(normalized.e164),
    }).returning();
    await audit(tx, tenantId, actor, "debtor.created", "debtor", row!.id, null, { displayName: row!.displayName, phoneE164: row!.phoneE164 });
    return toDebtorView(row!);
  });
}

export async function updateDebtor(app: Db, tenantId: string, actor: string, debtorId: string, input: { displayName?: string; notes?: string | null; riskFlag?: boolean }): Promise<DebtorView> {
  return withTenant(app, tenantId, async (tx) => {
    const [before] = await tx.select().from(debtors).where(and(eq(debtors.id, debtorId), isNull(debtors.deletedAt)));
    if (!before) throw new AppError("NOT_FOUND", "Debtor not found", 404);
    const [row] = await tx.update(debtors).set({
      ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.riskFlag !== undefined ? { riskFlag: input.riskFlag } : {}),
      updatedAt: new Date(),
    }).where(eq(debtors.id, debtorId)).returning();
    await audit(tx, tenantId, actor, "debtor.updated", "debtor", debtorId, { displayName: before.displayName }, { displayName: row!.displayName });
    return toDebtorView(row!);
  });
}

/** Soft-delete (F1 edge): history and audit are kept; the debtor leaves every list. */
export async function softDeleteDebtor(app: Db, tenantId: string, actor: string, debtorId: string): Promise<void> {
  await withTenant(app, tenantId, async (tx) => {
    const [before] = await tx.select().from(debtors).where(and(eq(debtors.id, debtorId), isNull(debtors.deletedAt)));
    if (!before) throw new AppError("NOT_FOUND", "Debtor not found", 404);
    await tx.update(debtors).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(debtors.id, debtorId));
    await audit(tx, tenantId, actor, "debtor.deleted", "debtor", debtorId, { displayName: before.displayName }, { deletedAt: "set" });
  });
}

export async function listDebtorsPage2(app: Db, tenantId: string, opts: { cursor?: Cursor; limit?: number; search?: string }) {
  const limit = parseLimit(opts.limit);
  return withTenant(app, tenantId, async (tx) => {
    const conditions = [isNull(debtors.deletedAt)];
    if (opts.cursor) conditions.push(gt(debtors.id, opts.cursor.id));
    if (opts.search) conditions.push(or(ilike(debtors.displayName, `%${opts.search}%`), ilike(debtors.phoneE164, `%${opts.search}%`))!);
    const rows = await tx.select().from(debtors).where(and(...conditions)).orderBy(asc(debtors.id)).limit(limit + 1);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return { items: items.map(toDebtorView), nextCursor: hasMore ? { id: items[items.length - 1]!.id } : null };
  });
}

// ----------------------------------------------------------------- invoices
export const createInvoiceInput = z.object({
  debtorId: z.string().uuid(),
  amount: moneyString,
  currency: z.string().trim().length(3).default("EGP"),
  issuedOn: dateString,
  dueOn: dateString.optional(),
  reference: z.string().trim().max(80).optional(),
  description: z.string().trim().max(500).optional(),
  source: z.enum(["manual", "import", "ledger_photo"]).default("manual"),
});
export type CreateInvoiceInput = z.input<typeof createInvoiceInput>;

export interface InvoiceView {
  id: string; debtorId: string; reference: string | null; description: string | null;
  amountMinor: string; paidMinor: string; outstandingMinor: string; currency: string;
  currencyWarning: boolean; issuedOn: string; dueOn: string; status: InvoiceStatus;
  overdue: boolean; agingBucket: string; source: string;
}

export function toInvoiceView(r: typeof invoices.$inferSelect, today: string): InvoiceView {
  const outstanding = r.amountMinor - r.paidMinor;
  return {
    id: r.id, debtorId: r.debtorId, reference: r.reference, description: r.description,
    amountMinor: r.amountMinor.toString(), paidMinor: r.paidMinor.toString(),
    outstandingMinor: (outstanding > 0n ? outstanding : 0n).toString(),
    currency: r.currency, currencyWarning: r.currency !== "EGP",
    issuedOn: r.issuedOn, dueOn: r.dueOn, status: r.status,
    overdue: isOverdue(r.status, r.dueOn, today), agingBucket: agingBucket(r.dueOn, today),
    source: r.source,
  };
}

async function findDebtorOr404(tx: Db, debtorId: string) {
  const [debtor] = await tx.select().from(debtors).where(and(eq(debtors.id, debtorId), isNull(debtors.deletedAt)));
  if (!debtor) throw new AppError("NOT_FOUND", "Debtor not found", 404);
  return debtor;
}

export async function createInvoice(app: Db, tenantId: string, actor: string, input: CreateInvoiceInput): Promise<InvoiceView> {
  const amountMinor = parseEgp(input.amount);
  const view = await withTenant(app, tenantId, async (tx) => {
    await findDebtorOr404(tx, input.debtorId);
    const settings = await tenantSettings(tx, tenantId);
    const dueOn = resolveDueOn(input.issuedOn, input.dueOn ?? null, settings.defaultTermsDays);
    const [row] = await tx.insert(invoices).values({
      tenantId, debtorId: input.debtorId, reference: input.reference ?? null,
      description: input.description ?? null, amountMinor,
      currency: (input.currency ?? "EGP").toUpperCase(), issuedOn: input.issuedOn, dueOn,
      status: "open", source: input.source,
    }).returning();
    await audit(tx, tenantId, actor, "invoice.created", "invoice", row!.id, null,
      { amountMinor: amountMinor.toString(), dueOn, currency: row!.currency });
    return toInvoiceView(row!, input.issuedOn);
  });
  replanLater(tenantId, view.id); // F4: plan reminders for the new invoice
  return view;
}

export interface InvoiceFilters {
  cursor?: Cursor; limit?: number; debtorId?: string; status?: InvoiceStatus;
  overdue?: boolean; agingBucket?: string; search?: string;
}

export async function listInvoicesPage(app: Db, tenantId: string, filters: InvoiceFilters, today: string) {
  const limit = parseLimit(filters.limit);
  return withTenant(app, tenantId, async (tx) => {
    // Fetch the filtered candidate set (tenant-scoped by RLS) and apply the
    // derived filters (overdue/aging are computed, not stored) before paging.
    let rows = await tx.select().from(invoices)
      .where(and(
        filters.debtorId ? eq(invoices.debtorId, filters.debtorId) : undefined,
        filters.status ? eq(invoices.status, filters.status) : undefined,
        filters.search ? or(ilike(invoices.reference, `%${filters.search}%`), ilike(invoices.description, `%${filters.search}%`)) : undefined,
      ))
      .orderBy(desc(invoices.id))
      .limit(1000);
    if (filters.overdue) rows = rows.filter((r) => isOverdue(r.status, r.dueOn, today));
    if (filters.agingBucket) rows = rows.filter((r) => agingBucket(r.dueOn, today) === filters.agingBucket && (r.status === "open" || r.status === "partially_paid"));
    const start = filters.cursor ? rows.findIndex((r) => r.id < filters.cursor!.id) : 0;
    const from = start === -1 ? rows.length : start;
    const page = rows.slice(from, from + limit);
    const hasMore = from + limit < rows.length;
    return {
      items: page.map((r) => toInvoiceView(r, today)),
      nextCursor: hasMore && page.length > 0 ? { id: page[page.length - 1]!.id } : null,
    };
  });
}

export async function updateInvoice(app: Db, tenantId: string, actor: string, invoiceId: string,
  input: { amount?: string; description?: string | null; reference?: string | null; dueOn?: string; issuedOn?: string }, today: string): Promise<InvoiceView> {
  const view = await withTenant(app, tenantId, async (tx) => {
    const [before] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId));
    if (!before) throw new AppError("NOT_FOUND", "Invoice not found", 404);
    const amountMinor = input.amount !== undefined ? parseEgp(input.amount) : before.amountMinor;
    if (amountMinor < before.paidMinor) {
      throw new AppError("AMOUNT_BELOW_PAID", "Invoice amount cannot be less than the amount already paid", 400);
    }
    // Editing re-derives the payment status from confirmed allocations
    // (§6); manual states (disputed/terminal) are preserved unless the new
    // amount is fully covered. Reminders re-plan from this row in M2 — sent
    // steps are never resent because the planner upserts by unique key.
    const status = before.status === "disputed" || before.status === "written_off" || before.status === "cancelled"
      ? before.status
      : deriveStatusFromPaid(amountMinor, before.paidMinor);
    const [row] = await tx.update(invoices).set({
      amountMinor, status,
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.reference !== undefined ? { reference: input.reference } : {}),
      ...(input.dueOn !== undefined ? { dueOn: input.dueOn } : {}),
      ...(input.issuedOn !== undefined ? { issuedOn: input.issuedOn } : {}),
      updatedAt: new Date(),
    }).where(eq(invoices.id, invoiceId)).returning();
    await audit(tx, tenantId, actor, "invoice.updated", "invoice", invoiceId,
      { amountMinor: before.amountMinor.toString(), status: before.status, dueOn: before.dueOn },
      { amountMinor: amountMinor.toString(), status, dueOn: row!.dueOn });
    return toInvoiceView(row!, today);
  });
  replanLater(tenantId, invoiceId); // F4: an edit re-plans future steps; sent steps are never resent
  return view;
}

export async function transitionInvoice(app: Db, tenantId: string, actor: string, invoiceId: string, to: InvoiceStatus, today = "9999-12-31"): Promise<InvoiceView> {
  const view = await withTenant(app, tenantId, async (tx) => {
    const [before] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId));
    if (!before) throw new AppError("NOT_FOUND", "Invoice not found", 404);
    if (!canTransition(before.status, to)) {
      throw new AppError("ILLEGAL_TRANSITION", `Cannot move invoice from ${before.status} to ${to}`, 409);
    }
    const [row] = await tx.update(invoices).set({ status: to, updatedAt: new Date() })
      .where(eq(invoices.id, invoiceId)).returning();
    await audit(tx, tenantId, actor, to === "disputed" ? "invoice.disputed" : "invoice.status_changed", "invoice", invoiceId,
      { status: before.status }, { status: to });
    return toInvoiceView(row!, today);
  });
  replanLater(tenantId, invoiceId);
  return view;
}

/** Bulk action: each invoice is validated independently; failures are reported per invoice, never silently skipped. */
export async function bulkTransitionInvoices(app: Db, tenantId: string, actor: string, invoiceIds: string[], to: InvoiceStatus) {
  const results: { invoiceId: string; ok: boolean; error?: string }[] = [];
  for (const invoiceId of invoiceIds) {
    try {
      await transitionInvoice(app, tenantId, actor, invoiceId, to);
      results.push({ invoiceId, ok: true });
    } catch (err) {
      results.push({ invoiceId, ok: false, error: err instanceof AppError ? err.code : "INTERNAL" });
    }
  }
  return results;
}

// ----------------------------------------------------------------- payments
export const recordPaymentInput = z.object({
  debtorId: z.string().uuid(),
  amount: moneyString,
  method: z.enum(["cash", "instapay", "bank", "wallet", "cheque", "gateway", "other"]).default("cash"),
  receivedOn: dateString,
  referenceNo: z.string().trim().max(80).optional(),
  allocations: z.array(z.object({ invoiceId: z.string().uuid(), amount: moneyString })).optional(),
});
export type RecordPaymentInput = z.input<typeof recordPaymentInput>;

export interface PaymentView {
  id: string; debtorId: string; amountMinor: string; allocatedMinor: string; creditMinor: string;
  method: string; receivedOn: string; status: string;
  allocations: { invoiceId: string; amountMinor: string }[];
}

/** Recomputes an invoice's paid_minor from CONFIRMED allocations only (§6) and re-derives its status. Exported for the M3 gateway/statement services, which settle money through the same rule. */
export async function recomputeInvoicePaid(tx: Db, tenantId: string, invoiceId: string) {
  const [inv] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!inv) return;
  const allocs = await tx.select({ amountMinor: paymentAllocations.amountMinor, status: payments.status })
    .from(paymentAllocations)
    .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .where(eq(paymentAllocations.invoiceId, invoiceId));
  const confirmed = allocs.filter((a) => a.status === "confirmed").reduce((s, a) => s + a.amountMinor, 0n);
  const status = resolveStatusAfterPayment(inv.status, inv.amountMinor, confirmed);
  if (confirmed !== inv.paidMinor || status !== inv.status) {
    await tx.update(invoices).set({ paidMinor: confirmed, status, updatedAt: new Date() }).where(eq(invoices.id, invoiceId));
  }
  void tenantId;
}

export async function recordPayment(app: Db, tenantId: string, actor: string, input: RecordPaymentInput): Promise<PaymentView> {
  const amountMinor = parseEgp(input.amount);
  const view = await withTenant(app, tenantId, async (tx) => {
    await findDebtorOr404(tx, input.debtorId);
    const openInvoices = await tx.select().from(invoices)
      .where(eq(invoices.debtorId, input.debtorId))
      .orderBy(asc(invoices.dueOn), asc(invoices.id));
    const targets: AllocationTarget[] = openInvoices.map((i) => ({
      invoiceId: i.id, amountMinor: i.amountMinor, paidMinor: i.paidMinor, dueOn: i.dueOn, status: i.status,
    }));
    let plan;
    try {
      plan = input.allocations && input.allocations.length > 0
        ? validateExplicitAllocations(amountMinor, input.allocations.map((a) => ({ invoiceId: a.invoiceId, amountMinor: parseEgp(a.amount) })), targets)
        : allocatePayment(amountMinor, targets);
    } catch (err) {
      throw new AppError("INVALID_ALLOCATION", err instanceof Error ? err.message : "Invalid allocation", 400);
    }
    const paymentId = uuidv7();
    await tx.insert(payments).values({
      id: paymentId, tenantId, debtorId: input.debtorId, invoiceId: plan.allocations[0]?.invoiceId ?? null,
      amountMinor, method: input.method ?? "cash", receivedOn: input.receivedOn,
      referenceNo: input.referenceNo ?? null, status: "confirmed", source: "manual", confirmedBy: actor,
    });
    for (const a of plan.allocations) {
      await tx.insert(paymentAllocations).values({ tenantId, paymentId, invoiceId: a.invoiceId, amountMinor: a.amountMinor });
    }
    for (const a of plan.allocations) await recomputeInvoicePaid(tx, tenantId, a.invoiceId);
    await audit(tx, tenantId, actor, "payment.recorded", "payment", paymentId, null, {
      amountMinor: amountMinor.toString(), allocatedMinor: plan.allocatedMinor.toString(),
      creditMinor: plan.creditMinor.toString(), allocations: plan.allocations.length,
    });
    return {
      id: paymentId, debtorId: input.debtorId, amountMinor: amountMinor.toString(),
      allocatedMinor: plan.allocatedMinor.toString(), creditMinor: plan.creditMinor.toString(),
      method: input.method ?? "cash", receivedOn: input.receivedOn, status: "confirmed",
      allocations: plan.allocations.map((a) => ({ invoiceId: a.invoiceId, amountMinor: a.amountMinor.toString() })),
    };
  });
  // F4: a payment re-plans every invoice it touched (paid ones lose their
  // future reminders in the planner upsert + dispatcher sweep).
  for (const a of view.allocations) replanLater(tenantId, a.invoiceId);
  return view;
}

// ------------------------------------------------------------------ detail
export interface DebtorDetail extends DebtorView {
  invoices: InvoiceView[];
  payments: {
    id: string; amountMinor: string; method: string; receivedOn: string; status: string;
    source: string; gatewayTransactionId: string | null; reversalOf: string | null;
  }[];
  creditMinor: string;
  totalOutstandingMinor: string;
}

export async function getDebtorDetail(app: Db, tenantId: string, debtorId: string, today = "9999-12-31"): Promise<DebtorDetail> {
  return withTenant(app, tenantId, async (tx) => {
    const debtor = await findDebtorOr404(tx, debtorId);
    const invs = await tx.select().from(invoices).where(eq(invoices.debtorId, debtorId)).orderBy(desc(invoices.id));
    const pays = await tx.select().from(payments).where(eq(payments.debtorId, debtorId)).orderBy(desc(payments.id));
    const allocs = pays.length === 0 ? [] : await tx.select().from(paymentAllocations)
      .where(inArray(paymentAllocations.paymentId, pays.map((p) => p.id)));
    const confirmedPaid = pays.filter((p) => p.status === "confirmed").reduce((s, p) => s + p.amountMinor, 0n);
    const allocated = allocs
      .filter((a) => pays.find((p) => p.id === a.paymentId)?.status === "confirmed")
      .reduce((s, a) => s + a.amountMinor, 0n);
    const credit = confirmedPaid - allocated;
    const outstanding = invs.reduce((s, i) => s + (i.amountMinor - i.paidMinor > 0n ? i.amountMinor - i.paidMinor : 0n), 0n);
    return {
      ...toDebtorView(debtor),
      invoices: invs.map((i) => toInvoiceView(i, today)),
      payments: pays.map((p) => ({
        id: p.id, amountMinor: p.amountMinor.toString(), method: p.method, receivedOn: p.receivedOn, status: p.status,
        source: p.source, gatewayTransactionId: p.gatewayTransactionId, reversalOf: p.reversalOf,
      })),
      creditMinor: (credit > 0n ? credit : 0n).toString(),
      totalOutstandingMinor: outstanding.toString(),
    };
  });
}

/**
 * Timeline through the core merge: invoices (issued), payments (received),
 * disputes + other invoice/debtor state changes from the audit log. Message
 * events join the same merge in M2. Deleted debtors keep their timeline
 * (audit/history preservation) even though detail/lists hide them.
 */
export async function getDebtorTimeline(app: Db, tenantId: string, debtorId: string): Promise<TimelineEvent[]> {
  return withTenant(app, tenantId, async (tx) => {
    const [debtor] = await tx.select().from(debtors).where(eq(debtors.id, debtorId));
    if (!debtor) throw new AppError("NOT_FOUND", "Debtor not found", 404);
    const invs = await tx.select().from(invoices).where(eq(invoices.debtorId, debtorId));
    const pays = await tx.select().from(payments).where(eq(payments.debtorId, debtorId));
    const msgs = await tx.select().from(messages).where(eq(messages.debtorId, debtorId));
    const invIds = new Set(invs.map((i) => i.id));
    const audits = await tx.select().from(auditLog).where(eq(auditLog.tenantId, tenantId));
    const events: TimelineEvent[] = [];
    for (const inv of invs) {
      events.push({
        id: `invoice-${inv.id}`, kind: "invoice", at: `${inv.issuedOn}T00:00:00.000Z`,
        summary: inv.reference ? `Invoice ${inv.reference}` : "Invoice",
        amountMinor: inv.amountMinor.toString(), status: inv.status,
      });
    }
    for (const p of pays) {
      events.push({
        id: `payment-${p.id}`, kind: "payment", at: `${p.receivedOn}T00:00:00.000Z`,
        summary: `Payment (${p.method})`, amountMinor: p.amountMinor.toString(), status: p.status,
      });
    }
    for (const m of msgs) {
      events.push({
        id: `message-${m.id}`, kind: "message", at: m.createdAt.toISOString(),
        summary: m.bodyText ?? m.templateKey ?? (m.direction === "in" ? "Inbound message" : "Message"),
        status: m.status,
      });
    }
    for (const a of audits) {
      const isDispute = a.action === "invoice.disputed" && invIds.has(a.entityId);
      const isDebtorEvent = a.entity === "debtor" && a.entityId === debtorId;
      const isInvoiceEvent = a.entity === "invoice" && invIds.has(a.entityId) && a.action !== "invoice.created";
      if (isDispute) {
        events.push({ id: `audit-${a.id}`, kind: "dispute", at: a.createdAt.toISOString(), summary: "Dispute opened", status: "disputed" });
      } else if (isDebtorEvent || isInvoiceEvent) {
        events.push({ id: `audit-${a.id}`, kind: "audit", at: a.createdAt.toISOString(), summary: a.action });
      }
    }
    return mergeTimeline(events);
  });
}

