import { and, asc, desc, eq, gt, gte, ilike, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  AppError, allocatePayment, canTransition, deriveStatusFromPaid, disputedFor,
  isCollectibleStatus, isOverdue, agingBucket, likePattern, maskPhone, mergeTimeline, normalizeEgPhone, outstandingFor, parseLimit, parseMoney,
  reconcileLedger,
  resolveDueOn, resolveStatusAfterPayment, validateExplicitAllocations,
  type AllocationTarget, type Cursor, type InvoiceStatus, type TimelineEvent,
} from "@tahseel/core";
import {
  auditLog, debtors, invoiceSequences, invoices, messages, paymentAllocations, payments, promisesToPay, tenants,
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

// F-06: coarse positivity pre-check only — it runs before the currency is
// known, so it must accept any amount valid in ANY supported currency.
// KWD (3 decimals) is the most permissive exponent: a valid KWD "1.234"
// must pass this gate and be validated for real at the currency-aware
// parse site (which throws MoneyParseError → 400 INVALID_AMOUNT).
const moneyString = z.string().trim().min(1).refine((s) => { try { return parseMoney(s, "KWD") > 0n; } catch { return false; } }, "INVALID_AMOUNT");
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

/**
 * F01: lock a debtor's allocatable invoices FOR UPDATE in allocation order
 * (due date, then id). Every allocation writer takes this lock FIRST, so
 * two concurrent payments can never both allocate the same outstanding.
 * The caller must already be inside withTenant (one transaction).
 */
export async function lockDebtorInvoices(tx: Db, debtorId: string) {
  return tx.select().from(invoices)
    .where(and(eq(invoices.debtorId, debtorId), inArray(invoices.status, ["open", "partially_paid", "disputed"])))
    .orderBy(asc(invoices.dueOn), asc(invoices.id))
    .for("update");
}

/** F01: lock specific invoices FOR UPDATE in id order (reversal paths). */
export async function lockInvoicesById(tx: Db, invoiceIds: string[]) {
  if (invoiceIds.length === 0) return [];
  return tx.select().from(invoices).where(inArray(invoices.id, invoiceIds)).orderBy(asc(invoices.id)).for("update");
}

/** F05: lock the debtor row FOR UPDATE (serializes credit updates). */
export async function lockDebtor(tx: Db, debtorId: string) {
  const [row] = await tx.select().from(debtors).where(eq(debtors.id, debtorId)).for("update");
  return row;
}

/**
 * F05: recompute a debtor's stored credit from the ledger — confirmed
 * payments minus confirmed allocations, in the stored credit's currency —
 * and persist it. The stored value is a cache of this derivation, never
 * an independent balance. Called after every money mutation (directly,
 * and via recomputeInvoicePaid). May go negative: that is the over-reversal
 * signal (a reversed payment whose credit was already consumed), surfaced
 * rather than clamped to 0.
 */
export async function recomputeDebtorCredit(tx: Db, tenantId: string, debtorId: string): Promise<{ creditMinor: bigint; creditCurrency: string }> {
  const [debtor] = await tx.select({ creditMinor: debtors.creditMinor, creditCurrency: debtors.creditCurrency })
    .from(debtors).where(eq(debtors.id, debtorId));
  const currency = debtor?.creditCurrency ?? "EGP";
  const [paid] = await tx.select({ total: sql<bigint>`coalesce(sum(${payments.amountMinor}), 0)::bigint` })
    .from(payments)
    .where(and(eq(payments.tenantId, tenantId), eq(payments.debtorId, debtorId), eq(payments.status, "confirmed"), eq(payments.currency, currency)));
  const [alloc] = await tx.select({ total: sql<bigint>`coalesce(sum(${paymentAllocations.amountMinor}), 0)::bigint` })
    .from(paymentAllocations)
    .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
    .innerJoin(invoices, eq(invoices.id, paymentAllocations.invoiceId))
    .where(and(eq(payments.tenantId, tenantId), eq(payments.debtorId, debtorId), eq(payments.status, "confirmed"), eq(invoices.currency, currency)));
  const credit = (paid?.total ?? 0n) - (alloc?.total ?? 0n);
  await tx.update(debtors).set({ creditMinor: credit, updatedAt: new Date() }).where(eq(debtors.id, debtorId));
  return { creditMinor: credit, creditCurrency: currency };
}

/** Build a PaymentView from stored rows (idempotent replay path). */
async function loadPaymentView(tx: Db, paymentId: string): Promise<PaymentView | null> {
  const [p] = await tx.select().from(payments).where(eq(payments.id, paymentId));
  if (!p) return null;
  const allocs = await tx.select().from(paymentAllocations).where(eq(paymentAllocations.paymentId, paymentId));
  const [debtor] = await tx.select({ creditMinor: debtors.creditMinor }).from(debtors).where(eq(debtors.id, p.debtorId));
  const allocated = allocs.reduce((s, a) => s + a.amountMinor, 0n);
  return {
    id: p.id, debtorId: p.debtorId, amountMinor: p.amountMinor.toString(),
    allocatedMinor: allocated.toString(), creditMinor: (debtor?.creditMinor ?? 0n).toString(),
    currency: p.currency, method: p.method, receivedOn: p.receivedOn, status: p.status,
    allocations: allocs.map((a) => ({ invoiceId: a.invoiceId, amountMinor: a.amountMinor.toString() })),
  };
}

/**
 * H05: hand out the next invoice reference atomically. The counter row
 * holds the last issued value; INSERT ... ON CONFLICT DO UPDATE increments
 * it and RETURNING yields the value to use — no count()+1001 race, and
 * UNIQUE(tenant_id, reference) is the backstop.
 */
export async function nextInvoiceReference(tx: Db, tenantId: string, year: string): Promise<string> {
  const [row] = await tx.insert(invoiceSequences).values({ tenantId, nextVal: 1001n })
    .onConflictDoUpdate({
      target: invoiceSequences.tenantId,
      set: { nextVal: sql`${invoiceSequences.nextVal} + 1`, updatedAt: new Date() },
    })
    .returning({ seq: invoiceSequences.nextVal });
  return `INV-${year}-${row!.seq}`;
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
  totalOutstandingMinor: string;
  totalPaidMinor: string;
  openInvoicesCount: number;
  totalInvoicesCount: number;
  /** F02: outstanding per currency. totalOutstandingMinor is the sum across
   * the debtor's open invoices ONLY when they share one currency; for a
   * mixed-currency debtor it is the default-currency subtotal and this
   * breakdown carries the rest — minor units are never summed across
   * currencies and presented as one number. */
  outstandingByCurrency?: { currency: string; minor: string }[];
  /** H09: the frozen remainder of disputed invoices (never part of
   * totalOutstandingMinor) and how many invoices are disputed. */
  totalDisputedMinor: string;
  disputedInvoicesCount: number;
  disputedByCurrency?: { currency: string; minor: string }[];
}

const toDebtorView = (r: typeof debtors.$inferSelect, stats?: { outstanding: bigint; paid: bigint; openCount: number; totalCount: number; byCurrency?: { currency: string; minor: string }[]; disputed?: bigint; disputedCount?: number; disputedByCurrency?: { currency: string; minor: string }[] }): DebtorView => ({
  id: r.id, displayName: r.displayName, phoneE164: r.phoneE164, phoneValid: r.phoneValid,
  whatsappStatus: r.whatsappStatus, optedOut: r.optedOutAt !== null, notes: r.notes, riskFlag: r.riskFlag,
  totalOutstandingMinor: (stats?.outstanding ?? 0n).toString(),
  totalPaidMinor: (stats?.paid ?? 0n).toString(),
  openInvoicesCount: stats?.openCount ?? 0,
  totalInvoicesCount: stats?.totalCount ?? 0,
  ...(stats?.byCurrency ? { outstandingByCurrency: stats.byCurrency } : {}),
  totalDisputedMinor: (stats?.disputed ?? 0n).toString(),
  disputedInvoicesCount: stats?.disputedCount ?? 0,
  ...(stats?.disputedByCurrency ? { disputedByCurrency: stats.disputedByCurrency } : {}),
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
    // M6: the audit log is a log — no raw phone numbers in it, only masked.
    await audit(tx, tenantId, actor, "debtor.created", "debtor", row!.id, null, { displayName: row!.displayName, phone: maskPhone(row!.phoneE164) });
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
    if (opts.search) conditions.push(or(ilike(debtors.displayName, likePattern(opts.search)), ilike(debtors.phoneE164, likePattern(opts.search)))!);
    const rows = await tx.select().from(debtors).where(and(...conditions)).orderBy(asc(debtors.id)).limit(limit + 1);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    // F-15: the header aggregates are computed client-side from the loaded
    // page (first 200) — without a total the UI presented partial counts
    // as tenant totals. Count the same search, ignoring the cursor.
    const countConditions = [isNull(debtors.deletedAt)];
    if (opts.search) countConditions.push(or(ilike(debtors.displayName, likePattern(opts.search)), ilike(debtors.phoneE164, likePattern(opts.search)))!);
    const [countRow] = await tx.select({ n: sql<number>`count(*)` }).from(debtors).where(and(...countConditions));
    const totalCount = Number(countRow?.n ?? 0);

    const settings = await tenantSettings(tx, tenantId);
    const defaultCurrency = settings.currency ?? "EGP";
    const statsMap: Record<string, { outstanding: bigint; paid: bigint; openCount: number; totalCount: number; byCurrency: Map<string, bigint>; disputed: bigint; disputedCount: number; disputedByCurrency: Map<string, bigint> }> = {};
    if (items.length > 0) {
      const debtorIds = items.map((d) => d.id);
      const invRows = await tx.select({
        debtorId: invoices.debtorId,
        amountMinor: invoices.amountMinor,
        paidMinor: invoices.paidMinor,
        status: invoices.status,
        currency: invoices.currency,
      }).from(invoices).where(inArray(invoices.debtorId, debtorIds));

      for (const inv of invRows) {
        if (!statsMap[inv.debtorId]) {
          statsMap[inv.debtorId] = { outstanding: 0n, paid: 0n, openCount: 0, totalCount: 0, byCurrency: new Map(), disputed: 0n, disputedCount: 0, disputedByCurrency: new Map() };
        }
        const s = statsMap[inv.debtorId]!;
        s.totalCount += 1;
        s.paid += inv.paidMinor;
        // H09: one rule — disputed invoices are frozen, never outstanding.
        const collectible = outstandingFor(inv);
        if (collectible > 0n) {
          s.byCurrency.set(inv.currency, (s.byCurrency.get(inv.currency) ?? 0n) + collectible);
          s.openCount += 1;
        }
        const frozen = disputedFor(inv);
        if (frozen > 0n) {
          s.disputedByCurrency.set(inv.currency, (s.disputedByCurrency.get(inv.currency) ?? 0n) + frozen);
          s.disputedCount += 1;
        }
      }
      // Outstanding is meaningful only per currency: single-currency
      // debtors keep the plain sum; mixed-currency debtors report the
      // default-currency subtotal as the headline and the full breakdown
      // alongside it. The disputed subtotal follows the same rule.
      const headline = (m: Map<string, bigint>) => m.size <= 1
        ? [...m.values()].reduce((a, b) => a + b, 0n)
        : (m.get(defaultCurrency) ?? 0n);
      for (const s of Object.values(statsMap)) {
        s.outstanding = headline(s.byCurrency);
        s.disputed = headline(s.disputedByCurrency);
      }
    }

    return {
      items: items.map((r) => {
        const s = statsMap[r.id];
        return toDebtorView(r, s ? {
          ...s,
          byCurrency: [...s.byCurrency.entries()].map(([currency, minor]) => ({ currency, minor: minor.toString() })),
          disputedByCurrency: [...s.disputedByCurrency.entries()].map(([currency, minor]) => ({ currency, minor: minor.toString() })),
        } : undefined);
      }),
      totalCount,
      nextCursor: hasMore ? { id: items[items.length - 1]!.id } : null,
    };
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
    id: r.id, debtorId: r.debtorId, reference: r.reference ?? `INV-${r.issuedOn.slice(0, 4)}-${r.id.slice(-4).toUpperCase()}`, description: r.description,
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
  const currency = (input.currency ?? "EGP").toUpperCase();
  if (!["EGP", "SAR", "USD", "AED", "EUR", "KWD", "JPY"].includes(currency)) {
    throw new AppError("UNSUPPORTED_CURRENCY", `Currency ${currency} is not supported`, 400);
  }
  // F-06: parse in the invoice's own currency (KWD 3 decimals, JPY 0) —
  // the old parseEgp read every amount ÷100.
  const amountMinor = parseMoney(input.amount, currency);
  let view: InvoiceView;
  try {
    view = await withTenant(app, tenantId, async (tx) => {
      await findDebtorOr404(tx, input.debtorId);
      const settings = await tenantSettings(tx, tenantId);
      const dueOn = resolveDueOn(input.issuedOn, input.dueOn ?? null, settings.defaultTermsDays);
      let reference = input.reference?.trim() || null;
      if (!reference) {
        // H05: atomic per-tenant counter, never count()+1001.
        const year = input.issuedOn.slice(0, 4) || new Date().getFullYear().toString();
        reference = await nextInvoiceReference(tx, tenantId, year);
      }
      const [row] = await tx.insert(invoices).values({
        tenantId, debtorId: input.debtorId, reference,
        description: input.description ?? null, amountMinor,
        currency, issuedOn: input.issuedOn, dueOn,
        status: "open", source: input.source,
      }).returning();
      await audit(tx, tenantId, actor, "invoice.created", "invoice", row!.id, null,
        { amountMinor: amountMinor.toString(), dueOn, currency: row!.currency });
      return toInvoiceView(row!, input.issuedOn);
    });
  } catch (err) {
    // A merchant-supplied reference that collides with an existing one
    // violates UNIQUE(tenant_id, reference) — report it, don't leak SQL.
    // Drizzle wraps the Postgres error: the code lives on .cause.
    const code = (err as { code?: string })?.code
      ?? (err as { cause?: { code?: string } })?.cause?.code;
    if (code === "23505") {
      throw new AppError("DUPLICATE_REFERENCE", "An invoice with this reference already exists for this tenant", 409);
    }
    throw err;
  }
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
    // H07: every filter is a SQL condition and paging is a keyset on
    // id — the old implementation fetched up to 1,000 rows and filtered
    // + sliced in memory, so overdue/aging filters silently dropped rows
    // past the cap. Aging ranges mirror reports.ts (ADR-023 buckets).
    // The cursor is kept out of baseConditions so the F-15 total count
    // below counts the whole filtered set, not just the current page.
    const baseConditions = [
      filters.debtorId ? eq(invoices.debtorId, filters.debtorId) : undefined,
      filters.status ? eq(invoices.status, filters.status) : undefined,
      filters.search ? or(ilike(invoices.reference, likePattern(filters.search)), ilike(invoices.description, likePattern(filters.search))) : undefined,
    ];
    if (filters.overdue) {
      baseConditions.push(
        inArray(invoices.status, ["open", "partially_paid"]),
        lt(invoices.dueOn, today),
      );
    }
    if (filters.agingBucket) {
      baseConditions.push(inArray(invoices.status, ["open", "partially_paid"]));
      if (filters.agingBucket === "current") baseConditions.push(gte(invoices.dueOn, today));
      else if (filters.agingBucket === "0-7") baseConditions.push(sql`(${today}::date - ${invoices.dueOn}) between 1 and 7`);
      else if (filters.agingBucket === "8-30") baseConditions.push(sql`(${today}::date - ${invoices.dueOn}) between 8 and 30`);
      else if (filters.agingBucket === "31-60") baseConditions.push(sql`(${today}::date - ${invoices.dueOn}) between 31 and 60`);
      else if (filters.agingBucket === "60+") baseConditions.push(sql`(${today}::date - ${invoices.dueOn}) > 60`);
    }
    const rows = await tx.select().from(invoices)
      .where(and(...baseConditions, filters.cursor ? lt(invoices.id, filters.cursor.id) : undefined))
      .orderBy(desc(invoices.id))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    // F-15: the aging panel is computed client-side from the loaded page
    // (first 100) — without a total the UI presented partial sums as the
    // filtered result.
    const [countRow] = await tx.select({ n: sql<number>`count(*)` }).from(invoices)
      .where(and(...baseConditions));
    return {
      items: page.map((r) => toInvoiceView(r, today)),
      totalCount: Number(countRow?.n ?? 0),
      nextCursor: hasMore && page.length > 0 ? { id: page[page.length - 1]!.id } : null,
    };
  });
}

export async function updateInvoice(app: Db, tenantId: string, actor: string, invoiceId: string,
  input: { amount?: string; description?: string | null; reference?: string | null; dueOn?: string; issuedOn?: string }, today: string): Promise<InvoiceView> {
  const view = await withTenant(app, tenantId, async (tx) => {
    const [before] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId));
    if (!before) throw new AppError("NOT_FOUND", "Invoice not found", 404);
    // H06: terminal invoices bypassed the status machine — a paid,
    // cancelled or written-off invoice could still be edited. Only the
    // description (a note, not money) may change on a terminal invoice.
    if ((before.status === "paid" || before.status === "cancelled" || before.status === "written_off")
      && (input.amount !== undefined || input.reference !== undefined || input.dueOn !== undefined || input.issuedOn !== undefined)) {
      throw new AppError("INVOICE_TERMINAL", `A ${before.status} invoice cannot be edited (only its description may change)`, 409);
    }
    const amountMinor = input.amount !== undefined ? parseMoney(input.amount, before.currency) : before.amountMinor;
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
  /** F04: client idempotency key (8–128 chars). A retry with the same key
   * returns the original payment instead of recording the money twice. */
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});
export type RecordPaymentInput = z.input<typeof recordPaymentInput>;

export interface PaymentView {
  id: string; debtorId: string; amountMinor: string; allocatedMinor: string; creditMinor: string;
  currency: string;
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
  // Reconcile promises for every confirmed payment path (manual, gateway,
  // cheque clearing or reviewed receipt), not only the manual-payment form.
  await reconcileAcceptedPromises(tx, tenantId, inv.debtorId);
  // Keep the debtor's stored credit in step with the ledger (F05).
  await recomputeDebtorCredit(tx, tenantId, inv.debtorId);
}

/** A promise is kept only when confirmed allocations recorded after acceptance cover its agreed amount. */
async function reconcileAcceptedPromises(tx: Db, tenantId: string, debtorId: string): Promise<void> {
  const tracked = await tx.select().from(promisesToPay).where(and(
    eq(promisesToPay.tenantId, tenantId), eq(promisesToPay.debtorId, debtorId),
    inArray(promisesToPay.status, ["accepted", "kept"]),
  ));
  for (const promise of tracked) {
    const acceptedAt = promise.reviewedAt ?? promise.createdAt;
    const [collected] = await tx.select({ amountMinor: sql<bigint>`coalesce(sum(${paymentAllocations.amountMinor}), 0)::bigint` })
      .from(paymentAllocations)
      .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
      .where(and(
        eq(payments.tenantId, tenantId), eq(payments.debtorId, debtorId), eq(payments.status, "confirmed"),
        gte(payments.createdAt, acceptedAt),
        promise.invoiceId ? eq(paymentAllocations.invoiceId, promise.invoiceId) : sql`true`,
      ));
    const isCovered = (collected?.amountMinor ?? 0n) >= promise.amountMinor;
    if (isCovered && promise.status === "accepted") {
      const fulfilledAt = new Date();
      await tx.update(promisesToPay).set({ status: "kept", fulfilledAt, updatedAt: fulfilledAt }).where(and(
        eq(promisesToPay.id, promise.id), eq(promisesToPay.status, "accepted"),
      ));
    } else if (!isCovered && promise.status === "kept") {
      // A later reversal must not leave a fulfilled promise falsely green.
      await tx.update(promisesToPay).set({ status: "accepted", fulfilledAt: null, updatedAt: new Date() }).where(and(
        eq(promisesToPay.id, promise.id), eq(promisesToPay.status, "kept"),
      ));
    }
  }
}

export async function recordPayment(app: Db, tenantId: string, actor: string, input: RecordPaymentInput): Promise<PaymentView> {
  const idempotencyKey = input.idempotencyKey ?? null;
  const view = await withTenant(app, tenantId, async (tx) => {
    // F04: a retry with the same key returns the original payment — the
    // money is never recorded twice.
    if (idempotencyKey) {
      const [existing] = await tx.select({ id: payments.id }).from(payments)
        .where(and(eq(payments.tenantId, tenantId), eq(payments.idempotencyKey, idempotencyKey)));
      if (existing) {
        const replay = await loadPaymentView(tx, existing.id);
        if (replay) return replay;
      }
    }
    await findDebtorOr404(tx, input.debtorId);
    // F01: lock the debtor row (credit) and the allocatable invoices
    // BEFORE planning, so concurrent payments serialize on the same rows.
    const lockedDebtor = await lockDebtor(tx, input.debtorId);
    const openInvoices = await lockDebtorInvoices(tx, input.debtorId);
    const targets: AllocationTarget[] = openInvoices.map((i) => ({
      invoiceId: i.id, amountMinor: i.amountMinor, paidMinor: i.paidMinor, dueOn: i.dueOn, status: i.status,
    }));
    // F02: one payment, one currency. Explicit allocations must all be in
    // the same currency; auto-allocation uses the earliest-due open
    // invoice's currency and ignores other currencies (there is no FX).
    // With no open invoices, the payment is pure credit in the tenant's
    // default currency.
    const allocatedInvoiceIds = input.allocations?.map((a) => a.invoiceId) ?? null;
    let currency: string;
    if (allocatedInvoiceIds) {
      const currencies = new Set(openInvoices.filter((i) => allocatedInvoiceIds.includes(i.id)).map((i) => i.currency));
      if (currencies.size > 1) {
        throw new AppError("CURRENCY_MISMATCH", "A single payment cannot allocate across currencies", 400);
      }
      if (currencies.size === 1) {
        currency = [...currencies][0]!;
      } else {
        const settings = await tenantSettings(tx, tenantId);
        currency = settings.currency ?? "EGP";
      }
    } else {
      const firstOpen = openInvoices.find((i) => (i.status === "open" || i.status === "partially_paid") && i.amountMinor > i.paidMinor);
      if (firstOpen) {
        currency = firstOpen.currency;
      } else {
        const settings = await tenantSettings(tx, tenantId);
        currency = settings.currency ?? "EGP";
      }
    }
    // F-06: parse here, once the payment currency is resolved (explicit
    // allocations' invoice currency, else the first open invoice's, else
    // the tenant default) — parsing before the tx could only assume EGP.
    // A replayed idempotency key above returns before this line, so a
    // duplicate retry never re-parses.
    const amountMinor = parseMoney(input.amount, currency);
    // F05: stored credit in the same currency is consumed first (oldest
    // invoice first, via allocatePayment). A zero stored credit adopts the
    // payment's currency so future payments in that currency can consume it.
    let effectiveMinor = amountMinor;
    if (lockedDebtor && lockedDebtor.creditMinor > 0n && lockedDebtor.creditCurrency === currency) {
      effectiveMinor = amountMinor + lockedDebtor.creditMinor;
    }
    if (lockedDebtor && lockedDebtor.creditMinor === 0n && lockedDebtor.creditCurrency !== currency) {
      await tx.update(debtors).set({ creditCurrency: currency, updatedAt: new Date() }).where(eq(debtors.id, input.debtorId));
    }
    let plan;
    try {
      plan = input.allocations && input.allocations.length > 0
        ? validateExplicitAllocations(effectiveMinor, input.allocations.map((a) => ({ invoiceId: a.invoiceId, amountMinor: parseMoney(a.amount, currency) })), targets)
        : allocatePayment(effectiveMinor, targets);
    } catch (err) {
      throw new AppError("INVALID_ALLOCATION", err instanceof Error ? err.message : "Invalid allocation", 400);
    }
    const paymentId = uuidv7();
    // onConflictDoNothing is the race backstop: two concurrent retries with
    // the same key — the loser inserts 0 rows and replays the winner.
    const inserted = await tx.insert(payments).values({
      id: paymentId, tenantId, debtorId: input.debtorId, invoiceId: plan.allocations[0]?.invoiceId ?? null,
      amountMinor, currency, method: input.method ?? "cash", receivedOn: input.receivedOn,
      referenceNo: input.referenceNo ?? null, status: "confirmed", source: "manual", confirmedBy: actor,
      idempotencyKey,
    }).onConflictDoNothing({ target: [payments.tenantId, payments.idempotencyKey] }).returning({ id: payments.id });
    if (inserted.length === 0) {
      const [winner] = await tx.select({ id: payments.id }).from(payments)
        .where(and(eq(payments.tenantId, tenantId), eq(payments.idempotencyKey, idempotencyKey!)));
      const replay = winner ? await loadPaymentView(tx, winner.id) : null;
      if (replay) return replay;
      throw new AppError("CONFLICT", "Payment could not be recorded", 409);
    }
    for (const a of plan.allocations) {
      await tx.insert(paymentAllocations).values({ tenantId, paymentId, invoiceId: a.invoiceId, amountMinor: a.amountMinor });
    }
    for (const a of plan.allocations) await recomputeInvoicePaid(tx, tenantId, a.invoiceId);
    const credit = await recomputeDebtorCredit(tx, tenantId, input.debtorId);
    await audit(tx, tenantId, actor, "payment.recorded", "payment", paymentId, null, {
      amountMinor: amountMinor.toString(), allocatedMinor: plan.allocatedMinor.toString(),
      creditMinor: credit.creditMinor.toString(), currency, allocations: plan.allocations.length,
      ...(idempotencyKey ? { idempotencyKey } : {}),
    });
    return {
      id: paymentId, debtorId: input.debtorId, amountMinor: amountMinor.toString(),
      allocatedMinor: plan.allocatedMinor.toString(), creditMinor: credit.creditMinor.toString(),
      currency, method: input.method ?? "cash", receivedOn: input.receivedOn, status: "confirmed",
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
  /** Currency of the stored credit (F02/F05). */
  creditCurrency: string;
  totalOutstandingMinor: string;
}

export async function getDebtorDetail(app: Db, tenantId: string, debtorId: string, today = "9999-12-31"): Promise<DebtorDetail> {
  return withTenant(app, tenantId, async (tx) => {
    const debtor = await findDebtorOr404(tx, debtorId);
    const invs = await tx.select().from(invoices).where(eq(invoices.debtorId, debtorId)).orderBy(desc(invoices.id));
    const pays = await tx.select().from(payments).where(eq(payments.debtorId, debtorId)).orderBy(desc(payments.id));
    // F02/F05: credit comes from the stored, ledger-recomputed value —
    // never re-derived-and-clamped here (the old code clamped negatives
    // to 0, hiding over-reversals). Outstanding is per currency: the
    // headline is the default-currency subtotal when mixed.
    // H09: disputed invoices are frozen — they count toward the disputed
    // subtotal, never toward outstanding or the open count.
    const byCurrency = new Map<string, bigint>();
    const disputedByCurrency = new Map<string, bigint>();
    for (const i of invs) {
      const collectible = outstandingFor(i);
      if (collectible > 0n) byCurrency.set(i.currency, (byCurrency.get(i.currency) ?? 0n) + collectible);
      const frozen = disputedFor(i);
      if (frozen > 0n) disputedByCurrency.set(i.currency, (disputedByCurrency.get(i.currency) ?? 0n) + frozen);
    }
    const settings = await tenantSettings(tx, tenantId);
    const defaultCurrency = settings.currency ?? "EGP";
    const headline = (m: Map<string, bigint>) => m.size <= 1
      ? [...m.values()].reduce((a, b) => a + b, 0n)
      : (m.get(defaultCurrency) ?? 0n);
    const outstanding = headline(byCurrency);
    const disputed = headline(disputedByCurrency);
    const paid = invs.reduce((s, i) => s + i.paidMinor, 0n);
    const openCount = invs.filter((i) => isCollectibleStatus(i.status) && outstandingFor(i) > 0n).length;
    const disputedCount = invs.filter((i) => disputedFor(i) > 0n).length;
    return {
      ...toDebtorView(debtor, {
        outstanding, paid, openCount, totalCount: invs.length,
        byCurrency: [...byCurrency.entries()].map(([currency, minor]) => ({ currency, minor: minor.toString() })),
        disputed, disputedCount,
        disputedByCurrency: [...disputedByCurrency.entries()].map(([currency, minor]) => ({ currency, minor: minor.toString() })),
      }),
      invoices: invs.map((i) => toInvoiceView(i, today)),
      payments: pays.map((p) => ({
        id: p.id, amountMinor: p.amountMinor.toString(), method: p.method, receivedOn: p.receivedOn, status: p.status,
        source: p.source, gatewayTransactionId: p.gatewayTransactionId, reversalOf: p.reversalOf,
      })),
      creditMinor: debtor.creditMinor.toString(),
      creditCurrency: debtor.creditCurrency,
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
export interface LedgerReconciliationView {
  balanced: boolean;
  discrepancies: { kind: string; id: string; detail: string }[];
  byCurrency: { currency: string; confirmedPaymentsMinor: string; allocatedMinor: string; storedCreditMinor: string }[];
}

/**
 * M01: ledger reconciliation, surfaced like the gateway report
 * (payments.reconciliation). Loads the tenant's ledger rows under RLS and
 * hands them to the pure core replay — invoice paid vs confirmed
 * allocations, per-payment over-allocation, replayed vs stored credit.
 */
export async function getLedgerReconciliation(app: Db, tenantId: string): Promise<LedgerReconciliationView> {
  return withTenant(app, tenantId, async (tx) => {
    const invs = await tx.select({ id: invoices.id, paidMinor: invoices.paidMinor }).from(invoices);
    const pays = await tx.select({
      id: payments.id, debtorId: payments.debtorId, amountMinor: payments.amountMinor,
      currency: payments.currency, status: payments.status, createdAt: payments.createdAt,
    }).from(payments);
    const allocs = await tx.select({
      paymentId: paymentAllocations.paymentId, invoiceId: paymentAllocations.invoiceId, amountMinor: paymentAllocations.amountMinor,
    }).from(paymentAllocations);
    const debts = await tx.select({
      id: debtors.id, creditMinor: debtors.creditMinor, creditCurrency: debtors.creditCurrency,
    }).from(debtors);
    const r = reconcileLedger(
      invs,
      pays.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() })),
      allocs,
      debts,
    );
    return {
      balanced: r.balanced,
      discrepancies: r.discrepancies,
      byCurrency: r.byCurrency.map((b) => ({
        currency: b.currency,
        confirmedPaymentsMinor: b.confirmedPaymentsMinor.toString(),
        allocatedMinor: b.allocatedMinor.toString(),
        storedCreditMinor: b.storedCreditMinor.toString(),
      })),
    };
  });
}

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

