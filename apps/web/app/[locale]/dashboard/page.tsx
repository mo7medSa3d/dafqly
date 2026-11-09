import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { formatEgp } from "@tahseel/core";
import { auth } from "@/server/auth";
import { appDb, ownerDb } from "@/server/db";
import { getDashboardSummary, listTenantsForUser, todayInTimezone } from "@/server/services";
import { getKpis, getForecast } from "@/server/reports";
import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import { LogoutButton } from "@/components/LogoutButton";
import { AppNav } from "@/components/AppNav";
import { BillingClient } from "@/components/BillingClient";
import { ExportButtons } from "@/components/ExportButtons";
import { DangerZone } from "@/components/DangerZone";

export default async function DashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect(`/${locale}/login`);
  const mine = await listTenantsForUser(ownerDb(), session.user.id);
  const tenant = mine[0];
  if (!tenant) redirect(`/${locale}/onboarding`);

  const t = await getTranslations("dashboard");
  const tr = await getTranslations("reports");
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
  const kpis = [
    { key: "outstanding", label: t("totalOutstanding"), amount: fmt(summary.totalOutstandingMinor), currency: true },
    { key: "overdue", label: t("overdue"), amount: fmt(summary.overdueMinor), currency: true },
    { key: "open", label: t("openInvoices"), amount: String(summary.openInvoices), currency: false },
    { key: "debtors", label: t("debtors"), amount: String(summary.debtors), currency: false },
    { key: "collected", label: t("collectedThisMonth"), amount: fmt(summary.collectedThisMonthMinor), currency: true },
  ];

  return (
    <main data-testid="dashboard" className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BrandMark variant="color" size={40} />
          <div>
            <h1 className="text-xl font-bold">{t("title")}</h1>
            <p className="text-text-muted">{tenant.businessNameAr}</p>
          </div>
        </div>
        <LogoutButton />
      </header>
      <AppNav locale={locale} />

      <section aria-label="kpis" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {kpis.map((kpi) => (
          <article key={kpi.key} className="rounded-lg border border-border bg-surface p-4">
            <p className="text-sm text-text-muted">{kpi.label}</p>
            <p className="mt-1 text-2xl font-bold">
              <span data-testid={`kpi-${kpi.key}`} className="tnum" dir="ltr">{kpi.amount}</span>
              {kpi.currency && <span className="text-base font-normal"> {t("currency")}</span>}
            </p>
          </article>
        ))}
      </section>

      <BillingClient locale={locale} />

      <section data-testid="reports" className="flex flex-col gap-4">
        <h2 className="text-lg font-bold">{tr("title")}</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <article className="rounded-lg border border-border bg-surface p-4">
            <p className="text-sm text-text-muted">{tr("collectionRate")}</p>
            <p className="mt-1 text-2xl font-bold"><span data-testid="kpi-collection-rate" className="tnum" dir="ltr">{(kpisFull.collectionRate * 100).toFixed(1)}%</span></p>
          </article>
          <article className="rounded-lg border border-border bg-surface p-4">
            <p className="text-sm text-text-muted">{tr("dso")}</p>
            <p className="mt-1 text-2xl font-bold"><span data-testid="kpi-dso" className="tnum" dir="ltr">{kpisFull.dsoDays.toFixed(1)}</span></p>
          </article>
          <article className="rounded-lg border border-border bg-surface p-4">
            <p className="text-sm text-text-muted">{tr("reminderPerfTitle")}</p>
            <p className="mt-1 text-sm">
              {tr("sent")}: <span data-testid="perf-sent" dir="ltr">{kpisFull.reminderPerformance.sent}</span> ·{" "}
              {tr("delivered")}: <span dir="ltr">{kpisFull.reminderPerformance.delivered}</span> ·{" "}
              {tr("replied")}: <span dir="ltr">{kpisFull.reminderPerformance.replied}</span> ·{" "}
              {tr("paidWithin7d")}: <span dir="ltr">{kpisFull.reminderPerformance.paidWithin7d}</span>
            </p>
          </article>
        </div>

        <div className="rounded-lg border border-border bg-surface p-4">
          <h3 className="font-bold">{tr("agingTitle")}</h3>
          <p className="mt-1 text-sm">
            {tr("current")}: {fmtN(kpisFull.agingBuckets.current)} · 0-7: {fmtN(kpisFull.agingBuckets["0-7"])} · 8-30: {fmtN(kpisFull.agingBuckets["8-30"])} · 31-60: {fmtN(kpisFull.agingBuckets["31-60"])} · 60+: {fmtN(kpisFull.agingBuckets["60+"])}
          </p>
          <h3 className="mt-3 font-bold">{tr("topDebtorsTitle")}</h3>
          {kpisFull.topDebtors.length === 0
            ? <p className="text-sm text-text-muted">—</p>
            : kpisFull.topDebtors.map((d) => (
              <p key={d.debtorId} className="text-sm">{d.displayName}: {fmtN(d.outstandingMinor)}</p>
            ))}
        </div>

        <div data-testid="forecast" className="rounded-lg border border-border bg-surface p-4">
          <h3 className="font-bold">{tr("forecastTitle")}</h3>
          {!forecast.enoughData ? (
            <p data-testid="forecast-not-enough" className="mt-1 text-sm text-text-muted">{tr("forecastNotEnough")}</p>
          ) : (
            <>
              <p className="text-sm text-text-muted">{tr("forecastMethod")}</p>
              {forecast.weeks.map((w) => (
                <p key={w.weekStart} className="text-sm">
                  <span dir="ltr">{w.weekStart}</span> — {tr("expected")}: {fmtN(w.expectedMinor)} · {tr("conservative")}: {fmtN(w.conservativeMinor)}
                </p>
              ))}
            </>
          )}
        </div>

        <ExportButtons />
        <DangerZone />
      </section>

      {isEmpty && (
        <section data-testid="empty-state" className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface p-8 text-center">
          <BrandMark variant="mono" size={48} />
          <h2 className="text-lg font-bold">{t("emptyTitle")}</h2>
          <p className="text-text-muted">{t("emptyBody")}</p>
          <Link href={`/${locale}/invoices`} className="min-h-touch rounded-md bg-primary px-4 py-3 font-bold text-primary-fg">
            {t("emptyCta")}
          </Link>
        </section>
      )}
    </main>
  );
}
