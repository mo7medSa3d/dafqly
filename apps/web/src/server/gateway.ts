import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  AppError, allocatePayment, decideGatewayCallback, localDateOf, outstandingForLink,
  parseMoney, parsePaymobCallback, planReversalAllocations, redactPaymobPayload,
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
import { lockDebtorInvoices, lockInvoicesById, recomputeDebtorCredit, recomputeInvoicePaid } from "./ledger";
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
  /** M8: a retried call with the same key returns the original link. */
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});
export type CreateGatewayLinkInput = z.infer<typeof createGatewayLinkInput>;

export interface PaymentLinkView {
  id: string; debtorId: string; invoiceId: string | null;
  amountMinor: string; checkoutUrl: string; status: string; expiresAt: string;
  specialReference: string;
  /** "paymob" = real checkout, "fake" = simulated link (F-02: the UI must
   * label these SIMULATED so nobody mistakes a demo link for real money). */
  provider: "paymob" | "fake";
}

function toPaymentLinkView(row: typeof paymentLinks.$inferSelect): PaymentLinkView {
  return {
    id: row.id, debtorId: row.debtorId, invoiceId: row.invoiceId,
    amountMinor: row.amountMinor.toString(), checkoutUrl: row.checkoutUrl,
    status: row.status, expiresAt: row.expiresAt.toISOString(),
    provider: row.provider === "paymob" ? "paymob" : "fake",
    // The merchant's own correlation reference (Paymob shows it as the
    // order's merchant_order_id) — needed for support reconciliation.
    specialReference: row.specialReference,
  };
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

  // M8: replay — the same key returns the original link, no new intention.
  if (input.idempotencyKey) {
    const replay = await withTenant(deps.app, tenantId, async (tx) => {
      const [row] = await tx.select().from(paymentLinks)
        .where(and(eq(paymentLinks.tenantId, tenantId), eq(paymentLinks.idempotencyKey, input.idempotencyKey!)));
      return row ?? null;
    });
    if (replay) return toPaymentLinkView(replay);
  }

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

  try {
    return await withTenant(deps.app, tenantId, async (tx) => {
      // H12: re-price inside the insert tx with the invoices locked — the
      // outstanding may have moved while the provider call was in flight.
      // A stale price fails closed (409 PRICE_CHANGED) instead of minting
      // a link for the wrong amount; the intention simply expires unused.
      const locked = await lockDebtorInvoices(tx, input.debtorId);
      const targets = locked.map((i) => ({
        id: i.id, amountMinor: i.amountMinor, paidMinor: i.paidMinor, dueOn: i.dueOn, status: i.status,
      }));
      const current = outstandingForLink(targets, input.invoiceId ?? null);
      if (current !== priced.amountMinor) {
        throw new AppError("PRICE_CHANGED", "The amount due changed while the link was being created; please try again", 409);
      }
      const values = {
        tenantId, debtorId: input.debtorId, invoiceId: input.invoiceId ?? null,
        amountMinor: priced.amountMinor, currency: "EGP",
        provider: deps.provider instanceof PaymobProvider ? "paymob" : "fake",
        specialReference: reference, providerIntentionId: created.transactionId,
        checkoutUrl: created.url, status: "pending" as const, expiresAt: created.expiresAt,
        idempotencyKey: input.idempotencyKey ?? null,
      };
      const inserted = input.idempotencyKey
        ? await tx.insert(paymentLinks).values(values)
          .onConflictDoNothing({ target: [paymentLinks.tenantId, paymentLinks.idempotencyKey] }).returning()
        : await tx.insert(paymentLinks).values(values).returning();
      let row = inserted[0];
      if (!row && input.idempotencyKey) {
        // A concurrent identical request won the race — return its link.
        [row] = await tx.select().from(paymentLinks)
          .where(and(eq(paymentLinks.tenantId, tenantId), eq(paymentLinks.idempotencyKey, input.idempotencyKey)));
        if (row) return toPaymentLinkView(row);
        throw new AppError("CONFLICT", "Payment link creation conflicted; please retry", 409);
      }
      await audit(tx, tenantId, actor, "payment_link.created", "payment_link", row!.id, {
        amountMinor: priced.amountMinor.toString(), invoiceId: input.invoiceId ?? null,
      });
      return toPaymentLinkView(row!);
    });
  } catch (err) {
    if (err instanceof AppError && err.code === "PRICE_CHANGED") {
      // The provider intention exists but is unused (it expires); record it
      // so support can trace it, then fail closed.
      await withTenant(deps.app, tenantId, async (tx) => {
        await audit(tx, tenantId, actor, "payment_link.price_changed", "payment_link", reference, {
          amountMinor: priced.amountMinor.toString(), providerIntentionId: created.transactionId,
        });
      }).catch(() => undefined);
    }
    throw err;
  }
}

export async function listPaymentLinks(app: Db, tenantId: string, debtorId: string): Promise<PaymentLinkView[]> {
  return withTenant(app, tenantId, async (tx) => {
    const rows = await tx.select().from(paymentLinks)
      .where(eq(paymentLinks.debtorId, debtorId)).orderBy(desc(paymentLinks.createdAt));
    return rows.map(toPaymentLinkView);
  });
}

// ------------------------------------------------------------------ webhook
export interface WebhookOutcome {
  outcome: "fulfilled" | "duplicate" | "reversed" | "ignored" | "unmatched";
  reason?: string;
  paymentId?: string;
}

interface ReversalPlan {
  allocations: { invoiceId: string; amountMinor: bigint }[];
  reversedMinor: bigint;
}

/**
 * Plan a reversal against the still-reversible allocations of an original
 * payment. Only live reversals count: a rejected refund intent never moved
 * money, so its (already deleted or never-counted) allocations must not
 * reduce the net. The affected invoices are locked (F01) before planning.
 */
async function loadReversalPlan(tx: Db, original: typeof payments.$inferSelect, refundMinor: bigint): Promise<ReversalPlan | null> {
  const related = await tx.select().from(paymentAllocations)
    .where(eq(paymentAllocations.paymentId, original.id));
  const reversals = await tx.select().from(payments)
    .where(and(eq(payments.reversalOf, original.id), ne(payments.status, "rejected")));
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
  await lockInvoicesById(tx, netAllocs.map((a) => a.invoiceId));
  const plan = planReversalAllocations(netAllocs, refundMinor);
  if (plan.reversedMinor <= 0n) return null;
  return plan;
}

async function insertReversal(
  tx: Db, tenantId: string, actor: string | null,
  original: typeof payments.$inferSelect, refundMinor: bigint,
  gateway: { transactionId: string; orderId: string }, receivedOn: string,
): Promise<{ id: string; reversedMinor: bigint; invoiceIds: string[] } | null> {
  const plan = await loadReversalPlan(tx, original, refundMinor);
  if (!plan) return null;
  const id = uuidv7();
  await tx.insert(payments).values({
    id, tenantId, debtorId: original.debtorId, invoiceId: original.invoiceId,
    amountMinor: -plan.reversedMinor, currency: original.currency, method: "gateway", receivedOn,
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
  // M3: store the redacted payload — source_data (masked PAN) never persists.
  await deps.owner.insert(webhookEvents).values({
    provider: "paymob",
    dedupeKey: `paymob:${cb.transactionId}:${cb.success}:${cb.isRefunded}:${cb.isVoided}:${cb.pending}`,
    payload: redactPaymobPayload(payload) as Record<string, unknown>,
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
    // F01: lock the debtor's invoices before allocating.
    const invs = await lockDebtorInvoices(tx, link.debtorId);
    const targets = invs.map((i) => ({
      invoiceId: i.id, amountMinor: i.amountMinor, paidMinor: i.paidMinor, dueOn: i.dueOn, status: i.status,
    }));
    const linked = link.invoiceId ? targets.filter((t) => t.invoiceId === link.invoiceId) : [];
    const others = link.invoiceId ? targets.filter((t) => t.invoiceId !== link.invoiceId) : targets;
    const first = allocatePayment(cb.amountMinor, linked);
    const second = allocatePayment(first.creditMinor, others);
    const allocations = [...first.allocations, ...second.allocations];
    const paymentId = uuidv7();
    // H03: a concurrent duplicate callback can pass the txnAlreadyProcessed
    // check above; the per-tenant unique index is the arbiter — a 0-row
    // insert means the twin won, and this delivery is a duplicate, not a 500.
    const inserted = await tx.insert(payments).values({
      id: paymentId, tenantId, debtorId: link.debtorId,
      invoiceId: allocations[0]?.invoiceId ?? link.invoiceId,
      amountMinor: cb.amountMinor, currency: "EGP", method: "gateway", receivedOn,
      referenceNo: cb.transactionId, status: "confirmed", source: "gateway_webhook",
      gatewayTransactionId: cb.transactionId, gatewayOrderId: cb.orderId,
    }).onConflictDoNothing({ target: [payments.tenantId, payments.gatewayTransactionId] })
      .returning({ id: payments.id });
    if (inserted.length === 0) return { outcome: "duplicate", replan: [] };
    for (const a of allocations) {
      await tx.insert(paymentAllocations).values({ tenantId, paymentId, invoiceId: a.invoiceId, amountMinor: a.amountMinor });
    }
    for (const a of allocations) await recomputeInvoicePaid(tx, tenantId, a.invoiceId);
    // F05: a fulfilment with no open invoice left is pure credit — the
    // per-invoice recompute above never runs, so recompute explicitly.
    if (allocations.length === 0) await recomputeDebtorCredit(tx, tenantId, link.debtorId);
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

/**
 * Merchant-initiated refund, intent-first (H3 outbox pattern):
 * 1. Tx1 — lock the original payment FOR UPDATE, validate the remainder
 *    (live reversals only: claimed + confirmed count, rejected do not),
 *    plan the reversal and write the reversal row + its allocations as
 *    CLAIMED. The allocations reserve the per-invoice amounts, but
 *    `recomputeInvoicePaid` only counts CONFIRMED payments, so no balance
 *    moves yet. A concurrent refund sees this intent and gets 409.
 * 2. Provider refund with idempotency key `refund:<intent id>`.
 * 3. Tx2 — flip the row to CONFIRMED, store the provider transaction id,
 *    and recompute the invoices (balances move only now).
 * If the provider call fails, the intent is marked REJECTED (and its
 * allocations deleted) so the amount is refundable again. If the process
 * crashes between 2 and 3, the CLAIMED intent stays visible in
 * reconciliation; an owner confirms it with the provider's refund
 * transaction id (`confirmRefundIntent`) or rejects it only after
 * verifying with the provider that no refund went through.
 */
export async function refundGatewayPayment(
  deps: GatewayDeps, tenantId: string, actor: string, input: RefundInputType,
): Promise<{ reversalId: string; reversedMinor: string }> {
  const intent = await withTenant(deps.app, tenantId, async (tx) => {
    const [payment] = await tx.select().from(payments).where(eq(payments.id, input.paymentId)).for("update");
    if (!payment) throw new AppError("NOT_FOUND", "Payment not found", 404);
    if (payment.method !== "gateway" || payment.status !== "confirmed" || payment.reversalOf !== null || !payment.gatewayTransactionId) {
      throw new AppError("NOT_REFUNDABLE", "Only a confirmed gateway payment can be refunded", 400);
    }
    const reversals = await tx.select().from(payments)
      .where(and(eq(payments.reversalOf, payment.id), ne(payments.status, "rejected")));
    const already = reversals.reduce((s, r) => s - r.amountMinor, 0n);
    const remaining = payment.amountMinor - already;
    // F-06: refund amounts parse in the payment's own currency.
    const amount = input.amount !== undefined ? parseMoney(input.amount, payment.currency) : remaining;
    if (amount <= 0n || amount > remaining) {
      throw new AppError("INVALID_REFUND", "Refund amount must be positive and no more than the un-refunded remainder", 400);
    }
    const plan = await loadReversalPlan(tx, payment, amount);
    if (!plan) throw new AppError("INVALID_REFUND", "Nothing left to refund", 409);
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    const receivedOn = localDateOf(new Date(), tenant?.timezone ?? "Africa/Cairo");
    const id = uuidv7();
    await tx.insert(payments).values({
      id, tenantId, debtorId: payment.debtorId, invoiceId: payment.invoiceId,
      amountMinor: -plan.reversedMinor, currency: payment.currency, method: "gateway", receivedOn,
      referenceNo: null, status: "claimed", source: "gateway_webhook",
      gatewayTransactionId: null, gatewayOrderId: payment.gatewayOrderId ?? null,
      reversalOf: payment.id, confirmedBy: actor,
    });
    for (const a of plan.allocations) {
      await tx.insert(paymentAllocations).values({ tenantId, paymentId: id, invoiceId: a.invoiceId, amountMinor: a.amountMinor });
    }
    await audit(tx, tenantId, actor, "payment.refund_intended", "payment", id, {
      reversalOf: payment.id, reversedMinor: plan.reversedMinor.toString(),
    });
    return { id, plan, payment, receivedOn };
  });

  let refundTransactionId: string;
  try {
    ({ refundTransactionId } = await deps.provider.refundPayment({
      transactionId: intent.payment.gatewayTransactionId!, amountMinor: intent.plan.reversedMinor,
      idempotencyKey: `refund:${intent.id}`,
    }));
  } catch (err) {
    // Money never moved: release the claim so the amount is refundable again.
    await withTenant(deps.app, tenantId, async (tx) => {
      await tx.delete(paymentAllocations).where(eq(paymentAllocations.paymentId, intent.id));
      await tx.update(payments).set({ status: "rejected", updatedAt: new Date() }).where(eq(payments.id, intent.id));
      await audit(tx, tenantId, actor, "payment.refund_failed", "payment", intent.id, {
        reversalOf: intent.payment.id, error: err instanceof Error ? err.message : "provider refund failed",
      });
    }).catch(() => { /* the claimed intent stays for reconciliation */ });
    throw err;
  }

  const written = await withTenant(deps.app, tenantId, async (tx) => {
    const [row] = await tx.select().from(payments).where(eq(payments.id, intent.id));
    if (!row || row.status !== "claimed") throw new AppError("INVALID_REFUND", "Refund intent is no longer pending", 409);
    await tx.update(payments).set({
      status: "confirmed", gatewayTransactionId: refundTransactionId, updatedAt: new Date(),
    }).where(eq(payments.id, intent.id));
    for (const a of intent.plan.allocations) await recomputeInvoicePaid(tx, tenantId, a.invoiceId);
    await audit(tx, tenantId, actor, "payment.refunded", "payment", intent.id, {
      originalPaymentId: intent.payment.id, refundTransactionId,
    });
    return { id: intent.id, reversedMinor: intent.plan.reversedMinor, invoiceIds: intent.plan.allocations.map((a) => a.invoiceId) };
  });
  for (const invoiceId of written.invoiceIds) replanLater(tenantId, invoiceId);
  return { reversalId: written.id, reversedMinor: written.reversedMinor.toString() };
}

/**
 * Crash recovery for a CLAIMED refund intent whose provider call succeeded
 * but whose confirmation never committed: the owner supplies the provider's
 * refund transaction id (verified against the provider dashboard/API) and
 * the intent is confirmed — balances move only now.
 */
export async function confirmRefundIntent(
  app: Db, tenantId: string, actor: string, reversalId: string, refundTransactionId: string,
): Promise<{ reversalId: string; reversedMinor: string }> {
  const result = await withTenant(app, tenantId, async (tx) => {
    const [row] = await tx.select().from(payments).where(eq(payments.id, reversalId));
    if (!row || row.reversalOf === null) throw new AppError("NOT_FOUND", "Refund intent not found", 404);
    if (row.status !== "claimed") throw new AppError("INVALID_REFUND", "Refund intent is no longer pending", 409);
    const allocs = await tx.select().from(paymentAllocations).where(eq(paymentAllocations.paymentId, reversalId));
    await tx.update(payments).set({
      status: "confirmed", gatewayTransactionId: refundTransactionId, updatedAt: new Date(),
    }).where(eq(payments.id, reversalId));
    for (const a of allocs) await recomputeInvoicePaid(tx, tenantId, a.invoiceId);
    await audit(tx, tenantId, actor, "payment.refunded", "payment", reversalId, {
      originalPaymentId: row.reversalOf, refundTransactionId, recovered: true,
    });
    return { reversalId, reversedMinor: (-row.amountMinor).toString(), invoiceIds: allocs.map((a) => a.invoiceId) };
  });
  for (const invoiceId of result.invoiceIds) replanLater(tenantId, invoiceId);
  return { reversalId: result.reversalId, reversedMinor: result.reversedMinor };
}

/**
 * Release a CLAIMED refund intent whose provider call is KNOWN not to have
 * moved money (provider error, or verified with the provider). The amount
 * becomes refundable again. Never call this for an intent whose provider
 * outcome is unknown — confirm it instead.
 */
export async function rejectRefundIntent(
  app: Db, tenantId: string, actor: string, reversalId: string,
): Promise<void> {
  await withTenant(app, tenantId, async (tx) => {
    const [row] = await tx.select().from(payments).where(eq(payments.id, reversalId));
    if (!row || row.reversalOf === null) throw new AppError("NOT_FOUND", "Refund intent not found", 404);
    if (row.status !== "claimed") throw new AppError("INVALID_REFUND", "Refund intent is no longer pending", 409);
    await tx.delete(paymentAllocations).where(eq(paymentAllocations.paymentId, reversalId));
    await tx.update(payments).set({ status: "rejected", updatedAt: new Date() }).where(eq(payments.id, reversalId));
    await audit(tx, tenantId, actor, "payment.refund_rejected", "payment", reversalId, {
      reversalOf: row.reversalOf,
    });
  });
}

// ------------------------------------------------- claimed payment lifecycle
/**
 * Confirm a claimed payment inside an existing transaction (F06: the
 * cheque-clear path calls this inline so the cheque status flip and the
 * payment confirmation commit or roll back together).
 *
 * Stored allocations win, but they are re-validated first (H13): a
 * deposit-time cap can exceed the invoice's CURRENT outstanding when
 * another payment landed in between — the excess is trimmed (or the row
 * dropped when nothing is outstanding anymore), never confirmed over
 * the invoice. With no stored allocations the payment auto-allocates,
 * consuming same-currency stored credit first (F05).
 */
export async function confirmClaimedPaymentInTx(tx: Db, tenantId: string, actor: string, paymentId: string): Promise<string[]> {
  const [payment] = await tx.select().from(payments).where(eq(payments.id, paymentId));
  if (!payment) throw new AppError("NOT_FOUND", "Payment not found", 404);
  if (payment.status !== "claimed") throw new AppError("INVALID_STATE", `Payment is ${payment.status}, not claimed`, 409);
  const existing = await tx.select().from(paymentAllocations).where(eq(paymentAllocations.paymentId, paymentId));
  let affected = existing.map((a) => a.invoiceId);
  if (existing.length > 0) {
    // H13: re-validate stored allocations against current outstanding.
    const locked = await lockInvoicesById(tx, affected);
    const byId = new Map(locked.map((i) => [i.id, i]));
    for (const a of existing) {
      const inv = byId.get(a.invoiceId);
      const outstanding = inv ? inv.amountMinor - inv.paidMinor : 0n;
      const capped = a.amountMinor < outstanding ? a.amountMinor : outstanding;
      if (capped <= 0n) {
        await tx.delete(paymentAllocations).where(and(eq(paymentAllocations.paymentId, paymentId), eq(paymentAllocations.invoiceId, a.invoiceId)));
        affected = affected.filter((id) => id !== a.invoiceId);
      } else if (capped !== a.amountMinor) {
        await tx.update(paymentAllocations).set({ amountMinor: capped })
          .where(and(eq(paymentAllocations.paymentId, paymentId), eq(paymentAllocations.invoiceId, a.invoiceId)));
      }
    }
  } else {
    // F01: lock before auto-allocating; F05: consume same-currency credit.
    const invs = await lockDebtorInvoices(tx, payment.debtorId);
    const [debtor] = await tx.select({ creditMinor: debtors.creditMinor, creditCurrency: debtors.creditCurrency })
      .from(debtors).where(eq(debtors.id, payment.debtorId));
    let effective = payment.amountMinor;
    if (debtor && debtor.creditMinor > 0n && debtor.creditCurrency === payment.currency) {
      effective = payment.amountMinor + debtor.creditMinor;
    }
    const plan = allocatePayment(effective, invs.map((i) => ({
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
  if (affected.length === 0) await recomputeDebtorCredit(tx, tenantId, payment.debtorId);
  await audit(tx, tenantId, actor, "payment.confirmed", "payment", paymentId, { amountMinor: payment.amountMinor.toString() });
  return affected;
}

/** Confirm a claimed payment (e.g. from receipt AI, M4): allocate it (stored allocations win; otherwise auto-allocate) and settle. */
export async function confirmClaimedPayment(app: Db, tenantId: string, actor: string, paymentId: string): Promise<void> {
  const invoiceIds = await withTenant(app, tenantId, async (tx) => confirmClaimedPaymentInTx(tx, tenantId, actor, paymentId));
  for (const id of invoiceIds) replanLater(tenantId, id);
}

/** Reject a claimed payment inside an existing transaction (see F06). */
export async function rejectClaimedPaymentInTx(tx: Db, tenantId: string, actor: string, paymentId: string): Promise<void> {
  const [payment] = await tx.select().from(payments).where(eq(payments.id, paymentId));
  if (!payment) throw new AppError("NOT_FOUND", "Payment not found", 404);
  if (payment.status !== "claimed") throw new AppError("INVALID_STATE", `Payment is ${payment.status}, not claimed`, 409);
  await tx.update(payments).set({ status: "rejected", confirmedBy: actor, updatedAt: new Date() })
    .where(eq(payments.id, paymentId));
  await audit(tx, tenantId, actor, "payment.rejected", "payment", paymentId, { amountMinor: payment.amountMinor.toString() });
}

/** Reject a claimed payment: it never counted toward any balance, so nothing recomputes. */
export async function rejectClaimedPayment(app: Db, tenantId: string, actor: string, paymentId: string): Promise<void> {
  await withTenant(app, tenantId, async (tx) => { await rejectClaimedPaymentInTx(tx, tenantId, actor, paymentId); });
}

// ------------------------------------------------------------- reconciliation
export interface ReconciliationView {
  gatewayTotalMinor: string;
  confirmedGatewayPayments: number;
  paidLinks: number;
  balanced: boolean;
  discrepancies: { kind: string; id: string; detail: string }[];
  /** H3: refund intents stuck in CLAIMED (provider call succeeded but the
   * confirmation never committed, or the outcome is unknown). They are NOT
   * discrepancies — they are work waiting for an owner to confirm (with the
   * provider's refund transaction id) or reject (only after verifying with
   * the provider that no refund went through). */
  pendingRefunds: { id: string; amountMinor: string; originalPaymentId: string; createdAt: string }[];
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
      pendingRefunds: pays
        .filter((p) => p.status === "claimed" && p.reversalOf !== null && p.method === "gateway")
        .map((p) => ({
          id: p.id, amountMinor: (-p.amountMinor).toString(),
          originalPaymentId: p.reversalOf!, createdAt: p.createdAt.toISOString(),
        })),
    };
  });
}
