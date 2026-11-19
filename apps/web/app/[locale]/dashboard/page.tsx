import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { formatDso, getCurrencySymbol } from "@tahseel/core";
import { formatCount, formatCurrency, formatCurrencyAmount, formatPercent } from "@/lib/format";
import { auth } from "@/server/auth";
import { runtimeModeFlags } from "@/server/env";
import { appDb, ownerDb } from "@/server/db";
import { getDashboardSummary, listTenantsForUser, todayInTimezone } from "@/server/services";
import { getKpis, getForecast } from "@/server/reports";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { DashboardRefresher } from "@/components/DashboardRefresher";
import { ReminderFunnelChart } from "@/components/charts";
import { AgingDonut, ForecastArea, Gauge, MosaicSparkCard, RankedBars } from "@/components/ProCharts";
import { Panel } from "@/components/ui";
import { btnGhost, btnPrimary } from "@/components/ui/styles";
import { EmptyInvoicesIllustration, ForecastIllustration } from "@/components/illustrations";

export const dynamic = "force-dynamic";

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect(`/${locale}/login`);
  const mine = await listTenantsForUser(ownerDb(), session.user.id);
  const tenant = mine[0];
  if (!tenant) redirect(`/${locale}/onboarding`);

  const [t, tr, ti, tn] = await Promise.all([
    getTranslations("dashboard"),
    getTranslations("reports"),
    getTranslations("invoices"),
    getTranslations("nav"),
  ]);
  const isAr = locale === "ar";
  const today = todayInTimezone(tenant.timezone);

  const [summary, kpisFull, forecast] = await Promise.all([
    getDashboardSummary(appDb(), tenant.tenantId, today),
    getKpis(appDb(), tenant.tenantId, today),
    getForecast(appDb(), tenant.tenantId, today),
  ]);

  const isEmpty = summary.openInvoices === 0 && summary.debtors === 0;
  const currency = tenant.settings?.currency ?? "EGP";
  const currencySymbol = getCurrencySymbol(currency, locale);
  const fmt = (minor: string) => formatCurrencyAmount(minor, currency);
  const otherCurrencies = kpisFull.byCurrency.filter(
    (b) =>
      b.currency !== currency &&
      (b.outstandingMinor > 0 || b.overdueMinor > 0 || b.collectedInMonthMinor > 0 || b.refundedInMonthMinor > 0),
  );

  const aging = [
    { key: "current", label: tr("current"), amountMinor: kpisFull.agingBuckets.current },
    { key: "0-7", label: "0-7", amountMinor: kpisFull.agingBuckets["0-7"] },
    { key: "8-30", label: "8-30", amountMinor: kpisFull.agingBuckets["8-30"] },
    { key: "31-60", label: "31-60", amountMinor: kpisFull.agingBuckets["31-60"] },
    { key: "60+", label: "60+", amountMinor: kpisFull.agingBuckets["60+"] },
  ];
  const perf = kpisFull.reminderPerformance;

  // Strictly real data series — never fabricated fallback numbers
  const weekSeries = (kpisFull.weeklyInvoiced ?? []).map((w) => w.amountMinor);
  const weekLabels = (kpisFull.weeklyInvoiced ?? []).map((w) => w.weekStart);
  const collectedSeries = (kpisFull.weeklyCollected ?? []).map((w) => w.amountMinor);
  const collectedLabels = (kpisFull.weeklyCollected ?? []).map((w) => w.weekStart);
  const overdueSeries = aging.map((b) => b.amountMinor);
  const overdueLabels = aging.map((b) => b.label);
  const totalOutNum = Number(summary.totalOutstandingMinor);
  const overdueNum = Number(summary.overdueMinor);
  const currentRatioPct = totalOutNum > 0 ? Math.round(((totalOutNum - overdueNum) / totalOutNum) * 100) : 100;
  const overdueRatioPct = totalOutNum > 0 ? Math.round((overdueNum / totalOutNum) * 100) : 0;

  return (
    <AppShell
      locale={locale}
      demoMode={runtimeModeFlags()}
      digits="latin"
      businessName={tenant.businessNameAr}
      currency={currency}
      testId="dashboard"
    >
      {/* Clean Cruip-style Dashboard Header */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <span className="size-2 rounded-full bg-[var(--chart-2)]" aria-hidden />
            <time className="tabular-nums" dir="ltr">{today}</time>
            <span>·</span>
            <span>{tenant.timezone}</span>
          </div>
          <h1 className="text-[26px] font-extrabold leading-tight tracking-tight text-foreground">
            {t("title")} — {tenant.businessNameAr}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/${locale}/import`} className={btnGhost}>{tn("import")}</Link>
          <Link href={`/${locale}/invoices`} className={btnPrimary}>+ {ti("add")}</Link>
        </div>
      </header>

      {/* Row 1: 3 Mosaic Sparkline KPI Cards */}
      <section aria-label="kpis" className="grid grid-cols-12 gap-5">
        <div className="col-span-full sm:col-span-6 xl:col-span-4">
          <MosaicSparkCard
            title={t("totalOutstanding")}
            subtitle={isAr ? "إجمالي المحفظة" : "Portfolio balance"}
            value={fmt(summary.totalOutstandingMinor)}
            unit={currencySymbol}
            badge={`${formatCount(summary.openInvoices, locale)} ${t("openInvoices")}`}
            series={weekSeries}
            seriesLabels={weekLabels}
            sourceLabel={isAr ? "فواتير آخر 6 أسابيع" : "Last 6 weeks invoiced"}
            ratioBar={{ pct: currentRatioPct, label: isAr ? "نسبة الأرصدة غير المستحقة بعد" : "Not yet due share" }}
            color="var(--status-paid-fg)"
            testId="kpi-outstanding"
            extra={
              <span>
                <span data-testid="kpi-open" className="tnum tabular-nums font-bold text-foreground" dir="ltr">{formatCount(summary.openInvoices, locale)}</span> {t("openInvoices")}
                {" · "}
                <span data-testid="kpi-debtors" className="tnum tabular-nums font-bold text-foreground" dir="ltr">{formatCount(summary.debtors, locale)}</span> {t("debtors")}
              </span>
            }
          />
        </div>

        <div className="col-span-full sm:col-span-6 xl:col-span-4">
          <MosaicSparkCard
            title={t("collectedThisMonth")}
            subtitle={isAr ? "مقبوضات الشهر" : "Monthly receipts"}
            value={fmt(summary.collectedThisMonthMinor)}
            unit={currencySymbol}
            badge={formatPercent(kpisFull.collectionRate, locale)}
            badgeTone="positive"
            series={collectedSeries}
            seriesLabels={collectedLabels}
            sourceLabel={isAr ? "تحصيلات آخر 6 أسابيع" : "Last 6 weeks collected"}
            ratioBar={{ pct: kpisFull.collectionRate * 100, label: isAr ? "معدل التحصيل الشهري" : "Monthly collection rate" }}
            color="var(--chart-2)"
            testId="kpi-collected"
            extra={
              BigInt(summary.refundedThisMonthMinor) > 0n ? (
                <span data-testid="kpi-refunded" className="tabular-nums">
                  {isAr ? `مسترد: ${fmt(summary.refundedThisMonthMinor)} ${currencySymbol}` : `Refunded: ${fmt(summary.refundedThisMonthMinor)} ${currencySymbol}`}
                </span>
              ) : (
                <span>{isAr ? "إجمالي التحصيل المؤكد" : "Confirmed cash received"}</span>
              )
            }
          />
        </div>

        <div className="col-span-full sm:col-span-12 xl:col-span-4">
          <MosaicSparkCard
            title={t("overdue")}
            subtitle={isAr ? "متأخرات الاستحقاق" : "Past due date"}
            value={fmt(summary.overdueMinor)}
            unit={currencySymbol}
            badge={BigInt(summary.overdueMinor) > 0n ? (isAr ? "متأخر" : "Overdue") : (isAr ? "سليم" : "Clear")}
            badgeTone={BigInt(summary.overdueMinor) > 0n ? "danger" : "positive"}
            series={overdueSeries}
            seriesLabels={overdueLabels}
            sourceLabel={isAr ? "توزيع الأعمار" : "Aging distribution"}
            ratioBar={{ pct: overdueRatioPct, label: isAr ? "نسبة المتأخرات" : "Overdue share" }}
            color="var(--destructive)"
            testId="kpi-overdue"
            extra={
              <Link href={`/${locale}/invoices?overdue=true`} className="font-bold text-foreground underline-offset-4 hover:underline">
                {isAr ? "عرض الفواتير المتأخرة ←" : "View overdue invoices →"}
              </Link>
            }
          />
        </div>
      </section>

      {otherCurrencies.length > 0 && (
        <section aria-label={isAr ? "ملخص العملات الأخرى" : "Other currencies summary"} data-testid="kpi-other-currencies" className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              {isAr ? "أرصدة بعملات أخرى (منفصلة عن العملة الافتراضية)" : "Other currencies (kept separate from default currency)"}
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {otherCurrencies.map((b) => (
              <div key={b.currency} className="flex flex-col gap-1 rounded-lg bg-muted/50 px-3.5 py-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-extrabold text-foreground">{b.currency}</span>
                  <span className="tnum tabular-nums font-extrabold text-foreground" dir="ltr">
                    {formatCurrency(b.outstandingMinor, b.currency, locale)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                  <span>
                    {isAr ? "متأخر:" : "Overdue:"}{" "}
                    <span className="tnum tabular-nums font-semibold" dir="ltr">{formatCurrency(b.overdueMinor, b.currency, locale)}</span>
                  </span>
                  <span>
                    {isAr ? "تحصيل الشهر:" : "Month:"}{" "}
                    <span className="tnum tabular-nums font-semibold" dir="ltr">{formatCurrency(b.collectedInMonthMinor, b.currency, locale)}</span>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {isEmpty && (
        <section className="rounded-xl border border-dashed border-border bg-card p-6 sm:p-8">
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <div className="shrink-0"><EmptyInvoicesIllustration size={130} /></div>
            <div className="max-w-2xl">
              <h2 className="text-xl font-extrabold">{t("emptyTitle")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {isAr
                  ? "أدخل أول مجموعة فواتير لعرض الرسوم البيانية وتوقعات السيولة."
                  : "Add your first invoices to populate cashflow charts and aging analytics."}
              </p>
            </div>
            <Link href={`/${locale}/invoices`} className={`${btnPrimary} shrink-0 sm:ms-auto`}>
              + {ti("add")}
            </Link>
          </div>
        </section>
      )}

      {/* Row 2 & 3: Cruip Mosaic 12-Col Analytics Bento */}
      <section data-testid="reports" className="grid grid-cols-12 gap-5">
        {/* Cashflow Forecast (Line + Bars Switcher) */}
        <div className="col-span-full xl:col-span-8">
          <Panel testId="forecast" title={tr("forecastTitle")}>
            {!forecast.enoughData ? (
              <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
                <ForecastIllustration size={76} />
                <p data-testid="forecast-not-enough" className="text-base font-bold">{tr("forecastNotEnough")}</p>
                <p className="max-w-md text-xs text-muted-foreground">
                  {isAr ? "أضف فواتير ومدفوعات لتفعيل منحنى التدفقات النقدية لـ 8 أسابيع." : "Log invoices and payments to unlock the 8-week cashflow projection."}
                </p>
                <Link href={`/${locale}/invoices`} className={`${btnPrimary} mt-1`}>
                  + {ti("add")}
                </Link>
              </div>
            ) : (
              <ForecastArea
                weeks={forecast.weeks}
                expectedLabel={tr("expected")}
                conservativeLabel={tr("conservative")}
                beyondHorizon={forecast.beyondHorizon}
              />
            )}
          </Panel>
        </div>

        {/* Collection Rate Gauge + DSO */}
        <div className="col-span-full xl:col-span-4">
          <Panel title={tr("collectionRate")}>
            <div className="flex flex-col gap-5 py-2">
              <Gauge
                value={kpisFull.collectionRate * 100}
                label={tr("collectionRate")}
                caption={`${tr("dso")}: ${formatDso(kpisFull.dsoDays)} ${isAr ? "يوم" : "days"}`}
              />
              <div className="grid grid-cols-2 gap-3 border-t border-border pt-4 text-center">
                <div className="rounded-lg bg-muted/60 p-3">
                  <p className="text-[11px] font-bold text-muted-foreground">{tr("collectionRate")}</p>
                  <p data-testid="kpi-collection-rate" className="tnum tabular-nums mt-1 text-lg font-extrabold text-foreground" dir="ltr">
                    {formatPercent(kpisFull.collectionRate, locale)}
                  </p>
                </div>
                <div className="rounded-lg bg-muted/60 p-3">
                  <p className="text-[11px] font-bold text-muted-foreground">{tr("dso")}</p>
                  <p data-testid="kpi-dso" className="tnum tabular-nums mt-1 text-lg font-extrabold text-foreground" dir="ltr">
                    {formatDso(kpisFull.dsoDays)} {isAr ? "يوم" : "d"}
                  </p>
                </div>
              </div>
            </div>
          </Panel>
        </div>

        {/* Aging Doughnut */}
        <div className="col-span-full md:col-span-6 xl:col-span-4">
          <Panel title={tr("agingTitle")}>
            {kpisFull.totalOutstandingMinor > 0 ? (
              <AgingDonut buckets={aging} />
            ) : (
              <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 text-center">
                <p className="text-sm font-bold">{isAr ? "لا توجد مستحقات مفتوحة" : "No open receivables"}</p>
                <Link href={`/${locale}/invoices`} className="text-xs font-bold underline underline-offset-4">
                  {isAr ? "إضافة فاتورة ←" : "Create an invoice →"}
                </Link>
              </div>
            )}
          </Panel>
        </div>

        {/* Top Overdue Customers */}
        <div className="col-span-full md:col-span-6 xl:col-span-4">
          <Panel title={tr("topDebtorsTitle")}>
            {kpisFull.topDebtors.length === 0 ? (
              <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 text-center">
                <p className="text-sm font-bold">{isAr ? "لا توجد حسابات متأخرة" : "No overdue accounts"}</p>
                <Link href={`/${locale}/invoices?overdue=true`} className="text-xs font-bold underline underline-offset-4">
                  {isAr ? "عرض الفواتير ←" : "View invoices →"}
                </Link>
              </div>
            ) : (
              <RankedBars
                items={kpisFull.topDebtors.map((d) => ({
                  id: d.debtorId,
                  name: d.displayName,
                  amountMinor: d.outstandingMinor,
                  href: `/${locale}/debtors/${d.debtorId}`,
                }))}
              />
            )}
          </Panel>
        </div>

        {/* Reminder Conversion Funnel */}
        <div className="col-span-full md:col-span-12 xl:col-span-4">
          <Panel title={tr("reminderPerfTitle")}>
            {perf.sent > 0 ? (
              <ReminderFunnelChart
                sent={perf.sent}
                delivered={perf.delivered}
                replied={perf.replied}
                paidWithin7d={perf.paidWithin7d}
                labels={{
                  sent: tr("sent"),
                  delivered: tr("delivered"),
                  replied: tr("replied"),
                  paidWithin7d: tr("paidWithin7d"),
                }}
              />
            ) : (
              <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 text-center">
                <p className="text-sm font-bold">{isAr ? "لم تُرسل تذكيرات بعد" : "No reminders sent yet"}</p>
                <Link href={`/${locale}/ai-inbox`} className="text-xs font-bold underline underline-offset-4">
                  {isAr ? "فتح صندوق التحصيل ←" : "Open collection inbox →"}
                </Link>
              </div>
            )}
          </Panel>
        </div>
      </section>

      <DashboardRefresher />
    </AppShell>
  );
}
