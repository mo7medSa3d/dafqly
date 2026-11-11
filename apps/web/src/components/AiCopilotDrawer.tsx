"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowSquareOut,
  Check,
  Copy,
  Lightning,
  PaperPlaneTilt,
  Robot,
  Sparkle,
  UsersThree,
  WarningCircle,
  WhatsappLogo,
  X,
} from "@phosphor-icons/react";
import { formatEgp, type NotificationTone } from "@tahseel/core";
import { trpc } from "@/lib/trpc-client";

export type CopilotTab = "briefing" | "composer" | "assistant";

export interface OpenCopilotDetail {
  tab?: CopilotTab;
  debtorId?: string;
  tone?: NotificationTone;
}

export function openAiCopilot(detail: OpenCopilotDetail = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<OpenCopilotDetail>("tahseel:open-ai-copilot", { detail }));
}

interface DebtorScoreItem {
  debtorId: string;
  displayName: string;
  phoneE164: string;
  whatsappCapable: boolean;
  optedOut: boolean;
  riskFlag: boolean;
  outstandingMinor: string;
  overdueMinor: string;
  maxDaysOverdue: number;
  openInvoicesCount: number;
  healthScore: number;
  tier: "healthy" | "watch" | "at_risk" | "critical";
  priorityScore: number;
  recommendation: {
    actionKind: string;
    titleAr: string;
    titleEn: string;
    reasonAr: string;
    reasonEn: string;
    suggestedTone: NotificationTone;
    urgency: "low" | "medium" | "high" | "critical";
  };
}

interface OverviewPayload {
  todayIso: string;
  businessName: string;
  healthStatus: "strong" | "attention" | "urgent";
  headlineAr: string;
  headlineEn: string;
  summaryAr: string;
  summaryEn: string;
  metrics: {
    totalOutstandingMinor: string;
    overdueMinor: string;
    collectedThisMonthMinor: string;
    collectionRate: number;
    dsoDays: number;
    pendingClaimsCount: number;
    openDisputesCount: number;
    humanIntentsCount: number;
    upcomingChequesCount: number;
    bouncedChequesCount: number;
  };
  topActions: DebtorScoreItem[];
  debtorScores: DebtorScoreItem[];
}

interface CopilotAnswer {
  answerAr: string;
  answerEn: string;
  suggestedDebtors: DebtorScoreItem[];
  quickLinks: { labelAr: string; labelEn: string; href: string }[];
}

function tierBadgeClass(tier: DebtorScoreItem["tier"]) {
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

export function AiCopilotDrawer({
  isOpen,
  onClose,
  locale,
  initialTab = "briefing",
  initialDebtorId,
  initialTone,
}: {
  isOpen: boolean;
  onClose: () => void;
  locale: string;
  initialTab?: CopilotTab;
  initialDebtorId?: string;
  initialTone?: NotificationTone;
}) {
  const isEn = locale === "en";
  const [tab, setTab] = useState<CopilotTab>(initialTab);
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);

  // Composer state
  const [selectedDebtorId, setSelectedDebtorId] = useState<string>(initialDebtorId ?? "");
  const [tone, setTone] = useState<NotificationTone>(initialTone ?? "polite");
  const [msgLocale, setMsgLocale] = useState<"ar" | "en">(isEn ? "en" : "ar");
  const [draftText, setDraftText] = useState("");
  const [suggestedSendTime, setSuggestedSendTime] = useState("");
  const [generatingMsg, setGeneratingMsg] = useState(false);
  const [copied, setCopied] = useState(false);

  // Q&A Copilot state
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [copilotAnswer, setCopilotAnswer] = useState<CopilotAnswer | null>(null);

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (initialDebtorId) setSelectedDebtorId(initialDebtorId);
    if (initialTone) setTone(initialTone);
  }, [initialDebtorId, initialTone]);

  const loadOverview = useCallback(async () => {
    setLoadingOverview(true);
    try {
      const data = await trpc.intelligence.overview.query({ syncNotifications: false });
      const typed = data as OverviewPayload;
      setOverview(typed);
      if (!selectedDebtorId && typed.debtorScores.length > 0) {
        const firstOpen =
          typed.topActions[0] ??
          typed.debtorScores.find((d) => BigInt(d.outstandingMinor) > 0n) ??
          typed.debtorScores[0];
        if (firstOpen) {
          setSelectedDebtorId(firstOpen.debtorId);
          if (!initialTone) setTone(firstOpen.recommendation.suggestedTone);
        }
      }
    } catch {
      // Keep UI graceful on error
    } finally {
      setLoadingOverview(false);
    }
  }, [selectedDebtorId, initialTone]);

  useEffect(() => {
    if (isOpen) {
      void loadOverview();
    }
  }, [isOpen, loadOverview]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  const activeDebtor = useMemo(
    () => overview?.debtorScores.find((d) => d.debtorId === selectedDebtorId) ?? null,
    [overview, selectedDebtorId],
  );

  const handleSelectDebtorForComposer = (d: DebtorScoreItem) => {
    setSelectedDebtorId(d.debtorId);
    setTone(d.recommendation.suggestedTone);
    setDraftText("");
    setTab("composer");
  };

  const handleGenerateMessage = async () => {
    if (!activeDebtor) return;
    const amountMinorNum = Math.max(100, Number(BigInt(activeDebtor.outstandingMinor)));
    setGeneratingMsg(true);
    try {
      const res = await trpc.aiWorkspace.generateNotification.mutate({
        debtorId: activeDebtor.debtorId,
        debtorName: activeDebtor.displayName,
        amountMinor: amountMinorNum,
        daysOverdue: activeDebtor.maxDaysOverdue,
        dueDate: overview?.todayIso ?? new Date().toISOString().slice(0, 10),
        riskFlag: activeDebtor.riskFlag,
        tone,
        locale: msgLocale,
      });
      setDraftText(res.notificationText);
      setSuggestedSendTime(res.suggestedSendTime);
    } catch {
      // Non-fatal
    } finally {
      setGeneratingMsg(false);
    }
  };

  const handleCopyDraft = async () => {
    if (!draftText) return;
    try {
      await navigator.clipboard.writeText(draftText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard failures in restricted browsers
    }
  };

  const runCopilotIntent = async (
    intent: "daily_summary" | "priority_customers" | "action_plan" | "inbox_triage" | "custom_question",
    customText?: string,
  ) => {
    setAsking(true);
    try {
      const res = await trpc.intelligence.askCopilot.mutate({
        intent,
        question: customText,
        locale: isEn ? "en" : "ar",
      });
      setCopilotAnswer(res as CopilotAnswer);
    } catch {
      // Non-fatal
    } finally {
      setAsking(false);
    }
  };

  if (!isOpen) return null;

  const waHref =
    activeDebtor && !activeDebtor.optedOut && draftText
      ? `https://wa.me/${activeDebtor.phoneE164.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(draftText)}`
      : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" data-testid="ai-copilot-drawer">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-navy-950/55 backdrop-blur-xs transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over Panel */}
      <aside className="relative z-10 flex h-full w-full max-w-[480px] flex-col border-s border-border bg-surface shadow-2xl">
        {/* Top Header */}
        <div className="flex items-center justify-between border-b border-border/70 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-fg">
              <Sparkle size={18} weight="fill" aria-hidden />
            </span>
            <div>
              <h2 className="text-sm font-bold text-text">
                {isEn ? "DAFQLY AI Copilot" : "مساعد دفقلي الذكي"}
              </h2>
              <p className="text-[11px] text-text-muted">
                {isEn ? "Briefings, customer priority & smart drafts" : "ملخصات يومية، أولويات العملاء وصياغة التنبيهات"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={isEn ? "Close" : "إغلاق"}
            className="flex size-8 items-center justify-center rounded-full border border-border/70 text-text-muted transition-colors hover:bg-surface-muted hover:text-text"
          >
            <X size={16} weight="fill" aria-hidden />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="grid grid-cols-3 gap-1 border-b border-border/60 bg-surface-muted/40 p-2">
          {(
            [
              { id: "briefing", labelEn: "Briefing", labelAr: "الملخص", Icon: Lightning },
              { id: "composer", labelEn: "Smart Draft", labelAr: "صياغة رسالة", Icon: WhatsappLogo },
              { id: "assistant", labelEn: "Ask AI", labelAr: "اسأل المساعد", Icon: Robot },
            ] as const
          ).map(({ id, labelEn, labelAr, Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`flex items-center justify-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-bold transition-all ${
                tab === id
                  ? "bg-surface text-primary shadow-xs"
                  : "text-text-muted hover:text-text"
              }`}
            >
              <Icon size={14} weight="fill" aria-hidden />
              <span>{isEn ? labelEn : labelAr}</span>
            </button>
          ))}
        </div>

        {/* Tab Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {tab === "briefing" && (
            <div className="flex flex-col gap-4">
              {loadingOverview && !overview ? (
                <p className="py-10 text-center text-xs text-text-muted">
                  {isEn ? "Analyzing workspace..." : "جاري تحليل بيانات التحصيل..."}
                </p>
              ) : overview ? (
                <>
                  {/* Executive Summary Card */}
                  <div className="rounded-2xl border border-border bg-callout/50 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-[11px] font-bold text-primary">
                        <Sparkle size={12} weight="fill" aria-hidden />
                        {isEn ? "Executive Briefing" : "الملخص التنفيذي"}
                      </span>
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                          overview.healthStatus === "urgent"
                            ? "bg-status-overdue-bg text-status-overdue-fg"
                            : overview.healthStatus === "attention"
                              ? "bg-status-due-bg text-status-due-fg"
                              : "bg-status-paid-bg text-status-paid-fg"
                        }`}
                      >
                        {overview.healthStatus === "urgent"
                          ? isEn
                            ? "Needs Urgent Action"
                            : "يتطلب تدخلاً عاجلاً"
                          : overview.healthStatus === "attention"
                            ? isEn
                              ? "Needs Follow-up"
                              : "يحتاج متابعة"
                            : isEn
                              ? "Healthy"
                              : "أداء مستقر"}
                      </span>
                    </div>
                    <h3 className="mt-2.5 text-sm font-bold text-text">
                      {isEn ? overview.headlineEn : overview.headlineAr}
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-text-muted">
                      {isEn ? overview.summaryEn : overview.summaryAr}
                    </p>
                    <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border/50 pt-3 text-center">
                      <div>
                        <p className="text-[10px] text-text-muted">{isEn ? "Collection" : "نسبة التحصيل"}</p>
                        <p className="text-sm font-bold text-text">{overview.metrics.collectionRate}%</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-text-muted">{isEn ? "DSO" : "متوسط التحصيل"}</p>
                        <p className="text-sm font-bold text-text">
                          {overview.metrics.dsoDays} {isEn ? "d" : "ي"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-text-muted">{isEn ? "Overdue" : "المتأخرات"}</p>
                        <p className="text-sm font-bold text-status-overdue-fg">
                          {formatEgp(BigInt(overview.metrics.overdueMinor))}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Top Priority Customer Suggestions */}
                  <div>
                    <div className="mb-2.5 flex items-center justify-between">
                      <h4 className="flex items-center gap-1.5 text-xs font-bold text-text">
                        <UsersThree size={15} weight="fill" className="text-primary" aria-hidden />
                        {isEn ? "Recommended Customer Actions" : "اقتراحات متابعة العملاء"}
                      </h4>
                      <span className="text-[11px] text-text-muted">
                        {overview.topActions.length} {isEn ? "priority" : "أولوية"}
                      </span>
                    </div>

                    {overview.topActions.length === 0 ? (
                      <div className="rounded-xl border border-border/70 bg-surface-muted/40 p-4 text-center text-xs text-text-muted">
                        {isEn
                          ? "No urgent customer follow-ups right now."
                          : "لا توجد متابعات عاجلة للعملاء حالياً."}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2.5">
                        {overview.topActions.map((d) => (
                          <div
                            key={d.debtorId}
                            className="rounded-xl border border-border bg-surface p-3.5 transition-colors hover:border-primary/40"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <Link
                                  href={`/${locale}/debtors/${d.debtorId}`}
                                  onClick={onClose}
                                  className="text-xs font-bold text-text hover:text-primary"
                                >
                                  {d.displayName}
                                </Link>
                                <p className="mt-0.5 text-[11px] text-text-muted">
                                  {formatEgp(BigInt(d.outstandingMinor))} {isEn ? "EGP" : "ج.م"}
                                  {d.maxDaysOverdue > 0 &&
                                    ` · ${isEn ? `${d.maxDaysOverdue}d overdue` : `متأخر ${d.maxDaysOverdue} يوم`}`}
                                </p>
                              </div>
                              <span
                                className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${tierBadgeClass(d.tier)}`}
                              >
                                {isEn ? `Health ${d.healthScore}` : `الصحة ${d.healthScore}/100`}
                              </span>
                            </div>

                            <p className="mt-2 text-xs font-semibold text-primary">
                              {isEn ? d.recommendation.titleEn : d.recommendation.titleAr}
                            </p>
                            <p className="mt-0.5 text-[11px] text-text-muted">
                              {isEn ? d.recommendation.reasonEn : d.recommendation.reasonAr}
                            </p>

                            <div className="mt-3 flex flex-wrap items-center gap-2">
                              <button
                                type="button"
                                onClick={() => handleSelectDebtorForComposer(d)}
                                className="inline-flex items-center gap-1.5 rounded-full bg-callout px-3 py-1 text-[11px] font-bold text-primary transition-opacity hover:opacity-85"
                              >
                                <Sparkle size={12} weight="fill" aria-hidden />
                                {isEn ? "Draft Reminder" : "صياغة تنبيه"}
                              </button>
                              <Link
                                href={`/${locale}/debtors/${d.debtorId}`}
                                onClick={onClose}
                                className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1 text-[11px] font-semibold text-text-muted hover:text-text"
                              >
                                <span>{isEn ? "Open File" : "ملف العميل"}</span>
                                <ArrowSquareOut size={11} weight="fill" aria-hidden />
                              </Link>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              ) : null}
            </div>
          )}

          {tab === "composer" && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-text-muted">
                  {isEn ? "Select Customer" : "اختر العميل"}
                </label>
                <select
                  value={selectedDebtorId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setSelectedDebtorId(id);
                    const found = overview?.debtorScores.find((d) => d.debtorId === id);
                    if (found) setTone(found.recommendation.suggestedTone);
                    setDraftText("");
                  }}
                  className="min-h-[42px] rounded-xl border border-border-strong/60 bg-surface px-3 text-xs font-medium text-text focus:border-primary focus:outline-none"
                >
                  {(overview?.debtorScores ?? []).map((d) => (
                    <option key={d.debtorId} value={d.debtorId}>
                      {d.displayName} — {formatEgp(BigInt(d.outstandingMinor))} {isEn ? "EGP" : "ج.م"}
                    </option>
                  ))}
                </select>
              </div>

              {activeDebtor?.optedOut && (
                <div className="flex items-center gap-2 rounded-xl bg-status-overdue-bg px-3 py-2 text-xs font-semibold text-status-overdue-fg">
                  <WarningCircle size={16} weight="fill" aria-hidden />
                  <span>
                    {isEn
                      ? "Customer opted out of reminders. Automated dispatch is blocked."
                      : "العميل أوقف استقبال التذكيرات — الإرسال التلقائي محظور."}
                  </span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-text-muted">
                    {isEn ? "Message Tone" : "نبرة الرسالة"}
                  </label>
                  <select
                    value={tone}
                    onChange={(e) => setTone(e.target.value as NotificationTone)}
                    className="min-h-[40px] rounded-xl border border-border-strong/60 bg-surface px-3 text-xs text-text focus:border-primary focus:outline-none"
                  >
                    <option value="friendly">{isEn ? "Friendly" : "ودية"}</option>
                    <option value="polite">{isEn ? "Polite" : "رسمية مهذبة"}</option>
                    <option value="firm">{isEn ? "Firm" : "حازمة"}</option>
                    <option value="urgent">{isEn ? "Urgent" : "عاجلة"}</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-text-muted">
                    {isEn ? "Language" : "لغة الرسالة"}
                  </label>
                  <select
                    value={msgLocale}
                    onChange={(e) => setMsgLocale(e.target.value as "ar" | "en")}
                    className="min-h-[40px] rounded-xl border border-border-strong/60 bg-surface px-3 text-xs text-text focus:border-primary focus:outline-none"
                  >
                    <option value="ar">العربية</option>
                    <option value="en">English</option>
                  </select>
                </div>
              </div>

              <button
                type="button"
                disabled={!activeDebtor || generatingMsg}
                onClick={() => void handleGenerateMessage()}
                className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-full bg-primary px-5 text-xs font-bold text-primary-fg transition-colors hover:bg-primary-hover disabled:opacity-50"
              >
                <Sparkle size={15} weight="fill" aria-hidden />
                <span>
                  {generatingMsg
                    ? isEn
                      ? "Generating..."
                      : "جاري الصياغة..."
                    : isEn
                      ? "Generate Smart Message"
                      : "صياغة الرسالة بالذكاء الاصطناعي"}
                </span>
              </button>

              {draftText && (
                <div className="flex flex-col gap-2.5 rounded-2xl border border-border bg-surface-muted/40 p-3.5">
                  <div className="flex items-center justify-between text-[11px] text-text-muted">
                    <span>
                      {isEn ? "Suggested send window:" : "أفضل وقت للإرسال:"} {suggestedSendTime}
                    </span>
                    <span className="rounded-full bg-callout px-2 py-0.5 font-bold text-primary">
                      {tone}
                    </span>
                  </div>
                  <textarea
                    rows={5}
                    value={draftText}
                    onChange={(e) => setDraftText(e.target.value)}
                    dir={msgLocale === "ar" ? "rtl" : "ltr"}
                    className="w-full rounded-xl border border-border-strong/60 bg-surface p-3 text-xs leading-relaxed text-text focus:border-primary focus:outline-none"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleCopyDraft()}
                      className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs font-semibold text-text hover:border-primary"
                    >
                      {copied ? <Check size={14} weight="fill" className="text-primary" /> : <Copy size={14} weight="fill" />}
                      <span>{copied ? (isEn ? "Copied" : "تم النسخ") : isEn ? "Copy" : "نسخ"}</span>
                    </button>
                    {waHref && (
                      <a
                        href={waHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-full bg-status-paid-bg px-3.5 py-1.5 text-xs font-bold text-status-paid-fg transition-opacity hover:opacity-90"
                      >
                        <WhatsappLogo size={14} weight="fill" aria-hidden />
                        <span>{isEn ? "Open WhatsApp" : "فتح واتساب"}</span>
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "assistant" && (
            <div className="flex flex-col gap-4">
              {/* Quick Intents */}
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    { id: "daily_summary", en: "Daily Briefing", ar: "ملخص اليوم" },
                    { id: "priority_customers", en: "Priority Customers", ar: "أهم العملاء" },
                    { id: "action_plan", en: "Action Plan", ar: "خطة العمل" },
                    { id: "inbox_triage", en: "Pending Queue", ar: "صندوق المراجعة" },
                  ] as const
                ).map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    disabled={asking}
                    onClick={() => void runCopilotIntent(chip.id)}
                    className="rounded-full border border-border bg-surface-muted/60 px-3 py-1.5 text-[11px] font-bold text-text transition-colors hover:border-primary hover:bg-callout hover:text-primary disabled:opacity-50"
                  >
                    {isEn ? chip.en : chip.ar}
                  </button>
                ))}
              </div>

              {/* Question Input */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!question.trim() || asking) return;
                  void runCopilotIntent("custom_question", question.trim());
                }}
                className="flex items-center gap-2"
              >
                <input
                  type="text"
                  data-testid="copilot-question-input"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder={
                    isEn ? "Ask about overdue customers, receipts, plans..." : "اسأل عن المتأخرين، الإيصالات، خطة اليوم..."
                  }
                  className="min-h-[42px] flex-1 rounded-xl border border-border-strong/60 bg-surface px-3.5 text-xs text-text placeholder:text-text-subtle focus:border-primary focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!question.trim() || asking}
                  aria-label={isEn ? "Ask" : "إرسال"}
                  className="flex size-[42px] shrink-0 items-center justify-center rounded-xl bg-primary text-primary-fg transition-colors hover:bg-primary-hover disabled:opacity-50"
                >
                  <PaperPlaneTilt size={16} weight="fill" aria-hidden />
                </button>
              </form>

              {asking && (
                <p className="text-center text-xs text-text-muted">
                  {isEn ? "Analyzing workspace metrics..." : "جاري قراءة مؤشرات مساحة العمل..."}
                </p>
              )}

              {copilotAnswer && !asking && (
                <div className="flex flex-col gap-3 rounded-2xl border border-border bg-callout/40 p-4">
                  <p className="whitespace-pre-line text-xs leading-relaxed text-text">
                    {isEn ? copilotAnswer.answerEn : copilotAnswer.answerAr}
                  </p>
                  {copilotAnswer.quickLinks.length > 0 && (
                    <div className="flex flex-wrap gap-2 border-t border-border/50 pt-3">
                      {copilotAnswer.quickLinks.map((lnk) => (
                        <Link
                          key={lnk.href}
                          href={`/${locale}${lnk.href}`}
                          onClick={onClose}
                          className="inline-flex items-center gap-1 rounded-full bg-surface px-3 py-1 text-[11px] font-bold text-primary shadow-2xs hover:bg-primary hover:text-primary-fg"
                        >
                          <span>{isEn ? lnk.labelEn : lnk.labelAr}</span>
                          <ArrowSquareOut size={11} weight="fill" aria-hidden />
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
