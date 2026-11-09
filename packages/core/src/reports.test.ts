import { describe, it, expect } from "vitest";
import { computeKpis, computeReminderPerformance, toCsv, type ReportInvoice, type ReportPayment } from "./reports";

/**
 * Hand-computed fixture (today = 2026-11-15):
 * Invoices:
 *  A debtor d1: amount 100000, paid 40000, open, issued 2026-11-01, due 2026-11-10 -> outstanding 60000, 5 days overdue (bucket 0-7)
 *  B debtor d1: amount 50000, paid 0, partially_paid? no open, issued 2026-09-01, due 2026-10-01 -> outstanding 50000, 45 days overdue (bucket 31-60)
 *  C debtor d2: amount 20000, paid 20000, PAID -> excluded everywhere
 *  D debtor d2: amount 30000, paid 0, open, issued 2026-11-14, due 2026-12-01 -> outstanding 30000, current
 *  E debtor d3: amount 999999, status written_off -> excluded
 * totalOutstanding = 60000+50000+30000 = 140000
 * overdueAmount = 60000+50000 = 110000
 * aging: current 30000, 0-7: 60000, 8-30: 0, 31-60: 50000, 60+: 0
 * Payments (confirmed): 25000 on 2026-11-03, 5000 on 2026-11-15, 77000 on 2026-10-31 (other month), one CLAIMED 12345 on 2026-11-05 (excluded), one confirmed reversal -2000 on 2026-11-10 (nets)
 * collectedInMonth = 25000+5000-2000 = 28000
 * collectionRate = 28000 / (28000+140000) = 28000/168000 = 1/6 = 0.16666...
 * invoiced last 90d: issued in [2026-08-17, 2026-11-15]: A 100000 (11-01) + C 20000 (use issued below) + D 30000 (11-14); B issued 2026-09-01 is INSIDE the window too -> +50000; E issued 2026-11-02 -> +999999? E is written_off but it WAS invoiced; the DSO denominator counts invoicing regardless of status: total = 100000+50000+20000+30000+999999 = 1199999. To keep the arithmetic clean E's amount is set 0 below instead — see fixture (E amount 0). Then invoiced90 = 200000, DSO = 140000/200000*90 = 63.
 * topDebtors: d1 110000, d2 30000.
 */
const invoices: ReportInvoice[] = [
  { id: "A", debtorId: "d1", amountMinor: 100000, paidMinor: 40000, status: "open", issuedOn: "2026-11-01", dueOn: "2026-11-10" },
  { id: "B", debtorId: "d1", amountMinor: 50000, paidMinor: 0, status: "open", issuedOn: "2026-09-01", dueOn: "2026-10-01" },
  { id: "C", debtorId: "d2", amountMinor: 20000, paidMinor: 20000, status: "paid", issuedOn: "2026-11-05", dueOn: "2026-11-12" },
  { id: "D", debtorId: "d2", amountMinor: 30000, paidMinor: 0, status: "open", issuedOn: "2026-11-14", dueOn: "2026-12-01" },
  { id: "E", debtorId: "d3", amountMinor: 0, paidMinor: 0, status: "written_off", issuedOn: "2026-11-02", dueOn: "2026-11-03" },
];
const payments: ReportPayment[] = [
  { amountMinor: 25000, status: "confirmed", receivedOn: "2026-11-03" },
  { amountMinor: 5000, status: "confirmed", receivedOn: "2026-11-15" },
  { amountMinor: 77000, status: "confirmed", receivedOn: "2026-10-31" },
  { amountMinor: 12345, status: "claimed", receivedOn: "2026-11-05" },
  { amountMinor: -2000, status: "confirmed", receivedOn: "2026-11-10" },
];
const names = new Map([["d1", "Debtor One"], ["d2", "Debtor Two"]]);

describe("computeKpis (hand-computed)", () => {
  const k = computeKpis({ invoices, payments, debtorNames: names, today: "2026-11-15" });
  it("totals", () => {
    expect(k.totalOutstandingMinor).toBe(140000);
    expect(k.overdueAmountMinor).toBe(110000);
    expect(k.collectedInMonthMinor).toBe(28000);
  });
  it("collection rate = collected / (collected + outstanding) = 1/6", () => {
    expect(k.collectionRate).toBeCloseTo(1 / 6, 10);
  });
  it("DSO = (140000 / 200000) * 90 = 63", () => {
    expect(k.dsoDays).toBe(63);
  });
  it("aging buckets", () => {
    expect(k.agingBuckets).toEqual({ current: 30000, "0-7": 60000, "8-30": 0, "31-60": 50000, "60+": 0 });
  });
  it("top debtors sorted desc", () => {
    expect(k.topDebtors).toEqual([
      { debtorId: "d1", displayName: "Debtor One", outstandingMinor: 110000 },
      { debtorId: "d2", displayName: "Debtor Two", outstandingMinor: 30000 },
    ]);
  });
  it("empty book -> zeros, no NaN", () => {
    const e = computeKpis({ invoices: [], payments: [], debtorNames: new Map(), today: "2026-11-15" });
    expect(e).toMatchObject({ totalOutstandingMinor: 0, collectionRate: 0, dsoDays: 0 });
  });
});

describe("computeReminderPerformance (hand-computed)", () => {
  it("counts sent/delivered/replied/paidWithin7d", () => {
    // outbound: d1 sent, d1 delivered, d2 read, d2 queued (not sent), d3 failed (not sent)
    // sent = 3, delivered = 2 (delivered + read)
    // inbound from d1 and d9: replied = debtors in both = {d1} = 1
    // paid invoices: paid 5 days after remind -> yes; 9 days -> no; never reminded -> no; paid BEFORE remind -> no
    const perf = computeReminderPerformance({
      outbound: [
        { debtorId: "d1", status: "sent" }, { debtorId: "d1", status: "delivered" },
        { debtorId: "d2", status: "read" }, { debtorId: "d2", status: "queued" },
        { debtorId: "d3", status: "failed" },
      ],
      inbound: [{ debtorId: "d1" }, { debtorId: "d9" }],
      paidInvoices: [
        { paidOn: "2026-11-10", lastRemindedAt: "2026-11-05T10:00:00.000Z" },
        { paidOn: "2026-11-14", lastRemindedAt: "2026-11-05T10:00:00.000Z" },
        { paidOn: "2026-11-10", lastRemindedAt: null },
        { paidOn: "2026-11-01", lastRemindedAt: "2026-11-05T10:00:00.000Z" },
      ],
    });
    expect(perf).toEqual({ sent: 3, delivered: 2, replied: 1, paidWithin7d: 1 });
  });
});

describe("toCsv", () => {
  it("BOM, CRLF, RFC-4180 quoting", () => {
    const csv = toCsv([["الاسم", "المبلغ"], ["أحمد, وشركاه", 1250], ['قال "نعم"', 5]]);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("\r\n");
    expect(csv).toContain('"أحمد, وشركاه",1250');
    expect(csv).toContain('"قال ""نعم""",5');
  });
});
