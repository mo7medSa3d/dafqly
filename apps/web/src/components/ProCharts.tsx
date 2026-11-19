"use client";
import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import { formatPct } from "@tahseel/core";
import { useCurrency } from "./CurrencyContext";
import { InitialAvatar } from "./ui";
import { axisLabel } from "./charts";

/**
 * Cruip Mosaic-inspired interactive SVG charts, themed with the DAFQLY
 * monochrome oklch palette (--chart-1 amber, --chart-2 cobalt, --chart-3..5
 * neutrals, --primary, --destructive). Zero external chart libs, SSR-safe.
 */
const SERIES = [
  "var(--status-paid-fg)",
  "var(--chart-2)",
  "var(--status-due_soon-fg)",
  "var(--chart-1)",
  "var(--status-overdue-fg)",
];

const AGING_COLOR: Record<string, string> = {
  current: "var(--status-paid-fg)",
  "0-7": "var(--chart-2)",
  "8-30": "var(--status-due_soon-fg)",
  "31-60": "var(--chart-1)",
  "60+": "var(--status-overdue-fg)",
};

function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return "";
  let d = `M${pts[0]![0]},${pts[0]![1]}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`;
  }
  return d;
}

/* ------------------------------------------------------------------ SparkCard */

export function MosaicSparkCard({
  title,
  subtitle,
  value,
  unit,
  badge,
  badgeTone = "neutral",
  series,
  seriesLabels,
  sourceLabel,
  ratioBar,
  color = "var(--chart-2)",
  testId,
  extra,
}: {
  title: string;
  subtitle?: string;
  value: string;
  unit?: string;
  badge?: string;
  badgeTone?: "neutral" | "positive" | "danger";
  series: number[];
  seriesLabels?: string[];
  sourceLabel?: string;
  ratioBar?: { pct: number; label: string };
  color?: string;
  testId?: string;
  extra?: ReactNode;
}) {
  const uid = useId().replace(/:/g, "");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const pts = series.length >= 2 ? series : [0, ...series, 0];
  const allZero = pts.every((v) => v === 0);
  const W = 320;
  const H = 72;
  const min = Math.min(...pts);
  const max = Math.max(...pts, min + 1);
  const coords: [number, number][] = pts.map((v, i) => [
    (i / Math.max(1, pts.length - 1)) * W,
    allZero ? H - 10 : H - 8 - ((v - min) / (max - min)) * (H - 18),
  ]);
  const line = smoothPath(coords);
  const area = `${line} L${W},${H} L0,${H} Z`;
  const badgeCls =
    badgeTone === "danger"
      ? "bg-status-overdue-bg text-status-overdue-fg"
      : badgeTone === "positive"
        ? "bg-status-paid-bg text-status-paid-fg"
        : "bg-muted text-muted-foreground";

  return (
    <div className="flex flex-col justify-between overflow-hidden rounded-xl border border-border bg-card shadow-xs">
      <div className="px-5 pt-5">
        <div className="flex items-start justify-between gap-2">
          <div>
            {/* h2, not h3: this card is the first heading after the page h1,
                and axe flags an h1 -> h3 skip (heading-order). */}
            <h2 className="text-sm font-bold text-card-foreground">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{subtitle}</p>}
          </div>
          {badge && (
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 font-mono text-[11px] font-bold ${badgeCls}`}>
              {badge}
            </span>
          )}
        </div>
        <div className="mt-2 flex items-baseline gap-1.5">
          <span data-testid={testId} className="tnum text-[30px] font-extrabold leading-none tracking-tight text-card-foreground" dir="ltr">
            {value}
          </span>
          {unit && <span className="text-xs font-bold text-muted-foreground">{unit}</span>}
        </div>
        {extra && <div className="mt-1.5 text-xs text-muted-foreground">{extra}</div>}
      </div>

      <div className="relative mt-3 h-[84px] w-full">
        {(sourceLabel || ratioBar) && (
          <div className="pointer-events-none absolute inset-x-5 top-0 z-10 flex items-center justify-between gap-2 text-[10px] font-semibold text-muted-foreground">
            <span className="truncate">
              {hoverIdx !== null && seriesLabels?.[hoverIdx] ? seriesLabels[hoverIdx] : (sourceLabel ?? ratioBar?.label)}
            </span>
            {hoverIdx !== null && pts[hoverIdx] !== undefined ? (
              <span className="tnum font-bold text-foreground" dir="ltr">
                {(pts[hoverIdx]! / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            ) : ratioBar ? (
              <span className="tnum font-bold text-foreground" dir="ltr">{Math.round(Math.max(0, Math.min(100, ratioBar.pct)))}%</span>
            ) : null}
          </div>
        )}
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="h-full w-full touch-none overflow-visible"
          aria-hidden="true"
          onPointerLeave={() => setHoverIdx(null)}
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / Math.max(1, r.width)));
            setHoverIdx(Math.round(ratio * (coords.length - 1)));
          }}
        >
          <defs>
            <linearGradient id={`${uid}g`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.22" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${uid}g)`} />
          <path d={line} fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" />
          {hoverIdx !== null && coords[hoverIdx] && (
            <g>
              <line x1={coords[hoverIdx]![0]} x2={coords[hoverIdx]![0]} y1={0} y2={H} stroke={color} strokeOpacity="0.3" strokeDasharray="3 3" />
              <circle cx={coords[hoverIdx]![0]} cy={coords[hoverIdx]![1]} r="4" fill="var(--card)" stroke={color} strokeWidth="2.5" />
            </g>
          )}
        </svg>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ ForecastArea */

export interface ForecastPoint {
  weekStart: string;
  expectedMinor: number;
  conservativeMinor: number;
}

export function ForecastArea({
  weeks,
  expectedLabel,
  conservativeLabel,
  beyondHorizon,
}: {
  weeks: ForecastPoint[];
  expectedLabel: string;
  conservativeLabel: string;
  beyondHorizon?: { expectedMinor: number; conservativeMinor: number };
}) {
  const isAr = useLocale() === "ar";
  const { symbol, formatAmountOnly, currency } = useCurrency();
  const uid = useId().replace(/:/g, "");
  const [hover, setHover] = useState<number | null>(null);
  const [mode, setMode] = useState<"area" | "bars">("area");
  if (!weeks.length) return null;
  const W = 760;
  const H = 248;
  const L = 54;
  const R = 14;
  const T = 18;
  const B = 32;
  const max = Math.max(1, ...weeks.map((w) => Math.max(w.expectedMinor, w.conservativeMinor))) * 1.12;
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(1, weeks.length - 1);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const exp = weeks.map((w, i): [number, number] => [x(i), y(w.expectedMinor)]);
  const con = weeks.map((w, i): [number, number] => [x(i), y(w.conservativeMinor)]);
  const line = smoothPath(exp);
  const area = `${line} L${x(weeks.length - 1)},${H - B} L${x(0)},${H - B} Z`;
  const fmt = (n: number) => formatAmountOnly(BigInt(Math.round(n)), { digits: "latin" });
  const total = weeks.reduce((s, w) => s + w.expectedMinor, 0);
  const totalCon = weeks.reduce((s, w) => s + w.conservativeMinor, 0);
  const peak = weeks.reduce((b, w, i) => (w.expectedMinor > weeks[b]!.expectedMinor ? i : b), 0);
  const dateFmt = new Intl.DateTimeFormat(isAr ? "ar-EG-u-nu-latn" : "en-GB", { day: "numeric", month: "short" });
  const day = (iso: string) => dateFmt.format(new Date(`${iso}T00:00:00`));
  const h = hover ?? null;
  const hasBeyond = Boolean(beyondHorizon && (beyondHorizon.expectedMinor > 0 || beyondHorizon.conservativeMinor > 0));

  const slotW = (W - L - R) / Math.max(1, weeks.length);
  const barW = Math.min(18, Math.max(8, slotW * 0.28));

  return (
    <div className="flex flex-col gap-4">
      {/* Mosaic-style summary bar + chart type switch */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{expectedLabel}</p>
            <p className="tnum text-xl font-extrabold text-card-foreground" dir="ltr">
              {fmt(total)} <span className="text-xs font-semibold text-muted-foreground">{symbol}</span>
            </p>
          </div>
          <div className="h-7 w-px bg-border" aria-hidden />
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{conservativeLabel}</p>
            <p className="tnum text-xl font-extrabold text-muted-foreground" dir="ltr">
              {fmt(totalCon)} <span className="text-xs font-semibold">{symbol}</span>
            </p>
          </div>
          <div className="h-7 w-px bg-border" aria-hidden />
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{isAr ? "أعلى أسبوع" : "Peak week"}</p>
            <p className="tnum text-base font-extrabold text-card-foreground">{day(weeks[peak]!.weekStart)}</p>
          </div>
        </div>

        <div className="inline-flex rounded-lg border border-border bg-muted p-0.5 text-xs font-bold">
          <button
            type="button"
            onClick={() => setMode("area")}
            className={`rounded-md px-2.5 py-1 transition-colors ${mode === "area" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"}`}
          >
            {isAr ? "منحنى" : "Line"}
          </button>
          <button
            type="button"
            onClick={() => setMode("bars")}
            className={`rounded-md px-2.5 py-1 transition-colors ${mode === "bars" ? "bg-card text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"}`}
          >
            {isAr ? "أعمدة" : "Bars"}
          </button>
        </div>
      </div>

      <div className="relative">
        <div className="mb-2 flex flex-wrap items-center gap-4 text-xs font-semibold text-muted-foreground">
          <span className="flex items-center gap-2">
            <i className="size-2.5 rounded-full" style={{ background: "var(--chart-2)" }} />
            {expectedLabel}
          </span>
          <span className="flex items-center gap-2">
            <i className="size-2.5 rounded-full" style={{ background: "var(--chart-1)" }} />
            {conservativeLabel}
          </span>
        </div>

        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-auto w-full touch-none overflow-visible"
          role="img"
          aria-label={isAr ? "رسم توقع التدفقات النقدية خلال ثمانية أسابيع" : "Eight-week cash flow projection"}
          onPointerLeave={() => setHover(null)}
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const px = ((e.clientX - r.left) / r.width) * W;
            setHover(Math.max(0, Math.min(weeks.length - 1, Math.round(((px - L) / (W - L - R)) * (weeks.length - 1)))));
          }}
        >
          <defs>
            <linearGradient id={`${uid}a`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--chart-2)" stopOpacity=".28" />
              <stop offset="1" stopColor="var(--chart-2)" stopOpacity="0" />
            </linearGradient>
            <clipPath id={`${uid}c`}>
              <rect className="pc-wipe" x="0" y="0" width={W} height={H} />
            </clipPath>
          </defs>
          {[0, 1, 2, 3, 4].map((i) => {
            const v = (max * (4 - i)) / 4;
            return (
              <g key={i}>
                <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="currentColor" opacity=".09" />
                <text x={L - 8} y={y(v) + 3} textAnchor="end" fontSize="10" fill="currentColor" opacity=".5" style={{ direction: "ltr" }}>
                  {axisLabel(v, isAr, currency)}
                </text>
              </g>
            );
          })}

          {mode === "area" ? (
            <g clipPath={`url(#${uid}c)`}>
              <path d={area} fill={`url(#${uid}a)`} />
              <path d={smoothPath(con)} fill="none" stroke="var(--chart-1)" strokeWidth="2.2" strokeDasharray="5 4" strokeLinecap="round" />
              <path d={line} fill="none" stroke="var(--chart-2)" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          ) : (
            <g>
              {weeks.map((w, i) => {
                const cx = x(i);
                const yExp = y(w.expectedMinor);
                const yCon = y(w.conservativeMinor);
                const hExp = Math.max(0, H - B - yExp);
                const hCon = Math.max(0, H - B - yCon);
                return (
                  <g key={w.weekStart} opacity={h !== null && h !== i ? 0.45 : 1}>
                    {hExp > 0 && <rect x={cx - barW - 2} y={yExp} width={barW} height={hExp} rx="4" fill="var(--chart-2)" />}
                    {hCon > 0 && <rect x={cx + 2} y={yCon} width={barW} height={hCon} rx="4" fill="var(--chart-1)" />}
                  </g>
                );
              })}
            </g>
          )}

          {weeks.map((w, i) => (
            <text key={w.weekStart} x={x(i)} y={H - 10} textAnchor="middle" fontSize="10" fill="currentColor" opacity=".55">
              {day(w.weekStart)}
            </text>
          ))}

          {h !== null && (
            <g pointerEvents="none">
              <line x1={x(h)} x2={x(h)} y1={T} y2={H - B} stroke="currentColor" opacity=".22" strokeDasharray="3 3" />
              <circle cx={x(h)} cy={y(weeks[h]!.expectedMinor)} r="5.5" fill="var(--card)" stroke="var(--chart-2)" strokeWidth="3" />
              <circle cx={x(h)} cy={y(weeks[h]!.conservativeMinor)} r="4.5" fill="var(--card)" stroke="var(--chart-1)" strokeWidth="2.5" />
            </g>
          )}
        </svg>

        {h !== null && (
          <div
            className="pointer-events-none absolute top-6 z-10 min-w-[164px] -translate-x-1/2 rounded-xl border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg"
            style={{ left: `${Math.min(86, Math.max(14, (x(h) / W) * 100))}%` }}
            dir={isAr ? "rtl" : "ltr"}
          >
            <p className="mb-1 font-bold">{day(weeks[h]!.weekStart)}</p>
            <p className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5">
                <i className="size-2 rounded-full" style={{ background: "var(--chart-2)" }} />
                {expectedLabel}
              </span>
              <b className="tnum" dir="ltr">{fmt(weeks[h]!.expectedMinor)} {symbol}</b>
            </p>
            <p className="flex items-center justify-between gap-3 text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <i className="size-2 rounded-full" style={{ background: "var(--chart-1)" }} />
                {conservativeLabel}
              </span>
              <b className="tnum" dir="ltr">{fmt(weeks[h]!.conservativeMinor)} {symbol}</b>
            </p>
          </div>
        )}
      </div>

      {hasBeyond && beyondHorizon && (
        <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
          {isAr ? "مستحقات بعد أفق 8 أسابيع:" : "Due beyond 8-week horizon:"}{" "}
          <span className="tnum font-bold text-foreground" dir="ltr">
            {fmt(beyondHorizon.expectedMinor)} {symbol}
          </span>
        </p>
      )}

      <details className="rounded-xl border border-border text-xs">
        <summary className="cursor-pointer px-3 py-2 font-bold text-muted-foreground hover:text-foreground">
          {isAr ? "عرض القيم الأسبوعية" : "View weekly values"}
        </summary>
        <div className="overflow-x-auto">
          <table className="w-full text-start">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="p-2.5 text-start">{isAr ? "الأسبوع" : "Week"}</th>
                <th className="p-2.5 text-start">{expectedLabel}</th>
                <th className="p-2.5 text-start">{conservativeLabel}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {weeks.map((w) => (
                <tr key={w.weekStart}>
                  <td className="p-2.5" dir="ltr">{w.weekStart}</td>
                  <td className="p-2.5 font-bold" dir="ltr">{fmt(w.expectedMinor)} {symbol}</td>
                  <td className="p-2.5 text-muted-foreground" dir="ltr">{fmt(w.conservativeMinor)} {symbol}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/* ------------------------------------------------------------------ AgingDonut */

export interface DonutItem {
  key: string;
  label: string;
  amountMinor: number;
}

export function AgingDonut({ buckets }: { buckets: DonutItem[] }) {
  const isAr = useLocale() === "ar";
  const { symbol, formatAmountOnly } = useCurrency();
  const [active, setActive] = useState<string | null>(null);
  const total = buckets.reduce((s, b) => s + b.amountMinor, 0);
  const R = 62;
  const C = 2 * Math.PI * R;
  const gap = 3;
  let acc = 0;
  const severe = buckets.filter((b) => ["31-60", "60+"].includes(b.key)).reduce((s, b) => s + b.amountMinor, 0);
  const sevRatio = total > 0 ? severe / total : 0;
  const shown = active ? buckets.find((b) => b.key === active) : null;

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
      <div className="relative size-[176px] shrink-0">
        <svg viewBox="0 0 160 160" className="size-full -rotate-90" role="img" aria-label={isAr ? "توزيع أعمار المستحقات" : "Receivables aging distribution"}>
          <circle cx="80" cy="80" r={R} fill="none" stroke="var(--muted)" strokeWidth="18" />
          {buckets.map((b, i) => {
            const len = total ? (b.amountMinor / total) * C : 0;
            const seg = Math.max(0, len - (len > gap ? gap : 0));
            const off = -acc;
            acc += len;
            if (b.amountMinor <= 0) return null;
            return (
              <circle
                key={b.key}
                cx="80"
                cy="80"
                r={R}
                fill="none"
                stroke={AGING_COLOR[b.key] ?? SERIES[i % SERIES.length]}
                strokeWidth={active === b.key ? 23 : 18}
                strokeDasharray={`${seg} ${C - seg}`}
                strokeDashoffset={off}
                className="pc-seg cursor-pointer transition-[stroke-width,opacity] duration-200"
                style={{ opacity: active && active !== b.key ? 0.3 : 1, animationDelay: `${i * 90}ms` }}
                onPointerEnter={() => setActive(b.key)}
                onPointerLeave={() => setActive(null)}
              />
            );
          })}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <p className="text-[11px] font-bold text-muted-foreground">{shown ? shown.label : isAr ? "الإجمالي" : "Total"}</p>
          <p className="tnum text-base font-extrabold text-card-foreground" dir="ltr">
            {formatAmountOnly(BigInt(Math.round(shown ? shown.amountMinor : total)), { digits: "latin" })}
          </p>
          <p className="tnum text-[10px] font-semibold text-muted-foreground" dir="ltr">
            {shown && total ? formatPct(shown.amountMinor / total) : symbol}
          </p>
        </div>
      </div>

      <ul className="flex w-full flex-1 flex-col gap-1.5 text-xs">
        {buckets.map((b, i) => (
          <li
            key={b.key}
            onPointerEnter={() => setActive(b.key)}
            onPointerLeave={() => setActive(null)}
            className="flex cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-accent"
          >
            <span className="flex items-center gap-2 font-semibold">
              <i className="size-2.5 rounded-full" style={{ background: AGING_COLOR[b.key] ?? SERIES[i % SERIES.length] }} />
              {b.label}
            </span>
            <span className="tnum font-bold text-muted-foreground" dir="ltr">
              {total ? formatPct(b.amountMinor / total) : formatPct(0)}
            </span>
          </li>
        ))}
        {severe > 0 && (
          <li className="mt-1 rounded-lg bg-danger-bg px-2.5 py-1.5 font-bold text-danger">
            {isAr ? `${formatPct(sevRatio)} من الرصيد تجاوز 30 يوماً` : `${formatPct(sevRatio)} over 30 days`}
          </li>
        )}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ Gauge */

export function Gauge({ value, label, caption }: { value: number; label: string; caption?: string }) {
  const safe = Number.isFinite(value) ? value : 0;
  const pct = Math.max(0, Math.min(100, safe));
  const pctLabel = formatPct(pct / 100);
  const R = 70;
  const arc = Math.PI * R;
  const tone = pct >= 70 ? "var(--chart-2)" : pct >= 40 ? "var(--chart-1)" : "var(--destructive)";
  return (
    <div className="flex flex-col items-center gap-1.5 text-center">
      <svg viewBox="0 0 180 104" className="w-full max-w-[230px]" role="img" aria-label={`${label}: ${pctLabel}`}>
        <path d="M20 90 A70 70 0 0 1 160 90" fill="none" stroke="var(--muted)" strokeWidth="14" strokeLinecap="round" />
        <path
          d="M20 90 A70 70 0 0 1 160 90"
          fill="none"
          stroke={tone}
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${(pct / 100) * arc} ${arc}`}
          className="pc-gauge"
        />
        <text x="90" y="80" textAnchor="middle" fontSize="24" fontWeight="800" fill="currentColor" className="tnum">
          {pctLabel}
        </text>
      </svg>
      <p className="text-sm font-bold">{label}</p>
      {caption && <p className="text-xs text-muted-foreground">{caption}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ RankedBars */

export interface RankedItem {
  id: string;
  name: string;
  amountMinor: number;
  href: string;
}

export function RankedBars({ items }: { items: RankedItem[] }) {
  const { symbol, formatAmountOnly } = useCurrency();
  const topItems = items.slice(0, 4);
  const max = Math.max(1, ...topItems.map((i) => i.amountMinor));
  return (
    <ol className="flex flex-col gap-2.5">
      {topItems.map((d, i) => (
        <li key={d.id}>
          <Link href={d.href} className="group flex flex-col gap-1.5 rounded-xl px-2.5 py-2 transition-colors hover:bg-accent">
            <span className="flex items-center gap-2.5">
              <span className="tnum flex size-5 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-[10px] font-extrabold text-muted-foreground" dir="ltr">
                {i + 1}
              </span>
              <InitialAvatar name={d.name} size={28} />
              <span className="min-w-0 flex-1 truncate text-sm font-bold">{d.name}</span>
              <span className="tnum text-sm font-extrabold text-foreground" dir="ltr">
                {formatAmountOnly(BigInt(Math.round(d.amountMinor)), { digits: "latin" })} <span className="text-[11px] font-normal text-muted-foreground">{symbol}</span>
              </span>
            </span>
            <span className="h-1.5 overflow-hidden rounded-full bg-muted">
              <span
                className="pc-bar block h-full rounded-full"
                style={{
                  width: `${(d.amountMinor / max) * 100}%`,
                  background: i === 0 ? "var(--chart-2)" : "var(--primary)",
                  animationDelay: `${i * 80}ms`,
                }}
              />
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
