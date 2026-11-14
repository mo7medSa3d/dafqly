"use client";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { useState } from "react";
import { useLocale } from "next-intl";
import { WarningCircle, TableIcon } from "@/components/ui/solid-icons";
import { formatPct, formatDso, currencyMinorExponent } from "@tahseel/core";
import { useCurrency } from "./CurrencyContext";

export interface ForecastWeek {
  weekStart: string;
  expectedMinor: number;
  conservativeMinor: number;
}

export function axisLabel(minor: number, isAr: boolean, currency = "EGP"): string {
  const major = minor / 10 ** currencyMinorExponent(currency);
  const loc = isAr ? "ar-EG" : "en-US";
  if (major >= 1000) {
    const k = major / 1000;
    return `${k.toLocaleString(loc, { maximumFractionDigits: k < 10 ? 1 : 0 })}k`;
  }
  if (major >= 10) return Math.round(major).toLocaleString(loc);
  return major.toLocaleString(loc, { maximumFractionDigits: 1 });
}

export function ForecastChart({
  weeks,
  expectedLabel,
  conservativeLabel,
}: {
  weeks: ForecastWeek[];
  expectedLabel: string;
  conservativeLabel: string;
}) {
  const isAr = useLocale() === "ar";
  const { symbol, formatAmountOnly, currency } = useCurrency();
  const format = (minor: number) => formatAmountOnly(BigInt(minor));
  const [showTable, setShowTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...weeks.map((w) => w.expectedMinor), ...weeks.map((w) => w.conservativeMinor)) * 1.1;
  const x = (i: number) => 46 + (i * 694) / Math.max(1, weeks.length - 1);
  const y = (v: number) => 190 - (v / max) * 150;
  const line = (key: "expectedMinor" | "conservativeMinor") =>
    weeks.map((w, i) => `${i ? "L" : "M"}${x(i)},${y(w[key])}`).join(" ");
  const expectedTotal = weeks.reduce((sum, w) => sum + w.expectedMinor, 0);
  const conservativeTotal = weeks.reduce((sum, w) => sum + w.conservativeMinor, 0);
  const peak = weeks.reduce<ForecastWeek | null>((best, w) => (!best || w.expectedMinor > best.expectedMinor ? w : best), null);

  if (!weeks.length) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{isAr ? "لا توجد نقاط توقع متاحة بعد." : "No forecast points available yet."}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2">
        <Kpi label={isAr ? "إجمالي متوقع" : "Expected total"} value={format(expectedTotal)} tone="primary" symbol={symbol} />
        <Kpi label={isAr ? "سيناريو محافظ" : "Conservative"} value={format(conservativeTotal)} tone="default" symbol={symbol} />
        <Kpi label={isAr ? "أعلى أسبوع" : "Peak week"} value={peak ? format(peak.expectedMinor) : format(0)} tone="default" symbol={symbol} />
      </div>
      <div className="relative rounded-xl border border-border bg-card p-3 sm:p-4">
        <div className="mb-3 flex flex-wrap items-center gap-4 text-xs font-semibold text-muted-foreground">
          <span className="flex items-center gap-2">
            <i className="size-2.5 rounded-full" style={{ background: "var(--chart-2)" }} />
            {expectedLabel}
          </span>
          <span className="flex items-center gap-2">
            <i className="size-2.5 rounded-full" style={{ background: "var(--chart-1)" }} />
            {conservativeLabel}
          </span>
          <span className="ms-auto">{isAr ? "٨ أسابيع" : "8-week horizon"}</span>
        </div>
        <svg
          viewBox="0 0 780 225"
          role="img"
          aria-label={isAr ? "رسم توقع التدفقات النقدية خلال ثمانية أسابيع" : "Eight-week cash flow projection"}
          className="h-[225px] w-full touch-none overflow-visible"
          onPointerLeave={() => setHover(null)}
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const px = ((e.clientX - r.left) / r.width) * 780;
            setHover(Math.max(0, Math.min(weeks.length - 1, Math.round(((px - 46) / 694) * (weeks.length - 1)))));
          }}
        >
          <defs>
            <linearGradient id="cash-area-mosaic" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-2)" stopOpacity=".24" />
              <stop offset="100%" stopColor="var(--chart-2)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 1, 2, 3].map((i) => (
            <g key={i}>
              <line x1="46" x2="740" y1={40 + i * 50} y2={40 + i * 50} stroke="currentColor" opacity=".10" />
              <text x="34" y={44 + i * 50} textAnchor="end" fill="currentColor" opacity=".50" fontSize="10">
                {axisLabel(max * (1 - i / 3), isAr, currency)}
              </text>
            </g>
          ))}
          <path d={`${line("expectedMinor")} L${x(weeks.length - 1)},190 L${x(0)},190 Z`} fill="url(#cash-area-mosaic)" />
          <path d={line("expectedMinor")} fill="none" stroke="var(--chart-2)" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d={line("conservativeMinor")} fill="none" stroke="var(--chart-1)" strokeWidth="2.2" strokeDasharray="6 5" strokeLinecap="round" strokeLinejoin="round" />
          {weeks.map((w, i) => (
            <g key={w.weekStart}>
              <circle cx={x(i)} cy={y(w.expectedMinor)} r={hover === i ? 5.5 : 3.5} fill="var(--card)" stroke="var(--chart-2)" strokeWidth="2.5" />
              <text x={x(i)} y="214" textAnchor="middle" fill="currentColor" opacity=".58" fontSize="10">
                {new Date(`${w.weekStart}T00:00:00`).toLocaleDateString(isAr ? "ar-EG" : "en-GB", { day: "numeric", month: "short" })}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <button type="button" onClick={() => setShowTable((v) => !v)} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "self-end")}>
        <TableIcon size={15} />
        {showTable ? (isAr ? "إخفاء التفاصيل" : "Hide detail") : isAr ? "عرض القيم الأسبوعية" : "View weekly values"}
      </button>
      {showTable && (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-start text-xs">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="p-3">{isAr ? "الأسبوع" : "Week"}</th>
                <th className="p-3">{expectedLabel}</th>
                <th className="p-3">{conservativeLabel}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {weeks.map((w) => (
                <tr key={w.weekStart}>
                  <td className="p-3" dir="ltr">{w.weekStart}</td>
                  <td className="p-3 font-bold" dir="ltr">{format(w.expectedMinor)} {symbol}</td>
                  <td className="p-3 font-bold text-muted-foreground" dir="ltr">{format(w.conservativeMinor)} {symbol}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export interface AgingBucket {
  key: string;
  label: string;
  amountMinor: number;
  formatted: string;
}

export function AgingBar({ buckets }: { buckets: AgingBucket[] }) {
  const isAr = useLocale() === "ar";
  const { symbol } = useCurrency();
  const total = buckets.reduce((sum, b) => sum + b.amountMinor, 0);
  const serious = buckets.filter((b) => ["31-60", "60+"].includes(b.key)).reduce((sum, b) => sum + b.amountMinor, 0);
  const severePct = total ? Math.round((serious / total) * 100) : 0;
  const tones = ["var(--chart-3)", "var(--chart-2)", "var(--chart-1)", "var(--destructive)", "var(--chart-5)"];

  return (
    <div className="flex flex-col gap-4">
      {severePct > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-destructive/20 bg-danger-bg px-3 py-2 text-xs font-bold text-destructive">
          <WarningCircle size={16} />
          {isAr ? `${severePct}% من الرصيد تجاوز ٣٠ يوماً` : `${severePct}% of receivables are over 30 days overdue`}
        </div>
      )}
      <div className="flex h-3.5 w-full gap-0.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={isAr ? "توزيع أعمار المستحقات" : "Receivables aging distribution"}>
        {buckets.map((b, i) => (
          <span
            key={b.key}
            className="h-full first:rounded-s-full last:rounded-e-full"
            style={{ width: `${total ? (b.amountMinor / total) * 100 : 0}%`, background: tones[i % tones.length] }}
            title={`${b.label}: ${b.formatted} ${symbol}`}
          />
        ))}
      </div>
      <div className="flex flex-col gap-3">
        {buckets.map((b, i) => {
          const pct = total ? Math.round((b.amountMinor / total) * 100) : 0;
          return (
            <div key={b.key} className="grid grid-cols-[minmax(76px,1fr)_minmax(90px,2fr)_auto] items-center gap-3 text-xs">
              <div className="flex items-center gap-2 font-bold text-foreground">
                <i className="size-2.5 shrink-0 rounded-full" style={{ background: tones[i % tones.length] }} />
                {b.label}
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: tones[i % tones.length] }} />
              </div>
              <div className="text-end">
                <span className="tnum font-extrabold" dir="ltr">{b.formatted}</span>
                <span className="ms-1 text-muted-foreground">{pct}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function VelocityAndConcentrationChart({
  velocityScore,
  collectionRate,
  dsoDays,
  topDebtorSharePct,
  top3ConcentrationPct,
  expected14dFormatted,
  atRiskFormatted,
  isEn,
}: {
  velocityScore: number;
  collectionRate: number;
  dsoDays: number;
  topDebtorSharePct: number;
  top3ConcentrationPct: number;
  expected14dFormatted: string;
  atRiskFormatted: string;
  isEn: boolean;
}) {
  const { symbol } = useCurrency();
  const score = Math.max(0, Math.min(100, velocityScore));
  const safeTop = Math.max(0, Math.min(100, topDebtorSharePct));
  const safeTop3 = Math.max(safeTop, Math.min(100, top3ConcentrationPct));
  return (
    <div className="mt-5 grid gap-4 border-t border-border pt-4 lg:grid-cols-2">
      <div className="rounded-xl border border-border bg-muted/40 p-4">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs font-bold text-muted-foreground">{isEn ? "Collection velocity" : "سرعة التحصيل"}</p>
            <p className="mt-1 text-3xl font-black text-foreground" dir="ltr">
              {score}
              <span className="ms-1 text-sm font-bold text-muted-foreground">/100</span>
            </p>
          </div>
          <span className="text-xs font-bold text-foreground">{isEn ? "Portfolio health" : "صحة المحفظة"}</span>
        </div>
        <Progress value={score} tone="primary" />
        <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
          <div>
            <p className="text-muted-foreground">{isEn ? "Collection rate" : "معدل التحصيل"}</p>
            <p className="mt-1 text-lg font-extrabold" dir="ltr">{formatPct(collectionRate)}</p>
          </div>
          <div>
            <p className="text-muted-foreground">{isEn ? "Days sales outstanding" : "متوسط أيام التحصيل"}</p>
            <p className="mt-1 text-lg font-extrabold" dir="ltr">{formatDso(dsoDays)}d</p>
          </div>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-bold text-muted-foreground">{isEn ? "Expected next 14 days" : "المتوقع خلال ١٤ يوماً"}</p>
          <p className="mt-2 text-xl font-extrabold text-status-paid-fg" dir="ltr">{expected14dFormatted}</p>
          <span className="text-[11px] text-muted-foreground">{symbol} · {isEn ? "Statistical estimate" : "تقدير إحصائي"}</span>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-bold text-muted-foreground">{isEn ? "Receivables at risk" : "مستحقات معرضة للمخاطر"}</p>
          <p className="mt-2 text-xl font-extrabold text-destructive" dir="ltr">{atRiskFormatted}</p>
          <span className="text-[11px] text-muted-foreground">{symbol} · {isEn ? "Risk-scored balance" : "رصيد وفق مؤشرات المخاطر"}</span>
        </div>
        <div className="rounded-xl border border-border bg-card p-4 sm:col-span-2">
          <div className="flex justify-between gap-2 text-xs font-bold">
            <span>{isEn ? "Top 3 customer concentration" : "تركيز أعلى ٣ عملاء"}</span>
            <span dir="ltr">{safeTop3}%</span>
          </div>
          <Progress value={safeTop3} tone={safeTop3 > 55 ? "danger" : "primary"} />
          <p className="mt-2 text-[11px] text-muted-foreground">
            {isEn ? `Largest account: ${safeTop}% of receivables` : `أكبر عميل يمثل ${safeTop}% من المستحقات`}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Cruip Mosaic DashboardCard11-style stacked segmented bar + funnel breakdown. */
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
  labels: { sent: string; delivered: string; replied: string; paidWithin7d: string };
}) {
  const isAr = useLocale() === "ar";
  const base = Math.max(sent, 1);
  const stages = [
    { key: "sent", label: labels.sent, value: sent, pct: 100, color: "var(--chart-3)" },
    { key: "delivered", label: labels.delivered, value: delivered, pct: Math.round((delivered / base) * 100), color: "var(--chart-2)" },
    { key: "replied", label: labels.replied, value: replied, pct: Math.round((replied / base) * 100), color: "var(--chart-1)" },
    { key: "paid", label: labels.paidWithin7d, value: paidWithin7d, pct: Math.round((paidWithin7d / base) * 100), color: "var(--primary)" },
  ];
  const segTotal = Math.max(1, sent + delivered + replied + paidWithin7d);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={isAr ? "مراحل استجابة التذكيرات" : "Reminder conversion breakdown"}>
        {stages.map((s) => (
          <div key={s.key} className="h-full first:rounded-s-full last:rounded-e-full" style={{ width: `${(s.value / segTotal) * 100}%`, background: s.color }} />
        ))}
      </div>
      <div className="flex flex-col gap-3">
        {stages.map((s) => (
          <div key={s.key} data-testid={`perf-${s.key === "paid" ? "paid" : s.key}`} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="flex items-center gap-2 font-semibold text-muted-foreground">
                <i className="size-2 rounded-full" style={{ background: s.color }} />
                {s.label}
              </span>
              <span className="tnum font-extrabold text-foreground" dir="ltr">
                {s.value.toLocaleString(isAr ? "ar-EG" : "en-US")} <span className="text-muted-foreground">· {s.pct}%</span>
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{ width: `${Math.max(0, Math.min(100, s.pct))}%`, background: s.color }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Kpi({ label, value, tone, symbol }: { label: string; value: string; tone: "primary" | "positive" | "default"; symbol: string }) {
  const color = tone === "primary" ? "text-foreground" : tone === "positive" ? "text-status-paid-fg" : "text-foreground";
  return (
    <div className="min-w-0 rounded-xl bg-muted/60 p-3">
      <p className="truncate text-[10px] font-bold text-muted-foreground">{label}</p>
      <p className={`mt-1 truncate text-sm font-extrabold ${color}`} dir="ltr">
        {value} <span className="text-[10px] text-muted-foreground">{symbol}</span>
      </p>
    </div>
  );
}

function Progress({ value, tone }: { value: number; tone: "primary" | "danger" }) {
  return (
    <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
      <div className={`h-full rounded-full ${tone === "danger" ? "bg-destructive" : "bg-primary"}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}
