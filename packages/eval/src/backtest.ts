import { backtestForecast, type PaidHistoryRow } from "@tahseel/core";

/**
 * F12 backtest on a SYNTHETIC deterministic payment history (labelled as
 * such): 3 debtors with fixed lateness habits paying weekly invoices over
 * 20 weeks. The backtest trains on data up to the cutoff (end of week 12)
 * and predicts the following 8 weeks, reporting per-week absolute error
 * and the MAE. Real-tenant backtests run the same core function against
 * the tenant's real paid history.
 */
export function syntheticBacktest(): { maeMinor: number; weeks: { weekStart: string; predictedMinor: number; actualMinor: number; absErrorMinor: number }[] } {
  const history: PaidHistoryRow[] = [];
  // Debtor habits (days late): d1 always 3, d2 always 10, d3 alternating 0/14 (median 7).
  const habits: Record<string, number[]> = { d1: [3], d2: [10], d3: [0, 14] };
  const startMs = Date.UTC(2026, 7, 3); // Monday 2026-08-03
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  for (let week = 0; week < 20; week++) {
    for (const [debtorId, pattern] of Object.entries(habits)) {
      const due = iso(startMs + week * 7 * 86_400_000);
      const late = pattern[week % pattern.length]!;
      history.push({
        debtorId, dueOn: due,
        paidOn: iso(startMs + (week * 7 + late) * 86_400_000),
        amountMinor: 10000,
      });
    }
  }
  const cutoff = iso(startMs + 12 * 7 * 86_400_000 - 86_400_000); // end of week 11 (2026-10-18)
  const result = backtestForecast({ history, cutoff, horizonWeeks: 8 });
  return { maeMinor: result.maeMinor, weeks: result.weeks };
}
