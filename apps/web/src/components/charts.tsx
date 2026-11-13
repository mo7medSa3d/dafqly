"use client";
import { useState } from "react";
import { useLocale } from "next-intl";
import { WarningCircle, Table as TableIcon } from "@phosphor-icons/react";
import { currencyMinorExponent, formatPct, formatDso } from "@tahseel/core";
import { useCurrency } from "./CurrencyContext";

export interface ForecastWeek { weekStart: string; expectedMinor: number; conservativeMinor: number }

export function axisLabel(minor: number, isAr: boolean, currency: string = "EGP"): string {
  const major = minor / 10 ** currencyMinorExponent(currency);
  const loc = isAr ? "ar-EG" : "en-US";
  if (major >= 1000) {
    const k = major / 1000;
    return `${k.toLocaleString(loc, { maximumFractionDigits: k < 10 ? 1 : 0 })}k`;
  }
  if (major >= 10) return Math.round(major).toLocaleString(loc);
  return major.toLocaleString(loc, { maximumFractionDigits: 1 });
}

/** Smooth cubic Catmull-Rom-style SVG path through (x, y) points. */
function smoothPath(pts: { x: number; y: number }[]): string {
  if (!pts.length) return "";
  if (pts.length === 1) return `M${pts[0]!.x},${pts[0]!.y}`;
  let d = `M${pts[0]!.x},${pts[0]!.y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i]!;
    const p1 = pts[i + 1]!;
    const cx = (p0.x + p1.x) / 2;
    d += ` C${cx},${p0.y} ${cx},${p1.y} ${p1.x},${p1.y}`;
  }
  return d;
}

/** Responsive, interactive SVG area/line chart. Values are deterministic forecast outputs from the ledger service. */
export function ForecastChart({ weeks, expectedLabel, conservativeLabel }: {
  weeks: ForecastWeek[]; expectedLabel: string; conservativeLabel: string;
}) {
  const isAr = useLocale() === "ar";
  const { currency, symbol, formatAmountOnly } = useCurrency();
  const format = (minor: number) => formatAmountOnly(BigInt(minor));
  const [showTable, setShowTable] = useState(false);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const max = Math.max(1, ...weeks.map((w) => w.expectedMinor), ...weeks.map((w) => w.conservativeMinor));
  const x = (i: number) => 44 + (i * 692) / Math.max(1, weeks.length - 1);
  const y = (v: number) => 188 - (v / max) * 148;
  const expectedPts = weeks.map((w, i) => ({ x: x(i), y: y(w.expectedMinor) }));
  const conservativePts = weeks.map((w, i) => ({ x: x(i), y: y(w.conservativeMinor) }));
  const expectedPath = smoothPath(expectedPts);
  const conservativePath = smoothPath(conservativePts);
  const expectedTotal = weeks.reduce((sum, w) => sum + w.expectedMinor, 0);
  const conservativeTotal = weeks.reduce((sum, w) => sum + w.conservativeMinor, 0);
  const peak = weeks.reduce<ForecastWeek | null>((best, w) => !best || w.expectedMinor > best.expectedMinor ? w : best, null);

  if (!weeks.length) return <p className="py-8 text-center text-sm text-text-muted">{isAr ? "لا توجد نقاط توقع متاحة بعد." : "No forecast points available yet."}</p>;

  const hovered = hoveredIdx !== null ? weeks[hoveredIdx] : null;
  const hoveredLeftPct = hoveredIdx !== null ? (x(hoveredIdx) / 780) * 100 : 50;

  return <div className="flex flex-col gap-4">
    <div className="grid grid-cols-3 gap-2.5">
      <Kpi label={isAr ? "إجمالي متوقع" : "Expected total"} value={format(expectedTotal)} tone="primary" symbol={symbol}/>
      <Kpi label={isAr ? "سيناريو محافظ" : "Conservative"} value={format(conservativeTotal)} tone="positive" symbol={symbol}/>
      <Kpi label={isAr ? "أعلى أسبوع" : "Peak week"} value={peak ? format(peak.expectedMinor) : format(0)} tone="default" symbol={symbol}/>
    </div>
    <div className="relative rounded-2xl border border-border/80 bg-surface-muted/20 p-3.5 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs font-semibold text-text-muted">
        <span className="flex items-center gap-2"><i className="size-2.5 rounded-full bg-primary ring-2 ring-primary/20"/>{expectedLabel}</span>
        <span className="flex items-center gap-2"><i className="size-2.5 rounded-full bg-emerald-500 ring-2 ring-emerald-500/20"/>{conservativeLabel}</span>
        <span className="ms-auto rounded-full bg-surface px-2.5 py-0.5 text-[11px] font-bold text-text-muted border border-border/60">{isAr ? "٨ أسابيع" : "8-week horizon"}</span>
      </div>
      <div className="relative" onMouseLeave={() => setHoveredIdx(null)}>
        {hovered && hoveredIdx !== null && (
          <div
            className="pointer-events-none absolute top-0 z-20 -translate-x-1/2 rounded-xl border border-border bg-surface/95 px-3 py-2 text-xs shadow-lg backdrop-blur-sm"
            style={{ left: `${Math.min(84, Math.max(16, hoveredLeftPct))}%` }}
          >
            <p className="font-bold text-text-muted" dir="ltr">{hovered.weekStart}</p>
            <p className="mt-1 flex items-center justify-between gap-3 font-extrabold text-primary" dir="ltr">
              <span>{format(hovered.expectedMinor)} {symbol}</span>
            </p>
            <p className="flex items-center justify-between gap-3 font-bold text-emerald-600" dir="ltr">
              <span>{format(hovered.conservativeMinor)} {symbol}</span>
            </p>
          </div>
        )}
        <svg viewBox="0 0 780 225" role="img" aria-label={isAr ? "رسم توقع التدفقات النقدية خلال ثمانية أسابيع" : "Eight-week cash flow projection"} className="h-[225px] w-full overflow-visible">
          <defs>
            <linearGradient id="cash-area" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.28"/>
              <stop offset="100%" stopColor="currentColor" stopOpacity="0"/>
            </linearGradient>
          </defs>
          {[0, 1, 2, 3].map((i) => (
            <g key={i}>
              <line x1="44" x2="736" y1={40 + i * 49} y2={40 + i * 49} stroke="currentColor" opacity=".10" strokeDasharray="3 5"/>
              <text x="32" y={44 + i * 49} textAnchor="end" fill="currentColor" opacity=".52" fontSize="10" className="tnum">{axisLabel(max * (1 - i / 3), isAr, currency)}</text>
            </g>
          ))}
          <path d={`${expectedPath} L${x(weeks.length - 1)},188 L${x(0)},188 Z`} fill="url(#cash-area)" className="text-primary"/>
          <path d={expectedPath} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-primary"/>
          <path d={conservativePath} fill="none" stroke="currentColor" strokeWidth="2.5" strokeDasharray="6 5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-500"/>
          {hoveredIdx !== null && (
            <line x1={x(hoveredIdx)} x2={x(hoveredIdx)} y1="36" y2="188" stroke="currentColor" strokeDasharray="3 3" opacity="0.35" className="text-primary"/>
          )}
          {weeks.map((w, i) => {
            const active = hoveredIdx === i;
            return (
              <g key={w.weekStart}>
                <circle cx={x(i)} cy={y(w.conservativeMinor)} r={active ? 4.5 : 0} fill="currentColor" className="text-emerald-500 transition-all"/>
                <circle cx={x(i)} cy={y(w.expectedMinor)} r={active ? 6 : 4} fill={active ? "var(--surface)" : "currentColor"} stroke="currentColor" strokeWidth={active ? 3 : 0} className="text-primary transition-all"/>
                <text x={x(i)} y="212" textAnchor="middle" fill="currentColor" opacity={active ? 0.95 : 0.58} fontWeight={active ? 700 : 400} fontSize="10">
                  {new Date(`${w.weekStart}T00:00:00`).toLocaleDateString(isAr ? "ar-EG" : "en-GB", { day: "numeric", month: "short" })}
                </text>
                <rect
                  x={x(i) - 36} y="24" width="72" height="190" fill="transparent" className="cursor-pointer"
                  onMouseEnter={() => setHoveredIdx(i)}
                />
              </g>
            );
          })}
        </svg>
      </div>
    </div>
    <button type="button" onClick={() => setShowTable((v) => !v)} className="inline-flex self-end items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs font-bold text-text-muted transition-colors hover:border-primary/50 hover:text-primary"><TableIcon size={15}/>{showTable ? (isAr ? "إخفاء التفاصيل" : "Hide detail") : (isAr ? "عرض القيم الأسبوعية" : "View weekly values")}</button>
    {showTable && <div className="overflow-x-auto rounded-xl border border-border"><table className="w-full text-start text-xs"><thead className="bg-surface-muted text-text-muted"><tr><th className="p-3">{isAr ? "الأسبوع" : "Week"}</th><th className="p-3">{expectedLabel}</th><th className="p-3">{conservativeLabel}</th></tr></thead><tbody className="divide-y divide-border">{weeks.map((w) => <tr key={w.weekStart} className="hover:bg-surface-muted/40"><td className="p-3" dir="ltr">{w.weekStart}</td><td className="p-3 tnum font-bold text-text" dir="ltr">{format(w.expectedMinor)} {symbol}</td><td className="p-3 tnum font-bold text-text" dir="ltr">{format(w.conservativeMinor)} {symbol}</td></tr>)}</tbody></table></div>}
  </div>;
}

export interface AgingBucket { key: string; label: string; amountMinor: number; formatted: string }
export function AgingBar({ buckets }: { buckets: AgingBucket[] }) {
  const isAr = useLocale() === "ar";
  const { symbol } = useCurrency();
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const total = buckets.reduce((sum, b) => sum + b.amountMinor, 0);
  const serious = buckets.filter((b) => ["31-60", "60+"].includes(b.key)).reduce((sum, b) => sum + b.amountMinor, 0);
  const severePct = total ? Math.round(serious / total * 100) : 0;
  const tones = ["bg-emerald-500", "bg-primary", "bg-amber-500", "bg-orange-500", "bg-red-500"];
  return <div className="flex flex-col gap-4">
    {severePct > 0 && <div className="flex items-center gap-2 rounded-xl border border-danger/20 bg-danger-bg px-3.5 py-2.5 text-xs font-bold text-danger"><WarningCircle size={16} weight="fill"/>{isAr ? `${severePct}% من الرصيد تجاوز ٣٠ يوماً` : `${severePct}% of receivables are over 30 days overdue`}</div>}
    <div className="flex h-4 w-full gap-0.5 overflow-hidden rounded-full bg-surface-muted p-0.5" role="img" aria-label={isAr ? "توزيع أعمار المستحقات" : "Receivables aging distribution"}>
      {buckets.map((b, i) => (
        <span
          key={b.key}
          onMouseEnter={() => setHoveredKey(b.key)}
          onMouseLeave={() => setHoveredKey(null)}
          className={`${tones[i] ?? "bg-primary"} h-full rounded-full transition-opacity ${hoveredKey && hoveredKey !== b.key ? "opacity-45" : "opacity-100"}`}
          style={{ width: `${total ? b.amountMinor / total * 100 : 0}%` }}
          title={`${b.label}: ${b.formatted} ${symbol}`}
        />
      ))}
    </div>
    <div className="flex flex-col gap-2.5">
      {buckets.map((b, i) => {
        const pct = total ? Math.round(b.amountMinor / total * 100) : 0;
        const active = hoveredKey === b.key;
        return (
          <div
            key={b.key}
            onMouseEnter={() => setHoveredKey(b.key)}
            onMouseLeave={() => setHoveredKey(null)}
            className={`grid grid-cols-[minmax(76px,1fr)_minmax(90px,2fr)_auto] items-center gap-3 rounded-lg px-2 py-1 text-xs transition-colors ${active ? "bg-surface-muted/70" : ""}`}
          >
            <div className="flex items-center gap-2 font-bold text-text"><i className={`size-2.5 shrink-0 rounded-sm ${tones[i] ?? "bg-primary"}`}/>{b.label}</div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-muted"><div className={`h-full rounded-full ${tones[i] ?? "bg-primary"} transition-[width] duration-300`} style={{ width: `${pct}%` }}/></div>
            <div className="text-end"><span className="tnum font-extrabold" dir="ltr">{b.formatted}</span><span className="ms-1.5 inline-block min-w-[2.2rem] text-text-muted" dir="ltr">{pct}%</span></div>
          </div>
        );
      })}
    </div>
  </div>;
}

export function VelocityAndConcentrationChart({ velocityScore, collectionRate, dsoDays, topDebtorSharePct, top3ConcentrationPct, expected14dFormatted, atRiskFormatted, isEn }: {
  velocityScore: number; collectionRate: number; dsoDays: number; topDebtorSharePct: number; top3ConcentrationPct: number;
  expected14dFormatted: string; atRiskFormatted: string; isEn: boolean;
}) {
  const { symbol } = useCurrency();
  const score = Math.max(0, Math.min(100, velocityScore));
  const safeTop = Math.max(0, Math.min(100, topDebtorSharePct));
  const safeTop3 = Math.max(safeTop, Math.min(100, top3ConcentrationPct));
  const r = 30;
  const circ = 2 * Math.PI * r;
  const dashOffset = circ - (score / 100) * circ;

  return <div className="mt-5 grid gap-4 border-t border-border/60 pt-4 lg:grid-cols-2">
    <div className="rounded-2xl border border-border/70 bg-surface-muted/30 p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-bold text-text-muted">{isEn ? "Collection velocity" : "سرعة التحصيل"}</p>
          <p className="mt-1 tnum text-3xl font-black text-text" dir="ltr">{score}<span className="ms-1 text-sm font-bold text-text-muted">/100</span></p>
          <span className="mt-1 inline-block rounded-full bg-callout px-2.5 py-0.5 text-[11px] font-bold text-primary">{isEn ? "Portfolio health" : "صحة المحفظة"}</span>
        </div>
        <svg width="76" height="76" viewBox="0 0 76 76" aria-hidden="true" className="shrink-0 -rotate-90">
          <circle cx="38" cy="38" r={r} fill="none" stroke="currentColor" strokeWidth="7" className="text-surface-muted" />
          <circle
            cx="38" cy="38" r={r} fill="none" stroke="currentColor" strokeWidth="7"
            strokeDasharray={circ} strokeDashoffset={dashOffset} strokeLinecap="round"
            className={score >= 70 ? "text-emerald-500" : score >= 45 ? "text-primary" : "text-amber-500"}
          />
        </svg>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border/50 pt-3 text-xs">
        <div><p className="text-text-muted">{isEn ? "Collection rate" : "معدل التحصيل"}</p><p className="mt-1 tnum text-lg font-extrabold" dir="ltr">{formatPct(collectionRate)}</p></div>
        <div><p className="text-text-muted">{isEn ? "Days sales outstanding" : "متوسط أيام التحصيل"}</p><p className="mt-1 tnum text-lg font-extrabold" dir="ltr">{formatDso(dsoDays)}d</p></div>
      </div>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-2xl border border-border/70 bg-surface p-4">
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-emerald-500" />
          <p className="text-xs font-bold text-text-muted">{isEn ? "Expected next 14 days" : "المتوقع خلال ١٤ يوماً"}</p>
        </div>
        <p className="mt-2 tnum text-xl font-black text-text" dir="ltr">{expected14dFormatted}</p>
        <span className="text-[11px] text-text-muted">{symbol} · {isEn ? "Statistical estimate" : "تقدير إحصائي"}</span>
      </div>
      <div className="rounded-2xl border border-border/70 bg-surface p-4">
        <div className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-danger" />
          <p className="text-xs font-bold text-text-muted">{isEn ? "Receivables at risk" : "مستحقات معرضة للمخاطر"}</p>
        </div>
        <p className="mt-2 tnum text-xl font-black text-text" dir="ltr">{atRiskFormatted}</p>
        <span className="text-[11px] text-text-muted">{symbol} · {isEn ? "Risk-scored balance" : "رصيد وفق مؤشرات المخاطر"}</span>
      </div>
      <div className="rounded-2xl border border-border/70 bg-surface p-4 sm:col-span-2"><div className="flex justify-between gap-2 text-xs font-bold"><span>{isEn ? "Top 3 customer concentration" : "تركيز أعلى ٣ عملاء"}</span><span className="tnum font-black text-text" dir="ltr">{safeTop3}%</span></div><Progress value={safeTop3} tone={safeTop3 > 55 ? "danger" : "primary"}/><p className="mt-2 text-[11px] text-text-muted">{isEn ? `Largest account: ${safeTop}% of receivables` : `أكبر عميل يمثل ${safeTop}% من المستحقات`}</p></div>
    </div>
  </div>;
}

export function ReminderFunnelChart({ sent, delivered, replied, paidWithin7d, labels }: {
  sent: number; delivered: number; replied: number; paidWithin7d: number; labels: { sent: string; delivered: string; replied: string; paidWithin7d: string };
}) {
  const isAr = useLocale() === "ar";
  const base = Math.max(sent, 1);
  const stages = [
    { key: "sent", label: labels.sent, value: sent, pct: sent > 0 ? 100 : 0, color: "bg-slate-400" },
    { key: "delivered", label: labels.delivered, value: delivered, pct: Math.round(delivered / base * 100), color: "bg-primary" },
    { key: "replied", label: labels.replied, value: replied, pct: Math.round(replied / base * 100), color: "bg-amber-500" },
    { key: "paid", label: labels.paidWithin7d, value: paidWithin7d, pct: Math.round(paidWithin7d / base * 100), color: "bg-emerald-500" },
  ];
  return <div className="flex flex-col gap-3.5">{stages.map((s) => <div key={s.key} data-testid={`perf-${s.key === "paid" ? "paid" : s.key}`} className="flex flex-col gap-1.5"><div className="flex items-center justify-between gap-3 text-xs"><span className="font-semibold text-text-muted">{s.label}</span><span className="tnum font-extrabold text-text" dir="ltr">{s.value.toLocaleString(isAr ? "ar-EG" : "en-US")} <span className="ms-1 rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-bold text-text-muted">{s.pct}%</span></span></div><div className="h-2.5 overflow-hidden rounded-full bg-surface-muted"><div className={`h-full rounded-full ${s.color} transition-[width] duration-500`} style={{ width: `${Math.max(0, Math.min(100, s.pct))}%` }}/></div></div>)}<p className="border-t border-border pt-3 text-[11px] leading-relaxed text-text-muted">{isAr ? "النسب محسوبة من عدد الرسائل المرسلة. السداد خلال ٧ أيام ارتباط زمني ولا يثبت وحده أن الرسالة سببت السداد." : "Rates are calculated against messages sent. Payment within 7 days is a time association, not proof that the reminder caused payment."}</p></div>;
}

function Kpi({ label, value, tone: _tone, symbol }: { label: string; value: string; tone: "primary" | "positive" | "default"; symbol: string }) {
  return <div className="min-w-0 rounded-xl border border-border/60 bg-surface p-3"><p className="truncate text-[10px] font-bold text-text-muted">{label}</p><p className="mt-1 truncate tnum text-sm font-black text-text" dir="ltr">{value} <span className="text-[10px] text-text-muted">{symbol}</span></p></div>;
}
function Progress({ value, tone }: { value: number; tone: "primary" | "danger" }) { return <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-muted"><div className={`h-full rounded-full transition-[width] duration-500 ${tone === "danger" ? "bg-danger" : "bg-primary"}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }}/></div>; }
