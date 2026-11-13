import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { ownerDb, appDb } from "./db";
import { user as userTable, tenants, payments, usageLedger, reminders } from "@tahseel/db/schema";
import { withTenant } from "@tahseel/db";
import { createTenantForUser } from "./services";
import { createDebtor, createInvoice, recordPayment, getDebtorDetail, transitionInvoice } from "./ledger";
import { registerCheque, transitionCheque, listCheques, runChequeAlerts, listChequeAlerts } from "./cheques";
import { confirmClaimedPayment } from "./gateway";
import { getQuotaStatus, changePlan, generateSubscriptionInvoices, listSubscriptionInvoices } from "./billing";
import { getKpis, getKpisReference, getForecast, loadCollectedByInvoice, exportDebtorsCsv } from "./reports";
import { FakePaymentProvider, FakeMessagingProvider } from "@tahseel/providers";
import { dispatchDue, planForInvoice, quotaExceededFromDb, type EngineDeps } from "@tahseel/reminders";
import { addDaysIso, localDateOf } from "@tahseel/core";

/**
 * M5 acceptance at the service layer, on real Postgres + RLS.
 * F9: deposit -> claimed payment -> clear -> paid; bounce while claimed ->
 * rejected; bounce after a merchant-confirmed payment -> reversal reopens
 * exactly + risk flag; alerts idempotent; cross-tenant invisible.
 * F13: quota warn at 80%, dispatcher blocks at 100% with quota_exceeded;
 * plan change via the FAKE provider; subscription invoice job idempotent.
 * F11/F12: KPI service on a hand fixture; forecast enough vs not-enough.
 */
const hasDb = Boolean(process.env.DATABASE_URL && (process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL));
if (!hasDb && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 but DB env missing");
const d = hasDb ? describe : describe.skip;

d("M5 services (F9/F11/F12/F13)", () => {
  const user = { id: randomUUID().replace(/-/g, ""), email: `m5-${randomUUID()}@example.test`, name: "M5" };
  let tenantA = "";
  let tenantB = "";
  let debtorA = "";
  const app = () => appDb();
  const tenantInput = {
    businessNameAr: "شركة م٥", timezone: "Africa/Cairo", quietStart: "21:00", quietEnd: "09:00",
    fridayMorningSkip: false, defaultTermsDays: 14, tone: "polite" as const, consent: true as const,
  };
  const today = localDateOf(new Date(), "Africa/Cairo");

  beforeAll(async () => {
    await ownerDb().insert(userTable).values([user]);
    tenantA = (await createTenantForUser(appDb(), user.id, tenantInput)).tenantId;
    tenantB = (await createTenantForUser(appDb(), user.id, { ...tenantInput, businessNameAr: "شركة م٥ ب" })).tenantId;
    const debtor = await createDebtor(app(), tenantA, user.id, { displayName: "عميل الشيكات", phone: "01012345678" });
    debtorA = debtor.id;
  });
  afterAll(async () => {
    const owner = ownerDb();
    await owner.delete(tenants).where(eq(tenants.id, tenantA));
    await owner.delete(tenants).where(eq(tenants.id, tenantB));
    await owner.delete(userTable).where(eq(userTable.id, user.id));
  });

  it("F9 lifecycle: deposit creates a CLAIMED payment; clear confirms it and pays the invoice", async () => {
    const inv = await createInvoice(app(), tenantA, user.id, { debtorId: debtorA, amount: "1000", issuedOn: today, dueOn: addDaysIso(today, 7) });
    const cheque = await registerCheque(app(), tenantA, user.id, {
      debtorId: debtorA, direction: "receivable", number: "1001", bank: "CIB", amount: "1000",
      issueDate: today, dueDate: addDaysIso(today, 3), invoiceId: inv.id,
    });
    expect(cheque.status).toBe("held");
    const deposited = await transitionCheque(app(), tenantA, user.id, cheque.id, "deposited", today);
    expect(deposited.paymentId).toBeTruthy();
    let detail = await getDebtorDetail(app(), tenantA, debtorA, today);
    const claim = detail.payments.find((p) => p.id === deposited.paymentId);
    expect(claim).toMatchObject({ status: "claimed", method: "cheque" });
    // Claimed money does NOT move paid_minor.
    expect(detail.invoices.find((i) => i.id === inv.id)).toMatchObject({ status: "open", paidMinor: "0" });

    await transitionCheque(app(), tenantA, user.id, cheque.id, "cleared", today);
    detail = await getDebtorDetail(app(), tenantA, debtorA, today);
    expect(detail.invoices.find((i) => i.id === inv.id)).toMatchObject({ status: "paid", paidMinor: "100000" });
    expect(detail.payments.find((p) => p.id === deposited.paymentId)).toMatchObject({ status: "confirmed" });
  });

  it("F9 bounce while claimed: payment rejected, invoice untouched, risk flag set", async () => {
    const inv = await createInvoice(app(), tenantA, user.id, { debtorId: debtorA, amount: "500", issuedOn: today, dueOn: addDaysIso(today, 7) });
    const cheque = await registerCheque(app(), tenantA, user.id, {
      debtorId: debtorA, direction: "receivable", number: "1002", bank: "NBE", amount: "500",
      issueDate: today, dueDate: addDaysIso(today, 3), invoiceId: inv.id,
    });
    const deposited = await transitionCheque(app(), tenantA, user.id, cheque.id, "deposited", today);
    await transitionCheque(app(), tenantA, user.id, cheque.id, "bounced", today);
    const detail = await getDebtorDetail(app(), tenantA, debtorA, today);
    expect(detail.payments.find((p) => p.id === deposited.paymentId)).toMatchObject({ status: "rejected" });
    expect(detail.invoices.find((i) => i.id === inv.id)).toMatchObject({ status: "open", paidMinor: "0" });
    expect(detail.riskFlag).toBe(true);
  });

  it("F9 bounce after the claim was merchant-confirmed: reversing payment reopens the invoice by exactly the cheque amount", async () => {
    const inv = await createInvoice(app(), tenantA, user.id, { debtorId: debtorA, amount: "400", issuedOn: today, dueOn: addDaysIso(today, 7) });
    const cheque = await registerCheque(app(), tenantA, user.id, {
      debtorId: debtorA, direction: "receivable", number: "1003", bank: "QNB", amount: "400",
      issueDate: today, dueDate: addDaysIso(today, 3), invoiceId: inv.id,
    });
    const deposited = await transitionCheque(app(), tenantA, user.id, cheque.id, "deposited", today);
    // Merchant confirms the claim early (M3 path); the bank then bounces the cheque.
    await confirmClaimedPayment(app(), tenantA, user.id, deposited.paymentId!);
    let detail = await getDebtorDetail(app(), tenantA, debtorA, today);
    expect(detail.invoices.find((i) => i.id === inv.id)).toMatchObject({ status: "paid", paidMinor: "40000" });
    await transitionCheque(app(), tenantA, user.id, cheque.id, "bounced", today);
    detail = await getDebtorDetail(app(), tenantA, debtorA, today);
    expect(detail.invoices.find((i) => i.id === inv.id)).toMatchObject({ status: "open", paidMinor: "0" });
    const reversal = detail.payments.find((p) => p.reversalOf === deposited.paymentId);
    expect(reversal).toMatchObject({ amountMinor: "-40000", status: "confirmed", method: "cheque" });
  });

  it("F9 illegal transitions are refused; cross-tenant cheques are invisible", async () => {
    const cheque = await registerCheque(app(), tenantA, user.id, {
      debtorId: debtorA, direction: "payable", number: "2001", bank: "CIB", amount: "250",
      issueDate: today, dueDate: addDaysIso(today, 10),
    });
    await expect(transitionCheque(app(), tenantA, user.id, cheque.id, "cleared", today)).rejects.toMatchObject({ code: "ILLEGAL_TRANSITION" });
    const inB = await listCheques(app(), tenantB);
    expect(inB.find((c) => c.id === cheque.id)).toBeUndefined();
    await expect(transitionCheque(app(), tenantB, user.id, cheque.id, "deposited", today)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Payable deposit creates NO payment.
    const deposited = await transitionCheque(app(), tenantA, user.id, cheque.id, "deposited", today);
    expect(deposited.paymentId).toBeNull();
  });

  it("F9 alerts: due in 3 days fires once — a second run creates nothing", async () => {
    await registerCheque(app(), tenantA, user.id, {
      debtorId: debtorA, direction: "receivable", number: "3001", bank: "CIB", amount: "100",
      issueDate: today, dueDate: addDaysIso(today, 3),
    });
    const first = await runChequeAlerts(app(), tenantA, today);
    expect(first.some((a) => a.alertKind === "due_in_3_days")).toBe(true);
    const second = await runChequeAlerts(app(), tenantA, today);
    expect(second).toHaveLength(0);
    expect((await listChequeAlerts(app(), tenantA)).length).toBeGreaterThan(0);
  });

  it("F11 KPI service matches a hand fixture; CSV export is BOM-prefixed and tenant-scoped", async () => {
    // tenantB is a clean book: one debtor, one open invoice of 200 EGP due yesterday, nothing paid.
    const debtorB = await createDebtor(app(), tenantB, user.id, { displayName: "عميل التقارير", phone: "01098765432" });
    await createInvoice(app(), tenantB, user.id, { debtorId: debtorB.id, amount: "200", issuedOn: addDaysIso(today, -10), dueOn: addDaysIso(today, -1) });
    const kpis = await getKpis(app(), tenantB, today);
    expect(kpis.totalOutstandingMinor).toBe(20000);
    expect(kpis.overdueAmountMinor).toBe(20000);
    expect(kpis.collectedInMonthMinor).toBe(0);
    expect(kpis.collectionRate).toBe(0);
    expect(kpis.agingBuckets["0-7"]).toBe(20000);
    expect(kpis.topDebtors).toEqual([{ debtorId: debtorB.id, displayName: "عميل التقارير", outstandingMinor: 20000 }]);
    const csv = await exportDebtorsCsv(app(), tenantB);
    expect(csv.csv.startsWith("\uFEFF")).toBe(true);
    expect(csv.csv).toContain("عميل التقارير");
    expect(csv.csv).not.toContain("عميل الشيكات");
  });

  it("M03: a June payment refunded in July keeps June's collected and shows July's refund", async () => {
    const debtor = await createDebtor(app(), tenantB, user.id, { displayName: "عميل الاسترداد", phone: "01099998888" });
    const june = await getKpis(app(), tenantB, "2026-06-15");
    const july = await getKpis(app(), tenantB, "2026-07-15");
    await withTenant(app(), tenantB, async (tx) => {
      await tx.insert(payments).values([
        { id: randomUUID().replace(/-/g, ""), tenantId: tenantB, debtorId: debtor.id, amountMinor: 10000n, currency: "EGP", method: "cash", receivedOn: "2026-06-28", status: "confirmed", source: "manual" },
        { id: randomUUID().replace(/-/g, ""), tenantId: tenantB, debtorId: debtor.id, amountMinor: -10000n, currency: "EGP", method: "cash", receivedOn: "2026-07-02", status: "confirmed", source: "manual" },
      ]);
    });
    // June is untouched by the July refund: collected 10000, refunded 0.
    const juneAfter = await getKpis(app(), tenantB, "2026-06-15");
    expect(juneAfter.collectedInMonthMinor - june.collectedInMonthMinor).toBe(10000);
    expect(juneAfter.refundedInMonthMinor - (june.refundedInMonthMinor ?? 0)).toBe(0);
    // July does not look like a bad collections month: collected 0 and
    // refunded 10000 as its own line, with a 0 (never negative) rate.
    const julyAfter = await getKpis(app(), tenantB, "2026-07-15");
    expect(julyAfter.collectedInMonthMinor - july.collectedInMonthMinor).toBe(0);
    expect(julyAfter.refundedInMonthMinor - (july.refundedInMonthMinor ?? 0)).toBe(10000);
    // The in-memory reference path agrees number-for-number.
    const refJune = await getKpisReference(app(), tenantB, "2026-06-15");
    const refJuly = await getKpisReference(app(), tenantB, "2026-07-15");
    expect(refJune.collectedInMonthMinor - june.collectedInMonthMinor).toBe(10000);
    expect(refJune.refundedInMonthMinor - (june.refundedInMonthMinor ?? 0)).toBe(0);
    expect(refJuly.collectedInMonthMinor - july.collectedInMonthMinor).toBe(0);
    expect(refJuly.refundedInMonthMinor - (july.refundedInMonthMinor ?? 0)).toBe(10000);
  });

  it("F12 forecast service: not-enough-data under 10 paid invoices, a real forecast at 10", async () => {
    const debtorB2 = await createDebtor(app(), tenantB, user.id, { displayName: "عميل التوقع", phone: "01055554444" });
    // 9 paid invoices: still not enough.
    for (let i = 0; i < 9; i++) {
      const inv = await createInvoice(app(), tenantB, user.id, { debtorId: debtorB2.id, amount: "100", issuedOn: addDaysIso(today, -60), dueOn: addDaysIso(today, -50) });
      await recordPayment(app(), tenantB, user.id, { debtorId: debtorB2.id, amount: "100", method: "cash", receivedOn: addDaysIso(today, -45) });
      void inv;
    }
    let f = await getForecast(app(), tenantB, today);
    expect(f.enoughData).toBe(false);
    // The 10th paid invoice unlocks the forecast; the open invoice lands somewhere in the 8 weeks.
    await createInvoice(app(), tenantB, user.id, { debtorId: debtorB2.id, amount: "100", issuedOn: addDaysIso(today, -60), dueOn: addDaysIso(today, -50) });
    await recordPayment(app(), tenantB, user.id, { debtorId: debtorB2.id, amount: "100", method: "cash", receivedOn: addDaysIso(today, -45) });
    await createInvoice(app(), tenantB, user.id, { debtorId: debtorB2.id, amount: "700", issuedOn: today, dueOn: addDaysIso(today, 2) });
    f = await getForecast(app(), tenantB, today);
    expect(f.enoughData).toBe(true);
    // 70000 for the new open invoice + 20000 for the F11 fixture's still-open
    // invoice in the same tenant — both land inside the 8-week horizon.
    expect(f.weeks.reduce((s, w) => s + w.expectedMinor, 0)).toBe(90000);
  });

  it("M04: forecast is single-currency, reports beyond-horizon, and trains on collected sums", async () => {
    const before = await getForecast(app(), tenantB, today);
    expect(before.enoughData).toBe(true);
    expect(before.currency).toBe("EGP");
    const weeksBefore = before.weeks.reduce((s, w) => s + w.expectedMinor, 0);
    const debtor = await createDebtor(app(), tenantB, user.id, { displayName: "عميل التوقع ٢", phone: "01055557777" });
    // A USD open invoice must not move the EGP forecast at all (F02).
    await createInvoice(app(), tenantB, user.id, { debtorId: debtor.id, amount: "1000", currency: "USD", issuedOn: today, dueOn: addDaysIso(today, 2) });
    // An EGP open invoice due 70 days out lands past the 8-week horizon.
    await createInvoice(app(), tenantB, user.id, { debtorId: debtor.id, amount: "420", issuedOn: today, dueOn: addDaysIso(today, 70) });
    const after = await getForecast(app(), tenantB, today);
    expect(after.weeks.reduce((s, w) => s + w.expectedMinor, 0)).toBe(weeksBefore);
    expect(after.beyondHorizon.expectedMinor - before.beyondHorizon.expectedMinor).toBe(42000);
    expect(after.beyondHorizon.conservativeMinor - before.beyondHorizon.conservativeMinor).toBe(42000);
    // A paid invoice with only part collected trains on the collected sum.
    const partial = await createInvoice(app(), tenantB, user.id, { debtorId: debtor.id, amount: "100", issuedOn: addDaysIso(today, -60), dueOn: addDaysIso(today, -50) });
    await recordPayment(app(), tenantB, user.id, { debtorId: debtor.id, amount: "40", method: "cash", receivedOn: addDaysIso(today, -45) });
    await transitionInvoice(app(), tenantB, user.id, partial.id, "paid");
    const collected = await withTenant(app(), tenantB, (tx) => loadCollectedByInvoice(tx));
    expect(collected.get(partial.id)).toBe(4000n);
  });

  it("F13 quota: warn at 80%, and the dispatcher blocks at 100% with quota_exceeded and sends nothing", async () => {
    // tenantA is on trial (quota 100). 80 units -> warn; 100 -> exceeded.
    await withTenant(app(), tenantA, async (tx) => {
      await tx.insert(usageLedger).values({ tenantId: tenantA, kind: "whatsapp_utility", units: 80, costEstimateMinor: 0n });
    });
    let qs = await getQuotaStatus(app(), tenantA, new Date());
    expect(qs).toMatchObject({ used: 80, quota: 100, state: "warn" });
    await withTenant(app(), tenantA, async (tx) => {
      await tx.insert(usageLedger).values({ tenantId: tenantA, kind: "whatsapp_utility", units: 20, costEstimateMinor: 0n });
    });
    qs = await getQuotaStatus(app(), tenantA, new Date());
    expect(qs.state).toBe("exceeded");

    // A due reminder for tenantA must be skipped, never sent.
    const debtorQ = await createDebtor(app(), tenantA, user.id, { displayName: "عميل الحصة", phone: "01066667777" });
    const inv = await createInvoice(app(), tenantA, user.id, { debtorId: debtorQ.id, amount: "100", issuedOn: today, dueOn: addDaysIso(today, 3) });
    const whatsapp = new FakeMessagingProvider();
    const engine: EngineDeps = {
      app: appDb(), owner: ownerDb(),
      providers: { whatsapp, sms: new FakeMessagingProvider() },
      quotaExceeded: (t) => quotaExceededFromDb(appDb(), t, new Date()),
    };
    // createInvoice already fired the app's re-plan hook; poll for its rows
    // instead of planning again (a second plan races the fire-and-forget one).
    for (let i = 0; i < 50; i++) {
      const rows = await withTenant(app(), tenantA, async (tx) => tx.select().from(reminders).where(eq(reminders.invoiceId, inv.id)));
      if (rows.length > 0) break;
      if (i === 49) await planForInvoice(engine, tenantA, inv.id, new Date());
      await new Promise((r) => setTimeout(r, 100));
    }
    // Force the d-3 step due now.
    await withTenant(app(), tenantA, async (tx) => {
      await tx.update(reminders).set({ dueAt: new Date(Date.now() - 60_000) }).where(eq(reminders.invoiceId, inv.id));
    });
    const summary = await dispatchDue(engine, new Date(), { tenantId: tenantA });
    expect(whatsapp.sent).toHaveLength(0);
    expect(summary.skipped["quota_exceeded"]).toBeGreaterThan(0);
  });

  it("F13 changePlan: paid plans are refused while prices are placeholders; free trial applies immediately; the billing job is idempotent", async () => {
    const provider = new FakePaymentProvider();
    // Placeholder prices (HUMAN_INPUTS #10, undecided) must never be sold —
    // not even through the dev fake provider, which used to mark the
    // invoice paid and flip the plan immediately.
    // AppError carries its machine code on `.code` (the message is the
    // human text), so assert the code + status, not a message match.
    await expect(
      changePlan({ app: app(), provider, providerIsFake: true }, tenantB, user.id, { planKey: "starter" }, new Date()),
    ).rejects.toMatchObject({ code: "PRICING_NOT_FINAL", status: 409 });
    const [stillTrial] = await ownerDb().select().from(tenants).where(eq(tenants.id, tenantB));
    expect(stillTrial!.plan).toBe("trial");
    expect(await listSubscriptionInvoices(app(), tenantB)).toHaveLength(0);

    const result = await changePlan({ app: app(), provider, providerIsFake: true }, tenantB, user.id, { planKey: "trial" }, new Date());
    expect(result.effectiveImmediately).toBe(true);
    expect(result.invoice).toMatchObject({ planKey: "trial", status: "paid", amountMinor: "0" });
    const [tenant] = await ownerDb().select().from(tenants).where(eq(tenants.id, tenantB));
    expect(tenant!.plan).toBe("trial");
    const g1 = await generateSubscriptionInvoices(ownerDb(), app(), new Date());
    const g2 = await generateSubscriptionInvoices(ownerDb(), app(), new Date());
    expect(g1.generated).toBe(0); // trial tenants are skipped by the job
    expect(g2.generated).toBe(0);
    const invoices = await listSubscriptionInvoices(app(), tenantB);
    expect(invoices.filter((i) => i.planKey === "trial")).toHaveLength(1);
    void payments; void invoices;
  });
});
