import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  AppError, allocatePayment, decideGatewayCallback, localDateOf, outstandingForLink,
  parseEgp, parsePaymobCallback, planReversalAllocations,
  reconcileGateway, type PaymobCallback, type PaymobTxnLike,
} from "@tahseel/core";
import { verifyPaymobHmac } from "@tahseel/core/payments-crypto";
import {
  auditLog, debtors, invoices, paymentAllocations, paymentLinks, payments, tenants, webhookEvents,
} from "@tahseel/db/schema";
import { withTenant, type Db } from "@tahseel/db";
import { FakePaymentProvider, PaymobProvider, type PaymentProvider } from "@tahseel/providers";
import { env } from "./env";
import { appDb, ownerDb } from "./db";
import { recomputeInvoicePaid } from "./ledger";
import { replanLater } from "./engine";

/**
 * F5 gateway services (BUILD_PLAN §7-F5, ADR-019/020): Paymob payment links,
 * the HMAC-verified webhook that is the ONLY fulfilment path, refunds as
 * reversing payments, claimed-payment confirm/reject, and reconciliation.
 * The provider is injected (fake in tests, Paymob adapter when configured);
 * no real Paymob call ever happens from dev/CI/tests.
 */

export interface GatewayDeps {
  app: Db;
  owner: Db;
  provider: PaymentProvider;
  hmacSecret: string;
  appUrl: string;
}

/** Resolve the payment provider from env: the real Paymob adapter only when fully configured, otherwise the fake. */
export function paymentProviderFromEnv(): PaymentProvider {
  const e = env();
  const integrationIds = (e.PAYMOB_INTEGRATION_ID ?? "")
    .split(",").map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0);
  if (e.PAYMOB_SECRET_KEY && e.PAYMOB_PUBLIC_KEY && integrationIds.length > 0) {
    return new PaymobProvider({
      secretKey: e.PAYMOB_SECRET_KEY, publicKey: e.PAYMOB_PUBLIC_KEY,
      integrationIds, baseUrl: e.PAYMOB_BASE_URL || "https://accept.paymob.com",
    });
  }
  return new FakePaymentProvider();
}

export function gatewayDeps(): GatewayDeps {
  const e = env();
  return {
    app: appDb(), owner: ownerDb(), provider: paymentProviderFromEnv(),
    hmacSecret: e.PAYMOB_HMAC_SECRET ?? "", appUrl: e.APP_URL,
  };
}

/** True when a real Paymob account is configured (the fake does not count). */
export function realGatewayConfigured(): boolean {
  const e = env();
  return Boolean(e.PAYMOB_SECRET_KEY && e.PAYMOB_PUBLIC_KEY && e.PAYMOB_INTEGRATION_ID);
}

async function audit(tx: Db, tenantId: string, actor: string | null, action: string, entity: string, entityId: string, after: unknown) {
  await tx.insert(auditLog).values({
    tenantId, actorUserId: actor, action, entity, entityId,
    before: null, after: (after ?? null) as never,
  });
}

// ------------------------------------------------------------ payment links
export const createGatewayLinkInput = z.object({
  debtorId: z.string().uuid(),
  invoiceId: z.string().uuid().optional(),
});
export type CreateGatewayLinkInput = z.infer<typeof createGatewayLinkInput>;

export interface PaymentLinkView {
  id: string; debtorId: string; invoiceId: string | null;
  amountMinor: string; checkoutUrl: string; status: string; expiresAt: string;
  specialReference: string;
}

export async function createGatewayLink(
  deps: GatewayDeps, tenantId: string, actor: string,
  input: CreateGatewayLinkInput, opts: { redirectionUrl?: string } = {},
): Promise<PaymentLinkView> {
  // Read + price inside RLS first: the amount comes from the ledger only.
  const priced = await withTenant(deps.app, tenantId, async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant) throw new AppError("NOT_FOUND", "Tenant not found", 404);
    if (tenant.settings.gatewayEnabled === false) {
      throw new AppError("GATEWAY_DISABLED", "Gateway payments are disabled for this tenant", 400);
    }
    const [debtor] = await tx.select().from(debtors)
      .where(and(eq(debtors.id, input.debtorId), isNull(debtors.deletedAt)));
    if (!debtor) throw new AppError("NOT_FOUND", "Debtor not found", 404);
    const invs = await tx.select().from(invoices).where(eq(invoices.debtorId, input.debtorId));
    if (input.invoiceId) {
      const inv = invs.find((i) => i.id === input.invoiceId);
      if (!inv) throw new AppError("NOT_FOUND", "Invoice not found", 404);
      if (inv.currency !== "EGP") throw new AppError("GATEWAY_CURRENCY", "Gateway links are EGP only", 400);
    }
    const egpInvoices = input.invoiceId ? invs : invs.filter((i) => i.currency === "EGP");
    const amountMinor = outstandingForLink(
      egpInvoices.map((i) => ({ id: i.id, amountMinor: i.amountMinor, paidMinor: i.paidMinor, status: i.status })),
      input.invoiceId ?? null,
    );
    if (amountMinor <= 0n) throw new AppError("NOTHING_DUE", "Nothing is due for this payment link", 400);
    return { debtor, amountMinor };
  });

  const reference = `tahseel_${uuidv7()}`;
  // Safety: a production deploy without Paymob keys must fail loudly here
  // rather than mint worthless fake checkout links (e2e opts in explicitly
  // via PAYMOB_ALLOW_FAKE=true).
  const e = env();
  if (deps.provider instanceof FakePaymentProvider && e.NODE_ENV === "production" && !e.PAYMOB_ALLOW_FAKE) {
    throw new AppError("GATEWAY_NOT_CONFIGURED", "Paymob is not configured for this deployment", 503);
  }
  const created = await deps.provider.createPaymentLink({
    reference, amountMinor: priced.amountMinor, currency: "EGP",
    debtorName: priced.debtor.displayName, debtorPhone: priced.debtor.phoneE164,
    notificationUrl: `${deps.appUrl}/api/webhooks/paymob`,
    redirectionUrl: opts.redirectionUrl ?? deps.appUrl,
  });

  return withTenant(deps.app, tenantId, async (tx) => {
    const [row] = await tx.insert(paymentLinks).values({
      tenantId, debtorId: input.debtorId, invoiceId: input.invoiceId ?? null,
      amountMinor: priced.amountMinor, currency: "EGP",
      provider: deps.provider instanceof PaymobProvider ? "paymob" : "fake",
      specialReference: reference, providerIntentionId: created.transactionId,
      checkoutUrl: created.url, status: "pending", expiresAt: created.expiresAt,
    }).returning();
    await audit(tx, tenantId, actor, "payment_link.created", "payment_link", row!.id, {
      amountMinor: priced.amountMinor.toString(), invoiceId: input.invoiceId ?? null,
    });
    return {
      id: row!.id, debtorId: row!.debtorId, invoiceId: row!.invoiceId,
      amountMinor: row!.amountMinor.toString(), checkoutUrl: row!.checkoutUrl,
      status: row!.status, expiresAt: row!.expiresAt.toISOString(),
      // The merchant's own correlation reference (Paymob shows it as the
      // order's merchant_order_id) — needed for support reconciliation.
      specialReference: row!.specialReference,
    };
  });
}

export async function listPaymentLinks(app: Db, tenantId: string, debtorId: string): Promise<PaymentLinkView[]> {
  return withTenant(app, tenantId, async (tx) => {
    const rows = await tx.select().from(paymentLinks)
      .where(eq(paymentLinks.debtorId, debtorId)).orderBy(desc(paymentLinks.createdAt));
    return rows.map((r) => ({
      id: r.id, debtorId: r.debtorId, invoiceId: r.invoiceId, amountMinor: r.amountMinor.toString(),
      checkoutUrl: r.checkoutUrl, status: r.status, expiresAt: r.expiresAt.toISOString(),
      specialReference: r.specialReference,
    }));
  });
}

// ------------------------------------------------------------------ webhook
export interface WebhookOutcome {
  outcome: "fulfilled" | "duplicate" | "reversed" | "ignored" | "unmatched";
  reason?: string;
  paymentId?: string;
}

async function insertReversal(
  tx: Db, tenantId: string, actor: string | null,
  original: typeof payments.$inferSelect, refundMinor: bigint,
  gateway: { transactionId: string; orderId: string }, receivedOn: string,
): Promise<{ id: string; reversedMinor: bigint; invoiceIds: string[] } | null> {
  const related = await tx.select().from(paymentAllocations)
    .where(inArray(paymentAllocations.paymentId, [original.id]));
  const reversals = await tx.select().from(payments).where(eq(payments.reversalOf, original.id));
  const reversalAllocs = reversals.length === 0 ? [] : await tx.select().from(paymentAllocations)
    .where(inArray(paymentAllocations.paymentId, reversals.map((r) => r.id)));
  // Net still-reversible allocations per invoice (original minus prior reversals).
  const net = new Map<string, bigint>();
  for (const a of [...related, ...reversalAllocs]) {
    net.set(a.invoiceId, (net.get(a.invoiceId) ?? 0n) + a.amountMinor);
  }
  const netAllocs = [...net.entries()]
    .filter(([, v]) => v > 0n)
    .map(([invoiceId, amountMinor]) => ({ invoiceId, amountMinor }));
  const plan = planReversalAllocations(netAllocs, refundMinor);
  if (plan.reversedMinor <= 0n) return null;
  const id = uuidv7();
  await tx.insert(payments).values({
    id, tenantId, debtorId: original.debtorId, invoiceId: original.invoiceId,
    amountMinor: -plan.reversedMinor, method: "gateway", receivedOn,
    referenceNo: gateway.transactionId, status: "confirmed", source: "gateway_webhook",
    gatewayTransactionId: gateway.transactionId, gatewayOrderId: gateway.orderId,
    reversalOf: original.id, confirmedBy: actor,
  });
  for (const a of plan.allocations) {
    await tx.insert(paymentAllocations).values({ tenantId, paymentId: id, invoiceId: a.invoiceId, amountMinor: a.amountMinor });
    await recomputeInvoicePaid(tx, tenantId, a.invoiceId);
  }
  await audit(tx, tenantId, actor, "payment.reversed", "payment", id, {
    reversalOf: original.id, reversedMinor: plan.reversedMinor.toString(),
  });
  return { id, reversedMinor: plan.reversedMinor, invoiceIds: plan.allocations.map((a) => a.invoiceId) };
}

/**
 * The Paymob webhook: HMAC first, inbox second, fulfilment last (ADR-019).
 * Throws AppError with status 503 (not configured), 400 (bad payload) or 401
 * (bad HMAC — nothing is stored in that case). Every verified callback,
 * including duplicates and ignores, is recorded in the webhook inbox.
 */
export async function handlePaymobCallback(
  deps: GatewayDeps, payload: unknown, receivedHmac: string | undefined, now: Date,
): Promise<WebhookOutcome> {
  if (!deps.hmacSecret) throw new AppError("WEBHOOK_NOT_CONFIGURED", "PAYMOB_HMAC_SECRET is not set", 503);
  const rawObj = (payload as { obj?: unknown } | null)?.obj;
  if (!rawObj || typeof rawObj !== "object") throw new AppError("BAD_PAYLOAD", "payload has no transaction object", 400);
  if (!verifyPaymobHmac(rawObj as PaymobTxnLike, receivedHmac, deps.hmacSecret)) {
    throw new AppError("BAD_HMAC", "HMAC verification failed", 401);
  }
  let cb: PaymobCallback;
  try {
    cb = parsePaymobCallback(payload);
  } catch {
    throw new AppError("BAD_PAYLOAD", "payload is not a valid Paymob transaction callback", 400);
  }

  // Inbox (platform-level, owner connection): identical redeliveries dedupe.
  await deps.owner.insert(webhookEvents).values({
    provider: "paymob",
    dedupeKey: `paymob:${cb.transactionId}:${cb.success}:${cb.isRefunded}:${cb.isVoided}:${cb.pending}`,
    payload: payload as Record<string, unknown>,
    processedAt: now,
  }).onConflictDoNothing();

  if (!cb.specialReference) return { outcome: "unmatched", reason: "no special_reference" };
  const [link] = await deps.owner.select().from(paymentLinks)
    .where(eq(paymentLinks.specialReference, cb.specialReference));
  if (!link) return { outcome: "unmatched", reason: "unknown special_reference" };
  const tenantId = link.tenantId;

  const result = await withTenant(deps.app, tenantId, async (tx): Promise<WebhookOutcome & { replan: string[] }> => {
    const [existing] = await tx.select().from(payments)
      .where(eq(payments.gatewayTransactionId, cb.transactionId));
    const decision = decideGatewayCallback(cb, {
      link: { amountMinor: link.amountMinor, status: link.status, expiresAt: link.expiresAt },
      now, txnAlreadyProcessed: Boolean(existing),
    });
    if (decision.action === "duplicate") return { outcome: "duplicate", replan: [] };

    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    const receivedOn = localDateOf(now, tenant?.timezone ?? "Africa/Cairo");

    if (decision.action === "ignore") {
      if (decision.reason === "amount_mismatch" && link.status === "pending") {
        await tx.update(paymentLinks).set({ status: "amount_mismatch", updatedAt: now })
          .where(eq(paymentLinks.id, link.id));
      }
      if (decision.reason === "link_expired" && link.status === "pending") {
        await tx.update(paymentLinks).set({ status: "expired", updatedAt: now })
          .where(eq(paymentLinks.id, link.id));
      }
      await audit(tx, tenantId, null, "payment_link.callback_ignored", "payment_link", link.id, {
        reason: decision.reason, transactionId: cb.transactionId,
      });
      return { outcome: "ignored", reason: decision.reason, replan: [] };
    }

    if (decision.action === "reverse") {
      let original: typeof payments.$inferSelect | undefined;
      if (link.paidPaymentId) {
        [original] = await tx.select().from(payments).where(eq(payments.id, link.paidPaymentId));
      }
      if (!original) {
        const byOrder = await tx.select().from(payments)
          .where(and(eq(payments.gatewayOrderId, cb.orderId), eq(payments.status, "confirmed"), isNull(payments.reversalOf)))
          .orderBy(desc(payments.createdAt));
        original = byOrder[0];
      }
      if (!original) return { outcome: "unmatched", reason: "reversal without an original payment", replan: [] };
      const reversal = await insertReversal(tx, tenantId, null, original, decision.amountMinor,
        { transactionId: cb.transactionId, orderId: cb.orderId }, receivedOn);
      if (!reversal) return { outcome: "duplicate", reason: "already fully reversed", replan: [] };
      return { outcome: "reversed", paymentId: reversal.id, replan: reversal.invoiceIds };
    }

    // fulfil: allocate the verified amount. The linked invoice is served
    // first; any remainder flows oldest-due-first over the debtor's other
    // open invoices, and whatever is left becomes credit (never negative).
    const invs = await tx.select().from(invoices).where(eq(invoices.debtorId, link.debtorId));
    const targets = invs.map((i) => ({
      invoiceId: i.id, amountMinor: i.amountMinor, paidMinor: i.paidMinor, dueOn: i.dueOn, status: i.status,
    }));
    const linked = link.invoiceId ? targets.filter((t) => t.invoiceId === link.invoiceId) : [];
    const others = link.invoiceId ? targets.filter((t) => t.invoiceId !== link.invoiceId) : targets;
    const first = allocatePayment(cb.amountMinor, linked);
    const second = allocatePayment(first.creditMinor, others);
    const allocations = [...first.allocations, ...second.allocations];
    const paymentId = uuidv7();
    await tx.insert(payments).values({
      id: paymentId, tenantId, debtorId: link.debtorId,
      invoiceId: allocations[0]?.invoiceId ?? link.invoiceId,
      amountMinor: cb.amountMinor, method: "gateway", receivedOn,
      referenceNo: cb.transactionId, status: "confirmed", source: "gateway_webhook",
      gatewayTransactionId: cb.transactionId, gatewayOrderId: cb.orderId,
    });
    for (const a of allocations) {
      await tx.insert(paymentAllocations).values({ tenantId, paymentId, invoiceId: a.invoiceId, amountMinor: a.amountMinor });
    }
    for (const a of allocations) await recomputeInvoicePaid(tx, tenantId, a.invoiceId);
    await tx.update(paymentLinks).set({ status: "paid", paidPaymentId: paymentId, updatedAt: now })
      .where(eq(paymentLinks.id, link.id));
    await audit(tx, tenantId, null, "payment.gateway_confirmed", "payment", paymentId, {
      amountMinor: cb.amountMinor.toString(), transactionId: cb.transactionId,
      allocations: allocations.length, creditMinor: second.creditMinor.toString(),
    });
    return { outcome: "fulfilled", paymentId, replan: allocations.map((a) => a.invoiceId) };
  });

  for (const invoiceId of result.replan) replanLater(tenantId, invoiceId);
  return { outcome: result.outcome, reason: result.reason, paymentId: result.paymentId };
}

// ------------------------------------------------------------------- refunds
export const refundInput = z.object({
  paymentId: z.string().uuid(),
  amount: z.string().trim().min(1).optional(), // EGP decimal string; omitted = refund everything remaining
});
export type RefundInputType = z.infer<typeof refundInput>;

/** Merchant-initiated refund: provider first (money moves there), reversal row second, only on provider success. */
export async function refundGatewayPayment(
  deps: GatewayDeps, tenantId: string, actor: string, input: RefundInputType,
): Promise<{ reversalId: string; reversedMinor: string }> {
  const snapshot = await withTenant(deps.app, tenantId, async (tx) => {
    const [payment] = await tx.select().from(payments).where(eq(payments.id, input.paymentId));
    if (!payment) throw new AppError("NOT_FOUND", "Payment not found", 404);
    if (payment.method !== "gateway" || payment.status !== "confirmed" || payment.reversalOf !== null || !payment.gatewayTransactionId) {
      throw new AppError("NOT_REFUNDABLE", "Only a confirmed gateway payment can be refunded", 400);
    }
    const reversals = await tx.select().from(payments).where(eq(payments.reversalOf, payment.id));
    const already = reversals.reduce((s, r) => s - r.amountMinor, 0n);
    const remaining = payment.amountMinor - already;
    const amount = input.amount !== undefined ? parseEgp(input.amount) : remaining;
    if (amount <= 0n || amount > remaining) {
      throw new AppError("INVALID_REFUND", "Refund amount must be positive and no more than the un-refunded remainder", 400);
    }
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    return { payment, amount, receivedOn: localDateOf(new Date(), tenant?.timezone ?? "Africa/Cairo") };
  });

  const { refundTransactionId } = await deps.provider.refundPayment({
    transactionId: snapshot.payment.gatewayTransactionId!, amountMinor: snapshot.amount,
  });

  const written = await withTenant(deps.app, tenantId, async (tx) => {
    const reversal = await insertReversal(tx, tenantId, actor, snapshot.payment, snapshot.amount,
      { transactionId: refundTransactionId, orderId: snapshot.payment.gatewayOrderId ?? "" }, snapshot.receivedOn);
    if (!reversal) throw new AppError("INVALID_REFUND", "Nothing left to refund", 409);
    await audit(tx, tenantId, actor, "payment.refunded", "payment", reversal.id, {
      originalPaymentId: snapshot.payment.id, refundTransactionId,
    });
    return reversal;
  });
  for (const invoiceId of written.invoiceIds) replanLater(tenantId, invoiceId);
  return { reversalId: written.id, reversedMinor: written.reversedMinor.toString() };
}

// ------------------------------------------------- claimed payment lifecycle
/** Confirm a claimed payment (e.g. from receipt AI, M4): allocate it (stored allocations win; otherwise auto-allocate) and settle. */
export async function confirmClaimedPayment(app: Db, tenantId: string, actor: string, paymentId: string): Promise<void> {
  const invoiceIds = await withTenant(app, tenantId, async (tx) => {
    const [payment] = await tx.select().from(payments).where(eq(payments.id, paymentId));
    if (!payment) throw new AppError("NOT_FOUND", "Payment not found", 404);
    if (payment.status !== "claimed") throw new AppError("INVALID_STATE", `Payment is ${payment.status}, not claimed`, 409);
    const existing = await tx.select().from(paymentAllocations).where(eq(paymentAllocations.paymentId, paymentId));
    let affected = existing.map((a) => a.invoiceId);
    if (existing.length === 0) {
      const invs = await tx.select().from(invoices).where(eq(invoices.debtorId, payment.debtorId));
      const plan = allocatePayment(payment.amountMinor, invs.map((i) => ({
        invoiceId: i.id, amountMinor: i.amountMinor, paidMinor: i.paidMinor, dueOn: i.dueOn, status: i.status,
      })));
      for (const a of plan.allocations) {
        await tx.insert(paymentAllocations).values({ tenantId, paymentId, invoiceId: a.invoiceId, amountMinor: a.amountMinor });
      }
      affected = plan.allocations.map((a) => a.invoiceId);
    }
    await tx.update(payments).set({ status: "confirmed", confirmedBy: actor, updatedAt: new Date() })
      .where(eq(payments.id, paymentId));
    for (const id of affected) await recomputeInvoicePaid(tx, tenantId, id);
    await audit(tx, tenantId, actor, "payment.confirmed", "payment", paymentId, { amountMinor: payment.amountMinor.toString() });
    return affected;
  });
  for (const id of invoiceIds) replanLater(tenantId, id);
}

/** Reject a claimed payment: it never counted toward any balance, so nothing recomputes. */
export async function rejectClaimedPayment(app: Db, tenantId: string, actor: string, paymentId: string): Promise<void> {
  await withTenant(app, tenantId, async (tx) => {
    const [payment] = await tx.select().from(payments).where(eq(payments.id, paymentId));
    if (!payment) throw new AppError("NOT_FOUND", "Payment not found", 404);
    if (payment.status !== "claimed") throw new AppError("INVALID_STATE", `Payment is ${payment.status}, not claimed`, 409);
    await tx.update(payments).set({ status: "rejected", confirmedBy: actor, updatedAt: new Date() })
      .where(eq(payments.id, paymentId));
    await audit(tx, tenantId, actor, "payment.rejected", "payment", paymentId, { amountMinor: payment.amountMinor.toString() });
  });
}

// ------------------------------------------------------------- reconciliation
export interface ReconciliationView {
  gatewayTotalMinor: string;
  confirmedGatewayPayments: number;
  paidLinks: number;
  balanced: boolean;
  discrepancies: { kind: string; id: string; detail: string }[];
}

/** F5 acceptance: the report's gateway total IS the sum of confirmed gateway payments; discrepancies flag any link/payment drift. */
export async function getReconciliation(app: Db, tenantId: string): Promise<ReconciliationView> {
  return withTenant(app, tenantId, async (tx) => {
    const pays = await tx.select().from(payments);
    const links = await tx.select().from(paymentLinks);
    const report = reconcileGateway(
      pays.map((p) => ({
        id: p.id, amountMinor: p.amountMinor, status: p.status,
        gatewayTransactionId: p.gatewayTransactionId, reversalOf: p.reversalOf,
      })),
      links.map((l) => ({ id: l.id, status: l.status, amountMinor: l.amountMinor, paidPaymentId: l.paidPaymentId })),
    );
    return {
      gatewayTotalMinor: report.gatewayTotalMinor.toString(),
      confirmedGatewayPayments: report.confirmedGatewayPayments,
      paidLinks: report.paidLinks,
      balanced: report.balanced,
      discrepancies: report.discrepancies,
    };
  });
}
