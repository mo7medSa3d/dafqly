"use client";
import { useState } from "react";
import { useLocale } from "next-intl";

/**
 * Data visuals aligned with Yaseir Design Guide v2.1 (#analytics):
 * - Bar chart with UI Blue (#0953DE) & Cyan (#00C7FC) bars + accessible
 *   toggle to view values as a structured text table.
 * - Aging composition bar + percentage breakdown.
 */

export interface ForecastWeek { weekStart: string; expectedMinor: number; conservativeMinor: number }

export function ForecastChart({
  weeks, expectedLabel, conservativeLabel, format,
}: {
  weeks: ForecastWeek[];
  expectedLabel: string;
  conservativeLabel: string;
  format: (minor: number) => string;
}) {
  const locale = useLocale();
  const isAr = locale === "ar";
  const [showTable, setShowTable] = useState(false);
  const W = 640, H = 232, BASE = 196, MAXH = 148;
  const max = Math.max(1, ...weeks.map((w) => w.expectedMinor));
  const group = W / Math.max(weeks.length, 1);
  const barW = Math.min(22, group / 3.8);
  const y = (v: number) => BASE - (v / max) * MAXH;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-4 text-sm text-text-muted">
        <div className="flex flex-wrap items-center gap-4">
          <span className="inline-flex items-center gap-2 font-medium">
            <span className="size-3 rounded-full bg-primary" aria-hidden /> {expectedLabel}
          </span>
          <span className="inline-flex items-center gap-2 font-medium">
            <span className="size-3 rounded-full bg-teal-400" aria-hidden /> {conservativeLabel}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          className="inline-flex min-h-[32px] items-center rounded-full border border-border-strong/50 bg-callout px-3 py-1 text-xs font-bold text-primary transition-colors hover:bg-primary hover:text-white"
        >
          {showTable ? (isAr ? "عرض الرسم البياني" : "Show Chart") : (isAr ? "عرض القيم كجدول نصي" : "Show Table")}
        </button>
      </div>
      {showTable ? (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface-muted text-start">
                <th className="px-3 py-2 text-start font-bold">{isAr ? "الأسبوع" : "Week"}</th>
                <th className="px-3 py-2 text-start font-bold">{expectedLabel}</th>
                <th className="px-3 py-2 text-start font-bold">{conservativeLabel}</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.weekStart} className="border-t border-border">
                  <td className="px-3 py-2 font-medium" dir="ltr">{w.weekStart}</td>
                  <td className="tnum px-3 py-2 font-bold text-primary" dir="ltr">{format(w.expectedMinor)}</td>
                  <td className="tnum px-3 py-2 font-semibold text-text-muted" dir="ltr">{format(w.conservativeMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div dir="ltr" className="w-full overflow-x-auto">
          <svg viewBox={`0 0 ${W} ${H}`} className="min-w-[520px] w-full" role="img" aria-label={expectedLabel}>
            {[0.33, 0.66, 1].map((f) => (
              <line key={f} x1="0" x2={W} y1={BASE - MAXH * f} y2={BASE - MAXH * f} stroke="var(--border)" strokeDasharray="3 5" strokeWidth="1" />
            ))}
            <line x1="0" x2={W} y1={BASE} y2={BASE} stroke="var(--border-strong)" strokeWidth="1.5" />
            {weeks.map((w, i) => {
              const cx = group * i + group / 2;
              return (
                <g key={w.weekStart}>
                  <rect x={cx - barW - 3} y={y(w.expectedMinor)} width={barW} height={BASE - y(w.expectedMinor)} rx="6" fill="var(--primary)" />
                  <rect x={cx + 3} y={y(w.conservativeMinor)} width={barW} height={BASE - y(w.conservativeMinor)} rx="6" fill="var(--teal-400)" />
                  <text x={cx - barW / 2 - 3} y={y(w.expectedMinor) - 6} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--text)">
                    {format(w.expectedMinor)}
                  </text>
                  <text x={cx} y={BASE + 20} textAnchor="middle" fontSize="11" fill="var(--text-muted)">
                    {w.weekStart.slice(5)}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </div>
  );
}

export interface AgingBucket { key: string; label: string; amountMinor: number; formatted: string }

const BUCKET_BAR: Record<string, string> = {
  current: "bg-primary",
  "0-7": "bg-teal-400",
  "8-30": "bg-yaseir-yellow",
  "31-60": "bg-yaseir-violet",
  "60+": "bg-status-overdue-fg",
};

export function AgingBar({ buckets }: { buckets: AgingBucket[] }) {
  const total = buckets.reduce((s, b) => s + b.amountMinor, 0);
  return (
    <div className="flex flex-col gap-3">
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {buckets.map((b) => {
          const pct = total > 0 ? Math.round((b.amountMinor / total) * 100) : 0;
          return (
            <li
              key={b.key}
              className="flex items-center gap-2.5 rounded-xl bg-surface-muted/50 px-3.5 py-2.5 text-xs sm:text-sm transition-colors hover:bg-surface-muted"
            >
              <span className={`size-2 shrink-0 rounded-full ${BUCKET_BAR[b.key] ?? "bg-slate-400"}`} aria-hidden />
              <span className="min-w-0 truncate font-medium text-text-muted">{b.label}</span>
              <span className="ms-auto flex shrink-0 items-center gap-1.5" dir="ltr">
                <span className="tnum font-bold text-text">{b.formatted}</span>
                <span className="tnum rounded-md bg-surface px-1.5 py-0.5 text-[11px] font-semibold text-text-muted">
                  {pct}%
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
