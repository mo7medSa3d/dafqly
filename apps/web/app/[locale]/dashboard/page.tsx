import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { formatCurrencyMinor, formatPct, formatDso, getCurrencySymbol } from "@tahseel/core";
import { auth } from "@/server/auth";
import { runtimeModeFlags } from "@/server/env";
import { appDb, ownerDb } from "@/server/db";
import { getDashboardSummary, listTenantsForUser, todayInTimezone } from "@/server/services";
import { getCollectionWorkspaceSummary } from "@/server/workflows";
import { getKpis, getForecast } from "@/server/reports";
import { getWorkspaceIntelligence } from "@/server/intelligence";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { DashboardIntelligence } from "@/components/DashboardIntelligence";
import { DashboardRefresher } from "@/components/DashboardRefresher";
import { AgingBar, ForecastChart, ReminderFunnelChart } from "@/components/charts";
import { InitialAvatar, Panel, SecurityNotice } from "@/components/ui";
import { EmptyInvoicesIllustration, ForecastIllustration, HeroBandArt, SecurityLockBadge } from "@/components/illustrations";

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
  const [summary, kpisFull, forecast, intel, collectionSummary] = await Promise.all([
    getDashboardSummary(appDb(), tenant.tenantId, today),
    getKpis(appDb(), tenant.tenantId, today),
    getForecast(appDb(), tenant.tenantId, today),
    getWorkspaceIntelligence(appDb(), tenant.tenantId, tenant.businessNameAr, today, { syncNotifications: true }),
    getCollectionWorkspaceSummary(appDb(), tenant.tenantId, today),
  ]);
  const isEmpty = summary.openInvoices === 0 && summary.debtors === 0;
  const hasFinancialActivity = summary.openInvoices > 0 || BigInt(summary.totalOutstandingMinor) > 0n || BigInt(summary.collectedThisMonthMinor) > 0n;
  const currency = tenant.settings?.currency ?? "EGP";
  const currencySymbol = getCurrencySymbol(currency, locale);
  // F-06: server-rendered amounts use the tenant currency (exponent-aware),
  // not hardcoded EGP.
  const fmt = (minor: string) => formatCurrencyMinor(BigInt(minor), currency);
  const fmtN = (minor: number) => formatCurrencyMinor(BigInt(minor), currency);

  const stats = [
    { key: "overdue", label: t("overdue"), testid: "kpi-overdue", value: fmt(summary.overdueMinor), currency: true, alert: BigInt(summary.overdueMinor) > 0n },
    { key: "collected", label: t("collectedThisMonth"), testid: "kpi-collected", value: fmt(summary.collectedThisMonthMinor), currency: true, alert: false },
    { key: "rate", label: tr("collectionRate"), testid: "kpi-collection-rate", value: formatPct(kpisFull.collectionRate), currency: false, alert: false },
    { key: "dso", label: tr("dso"), testid: "kpi-dso", value: formatDso(kpisFull.dsoDays), currency: false, alert: false },
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
    <AppShell locale={locale} demoMode={runtimeModeFlags()} digits={tenant.settings?.easternDigits ? "eastern" : "latin"} businessName={tenant.businessNameAr} currency={currency} testId="dashboard">
      <section className="hero-band panel-shadow relative overflow-hidden rounded-3xl text-white shadow-lg">
        <div className="brand-pattern absolute inset-0" aria-hidden />
        <div className="relative z-10 flex flex-wrap items-center justify-between gap-6 p-6 sm:p-8">
          <div className="flex min-w-[240px] flex-1 flex-col items-start gap-2.5">
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-teal-200"><span className="size-2 rounded-full bg-emerald-400" aria-hidden /><span>{isAr ? "نظرة تنفيذية على التحصيل" : "Receivables executive overview"}</span><span>·</span><time dir="ltr">{today}</time><span>·</span><span>{tenant.timezone}</span></div>
            <div className="flex items-center gap-3"><SecurityLockBadge size={38} /><h1 className="text-2xl font-extrabold leading-tight text-white sm:text-3xl">{t("title")} — {tenant.businessNameAr}</h1></div>
            <p className="max-w-xl text-sm text-navy-100">{isAr ? "متابعة المستحقات، توقعات التدفق النقدي، وإدارة مهام التحصيل من مساحة واحدة." : "Track receivables, cash-flow outlook and collection work from one workspace."}</p>
            <div className="mt-2 flex flex-wrap gap-2.5">
              <Link href={`/${locale}/invoices`} className="inline-flex min-h-[42px] items-center gap-2 rounded-xl bg-white px-5 py-2 text-sm font-extrabold text-navy-900 shadow-sm transition hover:bg-white/95"><span>+</span><span>{ti("add")}</span></Link>
              <Link href={`/${locale}/import`} className="inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-5 py-2 text-sm font-bold text-white backdrop-blur-sm transition hover:bg-white/20">{tn("import")}</Link>
              <Link href={`/${locale}/tasks`} className="inline-flex min-h-[42px] items-center rounded-xl border border-white/20 px-4 py-2 text-sm font-bold text-white transition hover:bg-white/10">{isAr ? "مساحة التحصيل" : "Collection workspace"}</Link>
            </div>
          </div>
          <div className="hidden shrink-0 lg:block" aria-hidden><HeroBandArt size={260} /></div>
        </div>
      </section>

      {/* 4-Card Executive KPI Summary (Equal height, unified rhythm, zero clutter) */}
      <section aria-label="kpis" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Total Outstanding */}
        <div className="bento-card kpi-glow-primary flex flex-col justify-between rounded-3xl p-6">
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
            <span className="ms-1.5 text-xs font-bold text-text-muted">{currencySymbol}</span>
          </div>
          <p className="text-xs text-text-muted">
            <span data-testid="kpi-open" className="tnum font-bold text-text" dir="ltr">{summary.openInvoices}</span> {t("openInvoices")}
            {" · "}
            <span data-testid="kpi-debtors" className="tnum font-bold text-text" dir="ltr">{summary.debtors}</span> {t("debtors")}
          </p>
          {/* F02: headline KPIs are in the tenant currency only — when the
              book holds other currencies, list their outstanding here
              instead of silently folding them into the total. */}
          {summary.byCurrency.filter((b) => b.currency !== summary.currency && BigInt(b.outstandingMinor) > 0n).length > 0 && (
            <p className="mt-2 text-xs text-text-muted" data-testid="kpi-other-currencies">
              {isAr ? "أيضًا: " : "Also: "}
              {summary.byCurrency.filter((b) => b.currency !== summary.currency && BigInt(b.outstandingMinor) > 0n)
                .map((b) => `${formatCurrencyMinor(BigInt(b.outstandingMinor), b.currency)} ${b.currency}`).join(" · ")}
            </p>
          )}
        </div>

        {/* Card 2: Overdue */}
        <div className="bento-card kpi-glow-danger flex flex-col justify-between rounded-3xl p-6">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-text-muted">{stats[0]!.label}</span>
            <span className="rounded-full bg-danger-bg px-2.5 py-0.5 text-[11px] font-bold text-danger">
              {isAr ? "متأخر" : "Overdue"}
            </span>
          </div>
          <div className="my-3">
            <span data-testid="kpi-overdue" className="tnum text-3xl font-black text-text" dir="ltr">
              {stats[0]!.value}
            </span>
            <span className="ms-1.5 text-xs font-bold text-text-muted">{currencySymbol}</span>
          </div>
          <p className="text-xs text-text-muted">{isAr ? "تجاوزت تاريخ الاستحقاق" : "Passed due date"}</p>
        </div>

        {/* Card 3: Collected This Month */}
        <div className="bento-card kpi-glow-paid flex flex-col justify-between rounded-3xl p-6">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-text-muted">{stats[1]!.label}</span>
            <span className="rounded-full bg-status-paid-bg px-2.5 py-0.5 text-[11px] font-bold text-status-paid-fg">
              {isAr ? "تم التحصيل" : "Received"}
            </span>
          </div>
          <div className="my-3">
            <span data-testid="kpi-collected" className="tnum text-3xl font-black text-text" dir="ltr">
              {stats[1]!.value}
            </span>
            <span className="ms-1.5 text-xs font-bold text-text-muted">{currencySymbol}</span>
          </div>
          <p className="text-xs text-text-muted">{isAr ? "إجمالي المقبوضات هذا الشهر" : "Total received this month"}</p>
          {BigInt(summary.refundedThisMonthMinor) > 0n && (
            <p className="text-xs font-semibold text-text-muted" data-testid="kpi-refunded">
              {isAr ? `منها مسترد: ${fmt(summary.refundedThisMonthMinor)} ${currencySymbol}` : `Of which refunded: ${fmt(summary.refundedThisMonthMinor)} ${currencySymbol}`}
            </p>
          )}
        </div>

        {/* Card 4: Collection Rate & DSO */}
        <div className="bento-card flex flex-col justify-between rounded-3xl p-6">
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
        <section className="rounded-2xl border border-dashed border-border bg-surface p-6 sm:p-8">
          <div className="flex flex-col items-center gap-4 sm:flex-row"><div className="shrink-0"><EmptyInvoicesIllustration size={150} /></div><div className="max-w-2xl"><span className="text-xs font-bold uppercase tracking-wider text-primary">{isAr ? "ابدأ تشغيل مساحة التحصيل" : "Activate your collection workspace"}</span><h2 className="mt-2 text-xl font-extrabold">{t("emptyTitle")}</h2><p className="mt-1 text-sm text-text-muted">{isAr ? "أدخل أول مجموعة فواتير حتى تظهر لك مؤشرات التحصيل والتأخر والتوقعات وأولويات المتابعة. يمكنك الإضافة يدوياً أو استيراد ملف." : "Add your first invoices to unlock receivables, aging, forecast and follow-up insights. Create one manually or import a spreadsheet."}</p></div></div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Link href={`/${locale}/invoices`} className="rounded-xl border border-border bg-surface-muted/30 p-4 hover:border-primary"><strong className="text-sm">{isAr ? "إصدار أول فاتورة" : "Create first invoice"}</strong><p className="mt-1 text-xs text-text-muted">{isAr ? "أضف العميل والمبلغ وتاريخ الاستحقاق" : "Add customer, amount and due date"}</p></Link>
            <Link href={`/${locale}/import`} className="rounded-xl border border-border bg-surface-muted/30 p-4 hover:border-primary"><strong className="text-sm">{isAr ? "استيراد ملف Excel / CSV" : "Import Excel / CSV"}</strong><p className="mt-1 text-xs text-text-muted">{isAr ? "ارفع بياناتك الحالية دفعة واحدة" : "Bring existing receivables in one batch"}</p></Link>
            <Link href={`/${locale}/debtors`} className="rounded-xl border border-border bg-surface-muted/30 p-4 hover:border-primary"><strong className="text-sm">{isAr ? "إضافة العملاء" : "Add customers"}</strong><p className="mt-1 text-xs text-text-muted">{isAr ? "أنشئ سجل العملاء قبل الفواتير" : "Build your customer directory"}</p></Link>
          </div>
        </section>
      )}

      {hasFinancialActivity && <DashboardIntelligence locale={locale} intel={intel} />}

      <section className="flex flex-col gap-3" aria-labelledby="collection-work-title">
        <div className="flex items-end justify-between gap-3"><div><h2 id="collection-work-title" className="text-lg font-extrabold">{isAr ? "مركز العمل اليومي" : "Daily collection work"}</h2><p className="text-xs text-text-muted">{isAr ? "العناصر التي تتطلب إجراءً من فريقك" : "Items that need an action from your team"}</p></div><Link href={`/${locale}/tasks`} className="text-xs font-bold text-primary hover:underline">{isAr ? "فتح مساحة التحصيل ←" : "Open workspace →"}</Link></div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Link href={`/${locale}/tasks`} className="group rounded-2xl border border-border bg-surface p-4 shadow-sm transition hover:border-primary/50"><p className="text-xs font-bold text-text-muted">{isAr ? "مهام متابعة مفتوحة" : "Open follow-up tasks"}</p><p className="mt-2 text-2xl font-extrabold" dir="ltr">{collectionSummary.openTasks}</p><p className="mt-1 text-xs text-text-muted">{collectionSummary.overdueTasks > 0 ? (isAr ? `${collectionSummary.overdueTasks} متأخرة عن موعدها` : `${collectionSummary.overdueTasks} overdue`) : (isAr ? "لا توجد مهام متأخرة" : "No overdue tasks")}</p></Link>
          <Link href={`/${locale}/tasks`} className="group rounded-2xl border border-border bg-surface p-4 shadow-sm transition hover:border-primary/50"><p className="text-xs font-bold text-text-muted">{isAr ? "تعهدات سداد مقبولة" : "Accepted promises"}</p><p className="mt-2 text-2xl font-extrabold" dir="ltr">{collectionSummary.acceptedPromises}</p><p className="mt-1 text-xs text-text-muted">{fmt(collectionSummary.acceptedPromiseAmountMinor)} {currencySymbol} · {isAr ? "مبالغ متوقع سدادها" : "committed amount"}</p></Link>
          <Link href={`/${locale}/tasks`} className="group rounded-2xl border border-border bg-surface p-4 shadow-sm transition hover:border-primary/50"><p className="text-xs font-bold text-text-muted">{isAr ? "موافقات AI معلقة" : "Pending AI approvals"}</p><p className="mt-2 text-2xl font-extrabold" dir="ltr">{collectionSummary.pendingAiApprovals}</p><p className="mt-1 text-xs text-text-muted">{isAr ? "تحتاج مراجعة مالك المنشأة" : "Require workspace owner review"}</p></Link>
        </div>
      </section>

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
                  <div aria-hidden="true"><ForecastIllustration size={84} /></div>
                  <div className="max-w-md">
                    <p data-testid="forecast-not-enough" className="text-base font-bold text-text">
                      {tr("forecastNotEnough")}
                    </p>
                    <p className="mt-1 text-xs text-text-muted">
                      {isAr
                        ? "التوقعات هنا إحصائية ومبنية على سجل السداد الفعلي؛ لا تمثل ضماناً للتحصيل."
                        : "A statistical projection from recorded payment history, not a guaranteed collection."}
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
                  />
                  {(forecast.beyondHorizon.expectedMinor > 0 || forecast.beyondHorizon.conservativeMinor > 0) && (
                    <p className="text-xs text-text-muted" data-testid="forecast-beyond-horizon">
                      {isAr
                        ? `بعد ٨ أسابيع: متوقع ${fmtN(forecast.beyondHorizon.expectedMinor)} ${currencySymbol} — متحفظ ${fmtN(forecast.beyondHorizon.conservativeMinor)} ${currencySymbol}`
                        : `Beyond 8 weeks: expected ${fmtN(forecast.beyondHorizon.expectedMinor)} ${currencySymbol} — conservative ${fmtN(forecast.beyondHorizon.conservativeMinor)} ${currencySymbol}`}
                    </p>
                  )}
                </div>
              )}
            </Panel>

            {/* Aging & Top Debtors 2-Column Row */}
            <div className="grid gap-6 sm:grid-cols-2">
              <Panel title={tr("agingTitle")}>
                {BigInt(summary.totalOutstandingMinor) > 0n ? (
                  <AgingBar buckets={aging} />
                ) : (
                  <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 text-center">
                    <p className="text-sm font-bold text-text">{isAr ? "لا توجد مستحقات مفتوحة بعد" : "No open receivables yet"}</p>
                    <p className="max-w-xs text-xs text-text-muted">{isAr ? "أصدر فاتورة أو استورد كشف مستحقات لعرض توزيع الأعمار." : "Create an invoice or import receivables to see the aging breakdown."}</p>
                    <Link href={`/${locale}/invoices`} className="mt-1 text-xs font-bold text-primary hover:underline">{isAr ? "إضافة فاتورة ←" : "Create an invoice →"}</Link>
                  </div>
                )}
              </Panel>

              <Panel title={tr("topDebtorsTitle")}>
                {kpisFull.topDebtors.length === 0 ? (
                  <div className="flex min-h-[160px] flex-col items-center justify-center gap-2 text-center">
                    <p className="text-sm font-bold text-text">{isAr ? "لا توجد حسابات متأخرة" : "No overdue accounts"}</p>
                    <p className="max-w-xs text-xs text-text-muted">{isAr ? "الحسابات التي تتجاوز تاريخ الاستحقاق ستظهر هنا مرتبة حسب الرصيد المتبقي." : "Accounts past due will appear here, ranked by remaining balance."}</p>
                    <Link href={`/${locale}/invoices?overdue=true`} className="mt-1 text-xs font-bold text-primary hover:underline">{isAr ? "عرض الفواتير ←" : "View invoices →"}</Link>
                  </div>
                ) : (
                  <ul className="flex flex-col divide-y divide-border">
                    {kpisFull.topDebtors.map((d) => (
                      <li key={d.debtorId}>
                        <Link href={`/${locale}/debtors/${d.debtorId}`} className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-callout">
                          <InitialAvatar name={d.displayName} size={34} />
                          <span className="min-w-0 flex-1 truncate text-sm font-bold">{d.displayName}</span>
                          <span className="tnum font-black text-text" dir="ltr">{fmtN(d.outstandingMinor)}</span>
                          <span className="text-xs font-normal text-text-muted">{currencySymbol}</span>
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
                <div className="flex min-h-[190px] flex-col items-center justify-center gap-2 text-center">
                  <p className="text-sm font-bold text-text">{isAr ? "لم تُرسل تذكيرات بعد" : "No reminders sent yet"}</p>
                  <p className="max-w-xs text-xs text-text-muted">{isAr ? "بعد إرسال أول تذكير ستظهر هنا مراحل التسليم والرد والسداد خلال ٧ أيام." : "After the first reminder, delivery, reply and 7-day payment activity will appear here."}</p>
                  <Link href={`/${locale}/ai-inbox`} className="mt-1 text-xs font-bold text-primary hover:underline">{isAr ? "فتح صندوق التحصيل ←" : "Open collection inbox →"}</Link>
                </div>
              )}
            </Panel>
          </div>
        </div>
      </section>

      <DashboardRefresher />
      <SecurityNotice
        compact
        body={t("autoRefreshNote")}
      />
    </AppShell>
  );
}
