import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { ownerDb, appDb } from "./db";
import { user as userTable, tenants, paymentLinks, payments, webhookEvents } from "@tahseel/db/schema";
import { createTenantForUser } from "./services";
import { createDebtor, createInvoice, recordPayment, getDebtorDetail } from "./ledger";
import {
  createGatewayLink, handlePaymobCallback, refundGatewayPayment, getReconciliation,
  confirmClaimedPayment, rejectClaimedPayment, type GatewayDeps,
} from "./gateway";
import { FakePaymentProvider } from "@tahseel/providers";
import { computePaymobHmac } from "@tahseel/core/payments-crypto";

/**
 * F5 acceptance at the service layer (real Postgres + RLS, FAKE provider):
 * link pricing from the ledger, HMAC-verified webhook fulfilment, replay
 * no-op, amount-mismatch and expiry guards, refunds as reversals, claimed
 * confirm/reject, and a balanced reconciliation. Webhook fixtures are built
 * to Paymob's verified shapes (ADR-019) and signed with the test secret —
 * no real Paymob account or network is involved.
 */
const hasDb = Boolean(process.env.DATABASE_URL && (process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL));
if (!hasDb && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 but DB env missing");
const d = hasDb ? describe : describe.skip;

const HMAC_SECRET = "m3-test-hmac-secret-0123456789abcdef";
let txnSeq = 900000;
function callbackPayload(opts: {
  reference: string; amountCents: number; overrides?: Record<string, unknown>;
}) {
  const obj = {
    amount_cents: opts.amountCents, created_at: "2026-11-09T10:00:00.000000", currency: "EGP",
    error_occured: false, has_parent_transaction: false, id: ++txnSeq, integration_id: 123456,
    is_3d_secure: true, is_auth: false, is_capture: false, is_refunded: false,
    is_standalone_payment: true, is_voided: false,
    order: { id: 555000 + txnSeq, merchant_order_id: opts.reference }, owner: 777, pending: false,
    source_data: { pan: "2346", sub_type: "MasterCard", type: "card" }, success: true,
    ...(opts.overrides ?? {}),
  };
  return { payload: { type: "TRANSACTION", obj }, obj, hmac: computePaymobHmac(obj as never, HMAC_SECRET) };
}

d("F5 gateway payments (service layer)", () => {
  const user = { id: randomUUID().replace(/-/g, ""), email: `f5-${randomUUID()}@example.test`, name: "F5" };
  let tenantId = "";
  const fake = new FakePaymentProvider();
  const deps = (): GatewayDeps => ({
    app: appDb(), owner: ownerDb(), provider: fake, hmacSecret: HMAC_SECRET, appUrl: "http://localhost:3000",
  });
  const app = () => appDb();
  let phoneSeq = 0;
  const newDebtor = (name: string) =>
    createDebtor(app(), tenantId, user.id, { displayName: name, phone: `0105555${String(1000 + ++phoneSeq)}` });

  beforeAll(async () => {
    await ownerDb().insert(userTable).values([user]);
    tenantId = (await createTenantForUser(appDb(), user.id, {
      businessNameAr: "شركة ف٥", timezone: "Africa/Cairo", quietStart: "21:00", quietEnd: "09:00",
      fridayMorningSkip: false, defaultTermsDays: 14, tone: "polite", consent: true,
    })).tenantId;
  });
  afterAll(async () => {
    const owner = ownerDb();
    await owner.delete(tenants).where(eq(tenants.id, tenantId));
    await owner.delete(userTable).where(eq(userTable.id, user.id));
  });

  it("prices a per-invoice link from the ledger (outstanding after a partial manual payment)", async () => {
    const debtor = await newDebtor("رابط فاتورة");
    const inv = await createInvoice(app(), tenantId, user.id, { debtorId: debtor.id, amount: "1000.00", issuedOn: "2026-11-01", dueOn: "2026-11-20" });
    await recordPayment(app(), tenantId, user.id, { debtorId: debtor.id, amount: "400.00", method: "cash", receivedOn: "2026-11-05" });
    const link = await createGatewayLink(deps(), tenantId, user.id, { debtorId: debtor.id, invoiceId: inv.id });
    expect(link.amountMinor).toBe("60000");
    expect(link.status).toBe("pending");
    expect(link.checkoutUrl).toContain("pay.example.invalid");
    const [row] = await ownerDb().select().from(paymentLinks).where(eq(paymentLinks.id, link.id));
    expect(row!.specialReference).toBe(fake.created[fake.created.length - 1]!.reference);
    expect(row!.expiresAt.getTime() - Date.now()).toBeGreaterThan(50 * 60_000);
  });

  it("prices a debtor-total link across open invoices and refuses when nothing is due", async () => {
    const debtor = await newDebtor("رابط إجمالي");
    await createInvoice(app(), tenantId, user.id, { debtorId: debtor.id, amount: "300.00", issuedOn: "2026-11-01", dueOn: "2026-11-10" });
    await createInvoice(app(), tenantId, user.id, { debtorId: debtor.id, amount: "200.00", issuedOn: "2026-11-01", dueOn: "2026-11-12" });
    const link = await createGatewayLink(deps(), tenantId, user.id, { debtorId: debtor.id });
    expect(link.amountMinor).toBe("50000");
    const settled = await newDebtor("مسدد بالكامل");
    const inv = await createInvoice(app(), tenantId, user.id, { debtorId: settled.id, amount: "10.00", issuedOn: "2026-11-01", dueOn: "2026-11-10" });
    await recordPayment(app(), tenantId, user.id, { debtorId: settled.id, amount: "10.00", method: "cash", receivedOn: "2026-11-05" });
    await expect(createGatewayLink(deps(), tenantId, user.id, { debtorId: settled.id, invoiceId: inv.id }))
      .rejects.toMatchObject({ code: "NOTHING_DUE" });
  });

  it("ACCEPTANCE: a signed success webhook pays the invoice exactly once; replay is a no-op; reconciliation balances", async () => {
    const debtor = await newDebtor("سداد بوابة");
    const inv = await createInvoice(app(), tenantId, user.id, { debtorId: debtor.id, amount: "750.00", issuedOn: "2026-11-01", dueOn: "2026-11-20" });
    const link = await createGatewayLink(deps(), tenantId, user.id, { debtorId: debtor.id, invoiceId: inv.id });
    const [row] = await ownerDb().select().from(paymentLinks).where(eq(paymentLinks.id, link.id));
    const { payload, hmac } = callbackPayload({ reference: row!.specialReference, amountCents: 75000 });

    const out = await handlePaymobCallback(deps(), payload, hmac, new Date());
    expect(out.outcome).toBe("fulfilled");
    const detail = await getDebtorDetail(app(), tenantId, debtor.id);
    expect(detail.invoices.find((i) => i.id === inv.id)).toMatchObject({ paidMinor: "75000", status: "paid" });
    const [paidLink] = await ownerDb().select().from(paymentLinks).where(eq(paymentLinks.id, link.id));
    expect(paidLink!.status).toBe("paid");
    expect(paidLink!.paidPaymentId).toBe(out.paymentId);

    const replay = await handlePaymobCallback(deps(), payload, hmac, new Date());
    expect(replay.outcome).toBe("duplicate");
    const gatewayPayments = await ownerDb().select().from(payments)
      .where(and(eq(payments.tenantId, tenantId), eq(payments.debtorId, debtor.id)));
    expect(gatewayPayments.filter((p) => p.gatewayTransactionId !== null)).toHaveLength(1);

    const report = await getReconciliation(app(), tenantId);
    expect(report.gatewayTotalMinor).toBe("75000");
    expect(report.balanced).toBe(true);
    expect(report.discrepancies).toEqual([]);
  });

  it("a bad HMAC returns 401 and stores nothing (no payment, no inbox row)", async () => {
    const debtor = await newDebtor("توقيع خاطئ");
    const inv = await createInvoice(app(), tenantId, user.id, { debtorId: debtor.id, amount: "100.00", issuedOn: "2026-11-01", dueOn: "2026-11-20" });
    const link = await createGatewayLink(deps(), tenantId, user.id, { debtorId: debtor.id, invoiceId: inv.id });
    const [row] = await ownerDb().select().from(paymentLinks).where(eq(paymentLinks.id, link.id));
    const { payload, obj } = callbackPayload({ reference: row!.specialReference, amountCents: 10000 });
    await expect(handlePaymobCallback(deps(), payload, "deadbeef", new Date()))
      .rejects.toMatchObject({ code: "BAD_HMAC", status: 401 });
    const inbox = await ownerDb().select().from(webhookEvents)
      .where(eq(webhookEvents.dedupeKey, `paymob:${obj.id}:true:false:false:false`));
    expect(inbox).toHaveLength(0);
    const detail = await getDebtorDetail(app(), tenantId, debtor.id);
    expect(detail.invoices[0]!.status).toBe("open");
    void createHmac;
  });

  it("amount mismatch creates NO payment, flags the link, and reconciliation reports it", async () => {
    const debtor = await newDebtor("مبلغ مختلف");
    const inv = await createInvoice(app(), tenantId, user.id, { debtorId: debtor.id, amount: "500.00", issuedOn: "2026-11-01", dueOn: "2026-11-20" });
    const link = await createGatewayLink(deps(), tenantId, user.id, { debtorId: debtor.id, invoiceId: inv.id });
    const [row] = await ownerDb().select().from(paymentLinks).where(eq(paymentLinks.id, link.id));
    const { payload, hmac } = callbackPayload({ reference: row!.specialReference, amountCents: 40000 });
    const out = await handlePaymobCallback(deps(), payload, hmac, new Date());
    expect(out).toMatchObject({ outcome: "ignored", reason: "amount_mismatch" });
    const [flagged] = await ownerDb().select().from(paymentLinks).where(eq(paymentLinks.id, link.id));
    expect(flagged!.status).toBe("amount_mismatch");
    const detail = await getDebtorDetail(app(), tenantId, debtor.id);
    expect(detail.invoices[0]).toMatchObject({ paidMinor: "0", status: "open" });
    const report = await getReconciliation(app(), tenantId);
    expect(report.balanced).toBe(false);
    expect(report.discrepancies.some((x) => x.kind === "link_amount_mismatch" && x.id === link.id)).toBe(true);
  });

  it("failed, pending and auth-only callbacks never create a payment", async () => {
    const debtor = await newDebtor("حالات غير نهائية");
    const inv = await createInvoice(app(), tenantId, user.id, { debtorId: debtor.id, amount: "200.00", issuedOn: "2026-11-01", dueOn: "2026-11-20" });
    const link = await createGatewayLink(deps(), tenantId, user.id, { debtorId: debtor.id, invoiceId: inv.id });
    const [row] = await ownerDb().select().from(paymentLinks).where(eq(paymentLinks.id, link.id));
    for (const [overrides, reason] of [
      [{ success: false }, "failed"],
      [{ pending: true }, "pending"],
      [{ is_auth: true, is_capture: false }, "auth_only"],
    ] as const) {
      const { payload, hmac } = callbackPayload({ reference: row!.specialReference, amountCents: 20000, overrides: { ...overrides } });
      const out = await handlePaymobCallback(deps(), payload, hmac, new Date());
      expect(out).toMatchObject({ outcome: "ignored", reason });
    }
    const detail = await getDebtorDetail(app(), tenantId, debtor.id);
    expect(detail.invoices[0]).toMatchObject({ paidMinor: "0", status: "open" });
  });

  it("a late success for an expired link is flagged, not fulfilled", async () => {
    const debtor = await newDebtor("رابط منتهي");
    const inv = await createInvoice(app(), tenantId, user.id, { debtorId: debtor.id, amount: "200.00", issuedOn: "2026-11-01", dueOn: "2026-11-20" });
    const link = await createGatewayLink(deps(), tenantId, user.id, { debtorId: debtor.id, invoiceId: inv.id });
    await ownerDb().update(paymentLinks).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(paymentLinks.id, link.id));
    const [row] = await ownerDb().select().from(paymentLinks).where(eq(paymentLinks.id, link.id));
    const { payload, hmac } = callbackPayload({ reference: row!.specialReference, amountCents: 20000 });
    const out = await handlePaymobCallback(deps(), payload, hmac, new Date());
    expect(out).toMatchObject({ outcome: "ignored", reason: "link_expired" });
    const [after] = await ownerDb().select().from(paymentLinks).where(eq(paymentLinks.id, link.id));
    expect(after!.status).toBe("expired");
  });

  it("a gateway payment arriving for an already-paid invoice becomes credit, never a negative invoice", async () => {
    const debtor = await newDebtor("دفع مكرر");
    const inv = await createInvoice(app(), tenantId, user.id, { debtorId: debtor.id, amount: "300.00", issuedOn: "2026-11-01", dueOn: "2026-11-20" });
    const link = await createGatewayLink(deps(), tenantId, user.id, { debtorId: debtor.id, invoiceId: inv.id });
    await recordPayment(app(), tenantId, user.id, { debtorId: debtor.id, amount: "300.00", method: "cash", receivedOn: "2026-11-06" });
    const [row] = await ownerDb().select().from(paymentLinks).where(eq(paymentLinks.id, link.id));
    const { payload, hmac } = callbackPayload({ reference: row!.specialReference, amountCents: 30000 });
    const out = await handlePaymobCallback(deps(), payload, hmac, new Date());
    expect(out.outcome).toBe("fulfilled");
    const detail = await getDebtorDetail(app(), tenantId, debtor.id);
    expect(detail.creditMinor).toBe("30000");
    expect(detail.invoices[0]).toMatchObject({ paidMinor: "30000", status: "paid" });
  });

  it("ACCEPTANCE: refunds create reversing payments that reopen invoices (partial then full)", async () => {
    const debtor = await newDebtor("استرجاع");
    const inv = await createInvoice(app(), tenantId, user.id, { debtorId: debtor.id, amount: "600.00", issuedOn: "2026-11-01", dueOn: "2026-11-20" });
    const link = await createGatewayLink(deps(), tenantId, user.id, { debtorId: debtor.id, invoiceId: inv.id });
    const [row] = await ownerDb().select().from(paymentLinks).where(eq(paymentLinks.id, link.id));
    const { payload, hmac } = callbackPayload({ reference: row!.specialReference, amountCents: 60000 });
    const paid = await handlePaymobCallback(deps(), payload, hmac, new Date());
    expect(paid.outcome).toBe("fulfilled");

    const partial = await refundGatewayPayment(deps(), tenantId, user.id, { paymentId: paid.paymentId!, amount: "200.00" });
    expect(partial.reversedMinor).toBe("20000");
    let detail = await getDebtorDetail(app(), tenantId, debtor.id);
    expect(detail.invoices[0]).toMatchObject({ paidMinor: "40000", status: "partially_paid" });
    expect(fake.refunded[fake.refunded.length - 1]).toMatchObject({ amountMinor: 20000n });

    const rest = await refundGatewayPayment(deps(), tenantId, user.id, { paymentId: paid.paymentId! });
    expect(rest.reversedMinor).toBe("40000");
    detail = await getDebtorDetail(app(), tenantId, debtor.id);
    expect(detail.invoices[0]).toMatchObject({ paidMinor: "0", status: "open" });
    await expect(refundGatewayPayment(deps(), tenantId, user.id, { paymentId: paid.paymentId! }))
      .rejects.toMatchObject({ code: "INVALID_REFUND" });
  });

  it("a refund callback (is_refunded) reverses idempotently", async () => {
    const debtor = await newDebtor("استرجاع كولباك");
    const inv = await createInvoice(app(), tenantId, user.id, { debtorId: debtor.id, amount: "450.00", issuedOn: "2026-11-01", dueOn: "2026-11-20" });
    const link = await createGatewayLink(deps(), tenantId, user.id, { debtorId: debtor.id, invoiceId: inv.id });
    const [row] = await ownerDb().select().from(paymentLinks).where(eq(paymentLinks.id, link.id));
    const first = callbackPayload({ reference: row!.specialReference, amountCents: 45000 });
    const paid = await handlePaymobCallback(deps(), first.payload, first.hmac, new Date());
    expect(paid.outcome).toBe("fulfilled");
    const refundCb = callbackPayload({
      reference: row!.specialReference, amountCents: 45000,
      overrides: { is_refunded: true, has_parent_transaction: true, order: { id: (first.obj.order as { id: number }).id, merchant_order_id: row!.specialReference } },
    });
    const out = await handlePaymobCallback(deps(), refundCb.payload, refundCb.hmac, new Date());
    expect(out.outcome).toBe("reversed");
    const detail = await getDebtorDetail(app(), tenantId, debtor.id);
    expect(detail.invoices[0]).toMatchObject({ paidMinor: "0", status: "open" });
    const replay = await handlePaymobCallback(deps(), refundCb.payload, refundCb.hmac, new Date());
    expect(replay.outcome).toBe("duplicate");
  });

  it("claimed payments: confirm allocates and settles; reject never touches balances", async () => {
    const debtor = await newDebtor("دفعات مدعاة");
    const inv = await createInvoice(app(), tenantId, user.id, { debtorId: debtor.id, amount: "500.00", issuedOn: "2026-11-01", dueOn: "2026-11-20" });
    const mkClaim = async (amount: bigint) => {
      const [row] = await ownerDb().insert(payments).values({
        tenantId, debtorId: debtor.id, amountMinor: amount, method: "instapay",
        receivedOn: "2026-11-08", status: "claimed", source: "receipt_ai",
      }).returning();
      return row!.id;
    };
    const claim1 = await mkClaim(50000n);
    await confirmClaimedPayment(app(), tenantId, user.id, claim1);
    let detail = await getDebtorDetail(app(), tenantId, debtor.id);
    expect(detail.invoices[0]).toMatchObject({ paidMinor: "50000", status: "paid" });
    await expect(confirmClaimedPayment(app(), tenantId, user.id, claim1)).rejects.toMatchObject({ code: "INVALID_STATE" });

    const inv2 = await createInvoice(app(), tenantId, user.id, { debtorId: debtor.id, amount: "100.00", issuedOn: "2026-11-02", dueOn: "2026-11-21" });
    const claim2 = await mkClaim(10000n);
    await rejectClaimedPayment(app(), tenantId, user.id, claim2);
    detail = await getDebtorDetail(app(), tenantId, debtor.id);
    expect(detail.invoices.find((i) => i.id === inv2.id)).toMatchObject({ paidMinor: "0", status: "open" });
    void inv;
  });
});
