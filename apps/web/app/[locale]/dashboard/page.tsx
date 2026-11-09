import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { formatEgp } from "@tahseel/core";
import { auth } from "@/server/auth";
import { appDb, ownerDb } from "@/server/db";
import { getDashboardSummary, listTenantsForUser, todayInTimezone } from "@/server/services";
import { getKpis, getForecast } from "@/server/reports";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { BillingClient } from "@/components/BillingClient";
import { ExportButtons } from "@/components/ExportButtons";
import { DangerZone } from "@/components/DangerZone";
import { EmptyInvoicesIllustration, ForecastIllustration, HeroBandArt } from "@/components/illustrations";
import { Reveal } from "@/components/motion";
import { AgingBar, ForecastChart } from "@/components/charts";
import { EmptyState, InitialAvatar, Panel } from "@/components/ui";

/**
 * Dashboard (v0.9.0 premium redesign). SAME server data as before —
 * getDashboardSummary + getKpis + getForecast — composed, not shuffled:
 * a navy header band, ONE summary panel (hero outstanding + a divided
 * stat row), then a two-column region (forecast chart, aging, top
 * debtors | reminder performance, plan, exports, danger zone).
 */
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
  const today = todayInTimezone(tenant.timezone);
  const summary = await getDashboardSummary(appDb(), tenant.tenantId, today);
  // F11/F12: the extended reports (core-computed KPIs + forecast).
  const kpisFull = await getKpis(appDb(), tenant.tenantId, today);
  const forecast = await getForecast(appDb(), tenant.tenantId, today);
  const isEmpty = summary.openInvoices === 0 && summary.debtors === 0;
  const fmt = (minor: string) => formatEgp(BigInt(minor));
  const fmtN = (minor: number) => formatEgp(BigInt(minor));

  // BRAND §2.3: amounts are wrapped in dir="ltr" so digits never reorder
  // inside RTL text; the currency label stays in the normal RTL flow.
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
      {/* Header band */}
      <section className="hero-band panel-shadow relative overflow-hidden rounded-2xl text-white">
        <div className="brand-pattern absolute inset-0" aria-hidden />
        <div className="relative flex flex-wrap items-center gap-6 p-6 sm:p-8">
          <div className="flex min-w-[230px] flex-1 flex-col items-start gap-2.5">
            <p className="text-sm font-bold text-teal-300">{tenant.businessNameAr}</p>
            <h1 className="text-3xl font-extrabold leading-tight">{t("title")}</h1>
            <p className="text-sm text-navy-100"><span dir="ltr">{today}</span></p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Link href={`/${locale}/invoices`} className="inline-flex min-h-touch items-center gap-2 rounded-md bg-accent px-4 py-2 font-bold text-accent-fg transition-opacity hover:opacity-90">
                {ti("add")}
              </Link>
              <Link href={`/${locale}/import`} className="inline-flex min-h-touch items-center gap-2 rounded-md border border-white/40 px-4 py-2 font-bold text-white transition-colors hover:bg-white/10">
                {tn("import")}
              </Link>
            </div>
          </div>
          <div className="hidden shrink-0 md:block" aria-hidden>
            <HeroBandArt />
          </div>
        </div>
      </section>

      {/* Composed KPI summary: hero metric + divided stat row */}
      <Reveal>
        <section aria-label="kpis" className="panel-shadow overflow-hidden rounded-2xl border border-border bg-surface">
          <div className="grid lg:grid-cols-[minmax(250px,1fr)_1.9fr]">
            <div className="flex flex-col justify-center gap-2 border-b border-border p-6 sm:p-7 lg:border-b-0 lg:border-e">
              <p className="text-sm font-semibold text-text-muted">{t("totalOutstanding")}</p>
              <p className="text-[38px] font-extrabold leading-none sm:text-[44px]">
                <span data-testid="kpi-outstanding" className="tnum" dir="ltr">{fmt(summary.totalOutstandingMinor)}</span>
                <span className="ms-2 align-middle text-base font-bold text-text-muted">{t("currency")}</span>
              </p>
              <p className="text-sm text-text-muted">
                <span data-testid="kpi-open" className="tnum font-bold text-text" dir="ltr">{summary.openInvoices}</span> {t("openInvoices")}
                {" · "}
                <span data-testid="kpi-debtors" className="tnum font-bold text-text" dir="ltr">{summary.debtors}</span> {t("debtors")}
              </p>
            </div>
            <dl className="grid grid-cols-2 gap-px bg-border">
              {stats.map((s) => (
                <div key={s.key} className="flex flex-col justify-center gap-1.5 bg-surface p-5 sm:p-6">
                  <dt className="text-sm font-semibold text-text-muted">{s.label}</dt>
                  <dd className={`text-2xl font-extrabold sm:text-[28px] ${s.alert ? "text-status-overdue-fg" : ""}`}>
                    <span data-testid={s.testid} className="tnum" dir="ltr">{s.value}</span>
                    {s.currency && <span className="ms-1.5 align-middle text-sm font-bold text-text-muted">{t("currency")}</span>}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </Reveal>

      {isEmpty && (
        <EmptyState
          testId="empty-state"
          illustration={<EmptyInvoicesIllustration size={96} />}
          title={t("emptyTitle")}
          body={t("emptyBody")}
        >
          <Link href={`/${locale}/invoices`} className="inline-flex min-h-touch items-center rounded-md bg-primary px-4 py-2 font-bold text-primary-fg hover:bg-primary-hover">
            {t("emptyCta")}
          </Link>
        </EmptyState>
      )}

      {/* Reports & forecast */}
      <section data-testid="reports" className="flex flex-col gap-6">
        <h2 className="text-xl font-extrabold">{tr("title")}</h2>
        <div className="grid items-start gap-6 lg:grid-cols-3">
          <div className="flex flex-col gap-6 lg:col-span-2">
            <Reveal>
              <Panel testId="forecast" title={tr("forecastTitle")}>
                {!forecast.enoughData ? (
                  <div className="flex flex-col items-center gap-2 py-4 text-center">
                    <ForecastIllustration size={88} />
                    <p data-testid="forecast-not-enough" className="max-w-md text-text-muted">{tr("forecastNotEnough")}</p>
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
            </Reveal>

            <Reveal>
              <Panel title={tr("agingTitle")}>
                <AgingBar buckets={aging} />
              </Panel>
            </Reveal>

            <Reveal>
              <Panel title={tr("topDebtorsTitle")}>
                {kpisFull.topDebtors.length === 0 ? (
                  <p className="text-text-muted">—</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-border">
                    {kpisFull.topDebtors.map((d) => (
                      <li key={d.debtorId}>
                        <Link href={`/${locale}/debtors/${d.debtorId}`} className="flex items-center gap-3 py-3 transition-colors hover:bg-surface-muted/60">
                          <InitialAvatar name={d.displayName} size={38} />
                          <span className="min-w-0 flex-1 truncate font-bold">{d.displayName}</span>
                          <span className="tnum font-extrabold" dir="ltr">{fmtN(d.outstandingMinor)}</span>
                          <span className="text-sm font-normal text-text-muted">{t("currency")}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </Reveal>
          </div>

          {/* Side rail */}
          <div className="flex flex-col gap-6">
            <Reveal>
              <Panel title={tr("reminderPerfTitle")}>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
                  {[
                    { label: tr("sent"), value: perf.sent, testid: "perf-sent" },
                    { label: tr("delivered"), value: perf.delivered, testid: undefined },
                    { label: tr("replied"), value: perf.replied, testid: undefined },
                    { label: tr("paidWithin7d"), value: perf.paidWithin7d, testid: undefined },
                  ].map((x) => (
                    <div key={x.label} className="flex flex-col gap-0.5">
                      <dt className="text-sm text-text-muted">{x.label}</dt>
                      <dd className="text-xl font-extrabold"><span data-testid={x.testid} className="tnum" dir="ltr">{x.value}</span></dd>
                    </div>
                  ))}
                </dl>
              </Panel>
            </Reveal>

            <BillingClient locale={locale} />
            <ExportButtons />
            <DangerZone />
          </div>
        </div>
      </section>
    </AppShell>
  );
}
