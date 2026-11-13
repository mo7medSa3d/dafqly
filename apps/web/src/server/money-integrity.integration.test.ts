import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { ownerDb, appDb } from "./db";
import { user as userTable, tenants, payments, debtors } from "@tahseel/db/schema";
import { withTenant } from "@tahseel/db";
import { createTenantForUser } from "./services";
import {
  createDebtor, createInvoice, recordPayment, getDebtorDetail, listInvoicesPage, updateInvoice,
} from "./ledger";
import { registerCheque, transitionCheque } from "./cheques";
import { getKpis } from "./reports";
import { addDaysIso, localDateOf } from "@tahseel/core";

/**
 * Prompt 02 money-integrity acceptance (audit F01/F02/F04/F05/F06, H05/H06/H07),
 * on real Postgres + RLS. Each test pins the invariant the old code violated:
 * concurrent payments double-allocating, retried payments double-recording,
 * overpayment credit vanishing, racy invoice references, terminal-invoice
 * edits, and the 1,000-row list cap.
 */
const hasDb = Boolean(process.env.DATABASE_URL && (process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL));
if (!hasDb && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 but DB env missing");
const d = hasDb ? describe : describe.skip;

d("money integrity (Prompt 02)", () => {
  const user = { id: randomUUID().replace(/-/g, ""), email: `mi-${randomUUID()}@example.test`, name: "MI" };
  let tenant = "";
  let debtor = "";
  const app = () => appDb();
  const today = localDateOf(new Date(), "Africa/Cairo");

  beforeAll(async () => {
    await ownerDb().insert(userTable).values([user]);
    tenant = (await createTenantForUser(appDb(), user.id, {
      businessNameAr: "شركة سلامة مالية", timezone: "Africa/Cairo", quietStart: "21:00", quietEnd: "09:00",
      fridayMorningSkip: false, defaultTermsDays: 14, tone: "polite" as const, consent: true as const,
    })).tenantId;
    const created = await createDebtor(app(), tenant, user.id, { displayName: "عميل السلامة", phone: "01098765432" });
    debtor = created.id;
  });
  afterAll(async () => {
    const owner = ownerDb();
    await owner.delete(tenants).where(eq(tenants.id, tenant));
    await owner.delete(userTable).where(eq(userTable.id, user.id));
  });

  it("F01: two concurrent full payments allocate the outstanding once, never 2x", async () => {
    const inv = await createInvoice(app(), tenant, user.id, { debtorId: debtor, amount: "1000", issuedOn: today, dueOn: addDaysIso(today, 7) });
    const [first, second] = await Promise.all([
      recordPayment(app(), tenant, user.id, { debtorId: debtor, amount: "1000", receivedOn: today }),
      recordPayment(app(), tenant, user.id, { debtorId: debtor, amount: "1000", receivedOn: today }),
    ]);
    const detail = await getDebtorDetail(app(), tenant, debtor, today);
    const row = detail.invoices.find((i) => i.id === inv.id)!;
    expect(row.paidMinor).toBe("100000");
    expect(row.status).toBe("paid");
    // The second payment found nothing left to allocate: it is pure credit.
    const totalAllocated = [first, second].reduce((s, v) => s + BigInt(v.allocatedMinor), 0n);
    expect(totalAllocated).toBe(100000n);
    expect(detail.creditMinor).toBe("100000");
    expect(detail.creditCurrency).toBe("EGP");
  });

  it("F04: the same idempotency key twice records the money once", async () => {
    // Fresh debtor: the shared one may carry credit from the F01 test.
    const debtorRow = await createDebtor(app(), tenant, user.id, { displayName: "عميل عدم التكرار", phone: "01022223333" });
    const inv = await createInvoice(app(), tenant, user.id, { debtorId: debtorRow.id, amount: "500", issuedOn: today, dueOn: addDaysIso(today, 7) });
    const key = `idem-${randomUUID()}`;
    const first = await recordPayment(app(), tenant, user.id, { debtorId: debtorRow.id, amount: "500", receivedOn: today, idempotencyKey: key });
    const second = await recordPayment(app(), tenant, user.id, { debtorId: debtorRow.id, amount: "500", receivedOn: today, idempotencyKey: key });
    expect(second.id).toBe(first.id);
    const detail = await getDebtorDetail(app(), tenant, debtorRow.id, today);
    expect(detail.invoices.find((i) => i.id === inv.id)).toMatchObject({ status: "paid", paidMinor: "50000" });
    const rows = await withTenant(app(), tenant, async (tx) =>
      tx.select().from(payments).where(eq(payments.idempotencyKey, key)));
    expect(rows).toHaveLength(1);
  });

  it("F05: overpayment credit persists and is consumed by the next payment", async () => {
    const debtorRow = await createDebtor(app(), tenant, user.id, { displayName: "عميل الرصيد الدائن", phone: "01044445555" });
    const inv1 = await createInvoice(app(), tenant, user.id, { debtorId: debtorRow.id, amount: "300", issuedOn: today, dueOn: addDaysIso(today, 7) });
    const over = await recordPayment(app(), tenant, user.id, { debtorId: debtorRow.id, amount: "500", receivedOn: today });
    expect(over.creditMinor).toBe("20000");
    const stored = await withTenant(app(), tenant, async (tx) =>
      tx.select({ creditMinor: debtors.creditMinor }).from(debtors).where(eq(debtors.id, debtorRow.id)));
    expect(stored[0]!.creditMinor).toBe(20000n);
    // Next payment of 100 cash allocates 100 + 200 credit = 300 against inv2.
    const inv2 = await createInvoice(app(), tenant, user.id, { debtorId: debtorRow.id, amount: "300", issuedOn: today, dueOn: addDaysIso(today, 7) });
    const next = await recordPayment(app(), tenant, user.id, { debtorId: debtorRow.id, amount: "100", receivedOn: today });
    expect(next.allocatedMinor).toBe("30000");
    expect(next.creditMinor).toBe("0");
    const detail = await getDebtorDetail(app(), tenant, debtorRow.id, today);
    expect(detail.invoices.find((i) => i.id === inv1.id)).toMatchObject({ status: "paid" });
    expect(detail.invoices.find((i) => i.id === inv2.id)).toMatchObject({ status: "paid" });
    expect(detail.creditMinor).toBe("0");
  });

  it("H05: concurrent invoice creation yields distinct sequential references", async () => {
    const created = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      createInvoice(app(), tenant, user.id, { debtorId: debtor, amount: `${10 + i}`, issuedOn: today, dueOn: addDaysIso(today, 7) })));
    const refs = created.map((c) => c.reference);
    expect(new Set(refs).size).toBe(10);
    const seqs = refs.map((r) => Number(r!.split("-").pop())).sort((a, b) => a - b);
    for (let i = 1; i < seqs.length; i++) expect(seqs[i]).toBe(seqs[i - 1]! + 1);
    // A merchant-supplied duplicate reference is refused, not crashed on.
    await expect(createInvoice(app(), tenant, user.id, {
      debtorId: debtor, amount: "10", issuedOn: today, dueOn: addDaysIso(today, 7), reference: refs[0]!,
    })).rejects.toMatchObject({ code: "DUPLICATE_REFERENCE", status: 409 });
  });

  it("H06: a paid invoice cannot be edited (except its description)", async () => {
    const inv = await createInvoice(app(), tenant, user.id, { debtorId: debtor, amount: "200", issuedOn: today, dueOn: addDaysIso(today, 7) });
    await recordPayment(app(), tenant, user.id, { debtorId: debtor, amount: "200", receivedOn: today });
    await expect(updateInvoice(app(), tenant, user.id, inv.id, { amount: "250" }, today))
      .rejects.toMatchObject({ code: "INVOICE_TERMINAL", status: 409 });
    const edited = await updateInvoice(app(), tenant, user.id, inv.id, { description: "corrected note" }, today);
    expect(edited.description).toBe("corrected note");
    expect(edited.status).toBe("paid");
  });

  it("H07: overdue/aging filters run in SQL — no 1,000-row cap, keyset paging works", async () => {
    const debtorRow = await createDebtor(app(), tenant, user.id, { displayName: "عميل القوائم", phone: "01011112222" });
    for (let i = 0; i < 12; i++) {
      await createInvoice(app(), tenant, user.id, {
        debtorId: debtorRow.id, amount: "10", issuedOn: addDaysIso(today, -30), dueOn: addDaysIso(today, -i - 1),
      });
    }
    const page1 = await listInvoicesPage(app(), tenant, { debtorId: debtorRow.id, overdue: true, limit: 5 }, today);
    expect(page1.items).toHaveLength(5);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = await listInvoicesPage(app(), tenant, { debtorId: debtorRow.id, overdue: true, limit: 5, cursor: page1.nextCursor! }, today);
    expect(page2.items).toHaveLength(5);
    const page3 = await listInvoicesPage(app(), tenant, { debtorId: debtorRow.id, overdue: true, limit: 5, cursor: page2.nextCursor! }, today);
    expect(page3.items).toHaveLength(2);
    expect(page3.nextCursor).toBeNull();
    const aging = await listInvoicesPage(app(), tenant, { debtorId: debtorRow.id, agingBucket: "8-30", limit: 50 }, today);
    expect(aging.items.length).toBeGreaterThan(0);
    expect(aging.items.every((i) => i.agingBucket === "8-30")).toBe(true);
  });

  it("F02: a payment cannot span currencies; KPIs group by currency", async () => {
    const debtorRow = await createDebtor(app(), tenant, user.id, { displayName: "عميل العملات", phone: "01033334444" });
    const egp = await createInvoice(app(), tenant, user.id, { debtorId: debtorRow.id, amount: "100", currency: "EGP", issuedOn: today, dueOn: addDaysIso(today, 7) });
    const usd = await createInvoice(app(), tenant, user.id, { debtorId: debtorRow.id, amount: "100", currency: "USD", issuedOn: today, dueOn: addDaysIso(today, 7) });
    await expect(recordPayment(app(), tenant, user.id, {
      debtorId: debtorRow.id, amount: "200", receivedOn: today,
      allocations: [
        { invoiceId: egp.id, amount: "100" },
        { invoiceId: usd.id, amount: "100" },
      ],
    })).rejects.toMatchObject({ code: "CURRENCY_MISMATCH", status: 400 });
    const paid = await recordPayment(app(), tenant, user.id, { debtorId: debtorRow.id, amount: "100", receivedOn: today });
    expect(paid.currency).toBe("EGP");
    const kpis = await getKpis(app(), tenant, today);
    expect(kpis.currency).toBe("EGP");
    expect(kpis.byCurrency.some((b) => b.currency === "USD" && b.outstandingMinor === 10000)).toBe(true);
    expect(kpis.byCurrency.some((b) => b.currency === "EGP")).toBe(true);
    const stored = await withTenant(app(), tenant, async (tx) =>
      tx.select().from(payments).where(eq(payments.id, paid.id)));
    expect(stored[0]!.currency).toBe("EGP");
  });

  it("F06/H13: clearing a cheque whose invoice was paid meanwhile trims the allocation", async () => {
    const debtorRow = await createDebtor(app(), tenant, user.id, { displayName: "عميل الشيك", phone: "01055556666" });
    const inv = await createInvoice(app(), tenant, user.id, { debtorId: debtorRow.id, amount: "1000", issuedOn: today, dueOn: addDaysIso(today, 7) });
    const cheque = await registerCheque(app(), tenant, user.id, {
      debtorId: debtorRow.id, direction: "receivable", number: "9001", bank: "CIB", amount: "1000",
      issueDate: today, dueDate: addDaysIso(today, 3), invoiceId: inv.id,
    });
    await transitionCheque(app(), tenant, user.id, cheque.id, "deposited", today);
    // Another payment settles the invoice before the cheque clears.
    await recordPayment(app(), tenant, user.id, { debtorId: debtorRow.id, amount: "1000", receivedOn: today });
    const cleared = await transitionCheque(app(), tenant, user.id, cheque.id, "cleared", today);
    expect(cleared.status).toBe("cleared");
    const detail = await getDebtorDetail(app(), tenant, debtorRow.id, today);
    expect(detail.invoices.find((i) => i.id === inv.id)).toMatchObject({ status: "paid", paidMinor: "100000" });
    const claim = detail.payments.find((p) => p.id === cleared.paymentId);
    expect(claim?.status).toBe("confirmed");
    // The cheque's 1000 became credit (its allocation was trimmed to 0),
    // never double-paid the invoice.
    expect(detail.creditMinor).toBe("100000");
  });
});
