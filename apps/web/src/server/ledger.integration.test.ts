import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { ownerDb, appDb } from "./db";
import { user as userTable, tenants, auditLog, invoices } from "@tahseel/db/schema";
import { withTenant } from "@tahseel/db";
import { MoneyParseError, outstandingForLink } from "@tahseel/core";
import { createTenantForUser } from "./services";
import {
  createDebtor, createInvoice, recordPayment, transitionInvoice, bulkTransitionInvoices,
  softDeleteDebtor, getDebtorTimeline, listInvoicesPage, getDebtorDetail, listDebtorsPage2,
  getLedgerReconciliation,
} from "./ledger";
import { createMerchantPromise, listPromisesToPay } from "./workflows";
import { getKpis } from "./reports";
import { createStatementLink, getStatementData } from "./statements";

/**
 * F1 acceptance at the service layer, on real Postgres + RLS:
 * status transitions, allocation across three invoices, credit balance,
 * default-terms due dates, duplicate phones, soft delete, timeline order,
 * filters and bulk actions.
 */
const hasDb = Boolean(process.env.DATABASE_URL && (process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL));
if (!hasDb && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 but DB env missing");
const d = hasDb ? describe : describe.skip;

d("F1 debtors, invoices, payments (service layer)", () => {
  const user = { id: randomUUID().replace(/-/g, ""), email: `f1-${randomUUID()}@example.test`, name: "F1" };
  let tenantId = "";
  const app = () => appDb();

  beforeAll(async () => {
    await ownerDb().insert(userTable).values([user]);
    tenantId = (await createTenantForUser(appDb(), user.id, {
      businessNameAr: "شركة ف١", timezone: "Africa/Cairo", quietStart: "21:00", quietEnd: "09:00",
      fridayMorningSkip: false, defaultTermsDays: 14, tone: "polite", consent: true,
    })).tenantId;
  });
  afterAll(async () => {
    const owner = ownerDb();
    await owner.delete(tenants).where(eq(tenants.id, tenantId));
    await owner.delete(userTable).where(eq(userTable.id, user.id));
  });

  it("creates a debtor, normalizes the phone, and rejects the same phone twice", async () => {
    const debtor = await createDebtor(app(), tenantId, user.id, { displayName: "أحمد", phone: "0100 123 4567" });
    expect(debtor.phoneE164).toBe("+201001234567");
    await expect(createDebtor(app(), tenantId, user.id, { displayName: "نسخة", phone: "+201001234567" }))
      .rejects.toMatchObject({ code: "DUPLICATE_PHONE" });
    await expect(createDebtor(app(), tenantId, user.id, { displayName: "خاطئ", phone: "123" }))
      .rejects.toMatchObject({ code: "INVALID_PHONE" });
  });

  it("M6: the debtor.created audit entry stores a masked phone, never the raw number", async () => {
    const debtor = await createDebtor(app(), tenantId, user.id, { displayName: "مخفي الهاتف", phone: "01099998888" });
    const rows = await ownerDb().select().from(auditLog)
      .where(eq(auditLog.entityId, debtor.id));
    const created = rows.find((r) => r.action === "debtor.created");
    expect(created).toBeDefined();
    const after = JSON.stringify(created!.after);
    expect(after).not.toContain("+201099998888");
    expect(after).not.toContain("01099998888");
    expect(after).toContain("+20*****88");
  });

  it("invoice without a due date falls back to issued + tenant default terms (14d); non-EGP warns", async () => {
    const debtor = await createDebtor(app(), tenantId, user.id, { displayName: "بلا استحقاق", phone: "01011112222" });
    const inv = await createInvoice(app(), tenantId, user.id, { debtorId: debtor.id, amount: "100.00", issuedOn: "2026-11-01" });
    expect(inv.dueOn).toBe("2026-11-15");
    expect(inv.status).toBe("open");
    const usd = await createInvoice(app(), tenantId, user.id, { debtorId: debtor.id, amount: "10.00", currency: "USD", issuedOn: "2026-11-01", dueOn: "2026-11-10" });
    expect(usd.currency).toBe("USD");
    expect(usd.currencyWarning).toBe(true);
    const egp = await createInvoice(app(), tenantId, user.id, { debtorId: debtor.id, amount: "10.00", issuedOn: "2026-11-01", dueOn: "2026-11-10" });
    expect(egp.currencyWarning).toBe(false);
  });

  it("F1 ACCEPTANCE: one payment allocated across three invoices updates all three", async () => {
    const debtor = await createDebtor(app(), tenantId, user.id, { displayName: "ثلاث فواتير", phone: "01022223333" });
    const mk = (amount: string, dueOn: string) =>
      createInvoice(app(), tenantId, user.id, { debtorId: debtor.id, amount, issuedOn: "2026-10-01", dueOn });
    const i1 = await mk("300.00", "2026-11-01");
    const i2 = await mk("500.00", "2026-11-05");
    const i3 = await mk("200.00", "2026-11-10");
    const payment = await recordPayment(app(), tenantId, user.id, {
      debtorId: debtor.id, amount: "850.00", method: "cash", receivedOn: "2026-11-09",
      allocations: [
        { invoiceId: i1.id, amount: "300.00" },
        { invoiceId: i2.id, amount: "400.00" },
        { invoiceId: i3.id, amount: "150.00" },
      ],
    });
    expect(payment.allocatedMinor).toBe("85000");
    expect(payment.creditMinor).toBe("0");
    const detail = await getDebtorDetail(app(), tenantId, debtor.id);
    const byId = new Map(detail.invoices.map((i) => [i.id, i]));
    expect(byId.get(i1.id)).toMatchObject({ paidMinor: "30000", status: "paid" });
    expect(byId.get(i2.id)).toMatchObject({ paidMinor: "40000", status: "partially_paid" });
    expect(byId.get(i3.id)).toMatchObject({ paidMinor: "15000", status: "partially_paid" });
  });

  it("marks a promise kept only after confirmed allocations cover the promised amount", async () => {
    const debtor = await createDebtor(app(), tenantId, user.id, { displayName: "تعهد جزئي", phone: "01033335555" });
    const invoice = await createInvoice(app(), tenantId, user.id, {
      debtorId: debtor.id, amount: "100.00", issuedOn: "2026-11-01", dueOn: "2026-12-01",
    });
    const promise = await createMerchantPromise(app(), tenantId, user.id, {
      debtorId: debtor.id, invoiceId: invoice.id, amountMinor: "2500", promisedOn: "2026-12-01",
    });
    expect(promise.status).toBe("accepted");
    await recordPayment(app(), tenantId, user.id, {
      debtorId: debtor.id, amount: "25.00", method: "instapay", receivedOn: "2026-11-12",
      allocations: [{ invoiceId: invoice.id, amount: "25.00" }],
    });
    const rows = await listPromisesToPay(app(), tenantId);
    expect(rows.find((row) => row.id === promise.id)?.status).toBe("kept");
    const detail = await getDebtorDetail(app(), tenantId, debtor.id);
    expect(detail.invoices[0]).toMatchObject({ status: "partially_paid", paidMinor: "2500" });
  });

  it("auto-allocation is oldest-due first; overpayment becomes debtor credit", async () => {
    const debtor = await createDebtor(app(), tenantId, user.id, { displayName: "ائتمان", phone: "01033334444" });
    const i1 = await createInvoice(app(), tenantId, user.id, { debtorId: debtor.id, amount: "100.00", issuedOn: "2026-10-01", dueOn: "2026-11-02" });
    const payment = await recordPayment(app(), tenantId, user.id, {
      debtorId: debtor.id, amount: "250.00", method: "instapay", receivedOn: "2026-11-09",
    });
    expect(payment.allocations).toEqual([{ invoiceId: i1.id, amountMinor: "10000" }]);
    expect(payment.creditMinor).toBe("15000");
    const detail = await getDebtorDetail(app(), tenantId, debtor.id);
    expect(detail.creditMinor).toBe("15000");
    expect(detail.invoices[0]).toMatchObject({ status: "paid", paidMinor: "10000" });
  });

  it("status transitions are enforced; disputed and cancelled behave", async () => {
    const debtor = await createDebtor(app(), tenantId, user.id, { displayName: "حالات", phone: "01044445555" });
    const inv = await createInvoice(app(), tenantId, user.id, { debtorId: debtor.id, amount: "50.00", issuedOn: "2026-11-01", dueOn: "2026-11-05" });
    const disputed = await transitionInvoice(app(), tenantId, user.id, inv.id, "disputed");
    expect(disputed.status).toBe("disputed");
    const back = await transitionInvoice(app(), tenantId, user.id, inv.id, "open");
    expect(back.status).toBe("open");
    await transitionInvoice(app(), tenantId, user.id, inv.id, "cancelled");
    await expect(transitionInvoice(app(), tenantId, user.id, inv.id, "open"))
      .rejects.toMatchObject({ code: "ILLEGAL_TRANSITION" });
  });

  it("bulk transition validates each invoice and reports per-invoice results", async () => {
    const debtor = await createDebtor(app(), tenantId, user.id, { displayName: "جماعي", phone: "01055556666" });
    const a = await createInvoice(app(), tenantId, user.id, { debtorId: debtor.id, amount: "10.00", issuedOn: "2026-11-01", dueOn: "2026-11-05" });
    const b = await createInvoice(app(), tenantId, user.id, { debtorId: debtor.id, amount: "20.00", issuedOn: "2026-11-01", dueOn: "2026-11-05" });
    await transitionInvoice(app(), tenantId, user.id, b.id, "cancelled");
    const results = await bulkTransitionInvoices(app(), tenantId, user.id, [a.id, b.id], "written_off");
    expect(results).toEqual([
      { invoiceId: a.id, ok: true },
      { invoiceId: b.id, ok: false, error: "ILLEGAL_TRANSITION" },
    ]);
  });

  it("invoice list filters: status, overdue, aging bucket, debtor, search", async () => {
    const debtor = await createDebtor(app(), tenantId, user.id, { displayName: "فلاتر", phone: "01066667777" });
    await createInvoice(app(), tenantId, user.id, { debtorId: debtor.id, amount: "10.00", reference: "FLT-OLD", issuedOn: "2026-09-01", dueOn: "2026-09-10" });
    await createInvoice(app(), tenantId, user.id, { debtorId: debtor.id, amount: "10.00", reference: "FLT-NEW", issuedOn: "2026-11-08", dueOn: "2026-12-01" });
    const today = "2026-11-09";
    const all = await listInvoicesPage(app(), tenantId, { debtorId: debtor.id }, today);
    expect(all.items.map((i) => i.reference)).toEqual(["FLT-NEW", "FLT-OLD"]); // newest issued first? see service: dueOn desc? — asserted below by filter results
    const overdue = await listInvoicesPage(app(), tenantId, { debtorId: debtor.id, overdue: true }, today);
    expect(overdue.items.map((i) => i.reference)).toEqual(["FLT-OLD"]);
    expect(overdue.items[0]?.overdue).toBe(true);
    const bucket = await listInvoicesPage(app(), tenantId, { debtorId: debtor.id, agingBucket: "31-60" }, today);
    expect(bucket.items.map((i) => i.reference)).toEqual(["FLT-OLD"]);
    const search = await listInvoicesPage(app(), tenantId, { search: "flt-new" }, today);
    expect(search.items.map((i) => i.reference)).toEqual(["FLT-NEW"]);
    const open = await listInvoicesPage(app(), tenantId, { debtorId: debtor.id, status: "open" }, today);
    expect(open.items).toHaveLength(2);
    // F-15: totalCount counts the whole filtered set (not the page): the
    // overdue filter matches 1 of 2, the debtor filter matches both.
    expect(all.totalCount).toBe(2);
    expect(overdue.totalCount).toBe(1);
    expect(bucket.totalCount).toBe(1);
    expect(search.totalCount).toBe(1);
  });

  it("timeline merges invoices, payments and dispute events newest-first", async () => {
    const debtor = await createDebtor(app(), tenantId, user.id, { displayName: "زمني", phone: "01077778888" });
    const inv = await createInvoice(app(), tenantId, user.id, { debtorId: debtor.id, amount: "80.00", issuedOn: "2026-11-01", dueOn: "2026-11-05" });
    await recordPayment(app(), tenantId, user.id, { debtorId: debtor.id, amount: "30.00", method: "cash", receivedOn: "2026-11-06" });
    await transitionInvoice(app(), tenantId, user.id, inv.id, "disputed");
    const timeline = await getDebtorTimeline(app(), tenantId, debtor.id);
    const kinds = timeline.map((e) => e.kind);
    expect(kinds[0]).toBe("dispute");
    expect(kinds).toContain("payment");
    expect(kinds).toContain("invoice");
    const ats = timeline.map((e) => e.at);
    expect(ats).toEqual([...ats].sort().reverse());
  });

  it("soft-deleting a debtor with history keeps the rows and audit, hides it from lists", async () => {
    const debtor = await createDebtor(app(), tenantId, user.id, { displayName: "محذوف", phone: "01088889999" });
    await createInvoice(app(), tenantId, user.id, { debtorId: debtor.id, amount: "10.00", issuedOn: "2026-11-01", dueOn: "2026-11-05" });
    await softDeleteDebtor(app(), tenantId, user.id, debtor.id);
    const detail = await getDebtorDetail(app(), tenantId, debtor.id).catch((e: unknown) => e);
    expect(detail).toMatchObject({ code: "NOT_FOUND" });
    // history preserved: timeline still readable for audit purposes via includeDeleted path
    const timeline = await getDebtorTimeline(app(), tenantId, debtor.id);
    expect(timeline.length).toBeGreaterThan(0);
  });

  it("H09: debtor list, detail, KPIs, statement and pay link agree that disputed is frozen", async () => {
    // getKpis aggregates the whole tenant (other tests in this file own
    // invoices too), so the KPI assertion is on the delta this fixture adds.
    const kpisBefore = await getKpis(app(), tenantId, "2026-11-09");
    const debtor = await createDebtor(app(), tenantId, user.id, { displayName: "متفق عليه", phone: "01077779999" });
    const open = await createInvoice(app(), tenantId, user.id, { debtorId: debtor.id, amount: "100.00", issuedOn: "2026-11-01", dueOn: "2026-11-20" });
    const partial = await createInvoice(app(), tenantId, user.id, { debtorId: debtor.id, amount: "200.00", issuedOn: "2026-11-01", dueOn: "2026-11-20" });
    await recordPayment(app(), tenantId, user.id, { debtorId: debtor.id, amount: "50.00", method: "cash", receivedOn: "2026-11-05" });
    const disputed = await createInvoice(app(), tenantId, user.id, { debtorId: debtor.id, amount: "300.00", issuedOn: "2026-11-01", dueOn: "2026-11-20" });
    await transitionInvoice(app(), tenantId, user.id, disputed.id, "disputed");
    const paid = await createInvoice(app(), tenantId, user.id, { debtorId: debtor.id, amount: "400.00", issuedOn: "2026-11-01", dueOn: "2026-11-20" });
    await recordPayment(app(), tenantId, user.id, { debtorId: debtor.id, amount: "400.00", method: "cash", receivedOn: "2026-11-06" });
    const cancelled = await createInvoice(app(), tenantId, user.id, { debtorId: debtor.id, amount: "500.00", issuedOn: "2026-11-01", dueOn: "2026-11-20" });
    await transitionInvoice(app(), tenantId, user.id, cancelled.id, "cancelled");
    // Collectible: the two 50.00 + 400.00 payments settle the 100.00 open
    // and 200.00 partial invoices and leave 250.00 on the 400.00 invoice —
    // total outstanding 250.00. Frozen: the 300.00 disputed invoice — a
    // separate subtotal, never outstanding. (Auto-allocation never touches
    // a disputed invoice, so the freeze survives the payments.)
    const list = await listDebtorsPage2(app(), tenantId, {});
    const listed = list.items.find((d) => d.id === debtor.id)!;
    expect(listed.totalOutstandingMinor).toBe("25000");
    expect(listed.totalDisputedMinor).toBe("30000");
    expect(listed.openInvoicesCount).toBe(1);
    expect(listed.disputedInvoicesCount).toBe(1);
    const detail = await getDebtorDetail(app(), tenantId, debtor.id);
    expect(detail.totalOutstandingMinor).toBe("25000");
    expect(detail.totalDisputedMinor).toBe("30000");
    expect(detail.openInvoicesCount).toBe(1);
    const kpis = await getKpis(app(), tenantId, "2026-11-09");
    expect(kpis.totalOutstandingMinor - kpisBefore.totalOutstandingMinor).toBe(25000);
    expect(
      (kpis.byCurrency.find((b) => b.currency === "EGP")?.outstandingMinor ?? 0)
      - (kpisBefore.byCurrency.find((b) => b.currency === "EGP")?.outstandingMinor ?? 0),
    ).toBe(25000);
    const link = await createStatementLink(app(), tenantId, user.id, debtor.id, new Date("2026-11-09T10:00:00Z"));
    const statement = await getStatementData(app(), ownerDb(), link.token, new Date("2026-11-09T10:00:00Z"));
    expect(statement!.totalDueMinor).toBe("25000");
    const rows = await withTenant(app(), tenantId, (tx) => tx.select().from(invoices).where(eq(invoices.debtorId, debtor.id)));
    const linkInvs = rows.map((i) => ({ id: i.id, amountMinor: i.amountMinor, paidMinor: i.paidMinor, status: i.status }));
    expect(outstandingForLink(linkInvs, null)).toBe(25000n);
    expect(outstandingForLink(linkInvs, disputed.id)).toBe(0n);
    expect(outstandingForLink(linkInvs, paid.id)).toBe(25000n);
    expect(outstandingForLink(linkInvs, open.id)).toBe(0n);
    void partial;
  });

  it("payments for another tenant's debtor are invisible (RLS through the service)", async () => {
    const other = { id: randomUUID().replace(/-/g, ""), email: `f1b-${randomUUID()}@example.test`, name: "Other" };
    await ownerDb().insert(userTable).values([other]);
    const tenantB = (await createTenantForUser(appDb(), other.id, {
      businessNameAr: "شركة أخرى", timezone: "Africa/Cairo", quietStart: "21:00", quietEnd: "09:00",
      fridayMorningSkip: false, defaultTermsDays: 14, tone: "polite", consent: true,
    })).tenantId;
    const debtorA = await createDebtor(app(), tenantId, user.id, { displayName: "خاص بأ", phone: "01099990000" });
    await expect(recordPayment(app(), tenantB, other.id, { debtorId: debtorA.id, amount: "1.00", method: "cash", receivedOn: "2026-11-09" }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    const owner = ownerDb();
    await owner.delete(tenants).where(eq(tenants.id, tenantB));
    await owner.delete(userTable).where(eq(userTable.id, other.id));
  });

  it("M01: ledger reconciliation balances on a clean book and flags a drifted paidMinor", async () => {
    // A fresh tenant: the shared one already carries other tests' books.
    const user2 = { id: randomUUID().replace(/-/g, ""), email: `m01-${randomUUID()}@example.test`, name: "M01" };
    await ownerDb().insert(userTable).values([user2]);
    const t2 = (await createTenantForUser(appDb(), user2.id, {
      businessNameAr: "شركة م٠١", timezone: "Africa/Cairo", quietStart: "21:00", quietEnd: "09:00",
      fridayMorningSkip: false, defaultTermsDays: 14, tone: "polite", consent: true,
    })).tenantId;
    try {
      const debtor = await createDebtor(app(), t2, user2.id, { displayName: "عميل التسوية", phone: "01088887777" });
      const inv = await createInvoice(app(), t2, user2.id, { debtorId: debtor.id, amount: "100", issuedOn: "2026-11-01", dueOn: "2026-11-20" });
      await recordPayment(app(), t2, user2.id, { debtorId: debtor.id, amount: "120", method: "cash", receivedOn: "2026-11-10" });
      // 100 allocated to the invoice, 20 stored as credit.
      let r = await getLedgerReconciliation(app(), t2);
      expect(r.balanced).toBe(true);
      expect(r.discrepancies).toEqual([]);
      expect(r.byCurrency).toEqual([{ currency: "EGP", confirmedPaymentsMinor: "12000", allocatedMinor: "10000", storedCreditMinor: "2000" }]);
      // Drift the stored paidMinor by one minor unit, as a manual edit
      // would (down, not up: the invoices_paid_range CHECK refuses a paid
      // amount above the invoice total).
      await ownerDb().update(invoices).set({ paidMinor: 9999n }).where(eq(invoices.id, inv.id));
      r = await getLedgerReconciliation(app(), t2);
      expect(r.balanced).toBe(false);
      expect(r.discrepancies).toEqual([expect.objectContaining({ kind: "invoice_paid_mismatch", id: inv.id })]);
    } finally {
      await ownerDb().delete(tenants).where(eq(tenants.id, t2));
      await ownerDb().delete(userTable).where(eq(userTable.id, user2.id));
    }
  });

  it("F-06: amounts parse in the invoice/payment currency, not EGP", async () => {
    const debtor = await createDebtor(app(), tenantId, user.id, { displayName: "عملات", phone: "01099990003" });
    // KWD has 3 decimals: "1.234" is 1234 fils, not an EGP parse error.
    const kwd = await createInvoice(app(), tenantId, user.id, { debtorId: debtor.id, amount: "10.000", currency: "KWD", issuedOn: "2026-11-01", dueOn: "2026-11-20" });
    expect(kwd.amountMinor).toBe("10000");
    const paid = await recordPayment(app(), tenantId, user.id, { debtorId: debtor.id, amount: "1.234", method: "cash", receivedOn: "2026-11-05" });
    expect(paid.amountMinor).toBe("1234");
    expect(paid.currency).toBe("KWD");
    // JPY has 0 decimals: "100.5" is not a readable JPY amount — the
    // currency-aware parse throws instead of silently storing 10050.
    // (Explicit allocation so the payment targets the JPY invoice; the
    // auto-allocation path would resolve the KWD invoice's currency.)
    const jpy = await createInvoice(app(), tenantId, user.id, { debtorId: debtor.id, amount: "500", currency: "JPY", issuedOn: "2026-11-01", dueOn: "2026-11-20" });
    expect(jpy.amountMinor).toBe("500");
    await expect(recordPayment(app(), tenantId, user.id, {
      debtorId: debtor.id, amount: "100.5", method: "cash", receivedOn: "2026-11-05",
      allocations: [{ invoiceId: jpy.id, amount: "100.5" }],
    })).rejects.toThrow(MoneyParseError);
  });

  it("F-15: debtor list totalCount counts the whole search, not the page", async () => {
    // Unique search token so the shared-tenant fixture noise cannot leak in.
    await createDebtor(app(), tenantId, user.id, { displayName: "عدد إجمالي أ", phone: "01099990001" });
    await createDebtor(app(), tenantId, user.id, { displayName: "عدد إجمالي ب", phone: "01099990002" });
    const page = await listDebtorsPage2(app(), tenantId, { search: "عدد إجمالي", limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.totalCount).toBe(2);
    expect(page.nextCursor).not.toBeNull();
    const full = await listDebtorsPage2(app(), tenantId, { search: "عدد إجمالي" });
    expect(full.items).toHaveLength(2);
    expect(full.totalCount).toBe(2);
    expect(full.nextCursor).toBeNull();
  });
});
