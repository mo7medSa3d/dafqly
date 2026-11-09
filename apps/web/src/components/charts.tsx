/**
 * Data visuals for the redesigned dashboard, drawn as pure SVG/HTML from
 * the SAME series the page already fetches (F12 forecast weeks, F11 aging
 * buckets). No chart library, no extra queries, no invented data.
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
  const W = 640, H = 232, BASE = 196, MAXH = 148;
  const max = Math.max(1, ...weeks.map((w) => w.expectedMinor));
  const group = W / Math.max(weeks.length, 1);
  const barW = Math.min(20, group / 4);
  const y = (v: number) => BASE - (v / max) * MAXH;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4 text-sm text-text-muted">
        <span className="inline-flex items-center gap-2">
          <span className="size-3 rounded-sm bg-teal-400" aria-hidden /> {expectedLabel}
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="size-3 rounded-sm bg-navy-300 dark:bg-navy-400" aria-hidden /> {conservativeLabel}
        </span>
      </div>
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
                <rect x={cx - barW - 3} y={y(w.expectedMinor)} width={barW} height={BASE - y(w.expectedMinor)} rx="4" fill="var(--teal-400)" />
                <rect x={cx + 3} y={y(w.conservativeMinor)} width={barW} height={BASE - y(w.conservativeMinor)} rx="4" fill="var(--navy-300)" />
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
    </div>
  );
}

export interface AgingBucket { key: string; label: string; amountMinor: number; formatted: string }

const BUCKET_BAR: Record<string, string> = {
  current: "bg-teal-400",
  "0-7": "bg-teal-700",
  "8-30": "bg-status-due-fg",
  "31-60": "bg-navy-400",
  "60+": "bg-status-overdue-fg",
};

export function AgingBar({ buckets }: { buckets: AgingBucket[] }) {
  const total = buckets.reduce((s, b) => s + b.amountMinor, 0);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex h-3.5 w-full overflow-hidden rounded-full bg-surface-muted" dir="ltr" role="img"
        aria-label={buckets.map((b) => `${b.label}: ${b.formatted}`).join(" · ")}>
        {total > 0 && buckets.filter((b) => b.amountMinor > 0).map((b) => (
          <span key={b.key} className={`h-full ${BUCKET_BAR[b.key] ?? "bg-slate-400"}`} style={{ width: `${(b.amountMinor / total) * 100}%` }} />
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {buckets.map((b) => (
          <li key={b.key} className="flex items-center gap-2 text-sm">
            <span className={`size-2.5 shrink-0 rounded-full ${BUCKET_BAR[b.key] ?? "bg-slate-400"}`} aria-hidden />
            <span className="text-text-muted">{b.label}</span>
            <span className="tnum ms-auto font-bold" dir="ltr">{b.formatted}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
