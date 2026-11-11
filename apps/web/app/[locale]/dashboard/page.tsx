import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { formatEgp } from "@tahseel/core";
import { auth } from "@/server/auth";
import { appDb, ownerDb } from "@/server/db";
import { getDashboardSummary, listTenantsForUser, todayInTimezone } from "@/server/services";
import { getKpis, getForecast } from "@/server/reports";
import { getWorkspaceIntelligence } from "@/server/intelligence";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { BillingClient } from "@/components/BillingClient";
import { DashboardIntelligence } from "@/components/DashboardIntelligence";
import { EmptyInvoicesIllustration, ForecastIllustration, HeroBandArt, SecurityLockBadge } from "@/components/illustrations";
import { AgingBar, ForecastChart } from "@/components/charts";
import { EmptyState, InitialAvatar, Panel, SecurityNotice } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect(`/${locale}/login`);
  const mine = await listTenantsForUser(ownerDb(), session.user.id);
  const tenant = mine[0];
  if (!tenant) redirect(`/${locale}/onboarding`);

  const t = await getTranslations("dashboard");
  const tr = await getTranslations("reports");
  const ti = await getTranslations("invoices");
  const tn = await getTranslations("nav");
  const isAr = locale === "ar";
  const today = todayInTimezone(tenant.timezone);
  const [summary, kpisFull, forecast, intel] = await Promise.all([
    getDashboardSummary(appDb(), tenant.tenantId, today),
    getKpis(appDb(), tenant.tenantId, today),
    getForecast(appDb(), tenant.tenantId, today),
    getWorkspaceIntelligence(appDb(), tenant.tenantId, tenant.businessNameAr, today),
  ]);
  const isEmpty = summary.openInvoices === 0 && summary.debtors === 0;
  const fmt = (minor: string) => formatEgp(BigInt(minor));
  const fmtN = (minor: number) => formatEgp(BigInt(minor));

  const stats = [
    { key: "overdue", label: t("overdue"), testid: "kpi-overdue", value: fmt(summary.overdueMinor), currency: true, alert: BigInt(summary.overdueMinor) > 0n },
    { key: "collected", label: t("collectedThisMonth"), testid: "kpi-collected", value: fmt(summary.collectedThisMonthMinor), currency: true, alert: false },
    { key: "rate", label: tr("collectionRate"), testid: "kpi-collection-rate", value: `${(kpisFull.collectionRate * 100).toFixed(1)}%`, currency: false, alert: false },
    { key: "dso", label: tr("dso"), testid: "kpi-dso", value: kpisFull.dsoDays.toFixed(1), currency: false, alert: false },
  ];
  const aging = [
    { key: "current", label: tr("current"), amountMinor: kpisFull.agingBuckets.current, formatted: fmtN(kpisFull.agingBuckets.current) },
    { key: "0-7", label: "0-7", amountMinor: kpisFull.agingBuckets["0-7"], formatted: fmtN(kpisFull.agingBuckets["0-7"]) },
    { key: "8-30", label: "8-30", amountMinor: kpisFull.agingBuckets["8-30"], formatted: fmtN(kpisFull.agingBuckets["8-30"]) },
    { key: "31-60", label: "31-60", amountMinor: kpisFull.agingBuckets["31-60"], formatted: fmtN(kpisFull.agingBuckets["31-60"]) },
    { key: "60+", label: "60+", amountMinor: kpisFull.agingBuckets["60+"], formatted: fmtN(kpisFull.agingBuckets["60+"]) },
  ];
  const perf = kpisFull.reminderPerformance;

  return (
    <AppShell locale={locale} businessName={tenant.businessNameAr} testId="dashboard">
      {/* Brand Signature Blue Hero Banner (Restored per user specification) */}
      <section className="hero-band panel-shadow relative overflow-hidden rounded-3xl text-white shadow-lg">
        <div className="brand-pattern absolute inset-0" aria-hidden />
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-6 p-6 sm:p-8">
          <div className="flex min-w-[240px] flex-1 flex-col items-start gap-2.5">
            <div className="flex items-center gap-2 text-xs font-bold text-teal-300">
              <span className="flex size-2 rounded-full bg-emerald-400 animate-pulse" aria-hidden />
              <span>{isAr ? "محدّث لحظياً" : "Live data"}</span>
              <span>·</span>
              <span dir="ltr">{today}</span>
            </div>
            <div className="flex items-center gap-3">
              <SecurityLockBadge size={38} />
              <h1 className="text-2xl sm:text-3xl font-extrabold leading-tight text-white">
                {t("title")} — {tenant.businessNameAr}
              </h1>
            </div>
            <p className="text-sm text-navy-100 max-w-xl">
              {isAr
                ? "متابعة شاملة للمستحقات، التنبؤ بحركة السيولة، وإدارة تذكيرات العملاء آلياً."
                : "Comprehensive receivables tracking, cash-flow projections, and smart reminders."}
            </p>
            <div className="mt-2 flex flex-wrap gap-2.5">
              <Link
                href={`/${locale}/invoices`}
                className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-white px-5 py-2 text-sm font-extrabold text-navy-900 shadow-sm transition hover:bg-white/95"
              >
                <span>+</span>
                <span>{ti("add")}</span>
              </Link>
              <Link
                href={`/${locale}/import`}
                className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-5 py-2 text-sm font-bold text-white backdrop-blur-sm transition hover:bg-white/20"
              >
                <span>{tn("import")}</span>
              </Link>
            </div>
          </div>
          <div className="hidden shrink-0 lg:block" aria-hidden>
            <HeroBandArt size={260} />
          </div>
        </div>
      </section>

      {/* 4-Card Executive KPI Summary (Equal height, unified rhythm, zero clutter) */}
      <section aria-label="kpis" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Total Outstanding */}
        <div className="flex flex-col justify-between rounded-3xl bg-surface p-6 shadow-sm transition-all hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-text-muted">{t("totalOutstanding")}</span>
            <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-bold text-primary">
              {isAr ? "المستحق الكلي" : "Total Due"}
            </span>
          </div>
          <div className="my-3">
            <span data-testid="kpi-outstanding" className="tnum text-3xl font-extrabold text-text" dir="ltr">
              {fmt(summary.totalOutstandingMinor)}
            </span>
            <span className="ms-1.5 text-xs font-bold text-text-muted">{t("currency")}</span>
          </div>
          <p className="text-xs text-text-muted">
            <span data-testid="kpi-open" className="tnum font-bold text-text" dir="ltr">{summary.openInvoices}</span> {t("openInvoices")}
            {" · "}
            <span data-testid="kpi-debtors" className="tnum font-bold text-text" dir="ltr">{summary.debtors}</span> {t("debtors")}
          </p>
        </div>

        {/* Card 2: Overdue */}
        <div className="flex flex-col justify-between rounded-3xl bg-surface p-6 shadow-sm transition-all hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-text-muted">{stats[0]!.label}</span>
            <span className="rounded-full bg-danger-bg px-2.5 py-0.5 text-[11px] font-bold text-danger">
              {isAr ? "متأخر" : "Overdue"}
            </span>
          </div>
          <div className="my-3">
            <span data-testid="kpi-overdue" className="tnum text-3xl font-extrabold text-danger" dir="ltr">
              {stats[0]!.value}
            </span>
            <span className="ms-1.5 text-xs font-bold text-text-muted">{t("currency")}</span>
          </div>
          <p className="text-xs text-text-muted">{isAr ? "تجاوزت تاريخ الاستحقاق" : "Passed due date"}</p>
        </div>

        {/* Card 3: Collected This Month */}
        <div className="flex flex-col justify-between rounded-3xl bg-surface p-6 shadow-sm transition-all hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-text-muted">{stats[1]!.label}</span>
            <span className="rounded-full bg-status-paid-bg px-2.5 py-0.5 text-[11px] font-bold text-status-paid-fg">
              {isAr ? "تم التحصيل" : "Received"}
            </span>
          </div>
          <div className="my-3">
            <span data-testid="kpi-collected" className="tnum text-3xl font-extrabold text-status-paid-fg" dir="ltr">
              {stats[1]!.value}
            </span>
            <span className="ms-1.5 text-xs font-bold text-text-muted">{t("currency")}</span>
          </div>
          <p className="text-xs text-text-muted">{isAr ? "صافي المقبوضات المسجلة" : "Total received this month"}</p>
        </div>

        {/* Card 4: Collection Rate & DSO */}
        <div className="flex flex-col justify-between rounded-3xl bg-surface p-6 shadow-sm transition-all hover:shadow-md">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-text-muted">{stats[2]!.label}</span>
            <span className="rounded-full bg-teal-500/10 px-2.5 py-0.5 text-[11px] font-bold text-teal-600 dark:text-teal-300">
              {isAr ? "كفاءة" : "Efficiency"}
            </span>
          </div>
          <div className="my-3">
            <span data-testid="kpi-collection-rate" className="tnum text-3xl font-extrabold text-text" dir="ltr">
              {stats[2]!.value}
            </span>
          </div>
          <p className="text-xs text-text-muted">
            {isAr ? "متوسط سرعة السداد:" : "Avg collection:"} <span data-testid="kpi-dso" className="tnum font-bold text-text" dir="ltr">{stats[3]!.value}</span> {isAr ? "يوم" : "days"}
          </p>
        </div>
      </section>

      {isEmpty && (
        <EmptyState
          testId="empty-state"
          illustration={<EmptyInvoicesIllustration size={150} />}
          title={t("emptyTitle")}
          body={t("emptyBody")}
        >
          <Link href={`/${locale}/invoices`} className="inline-flex min-h-[44px] items-center rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-fg hover:bg-primary-hover">
            {t("emptyCta")}
          </Link>
        </EmptyState>
      )}

      {!isEmpty && <DashboardIntelligence locale={locale} intel={intel} />}

      {/* Reports, Forecast & Operations (12-col balanced layout) */}
      <section data-testid="reports" className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-extrabold text-text">{tr("title")}</h2>
          <span className="text-xs font-medium text-text-muted">
            {isAr ? "تحليلات التدفق ومؤشرات السداد" : "Cashflow analytics & payment metrics"}
          </span>
        </div>

        <div className="grid gap-6 lg:grid-cols-12 items-start">
          {/* Main Financial Analytics (8 cols on desktop) */}
          <div className="flex flex-col gap-6 lg:col-span-8">
            {/* Forecast Panel */}
            <Panel testId="forecast" title={tr("forecastTitle")}>
              {!forecast.enoughData ? (
                <div className="flex flex-col items-center justify-center gap-4 py-8 text-center">
                  <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <ForecastIllustration size={44} />
                  </div>
                  <div className="max-w-md">
                    <p data-testid="forecast-not-enough" className="text-base font-bold text-text">
                      {tr("forecastNotEnough")}
                    </p>
                    <p className="mt-1 text-xs text-text-muted">
                      {isAr
                        ? "تحليل تنبؤي مدعوم بالذكاء الاصطناعي لحركة التدفقات النقدية."
                        : "AI-powered cash-flow forecasting based on payment trends."}
                    </p>
                  </div>
                  <div className="grid w-full max-w-lg grid-cols-1 gap-2.5 pt-2 text-start text-xs sm:grid-cols-3">
                    <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface-muted/40 p-3">
                      <span className="font-bold text-primary">{isAr ? "١. إصدار الفواتير" : "1. Issue Invoices"}</span>
                      <span className="text-text-muted">{isAr ? "تسجيل المستحقات" : "Record receivables"}</span>
                    </div>
                    <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface-muted/40 p-3">
                      <span className="font-bold text-primary">{isAr ? "٢. توثيق السداد" : "2. Log Payments"}</span>
                      <span className="text-text-muted">{isAr ? "تسجيل المقبوضات" : "Collect receipts"}</span>
                    </div>
                    <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface-muted/40 p-3">
                      <span className="font-bold text-primary">{isAr ? "٣. منحنى السيولة" : "3. Cash Forecast"}</span>
                      <span className="text-text-muted">{isAr ? "توقع تدفقات ٨ أسابيع" : "8-week projection"}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <p className="text-sm text-text-muted">{tr("forecastMethod")}</p>
                  <ForecastChart
                    weeks={forecast.weeks}
                    expectedLabel={tr("expected")}
                    conservativeLabel={tr("conservative")}
                    format={fmtN}
                  />
                </div>
              )}
            </Panel>

            {/* Aging & Top Debtors 2-Column Row */}
            <div className="grid gap-6 sm:grid-cols-2">
              <Panel title={tr("agingTitle")}>
                <AgingBar buckets={aging} />
              </Panel>

              <Panel title={tr("topDebtorsTitle")}>
                {kpisFull.topDebtors.length === 0 ? (
                  <div className="flex min-h-[140px] items-center justify-center text-sm text-text-muted">
                    {isAr ? "لا يوجد مدينين متأخرين حالياً" : "No overdue debtors currently"}
                  </div>
                ) : (
                  <ul className="flex flex-col divide-y divide-border">
                    {kpisFull.topDebtors.map((d) => (
                      <li key={d.debtorId}>
                        <Link href={`/${locale}/debtors/${d.debtorId}`} className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-callout">
                          <InitialAvatar name={d.displayName} size={34} />
                          <span className="min-w-0 flex-1 truncate text-sm font-bold">{d.displayName}</span>
                          <span className="tnum font-extrabold text-primary" dir="ltr">{fmtN(d.outstandingMinor)}</span>
                          <span className="text-xs font-normal text-text-muted">{t("currency")}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
          </div>

          {/* Operational Rail (4 cols on desktop) */}
          <div className="flex flex-col gap-6 lg:col-span-4">
            {/* Reminder Performance */}
            <Panel title={tr("reminderPerfTitle")}>
              <dl className="grid grid-cols-2 gap-2.5">
                {[
                  { label: tr("sent"), value: perf.sent, testid: "perf-sent" },
                  { label: tr("delivered"), value: perf.delivered, testid: undefined },
                  { label: tr("replied"), value: perf.replied, testid: undefined },
                  { label: tr("paidWithin7d"), value: perf.paidWithin7d, testid: undefined },
                ].map((x) => (
                  <div key={x.label} className="flex flex-col gap-1 rounded-xl border border-border/60 bg-surface-muted/50 p-3">
                    <dt className="text-xs font-medium text-text-muted">{x.label}</dt>
                    <dd className="text-xl font-extrabold text-primary">
                      <span data-testid={x.testid} className="tnum" dir="ltr">{x.value}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            </Panel>

            {/* Current Plan & Subscription (Required for m5 test and executive monitoring) */}
            <BillingClient locale={locale} compact />
          </div>
        </div>
      </section>

      <SecurityNotice
        compact
        body={isAr
          ? "تتحدث مؤشرات الأداء والتدفقات النقدية تلقائيًا مع كل فاتورة أو دفعة جديدة."
          : "KPIs and cash-flow projections update automatically with every invoice or payment."}
      />
    </AppShell>
  );
}
