import { eq, isNull, and, sql } from "drizzle-orm";
import {
  AppError, computeKpis, computeReminderPerformance, forecastCashflow, toCsv,
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
  /** Tenant default currency: every headline number below is in this
   * currency only (F02 — minor units are never summed across currencies). */
  currency: string;
  /** Per-currency breakdown so other-currency money is visible, not hidden. */
  byCurrency: { currency: string; outstandingMinor: number; overdueMinor: number; collectedInMonthMinor: number; refundedInMonthMinor: number }[];
  weeklyInvoiced?: { weekStart: string; amountMinor: number }[];
  weeklyCollected?: { weekStart: string; amountMinor: number }[];
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
 * invoices it measured seconds on this VM (M6 bench BEFORE).
 * This path computes the SAME pinned definitions (ADR-023) with SQL
 * aggregates under RLS; the in-memory reference below stays exported and
 * the M6 bench cross-checks both paths number-for-number on the 100k
 * tenant (and the M5 hand-fixture integration suite runs against getKpis).
 */
export async function getKpis(app: Db, tenantId: string, todayIso: string): Promise<KpiServiceResult> {
  return withTenant(app, tenantId, async (tx) => {
    const [tenant] = await tx.select({ settings: tenants.settings, timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId));
    // F02: headline KPIs are computed in the tenant's default currency
    // ONLY — the old query summed minor units across currencies. The
    // per-currency breakdown below keeps other-currency money visible.
    // H09: every status filter below is ('open','partially_paid') — the
    // same collectible rule as core outstandingFor(): a disputed invoice
    // is frozen and never counts toward outstanding, overdue or aging.
    const currency = tenant?.settings.currency ?? "EGP";
    const timezone = tenant?.timezone ?? "Africa/Cairo";
    const [[agg], top, byCurrency, collectedByCurrency, [perf], weeklyInvRows, weeklyColRows] = await Promise.all([
      tx.execute(sql`
        select
          coalesce(sum(amount_minor - paid_minor) filter (where status in ('open','partially_paid') and amount_minor > paid_minor), 0)::bigint as outstanding,
          coalesce(sum(amount_minor - paid_minor) filter (where status in ('open','partially_paid') and amount_minor > paid_minor and due_on < ${todayIso}::date), 0)::bigint as overdue,
          coalesce(sum(amount_minor) filter (where issued_on >= ${todayIso}::date - 89 and issued_on <= ${todayIso}::date and status not in ('cancelled','written_off')), 0)::bigint as invoiced90,
          coalesce(sum(amount_minor - paid_minor) filter (where status in ('open','partially_paid') and amount_minor > paid_minor and due_on >= ${todayIso}::date), 0)::bigint as aging_current,
          coalesce(sum(amount_minor - paid_minor) filter (where status in ('open','partially_paid') and amount_minor > paid_minor and (${todayIso}::date - due_on) between 1 and 7), 0)::bigint as aging_0_7,
          coalesce(sum(amount_minor - paid_minor) filter (where status in ('open','partially_paid') and amount_minor > paid_minor and (${todayIso}::date - due_on) between 8 and 30), 0)::bigint as aging_8_30,
          coalesce(sum(amount_minor - paid_minor) filter (where status in ('open','partially_paid') and amount_minor > paid_minor and (${todayIso}::date - due_on) between 31 and 60), 0)::bigint as aging_31_60,
          coalesce(sum(amount_minor - paid_minor) filter (where status in ('open','partially_paid') and amount_minor > paid_minor and (${todayIso}::date - due_on) > 60), 0)::bigint as aging_60p
        from invoices where tenant_id = ${tenantId} and currency = ${currency}`) as unknown as Promise<[{
          outstanding: string; overdue: string; invoiced90: string;
          aging_current: string; aging_0_7: string; aging_8_30: string; aging_31_60: string; aging_60p: string;
        }]>,
      tx.execute(sql`
        select i.debtor_id as "debtorId", d.display_name as "displayName", coalesce(sum(i.amount_minor - i.paid_minor), 0)::bigint as outstanding
        from invoices i
        join debtors d on d.id = i.debtor_id and d.deleted_at is null
        where i.tenant_id = ${tenantId} and i.status in ('open','partially_paid') and i.amount_minor > i.paid_minor and i.currency = ${currency}
        group by i.debtor_id, d.display_name order by outstanding desc, i.debtor_id asc limit 10`) as unknown as Promise<{ debtorId: string; displayName: string; outstanding: string }[]>,
      tx.execute(sql`
        select currency,
          coalesce(sum(amount_minor - paid_minor) filter (where status in ('open','partially_paid') and amount_minor > paid_minor), 0)::bigint as outstanding,
          coalesce(sum(amount_minor - paid_minor) filter (where status in ('open','partially_paid') and amount_minor > paid_minor and due_on < ${todayIso}::date), 0)::bigint as overdue
        from invoices where tenant_id = ${tenantId} group by currency order by currency`) as unknown as Promise<{ currency: string; outstanding: string; overdue: string }[]>,
      tx.execute(sql`
        select currency,
          coalesce(sum(amount_minor) filter (where amount_minor > 0), 0)::bigint as collected,
          coalesce(-sum(amount_minor) filter (where amount_minor < 0), 0)::bigint as refunded
        from payments
        where tenant_id = ${tenantId} and status = 'confirmed'
          and received_on >= date_trunc('month', ${todayIso}::date)::date
          and received_on < (date_trunc('month', ${todayIso}::date) + interval '1 month')::date
        group by currency order by currency`) as unknown as Promise<{ currency: string; collected: string; refunded: string }[]>,
      tx.execute(sql`
        select
          out_agg.sent,
          out_agg.delivered,
          (select count(distinct debtor_id)::int from messages where tenant_id = ${tenantId} and direction = 'in' and debtor_id in
             (select distinct debtor_id from messages where tenant_id = ${tenantId} and direction = 'out' and status in ('sent','delivered','read'))) as replied,
          (select count(*)::int from (
             select i.last_reminded_at, max(p.received_on) as paid_on
             from invoices i
             join payment_allocations a on a.invoice_id = i.id and a.tenant_id = ${tenantId}
             join payments p on p.id = a.payment_id and p.tenant_id = ${tenantId} and p.status = 'confirmed'
             where i.tenant_id = ${tenantId} and i.status = 'paid' and i.last_reminded_at is not null
             group by i.id, i.last_reminded_at) x
           where (x.paid_on - (x.last_reminded_at at time zone ${timezone})::date) between 0 and 7) as paid_within_7d
        from (
          select
            count(*) filter (where status in ('sent','delivered','read'))::int as sent,
            count(*) filter (where status in ('delivered','read'))::int as delivered
          from messages where tenant_id = ${tenantId} and direction = 'out'
        ) out_agg`) as unknown as Promise<[{ sent: number; delivered: number; replied: number; paid_within_7d: number }]>,
      tx.execute(sql`
        with weeks as (
          select generate_series(date_trunc('week', ${todayIso}::date) - interval '5 weeks', date_trunc('week', ${todayIso}::date), interval '1 week')::date as ws
        )
        select to_char(w.ws, 'MM-DD') as "weekStart",
          coalesce(sum(i.amount_minor) filter (where i.currency = ${currency} and i.status not in ('cancelled','written_off')), 0)::bigint as amount
        from weeks w
        left join invoices i on i.tenant_id = ${tenantId} and i.issued_on >= w.ws and i.issued_on < (w.ws + interval '7 days')::date
        group by w.ws order by w.ws`) as unknown as Promise<{ weekStart: string; amount: string }[]>,
      tx.execute(sql`
        with weeks as (
          select generate_series(date_trunc('week', ${todayIso}::date) - interval '5 weeks', date_trunc('week', ${todayIso}::date), interval '1 week')::date as ws
        )
        select to_char(w.ws, 'MM-DD') as "weekStart",
          coalesce(sum(p.amount_minor) filter (where p.currency = ${currency} and p.status = 'confirmed' and p.amount_minor > 0), 0)::bigint as amount
        from weeks w
        left join payments p on p.tenant_id = ${tenantId} and p.received_on >= w.ws and p.received_on < (w.ws + interval '7 days')::date
        group by w.ws order by w.ws`) as unknown as Promise<{ weekStart: string; amount: string }[]>,
    ]);
    const collectedMap = new Map(collectedByCurrency.map((c) => [c.currency, toSafeMinor(BigInt(c.collected), `collected ${c.currency}`)]));
    const refundedMap = new Map(collectedByCurrency.map((c) => [c.currency, toSafeMinor(BigInt(c.refunded), `refunded ${c.currency}`)]));
    const byCurrencyMerged = byCurrency.map((b) => ({
      currency: b.currency,
      outstandingMinor: toSafeMinor(BigInt(b.outstanding), `outstanding ${b.currency}`),
      overdueMinor: toSafeMinor(BigInt(b.overdue), `overdue ${b.currency}`),
      collectedInMonthMinor: collectedMap.get(b.currency) ?? 0,
      refundedInMonthMinor: refundedMap.get(b.currency) ?? 0,
    }));
    for (const c of collectedByCurrency) {
      if (!byCurrencyMerged.some((b) => b.currency === c.currency)) {
        byCurrencyMerged.push({
          currency: c.currency,
          outstandingMinor: 0,
          overdueMinor: 0,
          collectedInMonthMinor: collectedMap.get(c.currency) ?? 0,
          refundedInMonthMinor: refundedMap.get(c.currency) ?? 0,
        });
      }
    }
    byCurrencyMerged.sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));


    const totalOutstandingMinor = toSafeMinor(BigInt(agg!.outstanding), "totalOutstanding");
    const collectedInMonthMinor = collectedMap.get(currency) ?? 0;
    const refundedInMonthMinor = refundedMap.get(currency) ?? 0;
    const netCollected = Math.max(0, collectedInMonthMinor - refundedInMonthMinor);
    const invoiced90 = toSafeMinor(BigInt(agg!.invoiced90), "invoiced90");
    const overdueAmountMinor = toSafeMinor(BigInt(agg!.overdue), "overdueAmount");
    const ceiCollectible = netCollected + overdueAmountMinor;
    const ceiPct = ceiCollectible > 0 ? Math.round(Math.min(100, Math.max(0, (netCollected / ceiCollectible) * 100)) * 100) / 100 : null;
    return {
      totalOutstandingMinor,
      overdueAmountMinor,
      ceiPct,
      collectedInMonthMinor,
      refundedInMonthMinor,
      collectionRate: netCollected + totalOutstandingMinor > 0 ? netCollected / (netCollected + totalOutstandingMinor) : 0,
      dsoDays: invoiced90 > 0 ? Math.round(((totalOutstandingMinor / invoiced90) * 90) * 100) / 100 : 0,
      agingBuckets: {
        current: toSafeMinor(BigInt(agg!.aging_current), "aging.current"),
        "0-7": toSafeMinor(BigInt(agg!.aging_0_7), "aging.0-7"),
        "8-30": toSafeMinor(BigInt(agg!.aging_8_30), "aging.8-30"),
        "31-60": toSafeMinor(BigInt(agg!.aging_31_60), "aging.31-60"),
        "60+": toSafeMinor(BigInt(agg!.aging_60p), "aging.60+"),
      },
      topDebtors: top.map((t) => ({
        debtorId: t.debtorId,
        displayName: t.displayName ?? t.debtorId,
        outstandingMinor: toSafeMinor(BigInt(t.outstanding), `topDebtor ${t.debtorId}`),
      })),
      reminderPerformance: { sent: perf!.sent, delivered: perf!.delivered, replied: perf!.replied, paidWithin7d: perf!.paid_within_7d },
      weeklyInvoiced: weeklyInvRows.map((r) => ({ weekStart: r.weekStart, amountMinor: toSafeMinor(BigInt(r.amount), `weeklyInvoiced ${r.weekStart}`) })),
      weeklyCollected: weeklyColRows.map((r) => ({ weekStart: r.weekStart, amountMinor: toSafeMinor(BigInt(r.amount), `weeklyCollected ${r.weekStart}`) })),
      currency,
      byCurrency: byCurrencyMerged,
    };
  });
}

/** The M5 in-memory reference implementation (core-computed). Kept for cross-checks.
 * F02: like the SQL path it reports headline KPIs in the tenant's default
 * currency only, with a per-currency breakdown — the M6 bench cross-checks
 * both paths number-for-number on single-currency data.
 *
 * F-16: TEST-ONLY — this function has no production caller (its only
 * caller is m5.integration.test.ts, which asserts the SQL getKpis agrees
 * with it number-for-number). It is kept deliberately as the independent
 * reference implementation, NOT because it is dead code. Do not call it
 * from production code and do not delete it without moving the cross-check
 * into the test tree. */
export async function getKpisReference(app: Db, tenantId: string, todayIso: string): Promise<KpiServiceResult> {
  return withTenant(app, tenantId, async (tx) => {
    const [tenant] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
    const currency = tenant?.settings.currency ?? "EGP";
    const invs = await tx.select().from(invoices);
    const pays = await tx.select().from(payments);
    const dbs = await tx.select().from(debtors).where(isNull(debtors.deletedAt));
    const names = new Map(dbs.map((d) => [d.id, d.displayName]));
    const kpis = computeKpis({
      invoices: invs.filter((i) => i.currency === currency).map((i) => ({
        id: i.id, debtorId: i.debtorId, amountMinor: Number(i.amountMinor), paidMinor: Number(i.paidMinor),
        status: i.status, issuedOn: i.issuedOn, dueOn: i.dueOn,
      })),
      payments: pays.filter((p) => p.currency === currency).map((p) => ({ amountMinor: Number(p.amountMinor), status: p.status, receivedOn: p.receivedOn })),
      debtorNames: names, today: todayIso,
    });
    const byCurrencyMap = new Map<string, { outstandingMinor: number; overdueMinor: number; collectedInMonthMinor: number; refundedInMonthMinor: number }>();
    // Same month rule as core computeKpis: receivedOn in the calendar
    // month of today (YYYY-MM prefix). M03: collected and refunded are
    // separate lines, exactly as in the SQL path.
    const monthPrefix = todayIso.slice(0, 7);
    for (const i of invs) {
      const b = byCurrencyMap.get(i.currency) ?? { outstandingMinor: 0, overdueMinor: 0, collectedInMonthMinor: 0, refundedInMonthMinor: 0 };
      if ((i.status === "open" || i.status === "partially_paid") && i.amountMinor > i.paidMinor) {
        const diff = Number(i.amountMinor - i.paidMinor);
        b.outstandingMinor += diff;
        if (i.dueOn < todayIso) b.overdueMinor += diff;
      }
      byCurrencyMap.set(i.currency, b);
    }
    for (const p of pays) {
      if (p.status === "confirmed" && p.receivedOn.slice(0, 7) === monthPrefix) {
        const b = byCurrencyMap.get(p.currency) ?? { outstandingMinor: 0, overdueMinor: 0, collectedInMonthMinor: 0, refundedInMonthMinor: 0 };
        if (Number(p.amountMinor) >= 0) b.collectedInMonthMinor += Number(p.amountMinor);
        else b.refundedInMonthMinor += -Number(p.amountMinor);
        byCurrencyMap.set(p.currency, b);
      }
    }
    const byCurrency = [...byCurrencyMap.entries()].map(([c, v]) => ({ currency: c, ...v })).sort((a, b) => (a.currency < b.currency ? -1 : 1));
    const msgs = await tx.select().from(messages);
    const paidOn = await loadPaidOnByInvoice(tx);
    const reminderPerformance = computeReminderPerformance({
      outbound: msgs.filter((m) => m.direction === "out" && m.debtorId).map((m) => ({ debtorId: m.debtorId!, status: m.status })),
      inbound: msgs.filter((m) => m.direction === "in" && m.debtorId).map((m) => ({ debtorId: m.debtorId! })),
      paidInvoices: invs
        .filter((i) => i.status === "paid" && paidOn.has(i.id))
        .map((i) => ({ paidOn: paidOn.get(i.id)!, lastRemindedAt: i.lastRemindedAt?.toISOString() ?? null })),
    });
    return { ...kpis, reminderPerformance, currency, byCurrency };
  });
}

/**
 * M04: the money a paid invoice actually collected — Σ confirmed
 * allocations — not its full amount. An invoice marked paid by hand (or
 * settled partly by credit/write-off) must not train the forecast/backtest
 * on money that was never collected. Exported for the integration test.
 */
export async function loadCollectedByInvoice(tx: Db): Promise<Map<string, bigint>> {
  const rows = await tx.select({
    invoiceId: paymentAllocations.invoiceId, amountMinor: paymentAllocations.amountMinor, status: payments.status,
  }).from(paymentAllocations).innerJoin(payments, eq(payments.id, paymentAllocations.paymentId));
  const map = new Map<string, bigint>();
  for (const r of rows) {
    if (r.status !== "confirmed") continue;
    map.set(r.invoiceId, (map.get(r.invoiceId) ?? 0n) + r.amountMinor);
  }
  return map;
}

/** M04: bigint minor units cross into the number-based forecast only
 * through this guard — anything above 2^53 fails loudly, never silently
 * truncated. */
function toSafeMinor(value: bigint, what: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new AppError("AMOUNT_TOO_LARGE", `Report amount is outside the safe-integer range (${what})`, 500);
  }
  return Number(value);
}

export async function getForecast(app: Db, tenantId: string, todayIso: string): Promise<ForecastResult> {
  return withTenant(app, tenantId, async (tx) => {
    const [tenant] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
    // F02/M04: the forecast is single-currency (the tenant's default) —
    // the old code loaded every invoice and summed minor units across
    // currencies as if they were one.
    const currency = tenant?.settings.currency ?? "EGP";
    const invs = await tx
      .select({
        id: invoices.id,
        debtorId: invoices.debtorId,
        status: invoices.status,
        amountMinor: invoices.amountMinor,
        paidMinor: invoices.paidMinor,
        dueOn: invoices.dueOn,
      })
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.currency, currency)));
    const allocs = await tx
      .select({
        invoiceId: paymentAllocations.invoiceId,
        paidOn: sql<string>`max(${payments.receivedOn})::text`,
        collectedMinor: sql<string>`coalesce(sum(${paymentAllocations.amountMinor}), 0)::bigint`,
      })
      .from(paymentAllocations)
      .innerJoin(payments, eq(payments.id, paymentAllocations.paymentId))
      .where(and(eq(payments.tenantId, tenantId), eq(payments.status, "confirmed"), eq(payments.currency, currency)))
      .groupBy(paymentAllocations.invoiceId);
    const paidOn = new Map<string, string>();
    const collected = new Map<string, bigint>();
    for (const a of allocs) {
      paidOn.set(a.invoiceId, a.paidOn);
      collected.set(a.invoiceId, BigInt(a.collectedMinor));
    }
    const paidHistory: PaidHistoryRow[] = invs
      .filter((i) => i.status === "paid" && paidOn.has(i.id))
      .map((i) => ({
        debtorId: i.debtorId, dueOn: i.dueOn, paidOn: paidOn.get(i.id)!,
        amountMinor: toSafeMinor(collected.get(i.id) ?? 0n, `paid invoice ${i.id}`),
      }));
    return forecastCashflow({
      openInvoices: invs
        .filter((i) => (i.status === "open" || i.status === "partially_paid") && i.amountMinor > i.paidMinor)
        .map((i) => ({ id: i.id, debtorId: i.debtorId, dueOn: i.dueOn, outstandingMinor: toSafeMinor(i.amountMinor - i.paidMinor, `open invoice ${i.id}`) })),
      paidHistory, today: todayIso, currency, weeks: 8,
    });
  });
}

// ------------------------------------------------------------------ exports
/** F11 CSV exports: tenant-scoped (RLS), UTF-8 BOM via core toCsv. Amounts exported in minor units, labelled as such. */
export async function exportInvoicesCsv(app: Db, tenantId: string): Promise<{ filename: string; csv: string }> {
  return withTenant(app, tenantId, async (tx) => {
    const [t] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
    const isAr = t?.settings?.exportLanguage === "ar";
    const rows = await tx.select().from(invoices).where(eq(invoices.tenantId, tenantId)).orderBy(invoices.issuedOn, invoices.id);
    const headers = isAr
      ? ["المعرف", "معرف_العميل", "رقم_الفاتورة", "المبلغ_بالوحدة_الصغرى", "المدفوع_بالوحدة_الصغرى", "العملة", "تاريخ_الإصدار", "تاريخ_الاستحقاق", "الحالة"]
      : ["id", "debtor_id", "reference", "amount_minor", "paid_minor", "currency", "issued_on", "due_on", "status"];
    const csv = toCsv([
      headers,
      ...rows.map((i) => [i.id, i.debtorId, i.reference ?? "", i.amountMinor, i.paidMinor, i.currency, i.issuedOn, i.dueOn, i.status]),
    ]);
    return { filename: isAr ? "الفواتير.csv" : "invoices.csv", csv };
  });
}

export async function exportPaymentsCsv(app: Db, tenantId: string): Promise<{ filename: string; csv: string }> {
  return withTenant(app, tenantId, async (tx) => {
    const [t] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
    const isAr = t?.settings?.exportLanguage === "ar";
    const rows = await tx.select().from(payments).where(eq(payments.tenantId, tenantId)).orderBy(payments.receivedOn, payments.id);
    const headers = isAr
      ? ["المعرف", "معرف_العميل", "المبلغ_بالوحدة_الصغرى", "العملة", "طريقة_الدفع", "تاريخ_الاستلام", "الرقم_المرجعي", "الحالة", "المصدر"]
      : ["id", "debtor_id", "amount_minor", "currency", "method", "received_on", "reference_no", "status", "source"];
    const csv = toCsv([
      headers,
      ...rows.map((p) => [p.id, p.debtorId, p.amountMinor, p.currency, p.method, p.receivedOn, p.referenceNo ?? "", p.status, p.source]),
    ]);
    return { filename: isAr ? "المدفوعات.csv" : "payments.csv", csv };
  });
}

export async function exportDebtorsCsv(app: Db, tenantId: string): Promise<{ filename: string; csv: string }> {
  return withTenant(app, tenantId, async (tx) => {
    const [t] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
    const isAr = t?.settings?.exportLanguage === "ar";
    const rows = await tx.select().from(debtors).where(and(eq(debtors.tenantId, tenantId), isNull(debtors.deletedAt))).orderBy(debtors.createdAt, debtors.id);
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
