"use client";
import { useLocale } from "next-intl";
import { currencyMinorExponent, formatPct } from "@tahseel/core";

export function axisLabel(minor: number, isAr: boolean, currency = "EGP"): string {
  if (!Number.isFinite(minor)) return "0";
  const major = minor / 10 ** currencyMinorExponent(currency);
  const loc = isAr ? "ar-EG" : "en-US";
  if (major >= 1000) {
    const k = major / 1000;
    return `${k.toLocaleString(loc, { maximumFractionDigits: k < 10 ? 1 : 0 })}k`;
  }
  if (major >= 10) return Math.round(major).toLocaleString(loc);
  return major.toLocaleString(loc, { maximumFractionDigits: 1 });
}

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
  const base = sent > 0 ? sent : 1;
  const stages = [
    { key: "sent", label: labels.sent, value: sent, pct: sent > 0 ? 100 : 0, pctText: formatPct(sent > 0 ? 1 : 0), color: "var(--chart-3)" },
    { key: "delivered", label: labels.delivered, value: delivered, pct: sent > 0 ? (delivered / base) * 100 : 0, pctText: formatPct(sent > 0 ? delivered / base : 0), color: "var(--chart-2)" },
    { key: "replied", label: labels.replied, value: replied, pct: sent > 0 ? (replied / base) * 100 : 0, pctText: formatPct(sent > 0 ? replied / base : 0), color: "var(--chart-1)" },
    { key: "paid", label: labels.paidWithin7d, value: paidWithin7d, pct: sent > 0 ? (paidWithin7d / base) * 100 : 0, pctText: formatPct(sent > 0 ? paidWithin7d / base : 0), color: "var(--primary)" },
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
                {s.value.toLocaleString(isAr ? "ar-EG" : "en-US")} <span className="text-muted-foreground">· {s.pctText}</span>
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
