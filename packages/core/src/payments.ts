import { z } from "zod";
import { outstandingFor } from "./invoices";
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
/**
 * M8: `amount_cents` must survive as an exact integer. A JSON number above
 * 2^53 is already imprecise when parsed, so numbers must be safe integers;
 * a string keeps full precision (`BigInt(String(v))` in parsePaymobCallback).
 * The decision-critical booleans are REQUIRED — a callback that omits
 * `success`, `pending`, `is_auth`, `is_capture`, `is_refunded`,
 * `is_voided` or `error_occured` is rejected as BAD_PAYLOAD instead of
 * silently defaulting to "not refunded / not failed" and fulfilling.
 * (Paymob signs all 20 fields, so a genuine callback always carries them.)
 */
const amountCents = z.union([z.number(), z.string()]).refine((v) => {
  if (typeof v === "number") return Number.isSafeInteger(v) && v >= 0;
  if (!/^\d+$/.test(v)) return false;
  try {
    return BigInt(v) >= 0n;
  } catch {
    return false;
  }
}, { message: "amount_cents must be a non-negative integer (use a string above 2^53)" });
const requiredBool = z.boolean();
export const paymobTransactionSchema = z.object({
  amount_cents: amountCents,
  created_at: z.string().min(1),
  currency: z.string().min(1).default("EGP"),
  error_occured: requiredBool,
  has_parent_transaction: boolWithDefault,
  id: z.union([z.number(), z.string()]),
  integration_id: z.union([z.number(), z.string()]).default(0),
  is_3d_secure: boolWithDefault,
  is_auth: requiredBool,
  is_capture: requiredBool,
  is_refunded: requiredBool,
  is_standalone_payment: boolWithDefault,
  is_voided: requiredBool,
  order: z.object({
    id: z.union([z.number(), z.string()]),
    merchant_order_id: z.string().optional(),
  }),
  owner: z.union([z.number(), z.string()]).default(0),
  pending: requiredBool,
  source_data: z.object({
    pan: z.string().default(""),
    sub_type: z.string().default(""),
    type: z.string().default(""),
  }).default({ pan: "", sub_type: "", type: "" }),
  success: requiredBool,
});

/**
 * M3: strip card-adjacent data from a Paymob callback before it is stored.
 * `obj.source_data` carries the (masked) PAN and card metadata — nothing
 * downstream needs it (fulfilment uses the typed callback, not the raw
 * payload). Returns a deep copy; the caller's payload is untouched.
 */
export function redactPaymobPayload(payload: unknown): unknown {
  let copy: Record<string, unknown>;
  try {
    copy = JSON.parse(JSON.stringify(payload ?? null)) as Record<string, unknown>;
  } catch {
    return { redacted: true };
  }
  const obj = copy.obj as Record<string, unknown> | undefined;
  if (obj && typeof obj === "object") {
    delete obj.source_data;
    delete obj.card;
  }
  return copy;
}

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
    // M8: String() first — a string amount keeps full precision; a number
    // amount was already validated as a safe integer by the schema.
    amountMinor: BigInt(String(o.amount_cents)),
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

// ------------------------------------------------------- ledger reconciliation
export interface LedgerInvoiceRow { id: string; paidMinor: bigint }
export interface LedgerPaymentRow {
  id: string; debtorId: string; amountMinor: bigint; currency: string;
  status: string; createdAt: string;
}
export interface LedgerAllocationRow { paymentId: string; invoiceId: string; amountMinor: bigint }
export interface LedgerDebtorRow { id: string; creditMinor: bigint; creditCurrency: string }
export interface LedgerReconciliationDiscrepancy {
  kind: "invoice_paid_mismatch" | "payment_over_allocated" | "currency_imbalance" | "unattributed_remainder";
  id: string;
  detail: string;
}
export interface LedgerReconciliation {
  balanced: boolean;
  discrepancies: LedgerReconciliationDiscrepancy[];
  byCurrency: { currency: string; confirmedPaymentsMinor: bigint; allocatedMinor: bigint; storedCreditMinor: bigint }[];
}

/**
 * M01: the ledger's own reconciliation — the invariants the money code
 * maintains by construction, re-checked from the stored rows so a bug (or
 * a manual edit) shows up as a discrepancy instead of silent drift:
 *  (a) per invoice, paidMinor == Σ confirmed allocations;
 *  (b) per payment, allocations never exceed the payment plus the credit
 *      the debtor held when it landed (reversals: |allocations| never
 *      exceeds |amount| — credit is reduced by a reversal, never consumed
 *      by it);
 *  (c) per (debtor, currency), replaying confirmed payments in order
 *      (credit += amount − allocations) must end at the stored credit
 *      when that is the debtor's credit currency — and at zero otherwise.
 *      A non-zero remainder in a non-credit currency is an
 *      `unattributed_remainder`: money received but represented in no
 *      balance (the single-currency credit tag cannot hold it — Batch 2b
 *      documented limitation, now surfaced instead of silent).
 * Unconfirmed (claimed/pending) payments are excluded from the replay —
 * they have not counted toward any balance yet — but their stored
 * allocations still must not exceed the payment.
 */
export function reconcileLedger(
  invoices: readonly LedgerInvoiceRow[],
  payments: readonly LedgerPaymentRow[],
  allocations: readonly LedgerAllocationRow[],
  debtors: readonly LedgerDebtorRow[],
): LedgerReconciliation {
  const discrepancies: LedgerReconciliationDiscrepancy[] = [];
  const abs = (v: bigint) => (v < 0n ? -v : v);
  const confirmedIds = new Set(payments.filter((p) => p.status === "confirmed").map((p) => p.id));
  const allocByPayment = new Map<string, bigint>();
  const confirmedByInvoice = new Map<string, bigint>();
  for (const a of allocations) {
    allocByPayment.set(a.paymentId, (allocByPayment.get(a.paymentId) ?? 0n) + a.amountMinor);
    if (confirmedIds.has(a.paymentId)) {
      confirmedByInvoice.set(a.invoiceId, (confirmedByInvoice.get(a.invoiceId) ?? 0n) + a.amountMinor);
    }
  }
  // (a) per invoice.
  for (const inv of invoices) {
    const allocated = confirmedByInvoice.get(inv.id) ?? 0n;
    if (inv.paidMinor !== allocated) {
      discrepancies.push({ kind: "invoice_paid_mismatch", id: inv.id, detail: `paidMinor is ${inv.paidMinor}, confirmed allocations sum to ${allocated}` });
    }
  }
  // Unconfirmed payments: allocations must not exceed the payment.
  for (const p of payments) {
    if (p.status === "confirmed") continue;
    const alloc = allocByPayment.get(p.id) ?? 0n;
    if (abs(alloc) > abs(p.amountMinor)) {
      discrepancies.push({ kind: "payment_over_allocated", id: p.id, detail: `allocations sum to ${alloc}, payment amount is ${p.amountMinor}` });
    }
  }
  // (b)+(c): replay confirmed payments per (debtor, currency).
  const debtorById = new Map(debtors.map((d) => [d.id, d]));
  const groups = new Map<string, LedgerPaymentRow[]>();
  for (const p of payments) {
    if (p.status !== "confirmed") continue;
    const key = `${p.debtorId}|${p.currency}`;
    const list = groups.get(key) ?? [];
    list.push(p);
    groups.set(key, list);
  }
  for (const [key, pays] of groups) {
    const [debtorId, currency] = key.split("|") as [string, string];
    pays.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));
    let credit = 0n;
    for (const p of pays) {
      const alloc = allocByPayment.get(p.id) ?? 0n;
      if (p.amountMinor >= 0n) {
        const available = credit > 0n ? credit : 0n;
        if (alloc < 0n || alloc > p.amountMinor + available) {
          discrepancies.push({ kind: "payment_over_allocated", id: p.id, detail: `allocations sum to ${alloc}, payment is ${p.amountMinor} with ${available} credit available` });
        }
      } else if (alloc > 0n || alloc < p.amountMinor) {
        discrepancies.push({ kind: "payment_over_allocated", id: p.id, detail: `reversal allocations sum to ${alloc}, reversal amount is ${p.amountMinor}` });
      }
      credit += p.amountMinor - alloc;
    }
    const debtor = debtorById.get(debtorId);
    if (!debtor) {
      discrepancies.push({ kind: "currency_imbalance", id: debtorId, detail: `${currency}: replayed credit ${credit} but the debtor row is missing` });
      continue;
    }
    if (debtor.creditCurrency === currency) {
      if (credit !== debtor.creditMinor) {
        discrepancies.push({ kind: "currency_imbalance", id: debtorId, detail: `${currency}: replayed credit ${credit}, stored credit ${debtor.creditMinor}` });
      }
    } else if (credit !== 0n) {
      discrepancies.push({ kind: "unattributed_remainder", id: debtorId, detail: `${currency}: ${credit} received but neither allocated nor stored as credit (debtor holds credit in ${debtor.creditCurrency})` });
    }
  }
  // Stored credit with no confirmed payments in its currency at all.
  for (const d of debtors) {
    if (d.creditMinor === 0n) continue;
    if (!groups.has(`${d.id}|${d.creditCurrency}`)) {
      discrepancies.push({ kind: "currency_imbalance", id: d.id, detail: `${d.creditCurrency}: stored credit ${d.creditMinor} with no confirmed payments in that currency` });
    }
  }
  // Tenant-wide per-currency totals (informational — the verdict comes
  // from the per-debtor replay above).
  const currencyByPayment = new Map(payments.map((p) => [p.id, p.currency]));
  const totals = new Map<string, { confirmedPaymentsMinor: bigint; allocatedMinor: bigint; storedCreditMinor: bigint }>();
  const total = (c: string) => {
    const t = totals.get(c) ?? { confirmedPaymentsMinor: 0n, allocatedMinor: 0n, storedCreditMinor: 0n };
    totals.set(c, t);
    return t;
  };
  for (const p of payments) {
    if (p.status !== "confirmed") continue;
    total(p.currency).confirmedPaymentsMinor += p.amountMinor;
  }
  for (const a of allocations) {
    if (!confirmedIds.has(a.paymentId)) continue;
    total(currencyByPayment.get(a.paymentId) ?? "EGP").allocatedMinor += a.amountMinor;
  }
  for (const d of debtors) {
    if (d.creditMinor === 0n) continue;
    total(d.creditCurrency).storedCreditMinor += d.creditMinor;
  }
  const byCurrency = [...totals.entries()].sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([currency, t]) => ({ currency, ...t }));
  return { balanced: discrepancies.length === 0, discrepancies, byCurrency };
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
  // H09: one rule everywhere — a disputed invoice is frozen, so its link
  // prices at 0, exactly as the debtor list, KPIs and statement report.
  if (invoiceId !== null) {
    const inv = invoices.find((i) => i.id === invoiceId);
    return inv ? outstandingFor(inv) : 0n;
  }
  return invoices.reduce((s, i) => s + outstandingFor(i), 0n);
}
