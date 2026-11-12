"use client";

import { useMemo, useState } from "react";
import { useLocale } from "next-intl";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  type ChartOptions,
} from "chart.js";
import { Line, Bar, Doughnut } from "react-chartjs-2";
import {
  Table as TableIcon,
  WarningCircle,
} from "@phosphor-icons/react";
import { useCurrency } from "./CurrencyContext";

// Register Chart.js modules once
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

// ---------------------------------------------------------------------------
// 1. ForecastChart: 8-Week Cash Inflow & Recovery Trajectory (Chart.js Line)
// ---------------------------------------------------------------------------

export interface ForecastWeek {
  weekStart: string;
  expectedMinor: number;
  conservativeMinor: number;
}

export function ForecastChart({
  weeks,
  expectedLabel,
  conservativeLabel,
  format,
}: {
  weeks: ForecastWeek[];
  expectedLabel: string;
  conservativeLabel: string;
  format: (minor: number) => string;
}) {
  const locale = useLocale();
  const isAr = locale === "ar";
  const { symbol: currencySymbol } = useCurrency();
  const [showTable, setShowTable] = useState(false);

  const totalExpected = weeks.reduce((acc, w) => acc + w.expectedMinor, 0);
  const totalConservative = weeks.reduce((acc, w) => acc + w.conservativeMinor, 0);
  const peakWeek = weeks.reduce<ForecastWeek | null>(
    (best, w) => (!best || w.expectedMinor > best.expectedMinor ? w : best),
    null
  );

  const chartData = useMemo(() => {
    const labels = weeks.map((w, idx) => {
      const d = new Date(w.weekStart);
      const shortDate = isNaN(d.getTime())
        ? w.weekStart
        : d.toLocaleDateString(isAr ? "ar-EG" : "en-US", { month: "short", day: "numeric" });
      return isAr ? `أسبوع ${idx + 1} (${shortDate})` : `W${idx + 1} (${shortDate})`;
    });

    return {
      labels,
      datasets: [
        {
          label: expectedLabel,
          data: weeks.map((w) => w.expectedMinor / 100),
          borderColor: "rgba(9, 83, 222, 1)",
          backgroundColor: "rgba(9, 83, 222, 0.08)",
          fill: true,
          tension: 0.35,
          borderWidth: 2.5,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: "rgba(9, 83, 222, 1)",
          pointBorderColor: "rgba(255, 255, 255, 1)",
          pointBorderWidth: 2,
        },
        {
          label: conservativeLabel,
          data: weeks.map((w) => w.conservativeMinor / 100),
          borderColor: "rgba(0, 199, 252, 0.9)",
          backgroundColor: "rgba(0, 199, 252, 0.03)",
          fill: true,
          borderDash: [5, 5],
          tension: 0.35,
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 5,
          pointBackgroundColor: "rgba(0, 199, 252, 0.9)",
          pointBorderColor: "rgba(255, 255, 255, 1)",
          pointBorderWidth: 1.5,
        },
      ],
    };
  }, [weeks, expectedLabel, conservativeLabel, isAr]);

  const chartOptions: ChartOptions<"line"> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      plugins: {
        legend: {
          display: true,
          position: "top",
          align: isAr ? "end" : "start",
          rtl: isAr,
          labels: {
            boxWidth: 12,
            boxHeight: 12,
            usePointStyle: true,
            pointStyle: "circle",
            font: {
              family: "inherit",
              size: 11,
              weight: 600,
            },
            color: "currentColor",
          },
        },
        tooltip: {
          rtl: isAr,
          padding: 10,
          cornerRadius: 12,
          boxPadding: 4,
          callbacks: {
            label(ctx) {
              const valMinor = Math.round(Number(ctx.parsed.y) * 100);
              return ` ${ctx.dataset.label}: ${format(valMinor)} ${currencySymbol}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: {
            display: false,
          },
          ticks: {
            font: {
              family: "inherit",
              size: 11,
              weight: 500,
            },
            color: "rgba(100, 116, 139, 0.9)",
          },
        },
        y: {
          beginAtZero: true,
          grid: {
            color: "rgba(148, 163, 184, 0.12)",
          },
          ticks: {
            font: {
              family: "inherit",
              size: 11,
            },
            color: "rgba(100, 116, 139, 0.8)",
            callback(val) {
              const num = Number(val);
              if (num >= 1000) return `${Math.round(num / 1000)}k`;
              return String(num);
            },
          },
        },
      },
    }),
    [isAr, currencySymbol, format]
  );

  return (
    <div className="flex flex-col gap-4">
      {/* KPI Highlight Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="flex flex-col rounded-2xl bg-surface-muted/50 p-3 sm:p-3.5">
          <span className="text-[11px] font-semibold text-text-muted">
            {isAr ? "إجمالي السيولة المتوقعة (٨ أسابيع)" : "8-Week Projected Total"}
          </span>
          <span className="mt-1 text-base font-extrabold text-primary" dir="ltr">
            {format(totalExpected)} <span className="text-xs font-bold text-text-muted">{currencySymbol}</span>
          </span>
        </div>
        <div className="flex flex-col rounded-2xl bg-surface-muted/50 p-3 sm:p-3.5">
          <span className="text-[11px] font-semibold text-text-muted">
            {isAr ? "الحد الأدنى المتحفظ" : "Conservative Baseline"}
          </span>
          <span className="mt-1 text-base font-extrabold text-teal-600 dark:text-teal-400" dir="ltr">
            {format(totalConservative)} <span className="text-xs font-bold text-text-muted">{currencySymbol}</span>
          </span>
        </div>
        <div className="col-span-2 flex flex-col rounded-2xl bg-surface-muted/50 p-3 sm:col-span-1 sm:p-3.5">
          <span className="text-[11px] font-semibold text-text-muted">
            {isAr ? "أعلى أسبوع تدفقات متوقع" : "Peak Inflow Week"}
          </span>
          <span className="mt-1 text-base font-extrabold text-text" dir="ltr">
            {peakWeek ? format(peakWeek.expectedMinor) : "0"}{" "}
            <span className="text-xs font-bold text-text-muted">{currencySymbol}</span>
          </span>
        </div>
      </div>

      {/* Main Chart Canvas Container */}
      <div className="relative h-[260px] w-full rounded-2xl border border-border/60 bg-surface/80 p-2 sm:p-4">
        <Line data={chartData} options={chartOptions} />
      </div>

      {/* Table Toggle Button */}
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border/80 bg-surface px-3 py-1.5 text-xs font-bold text-text transition hover:border-primary hover:text-primary active:scale-95"
        >
          <TableIcon size={14} weight="bold" />
          <span>{showTable ? (isAr ? "إخفاء جدول البيانات" : "Hide Data Table") : (isAr ? "عرض جدول البيانات" : "Show Data Table")}</span>
        </button>
      </div>

      {/* Detailed Table (Toggleable) */}
      {showTable && (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface text-xs">
          <table className="w-full text-start">
            <thead>
              <tr className="bg-surface-muted/70 text-text-muted">
                <th className="p-2.5 text-start font-bold">{isAr ? "الأسبوع" : "Week"}</th>
                <th className="p-2.5 text-start font-bold">{expectedLabel}</th>
                <th className="p-2.5 text-start font-bold">{conservativeLabel}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {weeks.map((w, idx) => (
                <tr key={idx} className="hover:bg-callout/40">
                  <td className="p-2.5 font-semibold" dir="ltr">{w.weekStart}</td>
                  <td className="p-2.5 font-bold text-primary" dir="ltr">{format(w.expectedMinor)} {currencySymbol}</td>
                  <td className="p-2.5 font-semibold text-teal-600 dark:text-teal-400" dir="ltr">{format(w.conservativeMinor)} {currencySymbol}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. AgingBar: Overdue Aging Breakdown (Chart.js Bar)
// ---------------------------------------------------------------------------

export interface AgingBucket {
  key: string;
  label: string;
  amountMinor: number;
  formatted: string;
}

export function AgingBar({ buckets }: { buckets: AgingBucket[] }) {
  const locale = useLocale();
  const isAr = locale === "ar";
  const { symbol: currencySymbol } = useCurrency();

  const total = buckets.reduce((s, b) => s + b.amountMinor, 0);
  const severeMinor = buckets
    .filter((b) => b.key === "31-60" || b.key === "60+")
    .reduce((s, b) => s + b.amountMinor, 0);
  const severePct = total > 0 ? Math.round((severeMinor / total) * 100) : 0;

  const barData = useMemo(() => {
    const labels = buckets.map((b) => {
      if (b.key === "current") return isAr ? "غير مستحق" : "Current";
      if (b.key === "0-7") return isAr ? "١–٧ أيام" : "1–7d";
      if (b.key === "8-30") return isAr ? "٨–٣٠ يوماً" : "8–30d";
      if (b.key === "31-60") return isAr ? "٣١–٦٠ يوماً" : "31–60d";
      return isAr ? "+٦٠ يوماً" : "60d+";
    });

    const colors = [
      "rgba(18, 113, 107, 0.85)",  // Teal (current)
      "rgba(9, 83, 222, 0.85)",   // Blue (0-7d)
      "rgba(245, 158, 11, 0.85)",  // Amber (8-30d)
      "rgba(168, 85, 247, 0.85)",  // Violet (31-60d)
      "rgba(239, 68, 68, 0.85)",   // Red (60+d)
    ];

    return {
      labels,
      datasets: [
        {
          label: isAr ? "المبلغ المستحق" : "Outstanding Amount",
          data: buckets.map((b) => b.amountMinor / 100),
          backgroundColor: colors,
          borderRadius: 8,
          borderSkipped: false,
        },
      ],
    };
  }, [buckets, isAr]);

  const barOptions: ChartOptions<"bar"> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          rtl: isAr,
          padding: 10,
          cornerRadius: 12,
          callbacks: {
            label(ctx) {
              const val = Number(ctx.parsed.y);
              const pct = total > 0 ? Math.round(((val * 100) / total) * 100) : 0;
              return ` ${val.toLocaleString(isAr ? "ar-EG" : "en-US", { minimumFractionDigits: 2 })} ${currencySymbol} (${pct}%)`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: {
            display: false,
          },
          ticks: {
            font: {
              family: "inherit",
              size: 11,
              weight: 600,
            },
            color: "rgba(100, 116, 139, 0.9)",
          },
        },
        y: {
          beginAtZero: true,
          grid: {
            color: "rgba(148, 163, 184, 0.12)",
          },
          ticks: {
            font: {
              family: "inherit",
              size: 10,
            },
            color: "rgba(100, 116, 139, 0.8)",
            callback(val) {
              const num = Number(val);
              if (num >= 1000) return `${Math.round(num / 1000)}k`;
              return String(num);
            },
          },
        },
      },
    }),
    [isAr, total, currencySymbol]
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Severe Overdue Alert Banner if >30d has significant volume */}
      {severePct > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-status-overdue-fg/20 bg-status-overdue-bg px-3.5 py-2.5 text-xs font-semibold text-status-overdue-fg">
          <div className="flex items-center gap-2">
            <WarningCircle size={16} weight="fill" />
            <span>
              {isAr
                ? `${severePct}% من المستحقات متأخرة لأكثر من ٣٠ يوماً`
                : `${severePct}% of receivables are overdue >30 days`}
            </span>
          </div>
          <span className="rounded-full bg-surface px-2.5 py-0.5 text-[11px] font-bold text-status-overdue-fg shadow-2xs">
            {isAr ? "أولوية سداد" : "Priority"}
          </span>
        </div>
      )}

      {/* Bar Chart Canvas */}
      <div className="relative h-[210px] w-full rounded-2xl border border-border/60 bg-surface/80 p-2 sm:p-4">
        <Bar data={barData} options={barOptions} />
      </div>

      {/* Bucket Cards Summary Grid */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {buckets.map((b) => {
          const pct = total > 0 ? Math.round((b.amountMinor / total) * 100) : 0;
          return (
            <div key={b.key} className="flex flex-col rounded-xl bg-surface-muted/50 p-2.5 text-xs">
              <span className="text-[11px] font-semibold text-text-muted">{b.label}</span>
              <span className="mt-0.5 font-bold text-text" dir="ltr">
                {b.formatted} <span className="text-[10px] font-medium text-text-muted">{currencySymbol}</span>
              </span>
              <span className="mt-0.5 text-[10px] font-bold text-text-subtle">%{pct}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. VelocityAndConcentrationChart: Liquidity Velocity & Exposure (Chart.js Doughnut)
// ---------------------------------------------------------------------------

export function VelocityAndConcentrationChart({
  velocityScore,
  collectionRate,
  dsoDays,
  topDebtorSharePct,
  top3ConcentrationPct,
  expected14dFormatted,
  atRiskFormatted,
  expected14dMinor,
  atRiskMinor,
  isEn,
}: {
  velocityScore: number;
  collectionRate: number;
  dsoDays: number;
  topDebtorSharePct: number;
  top3ConcentrationPct: number;
  expected14dFormatted: string;
  atRiskFormatted: string;
  expected14dMinor: bigint;
  atRiskMinor: bigint;
  isEn: boolean;
}) {
  const { symbol: currencySymbol } = useCurrency();
  const clampedScore = Math.max(0, Math.min(100, velocityScore));

  const doughnutData = useMemo(() => {
    const safeExpected = Math.max(0, Number(expected14dMinor / 100n));
    const safeAtRisk = Math.max(0, Number(atRiskMinor / 100n));
    const dataVals = safeExpected === 0 && safeAtRisk === 0 ? [100, 0] : [safeExpected, safeAtRisk];

    return {
      labels: [
        isEn ? "14-Day Expected Liquidity" : "السيولة المتوقعة (١٤ يوماً)",
        isEn ? "At-Risk Receivables" : "مستحقات معرضة للمخاطر",
      ],
      datasets: [
        {
          data: dataVals,
          backgroundColor: [
            "rgba(18, 113, 107, 0.9)", // Healthy teal
            "rgba(239, 68, 68, 0.85)", // Red
          ],
          borderWidth: 0,
        },
      ],
    };
  }, [expected14dMinor, atRiskMinor, isEn]);

  const doughnutOptions: ChartOptions<"doughnut"> = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      cutout: "75%",
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          rtl: !isEn,
          padding: 10,
          cornerRadius: 12,
        },
      },
    }),
    [isEn]
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 items-center">
      {/* Left: Visual Doughnut with Center Metric */}
      <div className="relative flex flex-col items-center justify-center p-3 lg:col-span-4">
        <div className="relative size-36">
          <Doughnut data={doughnutData} options={doughnutOptions} />
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-2xl font-black text-text">{clampedScore}</span>
            <span className="text-[10px] font-bold text-text-muted">{isEn ? "Velocity" : "سرعة التحصيل"}</span>
          </div>
        </div>
      </div>

      {/* Right: Key Liquidity & Concentration Metrics (8 cols) */}
      <div className="flex flex-col gap-3 lg:col-span-8">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-border/70 bg-surface-muted/40 p-3.5">
            <div className="flex items-center justify-between text-[11px] font-semibold text-text-muted">
              <span>{isEn ? "Near-term Liquidity (14d)" : "سيولة متوقعة (١٤ يوماً)"}</span>
              <span className="size-2 rounded-full bg-teal-500" />
            </div>
            <p className="mt-1 text-base font-extrabold text-status-paid-fg" dir="ltr">
              +{expected14dFormatted} <span className="text-xs font-bold text-text-muted">{currencySymbol}</span>
            </p>
          </div>

          <div className="rounded-2xl border border-border/70 bg-surface-muted/40 p-3.5">
            <div className="flex items-center justify-between text-[11px] font-semibold text-text-muted">
              <span>{isEn ? "Receivables At Risk" : "مستحقات معرضة للمخاطر"}</span>
              <span className="size-2 rounded-full bg-status-overdue-fg" />
            </div>
            <p className="mt-1 text-base font-extrabold text-status-overdue-fg" dir="ltr">
              {atRiskFormatted} <span className="text-xs font-bold text-text-muted">{currencySymbol}</span>
            </p>
          </div>
        </div>

        {/* Debtor Concentration Indicator */}
        <div className="rounded-2xl border border-border/70 bg-surface-muted/40 p-3.5">
          <div className="flex items-center justify-between text-xs font-bold text-text">
            <span>{isEn ? "Debtor Concentration (Top 3)" : "تركز المديونية (أعلى ٣ عملاء)"}</span>
            <span className="tnum font-black text-primary">%{top3ConcentrationPct}</span>
          </div>
          <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-surface-muted">
            <div style={{ width: `${topDebtorSharePct}%` }} className="bg-primary" title={isEn ? "Top Debtor" : "أعلى عميل"} />
            <div style={{ width: `${Math.max(0, top3ConcentrationPct - topDebtorSharePct)}%` }} className="bg-teal-400" title={isEn ? "2nd & 3rd" : "العميل الثاني والثالث"} />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[10px] text-text-muted">
            <span>{isEn ? `Top customer: ${topDebtorSharePct}%` : `أعلى عميل بمفرده: ${topDebtorSharePct}%`}</span>
            <span>{isEn ? `Collection Rate: ${collectionRate}% · DSO: ${dsoDays}d` : `نسبة التحصيل: ${collectionRate}% · متوسط السداد: ${dsoDays} يوم`}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. ReminderFunnelChart: WhatsApp Reminder Conversion (Chart.js Bar)
// ---------------------------------------------------------------------------

export function ReminderFunnelChart({
  sent,
  delivered,
  replied,
  paidWithin7d,
  labels,
}: {
  sent: number;
  delivered: number;
  replied: number;
  paidWithin7d: number;
  labels: {
    sent: string;
    delivered: string;
    replied: string;
    paidWithin7d: string;
  };
}) {
  const locale = useLocale();
  const isAr = locale === "ar";
  const base = Math.max(1, sent);

  const stages = [
    { key: "sent", label: labels.sent, value: sent, pct: 100, color: "rgba(9, 83, 222, 0.85)", testid: "perf-sent" },
    { key: "delivered", label: labels.delivered, value: delivered, pct: Math.round((delivered / base) * 100), color: "rgba(0, 199, 252, 0.85)", testid: "perf-delivered" },
    { key: "replied", label: labels.replied, value: replied, pct: Math.round((replied / base) * 100), color: "rgba(245, 158, 11, 0.85)", testid: "perf-replied" },
    { key: "paidWithin7d", label: labels.paidWithin7d, value: paidWithin7d, pct: Math.round((paidWithin7d / base) * 100), color: "rgba(18, 113, 107, 0.85)", testid: "perf-paid" },
  ];

  const funnelData = useMemo(() => {
    return {
      labels: stages.map((s) => s.label),
      datasets: [
        {
          data: stages.map((s) => s.value),
          backgroundColor: stages.map((s) => s.color),
          borderRadius: 8,
          borderSkipped: false,
        },
      ],
    };
  }, [stages]);

  const funnelOptions: ChartOptions<"bar"> = useMemo(
    () => ({
      indexAxis: "y" as const,
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          rtl: isAr,
          padding: 10,
          cornerRadius: 12,
          callbacks: {
            label(ctx) {
              const val = Number(ctx.parsed.x);
              const pct = Math.round((val / base) * 100);
              return ` ${val} (${pct}%)`;
            },
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: {
            color: "rgba(148, 163, 184, 0.12)",
          },
          ticks: {
            font: {
              family: "inherit",
              size: 11,
            },
            color: "rgba(100, 116, 139, 0.8)",
          },
        },
        y: {
          grid: {
            display: false,
          },
          ticks: {
            font: {
              family: "inherit",
              size: 11,
              weight: 600,
            },
            color: "rgba(100, 116, 139, 0.9)",
          },
        },
      },
    }),
    [isAr, base]
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Horizontal Funnel Bar Chart */}
      <div className="relative h-[210px] w-full rounded-2xl border border-border/60 bg-surface/80 p-2 sm:p-4">
        <Bar data={funnelData} options={funnelOptions} />
      </div>

      {/* Funnel Stages Badge Grid */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stages.map((s) => (
          <div key={s.key} className="flex flex-col rounded-xl bg-surface-muted/50 p-2.5 text-xs">
            <span className="text-[11px] font-semibold text-text-muted">{s.label}</span>
            <span data-testid={s.testid} className="mt-0.5 text-base font-extrabold text-text" dir="ltr">
              {s.value}
            </span>
            <span className="text-[10px] font-bold text-text-subtle">%{s.pct}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
