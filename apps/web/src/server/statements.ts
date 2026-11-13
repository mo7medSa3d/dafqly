import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  AppError, canTransition, outstandingFor,
  statementLinkState, STATEMENT_DEFAULT_EXPIRY_DAYS, type StatementLinkState,
} from "@tahseel/core";
import { generateStatementToken, hashStatementToken } from "@tahseel/core/payments-crypto";
import {
  auditLog, debtors, disputes, invoices, payments, statementLinks, tenants, promisesToPay,
} from "@tahseel/db/schema";
import { withTenant, type Db } from "@tahseel/db";
import { replanLater } from "./engine";
import { upsertNotificationInTx } from "./notifications";
import { todayInTimezone } from "./services";

/**
 * F10 statement services (BUILD_PLAN §7-F10, ADR-020): merchant-side link
 * management plus the public, token-authorized statement surface.
 * The token is 32 random bytes; only its SHA-256 hash is stored, and the
 * raw token is returned exactly once (at creation). Public lookups resolve
 * the tenant by hash through the OWNER connection (pre-tenant, like a
 * webhook), then every data read/write runs inside withTenant (RLS).
 * The statement payload is an ALLOWLIST: internal notes and merchant-only
 * fields are never selected into it.
 */

async function audit(tx: Db, tenantId: string, actor: string | null, action: string, entity: string, entityId: string, after: unknown) {
  await tx.insert(auditLog).values({
    tenantId, actorUserId: actor, action, entity, entityId,
    before: null, after: (after ?? null) as never,
  });
}

// ------------------------------------------------------------- merchant side
export interface StatementLinkView {
  id: string; debtorId: string; expiresAt: string;
  revokedAt: string | null; lastViewedAt: string | null; createdAt: string;
  state: "valid" | "expired" | "revoked";
}

const toLinkView = (r: typeof statementLinks.$inferSelect, now: Date): StatementLinkView => ({
  id: r.id, debtorId: r.debtorId, expiresAt: r.expiresAt.toISOString(),
  revokedAt: r.revokedAt?.toISOString() ?? null,
  lastViewedAt: r.lastViewedAt?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
  state: statementLinkState(r, now) as StatementLinkView["state"],
});

export async function createStatementLink(
  app: Db, tenantId: string, actor: string, debtorId: string, now: Date,
): Promise<StatementLinkView & { token: string; path: string }> {
  const { token, tokenHash } = generateStatementToken();
  const view = await withTenant(app, tenantId, async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant) throw new AppError("NOT_FOUND", "Tenant not found", 404);
    if (tenant.settings.statementLinksEnabled === false) {
      throw new AppError("STATEMENT_DISABLED", "Statement links are disabled for this tenant", 400);
    }
    const [debtor] = await tx.select().from(debtors)
      .where(and(eq(debtors.id, debtorId), isNull(debtors.deletedAt)));
    if (!debtor) throw new AppError("NOT_FOUND", "Debtor not found", 404);
    const days = tenant.settings.statementExpiryDays ?? STATEMENT_DEFAULT_EXPIRY_DAYS;
    const expiresAt = new Date(now.getTime() + days * 86_400_000);
    const [row] = await tx.insert(statementLinks).values({
      tenantId, debtorId, tokenHash, expiresAt, createdBy: actor,
    }).returning();
    await audit(tx, tenantId, actor, "statement_link.created", "statement_link", row!.id, {
      debtorId, expiresAt: expiresAt.toISOString(),
    });
    return toLinkView(row!, now);
  });
  // The raw token leaves the server exactly here, once. Only its hash is stored.
  return { ...view, token, path: `/s/${token}` };
}

export async function listStatementLinks(app: Db, tenantId: string, debtorId: string, now: Date): Promise<StatementLinkView[]> {
  return withTenant(app, tenantId, async (tx) => {
    const rows = await tx.select().from(statementLinks)
      .where(eq(statementLinks.debtorId, debtorId)).orderBy(desc(statementLinks.createdAt));
    return rows.map((r) => toLinkView(r, now));
  });
}

export async function revokeStatementLink(app: Db, tenantId: string, actor: string, linkId: string, now: Date): Promise<void> {
  await withTenant(app, tenantId, async (tx) => {
    const [row] = await tx.select().from(statementLinks).where(eq(statementLinks.id, linkId));
    if (!row) throw new AppError("NOT_FOUND", "Statement link not found", 404);
    if (row.revokedAt) return; // idempotent
    await tx.update(statementLinks).set({ revokedAt: now, updatedAt: now }).where(eq(statementLinks.id, linkId));
    await audit(tx, tenantId, actor, "statement_link.revoked", "statement_link", linkId, { debtorId: row.debtorId });
  });
}

// -------------------------------------------------------------- public side
export interface ResolvedStatement {
  state: StatementLinkState;
  link?: typeof statementLinks.$inferSelect;
}

/** Resolve a raw token to its link via the owner connection (hash lookup only — the token itself is never stored or logged). */
export async function resolveStatement(owner: Db, token: string, now: Date = new Date()): Promise<ResolvedStatement> {
  const [link] = await owner.select().from(statementLinks)
    .where(eq(statementLinks.tokenHash, hashStatementToken(token)));
  return { state: statementLinkState(link ?? null, now), link: link ?? undefined };
}

export interface StatementData {
  businessName: string;
  debtorName: string;
  totalDueMinor: string;
  /** Tenant display currency (settings.currency, default EGP) — the public
   * portal used to hardcode ج.م. for every tenant. */
  currency: string;
  /** Tenant portal language (settings.exportLanguage, default ar) — the
   * portal renders in this locale unless ?lang= overrides it (F-08). */
  language: string;
  /** F02: per-currency totals. totalDueMinor is the headline-currency
   * subtotal when the debtor has invoices in several currencies — minor
   * units are never summed across currencies. */
  totalsByCurrency: { currency: string; minor: string }[];
  gatewayEnabled: boolean;
  invoices: {
    id: string; reference: string | null; description: string | null;
    amountMinor: string; paidMinor: string; outstandingMinor: string;
    currency: string;
    status: string; issuedOn: string; dueOn: string;
  }[];
  payments: { id: string; amountMinor: string; currency: string; method: string; receivedOn: string; status: string }[];
  openDisputes: { id: string; invoiceId: string; reason: string; createdAt: string }[];
  promises: { id: string; invoiceId: string | null; amountMinor: string; promisedOn: string; status: string; createdAt: string }[];
}

/**
 * The public statement payload. Returns null for EVERY non-valid state so
 * callers render one generic not-found (no oracle). Viewing stamps
 * last_viewed_at. Internal notes are never selected.
 */
export async function getStatementData(
  app: Db, owner: Db, token: string, now: Date,
): Promise<StatementData | null> {
  const { state, link } = await resolveStatement(owner, token, now);
  if (state !== "valid" || !link) return null;
  const data = await withTenant(app, link.tenantId, async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, link.tenantId));
    const [debtor] = await tx.select().from(debtors).where(eq(debtors.id, link.debtorId));
    if (!tenant || !debtor || debtor.deletedAt) return null;
    const invs = await tx.select().from(invoices)
      .where(eq(invoices.debtorId, link.debtorId)).orderBy(desc(invoices.dueOn));
    const pays = await tx.select().from(payments)
      .where(eq(payments.debtorId, link.debtorId)).orderBy(desc(payments.receivedOn));
    const disps = await tx.select().from(disputes)
      .where(and(eq(disputes.debtorId, link.debtorId), eq(disputes.status, "open")));
    const promiseRows = await tx.select({
      id: promisesToPay.id, invoiceId: promisesToPay.invoiceId,
      amountMinor: promisesToPay.amountMinor, promisedOn: promisesToPay.promisedOn,
      status: promisesToPay.status, createdAt: promisesToPay.createdAt,
    }).from(promisesToPay).where(and(
      eq(promisesToPay.debtorId, link.debtorId),
      // The public customer only sees their own current / recent commitment states.
      sql`${promisesToPay.status} in ('pending','accepted','kept','broken')`,
    )).orderBy(desc(promisesToPay.createdAt)).limit(20);
    const totalsByCurrencyMap = new Map<string, bigint>();
    for (const i of invs) {
      // H09: the same collectible rule as the debtor list and KPIs —
      // a disputed invoice is frozen and never adds to the amount due.
      const diff = outstandingFor(i);
      if (diff > 0n) totalsByCurrencyMap.set(i.currency, (totalsByCurrencyMap.get(i.currency) ?? 0n) + diff);
    }
    const statementCurrency = tenant.settings.currency ?? "EGP";
    const totalsByCurrency = [...totalsByCurrencyMap.entries()]
      .map(([currency, minor]) => ({ currency, minor: minor.toString() }))
      .sort((a, b) => (a.currency < b.currency ? -1 : 1));
    const totalDue = totalsByCurrencyMap.size <= 1
      ? [...totalsByCurrencyMap.values()].reduce((a, b) => a + b, 0n)
      : (totalsByCurrencyMap.get(statementCurrency) ?? 0n);
    const result: StatementData = {
      businessName: tenant.businessNameAr,
      debtorName: debtor.displayName,
      totalDueMinor: totalDue.toString(),
      currency: statementCurrency,
      language: tenant.settings.exportLanguage ?? "ar",
      totalsByCurrency,
      gatewayEnabled: tenant.settings.gatewayEnabled !== false,
      invoices: invs.map((i) => ({
        id: i.id, reference: i.reference, description: i.description,
        amountMinor: i.amountMinor.toString(), paidMinor: i.paidMinor.toString(),
        outstandingMinor: (i.amountMinor - i.paidMinor > 0n ? i.amountMinor - i.paidMinor : 0n).toString(),
        currency: i.currency,
        status: i.status, issuedOn: i.issuedOn, dueOn: i.dueOn,
      })),
      // Payment history: confirmed money plus claims still being checked;
      // rejected claims are the merchant's business, not the debtor's.
      payments: pays
        .filter((p) => p.status === "confirmed" || p.status === "claimed")
        .map((p) => ({
          id: p.id, amountMinor: p.amountMinor.toString(), currency: p.currency, method: p.method,
          receivedOn: p.receivedOn, status: p.status,
        })),
      openDisputes: disps.map((d) => ({
        id: d.id, invoiceId: d.invoiceId, reason: d.reason, createdAt: d.createdAt.toISOString(),
      })),
      promises: promiseRows.map((p) => ({
        id: p.id, invoiceId: p.invoiceId, amountMinor: p.amountMinor.toString(),
        promisedOn: p.promisedOn, status: p.status, createdAt: p.createdAt.toISOString(),
      })),
    };
    return result;
  });
  if (data) {
    await owner.update(statementLinks).set({ lastViewedAt: now })
      .where(eq(statementLinks.id, link.id));
  }
  return data;
}

export const raiseDisputeInput = z.object({
  invoiceId: z.string().uuid(),
  reason: z.string().trim().min(1).max(1000),
});
export type RaiseDisputeInput = z.infer<typeof raiseDisputeInput>;

/**
 * The statement page's dispute button (F10 acceptance): creates the dispute
 * row AND moves the invoice to `disputed` through the status machine, which
 * pauses its reminders (the M2 sweep cancels them; the re-plan hook here
 * makes it immediate). Unknown/expired/revoked tokens and invoices of
 * another debtor all produce the same generic NOT_FOUND.
 */
export async function raiseStatementDispute(
  app: Db, owner: Db, token: string, input: RaiseDisputeInput, now: Date,
): Promise<{ disputeId: string; invoiceId: string }> {
  const { state, link } = await resolveStatement(owner, token, now);
  if (state !== "valid" || !link) throw new AppError("NOT_FOUND", "Not found", 404);
  // M9: a token holder cannot dispute every invoice in turn and pause all
  // reminders — one open dispute per invoice, three open per debtor.
  const actor = `statement:${link.id}`;
  const out = await withTenant(app, link.tenantId, async (tx) => {
    const [invoice] = await tx.select().from(invoices)
      .where(and(eq(invoices.id, input.invoiceId), eq(invoices.debtorId, link.debtorId)));
    if (!invoice) throw new AppError("NOT_FOUND", "Not found", 404);
    if (!canTransition(invoice.status, "disputed")) {
      throw new AppError("INVALID_STATE", `Invoice is ${invoice.status} and cannot be disputed`, 409);
    }
    const open = await tx.select({ id: disputes.id, invoiceId: disputes.invoiceId }).from(disputes)
      .where(and(eq(disputes.debtorId, link.debtorId), eq(disputes.status, "open")));
    if (open.some((d) => d.invoiceId === invoice.id)) {
      throw new AppError("DISPUTE_ALREADY_OPEN", "This invoice already has an open dispute", 409);
    }
    if (open.length >= 3) {
      throw new AppError("DISPUTE_LIMIT", "Too many open disputes for this statement", 429);
    }
    const [row] = await tx.insert(disputes).values({
      tenantId: link.tenantId, invoiceId: invoice.id, debtorId: link.debtorId,
      raisedBy: "debtor", reason: input.reason, status: "open",
    }).returning();
    await tx.update(invoices).set({ status: "disputed", updatedAt: now })
      .where(eq(invoices.id, invoice.id));
    await audit(tx, link.tenantId, actor, "dispute.raised", "dispute", row!.id, {
      invoiceId: invoice.id, raisedBy: "debtor", via: "statement_page",
    });
    await audit(tx, link.tenantId, actor, "invoice.disputed", "invoice", invoice.id, {
      status: "disputed", disputeId: row!.id,
    });
    await upsertNotificationInTx(tx, link.tenantId, {
      kind: "dispute",
      severity: "urgent",
      titleAr: "اعتراض جديد على فاتورة",
      titleEn: "New invoice dispute raised",
      bodyAr: `قام العميل بالاعتراض على الفاتورة${invoice.reference ? ` (${invoice.reference})` : ""} وتوقفت تذكيراتها تلقائياً.`,
      bodyEn: `Customer disputed invoice${invoice.reference ? ` (${invoice.reference})` : ""}; reminders paused.`,
      actionUrl: `/debtors/${link.debtorId}`,
      entityType: "dispute",
      entityId: row!.id,
      dedupeKey: `dispute:${row!.id}`,
    });
    return { disputeId: row!.id, invoiceId: invoice.id };
  });
  replanLater(link.tenantId, out.invoiceId);
  return out;
}

/** Merchant-side dispute list for a debtor (timeline/detail surfaces). */
export async function listDisputes(app: Db, tenantId: string, debtorId: string) {
  return withTenant(app, tenantId, async (tx) => {
    const rows = await tx.select().from(disputes)
      .where(eq(disputes.debtorId, debtorId)).orderBy(desc(disputes.createdAt));
    return rows.map((r) => ({
      id: r.id, invoiceId: r.invoiceId, raisedBy: r.raisedBy, reason: r.reason,
      status: r.status, createdAt: r.createdAt.toISOString(),
    }));
  });
}

export const resolveDisputeInput = z.object({
  disputeId: z.string().uuid(),
  resolution: z.enum(["reopen_invoice", "cancel_invoice"]).default("reopen_invoice"),
  note: z.string().trim().max(500).optional(),
});
export type ResolveDisputeInput = z.input<typeof resolveDisputeInput>;

/**
 * Merchant-side dispute resolution: marks the dispute as `resolved`, transitions
 * the linked invoice back to active (`open` / `partially_paid`) or cancels/writes it off,
 * writes an immutable audit log entry, and triggers reminder re-planning.
 */
export async function resolveStatementDispute(
  app: Db,
  tenantId: string,
  actor: string,
  rawInput: ResolveDisputeInput,
  now = new Date(),
): Promise<{ ok: true; disputeId: string; invoiceId: string; invoiceStatus: string; replayed: boolean }> {
  const input = resolveDisputeInput.parse(rawInput);

  const out = await withTenant(app, tenantId, async (tx) => {
    // M09: lock the dispute row so two concurrent resolutions serialize —
    // the loser replays (same resolution) or is rejected (different one)
    // instead of writing a second audit row.
    const [disp] = await tx
      .select()
      .from(disputes)
      .where(eq(disputes.id, input.disputeId))
      .for("update");
    if (!disp) throw new AppError("NOT_FOUND", "Dispute not found", 404);

    const [inv] = await tx
      .select()
      .from(invoices)
      .where(eq(invoices.id, disp.invoiceId))
      .for("update");
    if (!inv) throw new AppError("NOT_FOUND", "Linked invoice not found", 404);

    if (disp.status === "resolved") {
      // Idempotent replay: the same resolution returns the existing
      // outcome with no second audit row; a different resolution is a
      // conflict — the caller must not be told the invoice was cancelled
      // when it was only reopened (or vice versa). A null stored
      // resolution (resolved before migration 0017) replays as-is.
      if (disp.resolution && disp.resolution !== input.resolution) {
        throw new AppError(
          "DISPUTE_RESOLUTION_MISMATCH",
          `Dispute was already resolved with ${disp.resolution}`,
          409,
        );
      }
      return { ok: true as const, disputeId: disp.id, invoiceId: inv.id, invoiceStatus: inv.status, replayed: true };
    }

    await tx
      .update(disputes)
      .set({ status: "resolved", resolution: input.resolution, updatedAt: now })
      .where(eq(disputes.id, disp.id));

    let nextInvoiceStatus = inv.status;
    if (inv.status === "disputed") {
      if (input.resolution === "cancel_invoice") {
        nextInvoiceStatus = inv.paidMinor > 0n ? "written_off" : "cancelled";
      } else {
        nextInvoiceStatus = inv.paidMinor > 0n ? "partially_paid" : "open";
      }
      if (canTransition(inv.status, nextInvoiceStatus)) {
        await tx
          .update(invoices)
          .set({ status: nextInvoiceStatus, updatedAt: now })
          .where(eq(invoices.id, inv.id));
        await audit(tx, tenantId, actor, "invoice.transitioned", "invoice", inv.id, {
          from: inv.status,
          to: nextInvoiceStatus,
          via: "dispute_resolution",
        });
      }
    }

    await audit(tx, tenantId, actor, "dispute.resolved", "dispute", disp.id, {
      invoiceId: inv.id,
      resolution: input.resolution,
      note: input.note ?? null,
    });

    return { ok: true as const, disputeId: disp.id, invoiceId: inv.id, invoiceStatus: nextInvoiceStatus, replayed: false };
  });

  // A replay changed nothing, so there is nothing to re-plan.
  if (!out.replayed) replanLater(tenantId, out.invoiceId);
  return out;
}


/** Public self-service promise request. The 256-bit statement token proves access to this debtor's portal. */
export async function createPublicPromiseRequest(
  app: Db, owner: Db, token: string,
  input: { invoiceId?: string; amountMinor: string; promisedOn: string; note?: string },
  now: Date,
): Promise<{ id: string; status: "pending" }> {
  const { state, link } = await resolveStatement(owner, token, now);
  if (state !== "valid" || !link) throw new AppError("NOT_FOUND", "Not found", 404);
  if (!/^\d{1,18}$/.test(input.amountMinor) || BigInt(input.amountMinor) <= 0n) throw new AppError("BAD_AMOUNT", "Invalid amount", 400);
  return withTenant(app, link.tenantId, async (tx) => {
    const [tenant] = await tx.select({ timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, link.tenantId));
    const todayIso = todayInTimezone(tenant?.timezone ?? "Africa/Cairo", now);
    const promisedDate = new Date(`${input.promisedOn}T00:00:00.000Z`);
    const validPromisedDate = /^\d{4}-\d{2}-\d{2}$/.test(input.promisedOn)
      && !Number.isNaN(promisedDate.getTime())
      && promisedDate.toISOString().slice(0, 10) === input.promisedOn;
    const maximumPromiseDate = new Date(`${todayIso}T00:00:00.000Z`);
    maximumPromiseDate.setUTCDate(maximumPromiseDate.getUTCDate() + 365);
    if (!validPromisedDate || input.promisedOn < todayIso || input.promisedOn > maximumPromiseDate.toISOString().slice(0, 10)) {
      throw new AppError("BAD_PROMISE_DATE", "Choose a valid promise date within the next 365 days", 400);
    }
    const [debtor] = await tx.select({ id: debtors.id }).from(debtors)
      .where(and(eq(debtors.id, link.debtorId), isNull(debtors.deletedAt)));
    if (!debtor) throw new AppError("NOT_FOUND", "Not found", 404);
    let balance = 0n;
    if (input.invoiceId) {
      const [invoice] = await tx.select().from(invoices)
        .where(and(eq(invoices.id, input.invoiceId), eq(invoices.debtorId, link.debtorId)));
      if (!invoice || !["open", "partially_paid"].includes(invoice.status)) throw new AppError("INVOICE_NOT_ACTIONABLE", "Invoice is not available", 400);
      balance = invoice.amountMinor - invoice.paidMinor;
    } else {
      const rows = await tx.select({ amountMinor: invoices.amountMinor, paidMinor: invoices.paidMinor })
        .from(invoices).where(and(eq(invoices.debtorId, link.debtorId), sql`${invoices.status} in ('open','partially_paid')`));
      balance = rows.reduce((sum, row) => sum + row.amountMinor - row.paidMinor, 0n);
    }
    const amount = BigInt(input.amountMinor);
    if (amount > balance) throw new AppError("PROMISE_EXCEEDS_BALANCE", "Requested amount exceeds the open balance", 400);
    const recent = await tx.select({ id: promisesToPay.id }).from(promisesToPay)
      .where(and(
        eq(promisesToPay.debtorId, link.debtorId),
        eq(promisesToPay.source, "customer_portal"),
        gte(promisesToPay.createdAt, new Date(now.getTime() - 7 * 86_400_000)),
      ));
    if (recent.length >= 5) throw new AppError("PROMISE_REQUEST_LIMIT", "Too many promise requests", 429);
    const [row] = await tx.insert(promisesToPay).values({
      tenantId: link.tenantId, debtorId: link.debtorId, invoiceId: input.invoiceId ?? null,
      amountMinor: amount, promisedOn: input.promisedOn, status: "pending", source: "customer_portal",
      note: input.note?.slice(0, 500) ?? null,
    }).returning({ id: promisesToPay.id });
    // M9: structured audit actor — the statement link, not a bare literal.
    await audit(tx, link.tenantId, `statement:${link.id}`, "promise.requested_from_portal", "promise_to_pay", row!.id, {
      invoiceId: input.invoiceId ?? null, amountMinor: amount.toString(), promisedOn: input.promisedOn,
    });
    return { id: row!.id, status: "pending" as const };
  });
}
