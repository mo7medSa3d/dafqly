"use client";

import Link from "next/link";
import {
  ArrowRight,
  ArrowLeft,
  CalendarCheck,
  ChartLineUp,
  Sparkle,
  UsersThree,
  WhatsappLogo,
} from "@phosphor-icons/react";
import { formatEgp } from "@tahseel/core";
import { useCurrency } from "./CurrencyContext";
import type { WorkspaceIntelligenceView } from "@/server/intelligence";
import { openAiCopilot } from "./AiCopilotDrawer";
import { VelocityAndConcentrationChart } from "./charts";

function tierClasses(tier: "healthy" | "watch" | "at_risk" | "critical") {
  switch (tier) {
    case "critical":
      return "bg-status-overdue-bg text-status-overdue-fg";
    case "at_risk":
      return "bg-status-due-bg text-status-due-fg";
    case "watch":
      return "bg-callout text-primary";
    default:
      return "bg-status-paid-bg text-status-paid-fg";
  }
}

export function DashboardIntelligence({
  locale,
  intel,
}: {
  locale: string;
  intel: WorkspaceIntelligenceView;
}) {
  const isEn = locale === "en";
  const { symbol: currencySymbol } = useCurrency();
  const top3 = intel.topActions.slice(0, 3);
  const DirArrow = isEn ? ArrowRight : ArrowLeft;
  const risk = intel.portfolioRisk;

  const badgeTone =
    intel.healthStatus === "urgent"
      ? "bg-status-overdue-bg text-status-overdue-fg"
      : intel.healthStatus === "attention"
        ? "bg-status-due-bg text-status-due-fg"
        : "bg-status-paid-bg text-status-paid-fg";

  const statusLabel =
    intel.healthStatus === "urgent"
      ? isEn
        ? "Urgent Attention"
        : "يتطلب إجراءً عاجلاً"
      : intel.healthStatus === "attention"
        ? isEn
          ? "Follow-up Needed"
          : "يحتاج متابعة"
        : isEn
          ? "Healthy Portfolio"
          : "محفظة مستقرة";

  return (
    <section
      data-testid="dashboard-ai-briefing"
      className="rounded-3xl border border-border bg-surface p-5 panel-shadow sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-callout text-primary">
            <Sparkle size={20} weight="fill" aria-hidden />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold text-primary">
                {isEn ? "AI Daily Briefing" : "الملخص التنفيذي الذكي"}
              </span>
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${badgeTone}`}>
                {statusLabel}
              </span>
              {risk && (
                <span className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2.5 py-0.5 text-[11px] font-bold text-text-muted">
                  <ChartLineUp size={12} weight="fill" className="text-primary" aria-hidden />
                  {isEn
                    ? `Velocity ${risk.velocityScore}/100`
                    : `سرعة التحصيل ${risk.velocityScore}/100`}
                </span>
              )}
            </div>
            <h2 className="mt-1 text-base font-extrabold text-text sm:text-lg">
              {isEn ? intel.headlineEn : intel.headlineAr}
            </h2>
            <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-text-muted sm:text-sm">
              {isEn ? intel.summaryEn : intel.summaryAr}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => openAiCopilot({ tab: "composer", mode: "installment" })}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-full border border-border bg-surface-muted/60 px-3.5 py-1.5 text-xs font-bold text-text transition-colors hover:border-primary hover:text-primary"
          >
            <CalendarCheck size={14} weight="fill" aria-hidden />
            <span>{isEn ? "Installment Planner" : "جدولة المديونيات"}</span>
          </button>
          <button
            type="button"
            onClick={() => openAiCopilot({ tab: "assistant" })}
            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-full bg-callout px-4 py-1.5 text-xs font-bold text-primary transition-colors hover:bg-primary hover:text-primary-fg"
          >
            <Sparkle size={14} weight="fill" aria-hidden />
            <span>{isEn ? "Open AI Window" : "فتح نافذة الذكاء الاصطناعي"}</span>
          </button>
        </div>
      </div>

      {/* Expressive 2026 Velocity Gauge, Concentration Bar & 14-Day Cash vs Risk Chart */}
      {risk && (
        <VelocityAndConcentrationChart
          velocityScore={risk.velocityScore}
          collectionRate={intel.metrics.collectionRate}
          dsoDays={intel.metrics.dsoDays}
          topDebtorSharePct={risk.topDebtorSharePct}
          top3ConcentrationPct={risk.top3ConcentrationPct}
          expected14dFormatted={formatEgp(BigInt(risk.expectedNext14DaysMinor))}
          atRiskFormatted={formatEgp(BigInt(risk.atRiskReceivablesMinor))}
          expected14dMinor={BigInt(risk.expectedNext14DaysMinor)}
          atRiskMinor={BigInt(risk.atRiskReceivablesMinor)}
          isEn={isEn}
        />
      )}

      {top3.length > 0 && (
        <div className="mt-5 border-t border-border/60 pt-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-bold text-text">
              <UsersThree size={15} weight="fill" className="text-primary" aria-hidden />
              {isEn ? "Top Suggested Follow-ups" : "أبرز اقتراحات متابعة العملاء"}
            </span>
            <Link
              href={`/${locale}/debtors`}
              className="inline-flex items-center gap-1 text-xs font-bold text-link hover:underline"
            >
              <span>{isEn ? "All customers" : "كل العملاء"}</span>
              <DirArrow size={13} weight="fill" aria-hidden />
            </Link>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            {top3.map((d) => (
              <div
                key={d.debtorId}
                className="flex flex-col justify-between rounded-2xl border border-border/80 bg-surface-muted/35 p-4 transition-colors hover:border-primary/40"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      href={`/${locale}/debtors/${d.debtorId}`}
                      className="line-clamp-1 text-sm font-bold text-text hover:text-primary"
                    >
                      {d.displayName}
                    </Link>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${tierClasses(d.tier)}`}>
                      {d.healthScore}/100
                    </span>
                  </div>
                  <p className="mt-1 text-xs font-semibold text-text-muted">
                    <span className="tnum text-text" dir="ltr">
                      {formatEgp(BigInt(d.outstandingMinor))}
                    </span>{" "}
                    {currencySymbol}
                    {d.maxDaysOverdue > 0 && (
                      <span className="text-status-overdue-fg">
                        {" "}
                        · {isEn ? `${d.maxDaysOverdue}d overdue` : `متأخر ${d.maxDaysOverdue} ي`}
                      </span>
                    )}
                  </p>
                  <p className="mt-2 text-xs font-bold text-primary">
                    {isEn ? d.recommendation.titleEn : d.recommendation.titleAr}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-text-muted">
                    {isEn ? d.recommendation.reasonEn : d.recommendation.reasonAr}
                  </p>
                </div>

                <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/50 pt-2.5">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        openAiCopilot({
                          tab: "composer",
                          debtorId: d.debtorId,
                          tone: d.recommendation.suggestedTone,
                          mode:
                            d.recommendation.actionKind === "offer_installment_plan"
                              ? "installment"
                              : "reminder",
                        })
                      }
                      className="inline-flex items-center gap-1 rounded-full bg-surface px-3 py-1 text-[11px] font-bold text-primary shadow-2xs transition-colors hover:bg-primary hover:text-primary-fg"
                    >
                      <WhatsappLogo size={13} weight="fill" aria-hidden />
                      <span>
                        {d.recommendation.actionKind === "offer_installment_plan"
                          ? isEn
                            ? "Plan Installments"
                            : "جدولة أقساط"
                          : isEn
                            ? "Smart Draft"
                            : "صياغة تنبيه"}
                      </span>
                    </button>
                  </div>
                  <Link
                    href={`/${locale}/debtors/${d.debtorId}`}
                    className="text-[11px] font-semibold text-text-muted hover:text-text"
                  >
                    {isEn ? "Details" : "التفاصيل"}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
