import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { ownerDb, appDb } from "./db";
import { user as userTable, tenants } from "@tahseel/db/schema";
import { createTenantForUser } from "./services";
import {
  createDebtor, createInvoice, recordPayment, transitionInvoice, bulkTransitionInvoices,
  softDeleteDebtor, getDebtorTimeline, listInvoicesPage, getDebtorDetail,
} from "./ledger";

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
});
