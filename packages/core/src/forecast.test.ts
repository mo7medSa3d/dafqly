import { describe, it, expect } from "vitest";
import {
  latenessStats, percentileNearestRank, debtorLateness, forecastCashflow, backtestForecast,
  DEFAULT_LATENESS, type PaidHistoryRow,
} from "./forecast";

/**
 * Hand-computed lateness fixture. Debtor d1 paid invoices (due -> paid = days late):
 *  2026-10-01 -> 2026-10-04 = 3
 *  2026-10-05 -> 2026-10-10 = 5
 *  2026-10-10 -> 2026-10-20 = 10
 *  2026-10-15 -> 2026-10-15 = 0
 *  2026-10-20 -> 2026-11-09 = 20
 * sorted days: [0, 3, 5, 10, 20]; median = 5; p80 nearest-rank: ceil(0.8*5)=4th = 10.
 */
const d1History: PaidHistoryRow[] = [
  { debtorId: "d1", dueOn: "2026-10-01", paidOn: "2026-10-04", amountMinor: 10000 },
  { debtorId: "d1", dueOn: "2026-10-05", paidOn: "2026-10-10", amountMinor: 10000 },
  { debtorId: "d1", dueOn: "2026-10-10", paidOn: "2026-10-20", amountMinor: 10000 },
  { debtorId: "d1", dueOn: "2026-10-15", paidOn: "2026-10-15", amountMinor: 10000 },
  { debtorId: "d1", dueOn: "2026-10-20", paidOn: "2026-11-09", amountMinor: 10000 },
];

describe("lateness stats (hand-computed)", () => {
  it("median and nearest-rank p80", () => {
    expect(latenessStats(d1History)).toEqual({ median: 5, p80: 10, count: 5 });
    expect(percentileNearestRank([1, 2, 3], 80)).toBe(3); // ceil(2.4)=3rd
    expect(percentileNearestRank([7], 80)).toBe(7);
  });
  it("even-count median averages the two middles (rounded)", () => {
    const rows: PaidHistoryRow[] = [
      { debtorId: "x", dueOn: "2026-10-01", paidOn: "2026-10-03", amountMinor: 1 }, // 2
      { debtorId: "x", dueOn: "2026-10-01", paidOn: "2026-10-06", amountMinor: 1 }, // 5
    ];
    expect(latenessStats(rows).median).toBe(4); // round((2+5)/2)=round(3.5)=4
  });
});

describe("debtorLateness fallback chain", () => {
  it("debtor level when >= 3 own points", () => {
    const r = debtorLateness(d1History, "d1");
    expect(r.level).toBe("debtor");
    expect(r.stats.median).toBe(5);
  });
  it("tenant level when debtor thin but tenant >= 3", () => {
    const r = debtorLateness(d1History, "d-unknown");
    expect(r.level).toBe("tenant");
    expect(r.stats.median).toBe(5);
  });
  it("default when the whole tenant is thin", () => {
    const r = debtorLateness(d1History.slice(0, 2), "d1");
    expect(r.level).toBe("default");
    expect(r.stats).toEqual(DEFAULT_LATENESS);
  });
});

describe("forecastCashflow (hand-computed)", () => {
  // today = 2026-11-16 (Monday; weeks are 7-day windows from today)
  // history: d1's 5 rows above + 5 more tenant rows (d2, each exactly 10 days late: due 2026-10-02 -> paid 2026-10-12)
  // tenant paid count = 10 -> enough data. Tenant stats: days = [0,3,5,10,20, 10,10,10,10,10] sorted [0,3,5,10,10,10,10,10,10,20]: median = round((10+10)/2)=10, p80 = ceil(8)=8th = 10.
  const d2History: PaidHistoryRow[] = Array.from({ length: 5 }, () => ({
    debtorId: "d2", dueOn: "2026-10-02", paidOn: "2026-10-12", amountMinor: 7000,
  }));
  const history = [...d1History, ...d2History];
  it("not-enough-data below 10 paid invoices: zeroed weeks, enoughData false", () => {
    const f = forecastCashflow({ openInvoices: [{ id: "o1", debtorId: "d1", dueOn: "2026-11-20", outstandingMinor: 1000 }], paidHistory: history.slice(0, 9), today: "2026-11-16" });
    expect(f.enoughData).toBe(false);
    expect(f.weeks.every((w) => w.expectedMinor === 0 && w.conservativeMinor === 0)).toBe(true);
  });
  it("buckets expected (due+median) and conservative (due+p80) per debtor level", () => {
    // Open invoices:
    //  o1 d1 (debtor level: median 5, p80 10): due 2026-11-18 -> expected 2026-11-23 (offset 7 -> week 1), conservative 2026-11-28 (offset 12 -> week 1); amount 100000
    //  o2 d2 (only 5 own points? d2 has 5 -> debtor level too; median of [10,10,10,10,10]=10, p80 10): due 2026-11-10 (past) -> expected 2026-11-20 (offset 4 -> week 0), conservative same week 0; amount 50000
    //  o3 d3 (no history -> tenant level median 10 p80 10): due 2026-12-20 -> expected 2026-12-30 (offset 44 -> week 6); amount 30000
    const f = forecastCashflow({
      openInvoices: [
        { id: "o1", debtorId: "d1", dueOn: "2026-11-18", outstandingMinor: 100000 },
        { id: "o2", debtorId: "d2", dueOn: "2026-11-10", outstandingMinor: 50000 },
        { id: "o3", debtorId: "d3", dueOn: "2026-12-20", outstandingMinor: 30000 },
      ],
      paidHistory: history, today: "2026-11-16",
    });
    expect(f.enoughData).toBe(true);
    expect(f.weeks[0]).toMatchObject({ weekStart: "2026-11-16", expectedMinor: 50000, conservativeMinor: 50000 });
    expect(f.weeks[1]).toMatchObject({ weekStart: "2026-11-23", expectedMinor: 100000, conservativeMinor: 100000 });
    expect(f.weeks[6]).toMatchObject({ expectedMinor: 30000, conservativeMinor: 30000 });
    expect(f.explanation.basisByLevel).toEqual({ debtor: 2, tenant: 1, default: 0 });
    expect(f.explanation.tenantMedianDays).toBe(10);
  });
});

describe("backtestForecast (hand-computed)", () => {
  it("predicts from pre-cutoff data only and reports per-week error", () => {
    // cutoff 2026-10-31. Training rows: d1's first four (paid <= 10-31): days [3,5,10,0] -> median round((3+5)/2)=4, level debtor (>=3).
    // Future row: d1 due 2026-10-20 paid 2026-11-09 (amount 10000): predicted date = due + 4 = 2026-10-24 -> before the horizon start (2026-11-01) -> clamps week 0.
    // Actual: paidOn 2026-11-09 -> offset from 2026-11-01 = 8 days -> week 1.
    // weeks: w0 predicted 10000 actual 0 err 10000; w1 predicted 0 actual 10000 err 10000; w2..w7 err 0. MAE = 20000/8 = 2500.
    const b = backtestForecast({ history: d1History, cutoff: "2026-10-31" });
    expect(b.weeks[0]).toMatchObject({ predictedMinor: 10000, actualMinor: 0, absErrorMinor: 10000 });
    expect(b.weeks[1]).toMatchObject({ predictedMinor: 0, actualMinor: 10000, absErrorMinor: 10000 });
    expect(b.maeMinor).toBe(2500);
  });
});
