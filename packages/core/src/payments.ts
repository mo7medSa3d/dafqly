import { z } from "zod";
import type { InvoiceStatus } from "./invoices";

/**
 * Payments domain logic for F5 (gateway) and F10 (statement links)
 * (BUILD_PLAN §7-F5/F10, ADR-019/020). Pure decisions only — all IO (Paymob
 * HTTP, DB writes) lives in providers/web services. Money is bigint minor
 * units throughout.
 */

// ------------------------------------------------------------- Paymob HMAC
/**
 * The 20 transaction fields Paymob signs, in the documented order (ADR-019).
 * Booleans concatenate as lowercase "true"/"false"; there is no separator.
 */
export interface PaymobTxnLike {
  amount_cents: number | string;
  created_at: string;
  currency: string;
  error_occured: boolean;
  has_parent_transaction: boolean;
  id: number | string;
  integration_id: number | string;
  is_3d_secure: boolean;
  is_auth: boolean;
  is_capture: boolean;
  is_refunded: boolean;
  is_standalone_payment: boolean;
  is_voided: boolean;
  order: { id: number | string };
  owner: number | string;
  pending: boolean;
  source_data: { pan: string; sub_type: string; type: string };
  success: boolean;
}

const fieldString = (v: unknown): string => (typeof v === "boolean" ? (v ? "true" : "false") : String(v));

export function paymobHmacMessage(obj: PaymobTxnLike): string {
  const fields: unknown[] = [
    obj.amount_cents, obj.created_at, obj.currency, obj.error_occured,
    obj.has_parent_transaction, obj.id, obj.integration_id, obj.is_3d_secure,
    obj.is_auth, obj.is_capture, obj.is_refunded, obj.is_standalone_payment,
    obj.is_voided, obj.order.id, obj.owner, obj.pending,
    obj.source_data.pan, obj.source_data.sub_type, obj.source_data.type, obj.success,
  ];
  return fields.map(fieldString).join("");
}

/**
 * The compute/verify side of this HMAC lives in `./payments-crypto`
 * (server-only `node:crypto`, kept out of the client-safe barrel).
 */

// ------------------------------------------------------- callback parsing
const boolWithDefault = z.boolean().default(false);
export const paymobTransactionSchema = z.object({
  amount_cents: z.coerce.number().int().nonnegative(),
  created_at: z.string().min(1),
  currency: z.string().min(1).default("EGP"),
  error_occured: boolWithDefault,
  has_parent_transaction: boolWithDefault,
  id: z.union([z.number(), z.string()]),
  integration_id: z.union([z.number(), z.string()]).default(0),
  is_3d_secure: boolWithDefault,
  is_auth: boolWithDefault,
  is_capture: boolWithDefault,
  is_refunded: boolWithDefault,
  is_standalone_payment: boolWithDefault,
  is_voided: boolWithDefault,
  order: z.object({
    id: z.union([z.number(), z.string()]),
    merchant_order_id: z.string().optional(),
  }),
  owner: z.union([z.number(), z.string()]).default(0),
  pending: boolWithDefault,
  source_data: z.object({
    pan: z.string().default(""),
    sub_type: z.string().default(""),
    type: z.string().default(""),
  }).default({ pan: "", sub_type: "", type: "" }),
  success: boolWithDefault,
});

export const paymobCallbackSchema = z.object({
  type: z.string().optional(),
  obj: paymobTransactionSchema,
});

export interface PaymobCallback {
  transactionId: string;
  orderId: string;
  /** Our payment link's special_reference, echoed as order.merchant_order_id. */
  specialReference: string | null;
  amountMinor: bigint;
  currency: string;
  success: boolean;
  pending: boolean;
  errorOccured: boolean;
  isAuth: boolean;
  isCapture: boolean;
  isRefunded: boolean;
  isVoided: boolean;
  /** The raw signed transaction object (kept for HMAC + audit). */
  raw: PaymobTxnLike;
}

export function parsePaymobCallback(payload: unknown): PaymobCallback {
  const parsed = paymobCallbackSchema.parse(payload);
  const o = parsed.obj;
  return {
    transactionId: String(o.id),
    orderId: String(o.order.id),
    specialReference: o.order.merchant_order_id ?? null,
    amountMinor: BigInt(o.amount_cents),
    currency: o.currency,
    success: o.success,
    pending: o.pending,
    errorOccured: o.error_occured,
    isAuth: o.is_auth,
    isCapture: o.is_capture,
    isRefunded: o.is_refunded,
    isVoided: o.is_voided,
    raw: o as PaymobTxnLike,
  };
}

// ------------------------------------------------------ callback decision
export interface GatewayLinkContext {
  amountMinor: bigint;
  status: string; // pending | paid | expired | failed | amount_mismatch
  expiresAt: Date;
}

export type GatewayDecision =
  | { action: "fulfil" }
  | { action: "reverse"; reason: "refund" | "void"; amountMinor: bigint }
  | { action: "duplicate" }
  | { action: "ignore"; reason: "failed" | "pending" | "auth_only" | "amount_mismatch" | "link_expired" };

/**
 * What a verified callback should do. Order matters: replay first (a replay
 * must be a no-op even if the world changed since), then reversals, then the
 * never-fulfil guards (failed / pending / auth-only), then the money-safety
 * guards (amount mismatch, expired link). The browser redirect is never an
 * input here — the verified callback is the only source of truth (ADR-019).
 */
export function decideGatewayCallback(
  cb: PaymobCallback,
  ctx: { link: GatewayLinkContext; now: Date; txnAlreadyProcessed: boolean },
): GatewayDecision {
  if (ctx.txnAlreadyProcessed) return { action: "duplicate" };
  if (cb.isRefunded) return { action: "reverse", reason: "refund", amountMinor: cb.amountMinor };
  if (cb.isVoided) return { action: "reverse", reason: "void", amountMinor: cb.amountMinor };
  if (!cb.success || cb.errorOccured) return { action: "ignore", reason: "failed" };
  if (cb.pending) return { action: "ignore", reason: "pending" };
  if (cb.isAuth && !cb.isCapture) return { action: "ignore", reason: "auth_only" };
  if (cb.amountMinor !== ctx.link.amountMinor) return { action: "ignore", reason: "amount_mismatch" };
  if (ctx.link.status !== "paid" && ctx.now.getTime() > ctx.link.expiresAt.getTime()) {
    return { action: "ignore", reason: "link_expired" };
  }
  return { action: "fulfil" };
}

// ---------------------------------------------------------------- reversals
export interface OriginalAllocation {
  invoiceId: string;
  amountMinor: bigint;
}

export interface ReversalPlan {
  /** Negative allocations mirroring the original payment, oldest first. */
  allocations: { invoiceId: string; amountMinor: bigint }[];
  reversedMinor: bigint;
}

/** Plan a refund/chargeback reversal: negate the original allocations in order, capped at what was allocated. */
export function planReversalAllocations(
  original: readonly OriginalAllocation[],
  refundMinor: bigint,
): ReversalPlan {
  if (refundMinor <= 0n) return { allocations: [], reversedMinor: 0n };
  let remaining = refundMinor;
  const allocations: ReversalPlan["allocations"] = [];
  for (const a of original) {
    if (remaining <= 0n) break;
    if (a.amountMinor <= 0n) continue;
    const take = a.amountMinor < remaining ? a.amountMinor : remaining;
    allocations.push({ invoiceId: a.invoiceId, amountMinor: -take });
    remaining -= take;
  }
  return { allocations, reversedMinor: refundMinor - remaining };
}

// ------------------------------------------------------------ reconciliation
export interface GatewayPaymentRow {
  id: string;
  amountMinor: bigint;
  status: string;
  gatewayTransactionId: string | null;
  reversalOf: string | null;
}
export interface GatewayLinkRow {
  id: string;
  status: string;
  amountMinor: bigint;
  paidPaymentId: string | null;
}
export interface ReconciliationDiscrepancy {
  kind: "paid_link_without_payment" | "payment_without_link" | "link_amount_mismatch";
  id: string;
  detail: string;
}
export interface Reconciliation {
  /** Net confirmed gateway money: successful payments minus reversals. */
  gatewayTotalMinor: bigint;
  confirmedGatewayPayments: number;
  paidLinks: number;
  discrepancies: ReconciliationDiscrepancy[];
  /** True when the ledger and the links agree completely. */
  balanced: boolean;
}

/**
 * F5 reconciliation: the gateway total is, by construction, the sum of
 * confirmed gateway payments (reversals included as negatives). The report
 * cross-checks links against payments so a fulfilment bug shows up as a
 * discrepancy instead of a silent total drift.
 */
export function reconcileGateway(
  payments: readonly GatewayPaymentRow[],
  links: readonly GatewayLinkRow[],
): Reconciliation {
  const gateway = payments.filter((p) => p.gatewayTransactionId !== null && p.status === "confirmed");
  const gatewayTotalMinor = gateway.reduce((s, p) => s + p.amountMinor, 0n);
  const byId = new Map(payments.map((p) => [p.id, p]));
  const linkedPaymentIds = new Set(links.map((l) => l.paidPaymentId).filter((x): x is string => x !== null));
  const discrepancies: ReconciliationDiscrepancy[] = [];
  for (const link of links) {
    if (link.status === "amount_mismatch") {
      discrepancies.push({ kind: "link_amount_mismatch", id: link.id, detail: "callback amount differed from the link amount; no payment was created" });
    }
    if (link.status === "paid") {
      const payment = link.paidPaymentId ? byId.get(link.paidPaymentId) : undefined;
      if (!payment || payment.status !== "confirmed" || payment.gatewayTransactionId === null) {
        discrepancies.push({ kind: "paid_link_without_payment", id: link.id, detail: "link is marked paid but no confirmed gateway payment backs it" });
      }
    }
  }
  for (const p of gateway) {
    if (p.reversalOf === null && !linkedPaymentIds.has(p.id)) {
      discrepancies.push({ kind: "payment_without_link", id: p.id, detail: "confirmed gateway payment is not attached to any paid link" });
    }
  }
  return {
    gatewayTotalMinor,
    confirmedGatewayPayments: gateway.length,
    paidLinks: links.filter((l) => l.status === "paid").length,
    discrepancies,
    balanced: discrepancies.length === 0,
  };
}

// ----------------------------------------------------------- statement links
export const STATEMENT_TOKEN_BYTES = 32;
export const STATEMENT_DEFAULT_EXPIRY_DAYS = 30;

/** Token minting/hashing lives in `./payments-crypto` (server-only). */
export type StatementLinkState = "valid" | "expired" | "revoked" | "not_found";

/**
 * Classify a looked-up link. Callers must render ONE generic not-found for
 * every non-valid state (F10 acceptance: no oracle distinguishing unknown,
 * expired and revoked tokens).
 */
export function statementLinkState(
  link: { expiresAt: Date; revokedAt: Date | null } | null | undefined,
  now: Date,
): StatementLinkState {
  if (!link) return "not_found";
  if (link.revokedAt) return "revoked";
  if (now.getTime() >= link.expiresAt.getTime()) return "expired";
  return "valid";
}

// --------------------------------------------------------------- link pricing
export interface LinkInvoice {
  id: string;
  amountMinor: bigint;
  paidMinor: bigint;
  status: InvoiceStatus;
}

/**
 * Server-side price of a payment link, from the ledger only (ADR-019: the
 * amount never comes from the browser). Per-invoice: that invoice's
 * outstanding. Debtor total: open + partially_paid outstanding — disputed
 * invoices are frozen and never priced into a link.
 */
export function outstandingForLink(invoices: readonly LinkInvoice[], invoiceId: string | null): bigint {
  const due = (i: LinkInvoice) => (i.amountMinor - i.paidMinor > 0n ? i.amountMinor - i.paidMinor : 0n);
  if (invoiceId !== null) {
    const inv = invoices.find((i) => i.id === invoiceId);
    return inv ? due(inv) : 0n;
  }
  return invoices
    .filter((i) => i.status === "open" || i.status === "partially_paid")
    .reduce((s, i) => s + due(i), 0n);
}
