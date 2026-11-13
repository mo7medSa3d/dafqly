import { describe, it, expect } from "vitest";
import {
  computePaymobHmac, verifyPaymobHmac, hashStatementToken, generateStatementToken,
} from "./payments-crypto";
import {
  parsePaymobCallback, decideGatewayCallback,
  planReversalAllocations, reconcileGateway, reconcileLedger, redactPaymobPayload,
  statementLinkState, outstandingForLink, STATEMENT_DEFAULT_EXPIRY_DAYS,
} from "./payments";

/**
 * F5/F10 pure domain logic (BUILD_PLAN §7-F5, §7-F10, ADR-019/020).
 * The HMAC known-answer vector below was computed independently (node:crypto,
 * manual field concatenation per Paymob's documented 20-field order) so the
 * implementation is checked against the spec, not against itself.
 */
const SECRET = "test-hmac-secret-for-m3-fixtures-only";
const TXN = {
  amount_cents: 10000, created_at: "2026-11-09T10:00:00.000000", currency: "EGP",
  error_occured: false, has_parent_transaction: false, id: 123456789, integration_id: 98765,
  is_3d_secure: true, is_auth: false, is_capture: false, is_refunded: false,
  is_standalone_payment: true, is_voided: false,
  order: { id: 555444, merchant_order_id: "tahseel_test_ref" }, owner: 777, pending: false,
  source_data: { pan: "2346", sub_type: "MasterCard", type: "card" }, success: true,
};
const KNOWN_HMAC = "d7e240d7427ace61b930d539ea9df098f8483d9ef21fe13aed8811fb3779579271aef0686a63a9743ff6f61dcf15d704fb0d7ab255f5292f7b2e3408aec14a37";
const payload = (obj: Record<string, unknown>) => ({ type: "TRANSACTION", obj: { ...TXN, ...obj } });

describe("Paymob HMAC-SHA512 (ADR-019: 20 fields, exact order, lowercase booleans)", () => {
  it("matches the independently computed known-answer digest", () => {
    expect(computePaymobHmac(TXN, SECRET)).toBe(KNOWN_HMAC);
  });
  it("verifies a correct hmac and rejects a tampered one (timing-safe compare)", () => {
    expect(verifyPaymobHmac(TXN, KNOWN_HMAC, SECRET)).toBe(true);
    expect(verifyPaymobHmac(TXN, KNOWN_HMAC.replace("d7", "00"), SECRET)).toBe(false);
    expect(verifyPaymobHmac({ ...TXN, amount_cents: 9999 }, KNOWN_HMAC, SECRET)).toBe(false);
    expect(verifyPaymobHmac(TXN, "", SECRET)).toBe(false);
    expect(verifyPaymobHmac(TXN, undefined, SECRET)).toBe(false);
    expect(verifyPaymobHmac(TXN, KNOWN_HMAC, "wrong-secret-wrong-secret-wrong")).toBe(false);
  });
  it("a boolean flipped anywhere changes the digest (booleans are signed)", () => {
    expect(computePaymobHmac({ ...TXN, success: false }, SECRET)).not.toBe(KNOWN_HMAC);
  });
});

describe("parsePaymobCallback", () => {
  it("normalizes a successful transaction callback", () => {
    const cb = parsePaymobCallback(payload({}));
    expect(cb.transactionId).toBe("123456789");
    expect(cb.orderId).toBe("555444");
    expect(cb.specialReference).toBe("tahseel_test_ref");
    expect(cb.amountMinor).toBe(10000n);
    expect(cb.success).toBe(true);
    expect(cb.isRefunded).toBe(false);
  });
  it("rejects payloads that are not transaction callbacks", () => {
    expect(() => parsePaymobCallback(null)).toThrow();
    expect(() => parsePaymobCallback({})).toThrow();
    expect(() => parsePaymobCallback({ obj: { id: "x" } })).toThrow();
  });

  // M8: exact amounts + required decision booleans.
  it("parses amount_cents given as a string above 2^53 exactly", () => {
    const cb = parsePaymobCallback(payload({ amount_cents: "9007199254740993" }));
    expect(cb.amountMinor).toBe(9007199254740993n);
  });
  it("rejects a non-safe-integer number amount_cents", () => {
    // One past the safe-integer range cannot be represented exactly as a
    // JS number; the schema must refuse it rather than silently
    // truncating before BigInt(). (Written as an expression, not a
    // literal: the literal itself would lose precision at parse time.)
    expect(() => parsePaymobCallback(payload({ amount_cents: Number.MAX_SAFE_INTEGER + 1 }))).toThrow();
    expect(() => parsePaymobCallback(payload({ amount_cents: -5 }))).toThrow();
    expect(() => parsePaymobCallback(payload({ amount_cents: "10.5" }))).toThrow();
  });
  it("rejects a callback that omits any decision-critical boolean", () => {
    for (const key of ["success", "pending", "is_auth", "is_capture", "is_refunded", "is_voided", "error_occured"] as const) {
      const { [key]: _omitted, ...rest } = TXN;
      expect(() => parsePaymobCallback({ type: "TRANSACTION", obj: rest }), `missing ${key}`).toThrow();
    }
    // Non-decision flags may still default (a genuine callback carries them,
    // but their absence cannot change fulfil vs reverse).
    const { has_parent_transaction: _h, is_3d_secure: _s, is_standalone_payment: _p, ...rest } = TXN;
    expect(parsePaymobCallback({ type: "TRANSACTION", obj: rest }).success).toBe(true);
  });
});

describe("decideGatewayCallback (webhook is the only source of truth)", () => {
  const link = { amountMinor: 10000n, status: "pending", expiresAt: new Date("2026-11-09T11:00:00Z") };
  const now = new Date("2026-11-09T10:30:00Z");
  const cb = (over: Record<string, unknown>) => parsePaymobCallback(payload(over));
  it("fulfils a clean success", () => {
    expect(decideGatewayCallback(cb({}), { link, now, txnAlreadyProcessed: false }).action).toBe("fulfil");
  });
  it("a replayed transaction is a duplicate no-op", () => {
    expect(decideGatewayCallback(cb({}), { link, now, txnAlreadyProcessed: true })).toEqual({ action: "duplicate" });
  });
  it("amount mismatch never fulfils", () => {
    expect(decideGatewayCallback(cb({ amount_cents: 9000 }), { link, now, txnAlreadyProcessed: false }))
      .toEqual({ action: "ignore", reason: "amount_mismatch" });
  });
  it("failed, pending and auth-only callbacks never fulfil", () => {
    expect(decideGatewayCallback(cb({ success: false }), { link, now, txnAlreadyProcessed: false })).toEqual({ action: "ignore", reason: "failed" });
    expect(decideGatewayCallback(cb({ pending: true }), { link, now, txnAlreadyProcessed: false })).toEqual({ action: "ignore", reason: "pending" });
    expect(decideGatewayCallback(cb({ is_auth: true, is_capture: false }), { link, now, txnAlreadyProcessed: false })).toEqual({ action: "ignore", reason: "auth_only" });
    expect(decideGatewayCallback(cb({ is_auth: true, is_capture: true }), { link, now, txnAlreadyProcessed: false }).action).toBe("fulfil");
  });
  it("a late success for an expired link is flagged, not fulfilled", () => {
    const late = new Date("2026-11-09T12:00:00Z");
    expect(decideGatewayCallback(cb({}), { link, now: late, txnAlreadyProcessed: false })).toEqual({ action: "ignore", reason: "link_expired" });
  });
  it("refund and void callbacks reverse", () => {
    expect(decideGatewayCallback(cb({ is_refunded: true, id: 999 }), { link: { ...link, status: "paid" }, now, txnAlreadyProcessed: false }))
      .toEqual({ action: "reverse", reason: "refund", amountMinor: 10000n });
    expect(decideGatewayCallback(cb({ is_voided: true, id: 998 }), { link: { ...link, status: "paid" }, now, txnAlreadyProcessed: false }).action).toBe("reverse");
  });
});

describe("planReversalAllocations (refunds are negative, capped at the original)", () => {
  const original = [
    { invoiceId: "inv-a", amountMinor: 6000n },
    { invoiceId: "inv-b", amountMinor: 4000n },
  ];
  it("a full refund negates every allocation", () => {
    const plan = planReversalAllocations(original, 10000n);
    expect(plan.allocations).toEqual([
      { invoiceId: "inv-a", amountMinor: -6000n },
      { invoiceId: "inv-b", amountMinor: -4000n },
    ]);
    expect(plan.reversedMinor).toBe(10000n);
  });
  it("a partial refund negates oldest allocations first and stops", () => {
    const plan = planReversalAllocations(original, 7000n);
    expect(plan.allocations).toEqual([
      { invoiceId: "inv-a", amountMinor: -6000n },
      { invoiceId: "inv-b", amountMinor: -1000n },
    ]);
    expect(plan.reversedMinor).toBe(7000n);
  });
  it("an over-large refund is capped at what was actually allocated", () => {
    expect(planReversalAllocations(original, 99999n).reversedMinor).toBe(10000n);
    expect(planReversalAllocations(original, 0n).allocations).toEqual([]);
  });
});

describe("reconcileGateway (report total == sum of confirmed gateway payments)", () => {
  it("a clean book balances with zero discrepancies", () => {
    const r = reconcileGateway(
      [
        { id: "p1", amountMinor: 10000n, status: "confirmed", gatewayTransactionId: "t1", reversalOf: null },
        { id: "p2", amountMinor: 5000n, status: "confirmed", gatewayTransactionId: "t2", reversalOf: null },
        { id: "p3", amountMinor: -5000n, status: "confirmed", gatewayTransactionId: "t3", reversalOf: "p2" },
        { id: "p4", amountMinor: 7000n, status: "confirmed", gatewayTransactionId: null, reversalOf: null }, // manual: ignored
      ],
      [
        { id: "l1", status: "paid", amountMinor: 10000n, paidPaymentId: "p1" },
        { id: "l2", status: "paid", amountMinor: 5000n, paidPaymentId: "p2" },
        { id: "l3", status: "pending", amountMinor: 3000n, paidPaymentId: null },
      ],
    );
    expect(r.gatewayTotalMinor).toBe(10000n); // 10000 + 5000 - 5000 reversal
    expect(r.discrepancies).toEqual([]);
    expect(r.balanced).toBe(true);
  });
  it("flags a paid link with no payment and a gateway payment with no link", () => {
    const r = reconcileGateway(
      [{ id: "p9", amountMinor: 1000n, status: "confirmed", gatewayTransactionId: "t9", reversalOf: null }],
      [{ id: "l9", status: "paid", amountMinor: 2000n, paidPaymentId: null }],
    );
    expect(r.balanced).toBe(false);
    expect(r.discrepancies.map((d) => d.kind).sort()).toEqual(["paid_link_without_payment", "payment_without_link"]);
  });
  it("flags amount_mismatch links as discrepancies", () => {
    const r = reconcileGateway([], [{ id: "l5", status: "amount_mismatch", amountMinor: 100n, paidPaymentId: null }]);
    expect(r.discrepancies).toHaveLength(1);
    expect(r.discrepancies[0]!.kind).toBe("link_amount_mismatch");
  });
});

describe("reconcileLedger (M01: invoice paid == confirmed allocations, replay == stored credit)", () => {
  // p1 20000 over two invoices leaves 4000 credit; p2 pays 2000 and
  // allocates 6000, consuming that credit — replay ends at 0.
  const debtor = { id: "d1", creditMinor: 0n, creditCurrency: "EGP" };
  const clean = () => reconcileLedger(
    [
      { id: "i1", paidMinor: 10000n },
      { id: "i2", paidMinor: 12000n },
    ],
    [
      { id: "p1", debtorId: "d1", amountMinor: 20000n, currency: "EGP", status: "confirmed", createdAt: "2026-11-01T10:00:00Z" },
      { id: "p2", debtorId: "d1", amountMinor: 2000n, currency: "EGP", status: "confirmed", createdAt: "2026-11-02T10:00:00Z" },
      { id: "p3", debtorId: "d1", amountMinor: 3000n, currency: "EGP", status: "claimed", createdAt: "2026-11-03T10:00:00Z" },
    ],
    [
      { paymentId: "p1", invoiceId: "i1", amountMinor: 10000n },
      { paymentId: "p1", invoiceId: "i2", amountMinor: 6000n },
      { paymentId: "p2", invoiceId: "i2", amountMinor: 6000n },
    ],
    [debtor],
  );
  it("a clean book balances: credit consumption is not over-allocation", () => {
    const r = clean();
    expect(r.balanced).toBe(true);
    expect(r.discrepancies).toEqual([]);
    expect(r.byCurrency).toEqual([{ currency: "EGP", confirmedPaymentsMinor: 22000n, allocatedMinor: 22000n, storedCreditMinor: 0n }]);
  });
  it("flags an invoice whose paidMinor drifted from its allocations", () => {
    const r = reconcileLedger(
      [{ id: "i1", paidMinor: 9999n }],
      [{ id: "p1", debtorId: "d1", amountMinor: 10000n, currency: "EGP", status: "confirmed", createdAt: "2026-11-01T10:00:00Z" }],
      [{ paymentId: "p1", invoiceId: "i1", amountMinor: 10000n }],
      [{ id: "d1", creditMinor: 0n, creditCurrency: "EGP" }],
    );
    expect(r.balanced).toBe(false);
    expect(r.discrepancies).toEqual([expect.objectContaining({ kind: "invoice_paid_mismatch", id: "i1" })]);
  });
  it("flags a payment allocated beyond amount + available credit", () => {
    const r = reconcileLedger(
      [{ id: "i1", paidMinor: 11000n }],
      [{ id: "p1", debtorId: "d1", amountMinor: 10000n, currency: "EGP", status: "confirmed", createdAt: "2026-11-01T10:00:00Z" }],
      [{ paymentId: "p1", invoiceId: "i1", amountMinor: 11000n }],
      [{ id: "d1", creditMinor: 0n, creditCurrency: "EGP" }],
    );
    expect(r.discrepancies.map((d) => d.kind)).toContain("payment_over_allocated");
  });
  it("flags stored credit that does not match the replay", () => {
    const r = reconcileLedger(
      [{ id: "i1", paidMinor: 10000n }],
      [{ id: "p1", debtorId: "d1", amountMinor: 20000n, currency: "EGP", status: "confirmed", createdAt: "2026-11-01T10:00:00Z" }],
      [{ paymentId: "p1", invoiceId: "i1", amountMinor: 10000n }],
      [{ id: "d1", creditMinor: 9999n, creditCurrency: "EGP" }],
    );
    expect(r.discrepancies).toEqual([expect.objectContaining({ kind: "currency_imbalance", id: "d1" })]);
  });
  it("flags a remainder in a non-credit currency as unattributed", () => {
    const r = reconcileLedger(
      [{ id: "i1", paidMinor: 6000n }],
      [
        // p0 created the 5000 EGP credit; p1's 4000 USD remainder has
        // nowhere to go — the debtor's credit tag is EGP.
        { id: "p0", debtorId: "d1", amountMinor: 5000n, currency: "EGP", status: "confirmed", createdAt: "2026-10-01T10:00:00Z" },
        { id: "p1", debtorId: "d1", amountMinor: 10000n, currency: "USD", status: "confirmed", createdAt: "2026-11-01T10:00:00Z" },
      ],
      [{ paymentId: "p1", invoiceId: "i1", amountMinor: 6000n }],
      [{ id: "d1", creditMinor: 5000n, creditCurrency: "EGP" }],
    );
    expect(r.discrepancies).toEqual([expect.objectContaining({ kind: "unattributed_remainder", id: "d1" })]);
  });
  it("a reversal that un-allocates more than it reverses is over-allocation", () => {
    const r = reconcileLedger(
      [{ id: "i1", paidMinor: -1000n }],
      [
        { id: "p1", debtorId: "d1", amountMinor: 10000n, currency: "EGP", status: "confirmed", createdAt: "2026-11-01T10:00:00Z" },
        { id: "p2", debtorId: "d1", amountMinor: -5000n, currency: "EGP", status: "confirmed", createdAt: "2026-11-02T10:00:00Z" },
      ],
      [
        { paymentId: "p1", invoiceId: "i1", amountMinor: 10000n },
        { paymentId: "p2", invoiceId: "i1", amountMinor: -11000n },
      ],
      [{ id: "d1", creditMinor: 6000n, creditCurrency: "EGP" }],
    );
    expect(r.discrepancies.map((d) => d.kind)).toContain("payment_over_allocated");
  });
});

describe("statement tokens (F10: 32 random bytes, hash-only storage)", () => {
  it("generates unique 43-char base64url tokens whose hash is stored", () => {
    const a = generateStatementToken();
    const b = generateStatementToken();
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).toBe(hashStatementToken(a.token));
    expect(a.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.tokenHash).not.toContain(a.token);
  });
  it("classifies link state: valid / expired / revoked / not found, generically", () => {
    const now = new Date("2026-11-09T10:00:00Z");
    const base = { expiresAt: new Date("2026-12-09T10:00:00Z"), revokedAt: null as Date | null };
    expect(statementLinkState(base, now)).toBe("valid");
    expect(statementLinkState({ ...base, expiresAt: new Date("2026-11-09T09:59:59Z") }, now)).toBe("expired");
    expect(statementLinkState({ ...base, revokedAt: new Date("2026-11-09T09:00:00Z") }, now)).toBe("revoked");
    expect(statementLinkState(null, now)).toBe("not_found");
    expect(STATEMENT_DEFAULT_EXPIRY_DAYS).toBe(30);
  });
});

describe("outstandingForLink (server-side pricing from the ledger)", () => {
  const invs = [
    { id: "i1", amountMinor: 10000n, paidMinor: 2500n, status: "open" as const },
    { id: "i2", amountMinor: 5000n, paidMinor: 5000n, status: "paid" as const },
    { id: "i3", amountMinor: 3000n, paidMinor: 0n, status: "partially_paid" as const },
    { id: "i4", amountMinor: 9000n, paidMinor: 0n, status: "disputed" as const },
  ];
  it("per-invoice link prices that invoice's outstanding only", () => {
    expect(outstandingForLink(invs, "i1")).toBe(7500n);
    expect(outstandingForLink(invs, "i2")).toBe(0n);
  });
  it("debtor-total link sums open + partially paid, never disputed/paid", () => {
    expect(outstandingForLink(invs, null)).toBe(10500n);
  });
});

describe("redactPaymobPayload (M3)", () => {
  it("drops source_data (masked PAN) + card, keeps the fulfilment fields, leaves the input untouched", () => {
    const payload = {
      type: "TRANSACTION",
      obj: {
        id: 123, amount_cents: 50000, currency: "EGP", success: true,
        source_data: { type: "card", pan: "512345******6789", sub_type: "MasterCard" },
        card: { last4: "6789" },
        order: { merchant_order_id: "link-1" },
      },
    };
    const redacted = redactPaymobPayload(payload) as typeof payload;
    const json = JSON.stringify(redacted);
    expect(json).not.toContain("512345");
    expect(json).not.toContain("source_data");
    expect(json).not.toContain("6789");
    expect(redacted.obj.amount_cents).toBe(50000);
    expect(redacted.obj.order.merchant_order_id).toBe("link-1");
    expect(JSON.stringify(payload)).toContain("512345"); // input untouched
  });
});
