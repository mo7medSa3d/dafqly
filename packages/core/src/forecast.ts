import { daysOverdue } from "./invoices";

/**
 * Cash-flow forecast (BUILD_PLAN F12, ADR-023): no ML. A debtor's lateness
 * is (paid date − due date) in days over their PAID invoices. Expected
 * payment date for an open invoice = due date + MEDIAN lateness;
 * conservative date = due date + 80th-PERCENTILE lateness. Fallback chain
 * when a debtor has fewer than 3 paid invoices: tenant-wide stats, then a
 * pinned conservative default. Weeks are 7-day windows starting TODAY
 * (week 0 = [today, today+6]). Dates BEFORE today clamp into week 0.
 * All amounts integer minor units; everything deterministic.
 */

export interface PaidHistoryRow {
  debtorId: string;
  dueOn: string; // YYYY-MM-DD
  paidOn: string; // YYYY-MM-DD the invoice became fully paid
  amountMinor: number;
}

export interface OpenInvoiceRow {
  id: string;
  debtorId: string;
  dueOn: string;
  outstandingMinor: number;
}

export interface LatenessStats { median: number; p80: number; count: number }

/** Conservative default when neither debtor nor tenant has >= 3 data points (ADR-023). */
export const DEFAULT_LATENESS: LatenessStats = { median: 7, p80: 21, count: 0 };
export const MIN_DEBTOR_POINTS = 3;
export const MIN_TENANT_POINTS = 3;
/** F12: below this many paid invoices tenant-wide there is NO forecast. */
export const MIN_FORECAST_PAID_INVOICES = 10;

function medianOf(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/** Nearest-rank percentile: the value at rank ceil(p/100 * n) (1-indexed). */
export function percentileNearestRank(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil((p / 100) * sorted.length)));
  return sorted[rank - 1]!;
}

export function latenessStats(rows: readonly PaidHistoryRow[]): LatenessStats {
  const days = rows.map((r) => daysOverdue(r.dueOn, r.paidOn)).sort((a, b) => a - b);
  return { median: medianOf(days), p80: percentileNearestRank(days, 80), count: days.length };
}

export type LatenessLevel = "debtor" | "tenant" | "default";

/** The fallback chain (F12): debtor stats -> tenant stats -> conservative default; the level used is reported. */
export function debtorLateness(
  history: readonly PaidHistoryRow[], debtorId: string,
): { stats: LatenessStats; level: LatenessLevel } {
  const own = history.filter((r) => r.debtorId === debtorId);
  if (own.length >= MIN_DEBTOR_POINTS) return { stats: latenessStats(own), level: "debtor" };
  if (history.length >= MIN_TENANT_POINTS) return { stats: latenessStats(history), level: "tenant" };
  return { stats: DEFAULT_LATENESS, level: "default" };
}

/**
 * Batch form of debtorLateness with IDENTICAL semantics: groups the history
 * by debtor once and computes each debtor's stats at most once. The naive
 * per-invoice debtorLateness call is O(open × paid) — at the M6 100k bench
 * (70k open × 30k paid) it ran for minutes; this resolver is O(paid + open).
 */
export function makeLatenessResolver(
  history: readonly PaidHistoryRow[],
): (debtorId: string) => { stats: LatenessStats; level: LatenessLevel } {
  const byDebtor = new Map<string, PaidHistoryRow[]>();
  for (const r of history) {
    const arr = byDebtor.get(r.debtorId);
    if (arr) arr.push(r);
    else byDebtor.set(r.debtorId, [r]);
  }
  const statsByDebtor = new Map<string, LatenessStats>();
  const tenantStats = history.length >= MIN_TENANT_POINTS ? latenessStats(history) : null;
  return (debtorId: string) => {
    const own = byDebtor.get(debtorId);
    if (own && own.length >= MIN_DEBTOR_POINTS) {
      let s = statsByDebtor.get(debtorId);
      if (!s) { s = latenessStats(own); statsByDebtor.set(debtorId, s); }
      return { stats: s, level: "debtor" };
    }
    if (tenantStats) return { stats: tenantStats, level: "tenant" };
    return { stats: DEFAULT_LATENESS, level: "default" };
  };
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!) + days * 86_400_000).toISOString().slice(0, 10);
}

export interface ForecastWeek { weekStart: string; expectedMinor: number; conservativeMinor: number }
export interface ForecastResult {
  enoughData: boolean;
  paidInvoiceCount: number;
  /** The currency every amount in this forecast is in (the tenant's
   * default — the forecast never sums minor units across currencies). */
  currency: string;
  weeks: ForecastWeek[];
  /** M04: amounts whose expected/conservative date falls past the horizon
   * are reported here, never silently dropped. */
  beyondHorizon: { expectedMinor: number; conservativeMinor: number };
  explanation: {
    basisByLevel: Record<LatenessLevel, number>;
    tenantMedianDays: number | null;
    tenantP80Days: number | null;
    method: string;
  };
}

/**
 * M04: forecast money is `number` by API contract, so every input amount
 * must be a safe integer — a bigint above 2^53 would lose precision
 * silently in Number(). The server enforces this at the conversion
 * boundary; this is the second line of defence for direct callers.
 */
function assertSafeMinor(value: number, what: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Forecast amount is not a safe integer minor-unit value (${what})`);
  }
}

export function forecastCashflow(input: {
  openInvoices: readonly OpenInvoiceRow[];
  paidHistory: readonly PaidHistoryRow[];
  today: string;
  currency: string;
  weeks?: number;
}): ForecastResult {
  for (const inv of input.openInvoices) assertSafeMinor(inv.outstandingMinor, `open invoice ${inv.id}`);
  for (const row of input.paidHistory) assertSafeMinor(row.amountMinor, `paid history ${row.debtorId}/${row.dueOn}`);
  const weekCount = input.weeks ?? 8;
  const weeks: ForecastWeek[] = Array.from({ length: weekCount }, (_, i) => ({
    weekStart: addDays(input.today, i * 7), expectedMinor: 0, conservativeMinor: 0,
  }));
  const beyondHorizon = { expectedMinor: 0, conservativeMinor: 0 };
  const paidCount = input.paidHistory.length;
  const tenantStats = paidCount > 0 ? latenessStats(input.paidHistory) : null;
  const basisByLevel: Record<LatenessLevel, number> = { debtor: 0, tenant: 0, default: 0 };

  if (paidCount < MIN_FORECAST_PAID_INVOICES) {
    return {
      enoughData: false, paidInvoiceCount: paidCount, currency: input.currency, weeks, beyondHorizon,
      explanation: {
        basisByLevel,
        tenantMedianDays: tenantStats?.median ?? null, tenantP80Days: tenantStats?.p80 ?? null,
        method: `Not enough data: ${paidCount} paid invoices (< ${MIN_FORECAST_PAID_INVOICES}); no forecast is shown rather than a fabricated one.`,
      },
    };
  }

  const bucket = (dateIso: string): number => {
    const offset = daysOverdue(input.today, dateIso);
    if (offset < 0) return 0;
    return Math.floor(offset / 7);
  };
  const resolveLateness = makeLatenessResolver(input.paidHistory);
  for (const inv of input.openInvoices) {
    if (inv.outstandingMinor <= 0) continue;
    const { stats, level } = resolveLateness(inv.debtorId);
    basisByLevel[level]++;
    const e = bucket(addDays(inv.dueOn, stats.median));
    if (e < weekCount) weeks[e]!.expectedMinor += inv.outstandingMinor;
    else beyondHorizon.expectedMinor += inv.outstandingMinor;
    const c = bucket(addDays(inv.dueOn, stats.p80));
    if (c < weekCount) weeks[c]!.conservativeMinor += inv.outstandingMinor;
    else beyondHorizon.conservativeMinor += inv.outstandingMinor;
  }
  return {
    enoughData: true, paidInvoiceCount: paidCount, currency: input.currency, weeks, beyondHorizon,
    explanation: {
      basisByLevel,
      tenantMedianDays: tenantStats?.median ?? null, tenantP80Days: tenantStats?.p80 ?? null,
      method: "Expected date = due date + median days-late; conservative date = due date + 80th-percentile days-late. "
        + "Per-debtor stats when the debtor has >= 3 paid invoices, else tenant stats, else the conservative default (median 7, p80 21). "
        + "Weeks are 7-day windows starting today; amounts whose expected/conservative date falls past the 8-week horizon are reported in beyondHorizon, never dropped.",
    },
  };
}

// ------------------------------------------------------------------ backtest
export interface BacktestWeek { weekStart: string; predictedMinor: number; actualMinor: number; absErrorMinor: number }
export interface BacktestResult { weeks: BacktestWeek[]; maeMinor: number; cutoff: string }

/**
 * Backtest (F12 acceptance): as of `cutoff`, train ONLY on invoices paid on
 * or before the cutoff, then "predict" the collections of the invoices that
 * were actually paid in the following horizon — those were the open book at
 * the cutoff. Predicted weekly collections use the same expected-date rule;
 * actual weekly collections bucket the real paidOn. Reports per-week
 * absolute error and the mean absolute error.
 */
export function backtestForecast(input: {
  history: readonly PaidHistoryRow[];
  cutoff: string;
  horizonWeeks?: number;
}): BacktestResult {
  for (const row of input.history) assertSafeMinor(row.amountMinor, `backtest history ${row.debtorId}/${row.dueOn}`);
  const horizon = input.horizonWeeks ?? 8;
  const training = input.history.filter((r) => r.paidOn <= input.cutoff);
  const future = input.history.filter((r) => r.paidOn > input.cutoff);
  const weeks: BacktestWeek[] = Array.from({ length: horizon }, (_, i) => ({
    weekStart: addDays(input.cutoff, i * 7 + 1), predictedMinor: 0, actualMinor: 0, absErrorMinor: 0,
  }));
  const bucket = (dateIso: string): number => {
    const offset = daysOverdue(addDays(input.cutoff, 1), dateIso);
    if (offset < 0) return 0;
    return Math.floor(offset / 7);
  };
  const resolveTraining = makeLatenessResolver(training);
  for (const row of future) {
    const a = bucket(row.paidOn);
    if (a < horizon) weeks[a]!.actualMinor += row.amountMinor;
    const { stats } = resolveTraining(row.debtorId);
    const p = bucket(addDays(row.dueOn, stats.median));
    if (p < horizon) weeks[p]!.predictedMinor += row.amountMinor;
  }
  let totalErr = 0;
  for (const w of weeks) {
    w.absErrorMinor = Math.abs(w.predictedMinor - w.actualMinor);
    totalErr += w.absErrorMinor;
  }
  return { weeks, maeMinor: horizon > 0 ? Math.round(totalErr / horizon) : 0, cutoff: input.cutoff };
}
