import { daysOverdue } from "./invoices";

/**
 * Dashboard KPIs and CSV export (BUILD_PLAN F11, ADR-023). Pure functions
 * over plain rows so every KPI is unit-tested against a small
 * hand-computed fixture. Amounts are integer minor units (numbers here are
 * safe integers well below 2^53 for any realistic book).
 *
 * PINNED DEFINITIONS (ADR-023):
 * - totalOutstanding: Σ (amount − paid) over open + partially_paid invoices.
 * - overdueAmount: the same sum restricted to invoices due before today.
 * - collectedInMonth: Σ CONFIRMED payments with receivedOn inside the
 *   calendar month of `today` (reversals are confirmed negative rows, so
 *   they net out).
 * - collectionRate = collectedInMonth / (collectedInMonth +
 *   totalOutstanding); 0 when the denominator is 0.
 * - dsoDays = (totalOutstanding / invoicedInLast90Days) * 90, where the
 *   denominator is Σ amounts of invoices ISSUED in [today−89, today];
 *   0 when nothing was invoiced in the window.
 * - aging buckets bucket outstanding by days overdue: not yet due =
 *   "current", then 1–7 "0-7", 8–30, 31–60, >60 "60+".
 */

export interface ReportInvoice {
  id: string;
  debtorId: string;
  amountMinor: number;
  paidMinor: number;
  status: string;
  issuedOn: string; // YYYY-MM-DD
  dueOn: string;
}

export interface ReportPayment {
  amountMinor: number;
  status: string;
  receivedOn: string; // YYYY-MM-DD
}

export type AgingBucketKey = "current" | "0-7" | "8-30" | "31-60" | "60+";
export const AGING_BUCKET_KEYS: AgingBucketKey[] = ["current", "0-7", "8-30", "31-60", "60+"];

export interface KpiReport {
  totalOutstandingMinor: number;
  overdueAmountMinor: number;
  collectedInMonthMinor: number;
  collectionRate: number;
  dsoDays: number;
  agingBuckets: Record<AgingBucketKey, number>;
  topDebtors: { debtorId: string; displayName: string; outstandingMinor: number }[];
}

const OPEN_STATUSES = new Set(["open", "partially_paid"]);

export function agingBucketFor(daysOverdueCount: number): AgingBucketKey {
  if (daysOverdueCount <= 0) return "current";
  if (daysOverdueCount <= 7) return "0-7";
  if (daysOverdueCount <= 30) return "8-30";
  if (daysOverdueCount <= 60) return "31-60";
  return "60+";
}

export function computeKpis(input: {
  invoices: readonly ReportInvoice[];
  payments: readonly ReportPayment[];
  debtorNames: ReadonlyMap<string, string>;
  today: string;
}): KpiReport {
  const monthPrefix = input.today.slice(0, 7);
  const aging: Record<AgingBucketKey, number> = { current: 0, "0-7": 0, "8-30": 0, "31-60": 0, "60+": 0 };
  let totalOutstanding = 0;
  let overdueAmount = 0;
  const perDebtor = new Map<string, number>();

  for (const inv of input.invoices) {
    if (!OPEN_STATUSES.has(inv.status)) continue;
    const outstanding = Math.max(0, inv.amountMinor - inv.paidMinor);
    if (outstanding === 0) continue;
    totalOutstanding += outstanding;
    const late = daysOverdue(inv.dueOn, input.today);
    if (late > 0) overdueAmount += outstanding;
    aging[agingBucketFor(late)] += outstanding;
    perDebtor.set(inv.debtorId, (perDebtor.get(inv.debtorId) ?? 0) + outstanding);
  }

  let collected = 0;
  for (const p of input.payments) {
    if (p.status === "confirmed" && p.receivedOn.slice(0, 7) === monthPrefix) collected += p.amountMinor;
  }

  // Invoiced in the last 90 days: issuedOn in [today-89, today] (a 90-day
  // inclusive window ending today).
  const windowStart = addDays(input.today, -89);
  let invoiced90 = 0;
  for (const inv of input.invoices) {
    if (inv.issuedOn >= windowStart && inv.issuedOn <= input.today) invoiced90 += inv.amountMinor;
  }

  const topDebtors = [...perDebtor.entries()]
    .map(([debtorId, outstandingMinor]) => ({
      debtorId,
      displayName: input.debtorNames.get(debtorId) ?? debtorId,
      outstandingMinor,
    }))
    .sort((a, b) => b.outstandingMinor - a.outstandingMinor || (a.debtorId < b.debtorId ? -1 : 1))
    .slice(0, 10);

  return {
    totalOutstandingMinor: totalOutstanding,
    overdueAmountMinor: overdueAmount,
    collectedInMonthMinor: collected,
    collectionRate: collected + totalOutstanding > 0 ? collected / (collected + totalOutstanding) : 0,
    // Rounded to 2 decimals: DSO is a reporting figure, and the rounding
    // keeps it free of binary float dust (140000/200000*90 is 63, not 62.999...).
    dsoDays: invoiced90 > 0 ? Math.round(((totalOutstanding / invoiced90) * 90) * 100) / 100 : 0,
    agingBuckets: aging,
    topDebtors,
  };
}

// ---------------------------------------------------------- reminder stats
export interface ReminderPerformance {
  sent: number;
  delivered: number;
  replied: number;
  paidWithin7d: number;
}

/**
 * Reminder performance (F11) from rows the service can actually query:
 * - sent: outbound reminder messages in sent/delivered/read.
 * - delivered: outbound in delivered/read.
 * - replied: DISTINCT debtors who both received a sent reminder and sent
 *   any inbound reply afterwards-or-ever in the window of data given
 *   (the service passes the tenant's messages; the debtor match is the
 *   honest signal available without threading message chains).
 * - paidWithin7d: invoices whose completing payment landed within 7 days
 *   after the invoice's last_reminded_at.
 */
export function computeReminderPerformance(input: {
  outbound: readonly { debtorId: string; status: string }[];
  inbound: readonly { debtorId: string }[];
  paidInvoices: readonly { paidOn: string; lastRemindedAt: string | null }[];
}): ReminderPerformance {
  const sent = input.outbound.filter((m) => m.status === "sent" || m.status === "delivered" || m.status === "read");
  const delivered = input.outbound.filter((m) => m.status === "delivered" || m.status === "read");
  const sentDebtors = new Set(sent.map((m) => m.debtorId));
  const replied = new Set(input.inbound.filter((m) => sentDebtors.has(m.debtorId)).map((m) => m.debtorId)).size;
  let paidWithin7d = 0;
  for (const inv of input.paidInvoices) {
    if (!inv.lastRemindedAt) continue;
    const remindedDate = inv.lastRemindedAt.slice(0, 10);
    const gap = daysOverdue(remindedDate, inv.paidOn);
    if (gap >= 0 && gap <= 7) paidWithin7d++;
  }
  return { sent: sent.length, delivered: delivered.length, replied, paidWithin7d };
}

// --------------------------------------------------------------------- csv
/**
 * CSV serialization for F11 exports: UTF-8 BOM so Excel renders Arabic
 * correctly, CRLF line endings, RFC-4180 quoting.
 */
export function toCsv(rows: readonly (readonly (string | number)[])[]): string {
  const escape = (v: string | number): string => {
    const s = String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "\uFEFF" + rows.map((r) => r.map(escape).join(",")).join("\r\n") + "\r\n";
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!) + days * 86_400_000).toISOString().slice(0, 10);
}
