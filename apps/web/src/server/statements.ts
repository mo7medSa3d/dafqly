import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  AppError, canTransition,
  statementLinkState, STATEMENT_DEFAULT_EXPIRY_DAYS, type StatementLinkState,
} from "@tahseel/core";
import { generateStatementToken, hashStatementToken } from "@tahseel/core/payments-crypto";
import {
  auditLog, debtors, disputes, invoices, payments, statementLinks, tenants,
} from "@tahseel/db/schema";
import { withTenant, type Db } from "@tahseel/db";
import { replanLater } from "./engine";

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
  gatewayEnabled: boolean;
  invoices: {
    id: string; reference: string | null; description: string | null;
    amountMinor: string; paidMinor: string; outstandingMinor: string;
    status: string; issuedOn: string; dueOn: string;
  }[];
  payments: { id: string; amountMinor: string; method: string; receivedOn: string; status: string }[];
  openDisputes: { id: string; invoiceId: string; reason: string; createdAt: string }[];
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
    const totalDue = invs
      .filter((i) => i.status === "open" || i.status === "partially_paid")
      .reduce((s, i) => s + (i.amountMinor - i.paidMinor > 0n ? i.amountMinor - i.paidMinor : 0n), 0n);
    const result: StatementData = {
      businessName: tenant.businessNameAr,
      debtorName: debtor.displayName,
      totalDueMinor: totalDue.toString(),
      gatewayEnabled: tenant.settings.gatewayEnabled !== false,
      invoices: invs.map((i) => ({
        id: i.id, reference: i.reference, description: i.description,
        amountMinor: i.amountMinor.toString(), paidMinor: i.paidMinor.toString(),
        outstandingMinor: (i.amountMinor - i.paidMinor > 0n ? i.amountMinor - i.paidMinor : 0n).toString(),
        status: i.status, issuedOn: i.issuedOn, dueOn: i.dueOn,
      })),
      // Payment history: confirmed money plus claims still being checked;
      // rejected claims are the merchant's business, not the debtor's.
      payments: pays
        .filter((p) => p.status === "confirmed" || p.status === "claimed")
        .map((p) => ({
          id: p.id, amountMinor: p.amountMinor.toString(), method: p.method,
          receivedOn: p.receivedOn, status: p.status,
        })),
      openDisputes: disps.map((d) => ({
        id: d.id, invoiceId: d.invoiceId, reason: d.reason, createdAt: d.createdAt.toISOString(),
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
  const out = await withTenant(app, link.tenantId, async (tx) => {
    const [invoice] = await tx.select().from(invoices)
      .where(and(eq(invoices.id, input.invoiceId), eq(invoices.debtorId, link.debtorId)));
    if (!invoice) throw new AppError("NOT_FOUND", "Not found", 404);
    if (!canTransition(invoice.status, "disputed")) {
      throw new AppError("INVALID_STATE", `Invoice is ${invoice.status} and cannot be disputed`, 409);
    }
    const [row] = await tx.insert(disputes).values({
      tenantId: link.tenantId, invoiceId: invoice.id, debtorId: link.debtorId,
      raisedBy: "debtor", reason: input.reason, status: "open",
    }).returning();
    await tx.update(invoices).set({ status: "disputed", updatedAt: now })
      .where(eq(invoices.id, invoice.id));
    await audit(tx, link.tenantId, null, "dispute.raised", "dispute", row!.id, {
      invoiceId: invoice.id, raisedBy: "debtor", via: "statement_page",
    });
    await audit(tx, link.tenantId, null, "invoice.disputed", "invoice", invoice.id, {
      status: "disputed", disputeId: row!.id,
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
