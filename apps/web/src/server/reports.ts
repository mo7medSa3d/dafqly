import { eq, isNull, and, inArray, sql } from "drizzle-orm";
import {
  computeKpis, computeReminderPerformance, forecastCashflow, toCsv,
  type ForecastResult, type KpiReport, type PaidHistoryRow, type ReminderPerformance,
} from "@tahseel/core";
import {
  debtors, invoices, messages, paymentAllocations, payments, tenants,
} from "@tahseel/db/schema";
import { withTenant, type Db } from "@tahseel/db";

/**
 * F11/F12 report services: load tenant rows under RLS and hand them to the
 * pure core computations (every KPI/forecast number is produced by the
 * hand-fixture-tested core functions — this file only queries and shapes).
 * "Paid on" for an invoice = the latest received_on among its CONFIRMED
 * allocated payments (the completing payment in practice).
 */

export interface KpiServiceResult extends KpiReport {
  reminderPerformance: ReminderPerformance;
}

async function loadPaidOnByInvoice(tx: Db): Promise<Map<string, string>> {
  const allocs = await tx.select({
    invoiceId: paymentAllocations.invoiceId, receivedOn: payments.receivedOn, status: payments.status,
  }).from(paymentAllocations).innerJoin(payments, eq(payments.id, paymentAllocations.paymentId));
  const map = new Map<string, string>();
  for (const a of allocs) {
    if (a.status !== "confirmed") continue;
    const cur = map.get(a.invoiceId);
    if (!cur || a.receivedOn > cur) map.set(a.invoiceId, a.receivedOn);
  }
  return map;
}

/**
 * M6 (ADR-024): SQL-aggregation KPI path. The M5 implementation loaded
 * every invoice/payment/message row into memory — correct, but at 100k
 * invoices it measured seconds on this VM (PROGRESS M6 bench BEFORE).
 * This path computes the SAME pinned definitions (ADR-023) with SQL
 * aggregates under RLS; the in-memory reference below stays exported and
 * the M6 bench cross-checks both paths number-for-number on the 100k
 * tenant (and the M5 hand-fixture integration suite runs against getKpis).
 */
export async function getKpis(app: Db, tenantId: string, todayIso: string): Promise<KpiServiceResult> {
  return withTenant(app, tenantId, async (tx) => {
    const [agg] = await tx.execute(sql`
      select
        coalesce(sum(amount_minor - paid_minor) filter (where status in ('open','partially_paid') and amount_minor > paid_minor), 0)::bigint as outstanding,
        coalesce(sum(amount_minor - paid_minor) filter (where status in ('open','partially_paid') and amount_minor > paid_minor and due_on < ${todayIso}::date), 0)::bigint as overdue,
        coalesce(sum(amount_minor) filter (where issued_on >= ${todayIso}::date - 89 and issued_on <= ${todayIso}::date), 0)::bigint as invoiced90,
        coalesce(sum(amount_minor - paid_minor) filter (where status in ('open','partially_paid') and amount_minor > paid_minor and due_on >= ${todayIso}::date), 0)::bigint as aging_current,
        coalesce(sum(amount_minor - paid_minor) filter (where status in ('open','partially_paid') and amount_minor > paid_minor and (${todayIso}::date - due_on) between 1 and 7), 0)::bigint as aging_0_7,
        coalesce(sum(amount_minor - paid_minor) filter (where status in ('open','partially_paid') and amount_minor > paid_minor and (${todayIso}::date - due_on) between 8 and 30), 0)::bigint as aging_8_30,
        coalesce(sum(amount_minor - paid_minor) filter (where status in ('open','partially_paid') and amount_minor > paid_minor and (${todayIso}::date - due_on) between 31 and 60), 0)::bigint as aging_31_60,
        coalesce(sum(amount_minor - paid_minor) filter (where status in ('open','partially_paid') and amount_minor > paid_minor and (${todayIso}::date - due_on) > 60), 0)::bigint as aging_60p
      from invoices`) as unknown as [{
        outstanding: string; overdue: string; invoiced90: string;
        aging_current: string; aging_0_7: string; aging_8_30: string; aging_31_60: string; aging_60p: string;
      }];
    const [col] = await tx.execute(sql`
      select coalesce(sum(amount_minor), 0)::bigint as collected from payments
      where status = 'confirmed'
        and received_on >= date_trunc('month', ${todayIso}::date)::date
        and received_on < (date_trunc('month', ${todayIso}::date) + interval '1 month')::date`) as unknown as [{ collected: string }];
    const top = await tx.execute(sql`
      select debtor_id as "debtorId", coalesce(sum(amount_minor - paid_minor), 0)::bigint as outstanding
      from invoices
      where status in ('open','partially_paid') and amount_minor > paid_minor
      group by debtor_id order by outstanding desc, debtor_id asc limit 10`) as unknown as { debtorId: string; outstanding: string }[];
    const names = top.length === 0 ? new Map<string, string>() : new Map(
      (await tx.select({ id: debtors.id, displayName: debtors.displayName }).from(debtors)
        .where(inArray(debtors.id, top.map((t) => t.debtorId)))).map((d) => [d.id, d.displayName]),
    );
    const [perf] = await tx.execute(sql`
      select
        (select count(*)::int from messages where direction = 'out' and status in ('sent','delivered','read')) as sent,
        (select count(*)::int from messages where direction = 'out' and status in ('delivered','read')) as delivered,
        (select count(distinct debtor_id)::int from messages where direction = 'in' and debtor_id in
           (select distinct debtor_id from messages where direction = 'out' and status in ('sent','delivered','read'))) as replied,
        (select count(*)::int from (
           select i.last_reminded_at, max(p.received_on) as paid_on
           from invoices i
           join payment_allocations a on a.invoice_id = i.id
           join payments p on p.id = a.payment_id and p.status = 'confirmed'
           where i.status = 'paid' and i.last_reminded_at is not null
           group by i.id, i.last_reminded_at) x
         where (x.paid_on - (x.last_reminded_at at time zone 'UTC')::date) between 0 and 7) as paid_within_7d`) as unknown as [{ sent: number; delivered: number; replied: number; paid_within_7d: number }];

    const totalOutstandingMinor = Number(agg!.outstanding);
    const collectedInMonthMinor = Number(col!.collected);
    const invoiced90 = Number(agg!.invoiced90);
    return {
      totalOutstandingMinor,
      overdueAmountMinor: Number(agg!.overdue),
      collectedInMonthMinor,
      collectionRate: collectedInMonthMinor + totalOutstandingMinor > 0 ? collectedInMonthMinor / (collectedInMonthMinor + totalOutstandingMinor) : 0,
      dsoDays: invoiced90 > 0 ? Math.round(((totalOutstandingMinor / invoiced90) * 90) * 100) / 100 : 0,
      agingBuckets: {
        current: Number(agg!.aging_current), "0-7": Number(agg!.aging_0_7), "8-30": Number(agg!.aging_8_30),
        "31-60": Number(agg!.aging_31_60), "60+": Number(agg!.aging_60p),
      },
      topDebtors: top.map((t) => ({ debtorId: t.debtorId, displayName: names.get(t.debtorId) ?? t.debtorId, outstandingMinor: Number(t.outstanding) })),
      reminderPerformance: { sent: perf!.sent, delivered: perf!.delivered, replied: perf!.replied, paidWithin7d: perf!.paid_within_7d },
    };
  });
}

/** The M5 in-memory reference implementation (core-computed). Kept for cross-checks. */
export async function getKpisReference(app: Db, tenantId: string, todayIso: string): Promise<KpiServiceResult> {
  return withTenant(app, tenantId, async (tx) => {
    const invs = await tx.select().from(invoices);
    const pays = await tx.select().from(payments);
    const dbs = await tx.select().from(debtors).where(isNull(debtors.deletedAt));
    const names = new Map(dbs.map((d) => [d.id, d.displayName]));
    const kpis = computeKpis({
      invoices: invs.map((i) => ({
        id: i.id, debtorId: i.debtorId, amountMinor: Number(i.amountMinor), paidMinor: Number(i.paidMinor),
        status: i.status, issuedOn: i.issuedOn, dueOn: i.dueOn,
      })),
      payments: pays.map((p) => ({ amountMinor: Number(p.amountMinor), status: p.status, receivedOn: p.receivedOn })),
      debtorNames: names, today: todayIso,
    });
    const msgs = await tx.select().from(messages);
    const paidOn = await loadPaidOnByInvoice(tx);
    const reminderPerformance = computeReminderPerformance({
      outbound: msgs.filter((m) => m.direction === "out" && m.debtorId).map((m) => ({ debtorId: m.debtorId!, status: m.status })),
      inbound: msgs.filter((m) => m.direction === "in" && m.debtorId).map((m) => ({ debtorId: m.debtorId! })),
      paidInvoices: invs
        .filter((i) => i.status === "paid" && paidOn.has(i.id))
        .map((i) => ({ paidOn: paidOn.get(i.id)!, lastRemindedAt: i.lastRemindedAt?.toISOString() ?? null })),
    });
    return { ...kpis, reminderPerformance };
  });
}

export async function getForecast(app: Db, tenantId: string, todayIso: string): Promise<ForecastResult> {
  return withTenant(app, tenantId, async (tx) => {
    const invs = await tx.select().from(invoices);
    const paidOn = await loadPaidOnByInvoice(tx);
    const paidHistory: PaidHistoryRow[] = invs
      .filter((i) => i.status === "paid" && paidOn.has(i.id))
      .map((i) => ({ debtorId: i.debtorId, dueOn: i.dueOn, paidOn: paidOn.get(i.id)!, amountMinor: Number(i.amountMinor) }));
    return forecastCashflow({
      openInvoices: invs
        .filter((i) => i.status === "open" || i.status === "partially_paid")
        .map((i) => ({ id: i.id, debtorId: i.debtorId, dueOn: i.dueOn, outstandingMinor: Number(i.amountMinor - i.paidMinor) })),
      paidHistory, today: todayIso, weeks: 8,
    });
  });
}

// ------------------------------------------------------------------ exports
/** F11 CSV exports: tenant-scoped (RLS), UTF-8 BOM via core toCsv. Amounts exported in minor units, labelled as such. */
export async function exportInvoicesCsv(app: Db, tenantId: string): Promise<{ filename: string; csv: string }> {
  return withTenant(app, tenantId, async (tx) => {
    const [t] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
    const isAr = t?.settings?.exportLanguage === "ar";
    const rows = await tx.select().from(invoices);
    const headers = isAr
      ? ["المعرف", "معرف_العميل", "رقم_الفاتورة", "المبلغ_بالقروش", "المدفوع_بالقروش", "العملة", "تاريخ_الإصدار", "تاريخ_الاستحقاق", "الحالة"]
      : ["id", "debtor_id", "reference", "amount_minor", "paid_minor", "currency", "issued_on", "due_on", "status"];
    const csv = toCsv([
      headers,
      ...rows.map((i) => [i.id, i.debtorId, i.reference ?? "", Number(i.amountMinor), Number(i.paidMinor), i.currency, i.issuedOn, i.dueOn, i.status]),
    ]);
    return { filename: isAr ? "الفواتير.csv" : "invoices.csv", csv };
  });
}

export async function exportPaymentsCsv(app: Db, tenantId: string): Promise<{ filename: string; csv: string }> {
  return withTenant(app, tenantId, async (tx) => {
    const [t] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
    const isAr = t?.settings?.exportLanguage === "ar";
    const rows = await tx.select().from(payments);
    const headers = isAr
      ? ["المعرف", "معرف_العميل", "المبلغ_بالقروش", "طريقة_الدفع", "تاريخ_الاستلام", "الرقم_المرجعي", "الحالة", "المصدر"]
      : ["id", "debtor_id", "amount_minor", "method", "received_on", "reference_no", "status", "source"];
    const csv = toCsv([
      headers,
      ...rows.map((p) => [p.id, p.debtorId, Number(p.amountMinor), p.method, p.receivedOn, p.referenceNo ?? "", p.status, p.source]),
    ]);
    return { filename: isAr ? "المدفوعات.csv" : "payments.csv", csv };
  });
}

export async function exportDebtorsCsv(app: Db, tenantId: string): Promise<{ filename: string; csv: string }> {
  return withTenant(app, tenantId, async (tx) => {
    const [t] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
    const isAr = t?.settings?.exportLanguage === "ar";
    const rows = await tx.select().from(debtors).where(and(isNull(debtors.deletedAt)));
    const headers = isAr
      ? ["المعرف", "اسم_العميل", "الهاتف", "حالة_الواتساب", "مؤشر_المخاطر", "إلغاء_الاشتراك"]
      : ["id", "display_name", "phone_e164", "whatsapp_status", "risk_flag", "opted_out"];
    const csv = toCsv([
      headers,
      ...rows.map((d) => [d.id, d.displayName, d.phoneE164, d.whatsappStatus, d.riskFlag ? "yes" : "no", d.optedOutAt ? "yes" : "no"]),
    ]);
    return { filename: isAr ? "العملاء.csv" : "debtors.csv", csv };
  });
}
