"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowsInSimple,
  ArrowsOutSimple,
  ArrowSquareOut,
  CalendarCheck,
  ChartLineUp,
  Check,
  ClockCountdown,
  Copy,
  Cpu,
  Lightning,
  Minus,
  PaperPlaneTilt,
  Robot,
  ShieldWarning,
  Sparkle,
  UsersThree,
  WarningCircle,
  WhatsappLogo,
  X,
} from "@phosphor-icons/react";
import { formatPct, formatDso, type NotificationTone } from "@tahseel/core";
import { trpc } from "@/lib/trpc-client";
import { useCurrency } from "./CurrencyContext";

export type CopilotTab = "briefing" | "composer" | "assistant";
export type ComposerMode = "reminder" | "installment";

export interface OpenCopilotDetail {
  tab?: CopilotTab;
  debtorId?: string;
  tone?: NotificationTone;
  mode?: ComposerMode;
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

interface PortfolioRiskPayload {
  topDebtorSharePct: number;
  topDebtorName: string | null;
  top3ConcentrationPct: number;
  concentrationLevel: "diversified" | "moderate" | "high_concentration";
  overdueSeverityRatioPct: number;
  atRiskReceivablesMinor: string;
  expectedNext14DaysMinor: string;
  velocityScore: number;
  insightsAr: string[];
  insightsEn: string[];
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
  portfolioRisk?: PortfolioRiskPayload;
  topActions: DebtorScoreItem[];
  debtorScores: DebtorScoreItem[];
}

interface InstallmentPlanPayload {
  debtorName: string;
  businessName: string;
  totalMinor: string;
  formattedTotal: string;
  installmentsCount: number;
  interval: "weekly" | "biweekly" | "monthly";
  downPaymentPct: number;
  tranches: {
    sequence: number;
    labelAr: string;
    labelEn: string;
    dueDate: string;
    amountMinor: string;
    formattedAmount: string;
    isDownPayment: boolean;
  }[];
  proposalTextAr: string;
  proposalTextEn: string;
  settled?: boolean;
  settledMessageAr?: string;
  settledMessageEn?: string;
}

interface ToolCallTraceItem {
  toolName: string;
  titleAr: string;
  titleEn: string;
  status: "completed" | "failed";
  summaryAr: string;
  summaryEn: string;
}

interface OptimalWindowView {
  canSend: boolean;
  isImmediateAllowed: boolean;
  localDateFormatted: string;
  localTimeFormatted: string;
  windowLabelAr: string;
  windowLabelEn: string;
  recommendedTone: NotificationTone;
  strategyReasonAr: string;
  strategyReasonEn: string;
  blockReasonAr: string | null;
  blockReasonEn: string | null;
}

interface CopilotAnswer {
  answerAr: string;
  answerEn: string;
  toolCalls?: ToolCallTraceItem[];
  matchedDebtor?: (DebtorScoreItem & { optimalWindow: OptimalWindowView }) | null;
  suggestedDebtors: DebtorScoreItem[];
  quickLinks: { labelAr: string; labelEn: string; href: string }[];
  conversationId: string;
  aiMode: "live" | "fallback";
  aiModel: string | null;
  aiFallbackReason: "provider_not_configured" | "daily_token_budget_exceeded" | "provider_error" | "empty_response" | null;
}


interface PersistedChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: CopilotAnswer["toolCalls"];
  aiMode?: "live" | "fallback";
  aiModel?: string | null;
  aiFallbackReason?: CopilotAnswer["aiFallbackReason"];
  matchedDebtor?: CopilotAnswer["matchedDebtor"];
  quickLinks?: CopilotAnswer["quickLinks"];
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
  initialMode = "reminder",
}: {
  isOpen: boolean;
  onClose: () => void;
  locale: string;
  initialTab?: CopilotTab;
  initialDebtorId?: string;
  initialTone?: NotificationTone;
  initialMode?: ComposerMode;
}) {
  const isEn = locale === "en";
  const router = useRouter();
  const { symbol: currencySymbol, formatAmountOnly } = useCurrency();
  const [tab, setTab] = useState<CopilotTab>(initialTab);
  const [composerMode, setComposerMode] = useState<ComposerMode>(initialMode);
  const [overview, setOverview] = useState<OverviewPayload | null>(null);
  const [loadingOverview, setLoadingOverview] = useState(false);

  // Pop-up Window state (Compact vs. Expanded vs. Minimized Pill)
  const [isExpanded, setIsExpanded] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);

  // Composer state
  const [selectedDebtorId, setSelectedDebtorId] = useState<string>(initialDebtorId ?? "");
  const [tone, setTone] = useState<NotificationTone>(initialTone ?? "polite");
  const [msgLocale, setMsgLocale] = useState<"ar" | "en">(isEn ? "en" : "ar");
  const [draftText, setDraftText] = useState("");
  const [draftGenerationMode, setDraftGenerationMode] = useState<"ai" | "rules">("rules");
  const [suggestedSendTime, setSuggestedSendTime] = useState("");
  const [generatingMsg, setGeneratingMsg] = useState(false);
  const [copied, setCopied] = useState(false);

  // Installment planner state
  const [installmentsCount, setInstallmentsCount] = useState<2 | 3 | 4 | 6>(3);
  const [interval, setInterval] = useState<"weekly" | "biweekly" | "monthly">("monthly");
  const [downPaymentPct, setDownPaymentPct] = useState<0 | 10 | 20 | 25 | 30 | 50>(25);
  const [installmentPlan, setInstallmentPlan] = useState<InstallmentPlanPayload | null>(null);

  // Smart Optimal-Time Reminder Dispatch & Schedule Optimization state
  const [dispatchingReminder, setDispatchingReminder] = useState(false);
  const [optimizingSchedule, setOptimizingSchedule] = useState(false);
  const [dispatchFeedback, setDispatchFeedback] = useState<{
    ok: boolean;
    messageAr: string;
    messageEn: string;
  } | null>(null);

  // Multi-turn Q&A Copilot state
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [_copilotAnswer, setCopilotAnswer] = useState<CopilotAnswer | null>(null);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [conversationList, setConversationList] = useState<{ id: string; title: string; updatedAt: string }[]>([]);
  // F-18: the server returns only the latest 20 conversations / 60
  // messages — keep the totals so the drawer can say what is hidden.
  const [conversationTotal, setConversationTotal] = useState(0);
  const [totalMessages, setTotalMessages] = useState(0);
  const [persistedMessages, setPersistedMessages] = useState<PersistedChatMessage[]>([]);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [copilotError, setCopilotError] = useState<string | null>(null);

  const loadCopilotConversations = useCallback(async () => {
    try {
      const res = await trpc.intelligence.listCopilotConversations.query();
      setConversationList(res.items);
      setConversationTotal(res.totalCount);
    } catch {
      // Conversation history is helpful but must not block the assistant.
    }
  }, []);

  useEffect(() => {
    if (isOpen && tab === "assistant") void loadCopilotConversations();
  }, [isOpen, tab, loadCopilotConversations]);

  useEffect(() => {
    if (tab === "assistant") {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [persistedMessages, asking, tab]);

  const startNewConversation = () => {
    setConversationId(undefined);
    setPersistedMessages([]);
    setTotalMessages(0);
    setCopilotAnswer(null);
    setQuestion("");
    setCopilotError(null);
    setStreamingMessageId(null);
  };

  const openSavedConversation = async (id: string) => {
    if (!id || id === conversationId || loadingConversation) return;
    setLoadingConversation(true);
    setCopilotError(null);
    try {
      const loaded = await trpc.intelligence.getCopilotConversation.query({ conversationId: id });
      setConversationId(loaded.id);
      setTotalMessages(loaded.totalMessages);
      setPersistedMessages(loaded.messages.map((message) => ({
        id: message.id,
        role: message.role === "assistant" ? "assistant" : "user",
        content: message.content,
      })));
      setCopilotAnswer(null);
      setQuestion("");
    } catch {
      setCopilotError(isEn ? "Could not load this conversation. Refresh and try again." : "تعذر تحميل المحادثة. حدّث القائمة وحاول مرة أخرى.");
    } finally {
      setLoadingConversation(false);
    }
  };

  const initialToneRef = useRef(initialTone);
  initialToneRef.current = initialTone;

  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (initialDebtorId) setSelectedDebtorId(initialDebtorId);
    if (initialTone) setTone(initialTone);
    if (initialMode) setComposerMode(initialMode);
    if (isOpen) setIsMinimized(false);
  }, [initialDebtorId, initialTone, initialMode, isOpen]);

  // Single-fetch overview per open session (no redundant re-fetches when switching selectedDebtorId)
  const loadOverview = useCallback(async () => {
    setLoadingOverview(true);
    try {
      const data = await trpc.intelligence.overview.query({ syncNotifications: false });
      const typed = data as OverviewPayload;
      setOverview(typed);
      setSelectedDebtorId((prevId) => {
        if (prevId) return prevId;
        const firstOpen =
          typed.topActions[0] ??
          typed.debtorScores.find((d) => BigInt(d.outstandingMinor) > 0n) ??
          typed.debtorScores[0];
        if (firstOpen && !initialToneRef.current) {
          setTone(firstOpen.recommendation.suggestedTone);
        }
        return firstOpen ? firstOpen.debtorId : "";
      });
    } catch {
      // Keep UI graceful on error
    } finally {
      setLoadingOverview(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && !overview) {
      void loadOverview();
    }
  }, [isOpen, overview, loadOverview]);

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

  const handleSelectDebtorForComposer = (d: DebtorScoreItem, mode: ComposerMode = "reminder") => {
    setSelectedDebtorId(d.debtorId);
    setTone(d.recommendation.suggestedTone);
    setComposerMode(mode);
    setDraftText("");
    setInstallmentPlan(null);
    setDispatchFeedback(null);
    setTab("composer");
  };

  const handleGenerateMessage = async () => {
    if (!activeDebtor) return;
    const amountMinorNum = Math.max(100, Number(BigInt(activeDebtor.outstandingMinor)));
    setGeneratingMsg(true);
    setDispatchFeedback(null);
    try {
      if (composerMode === "installment") {
        const res = await trpc.aiWorkspace.proposeInstallmentPlan.mutate({
          debtorId: activeDebtor.debtorId,
          debtorName: activeDebtor.displayName,
          totalMinor: amountMinorNum,
          installmentsCount,
          interval,
          downPaymentPct,
          startDateIso: overview?.todayIso ?? new Date().toISOString().slice(0, 10),
        });
        const typedPlan = res as InstallmentPlanPayload;
        setInstallmentPlan(typedPlan);
        if (typedPlan.settled) {
          // Settled account: no schedule to draft — the plan card shows the
          // settled notice instead.
          setDraftText("");
        } else {
          setDraftText(msgLocale === "en" ? typedPlan.proposalTextEn : typedPlan.proposalTextAr);
        }
        setDraftGenerationMode("rules");
        setSuggestedSendTime("10:30 AM (Africa/Cairo)");
      } else {
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
        setInstallmentPlan(null);
        setDraftText(res.notificationText);
        setDraftGenerationMode(res.generationMode === "ai" ? "ai" : "rules");
        setSuggestedSendTime(res.suggestedSendTime);
      }
    } catch {
      // Non-fatal
    } finally {
      setGeneratingMsg(false);
    }
  };

  const handleDispatchSmartReminder = async (debtorId: string, preferredTone?: NotificationTone) => {
    setDispatchingReminder(true);
    setDispatchFeedback(null);
    try {
      const res = await trpc.aiWorkspace.dispatchSmartReminder.mutate({
        debtorId,
        tone: preferredTone ?? tone,
      });
      if (!res.ok) {
        setDispatchFeedback({
          ok: false,
          messageAr: res.reasonAr ?? "تعذر جدولة التذكير لهذا الحساب.",
          messageEn: res.reasonEn ?? "Could not schedule reminder for this debtor.",
        });
      } else {
        if (res.messagePreviewAr || res.messagePreviewEn) {
          setDraftText(msgLocale === "en" ? (res.messagePreviewEn ?? "") : (res.messagePreviewAr ?? ""));
          setSuggestedSendTime(`${res.localDateFormatted} · ${res.localTimeFormatted}`);
        }
        setDispatchFeedback({
          ok: true,
          messageAr: `تمت جدولة/إرسال التذكير الذكي للعميل «${res.debtorName}» (${res.windowLabelAr}).`,
          messageEn: `Smart reminder queued/dispatched for "${res.debtorName}" (${res.windowLabelEn}).`,
        });
        // F-10: dispatching mutates reminder state — refresh the page
        // behind the drawer so its numbers reflect the new state.
        router.refresh();
      }
    } catch {
      setDispatchFeedback({
        ok: false,
        messageAr: "حدث خطأ أثناء الاتصال بمحرك التذكيرات الذكي.",
        messageEn: "Error communicating with smart reminder engine.",
      });
    } finally {
      setDispatchingReminder(false);
    }
  };

  const handleOptimizeAllReminders = async () => {
    setOptimizingSchedule(true);
    setDispatchFeedback(null);
    try {
      const res = await trpc.aiWorkspace.optimizeReminders.mutate();
      setDispatchFeedback({
        ok: true,
        messageAr: res.summaryAr,
        messageEn: res.summaryEn,
      });
      // F-10: schedule optimization mutates reminder state — refresh the
      // page behind the drawer.
      router.refresh();
    } catch {
      setDispatchFeedback({
        ok: false,
        messageAr: "تعذر تحديث جدول التذكيرات التلقائي.",
        messageEn: "Failed to optimize reminder schedule.",
      });
    } finally {
      setOptimizingSchedule(false);
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

  const INTENT_LABELS: Record<string, { ar: string; en: string }> = {
    daily_summary: { ar: "أعطني الملخص التنفيذي لليوم", en: "Show me today's executive briefing" },
    priority_customers: { ar: "من هم أهم العملاء المتأخرين للمتابعة اليوم؟", en: "Who are the top priority overdue customers today?" },
    forecast_and_risk: { ar: "حلّل السيولة المتوقعة ومخاطر تركز المحفظة", en: "Analyze cashflow forecast & portfolio concentration risk" },
    settlement_options: { ar: "اقترح خطة جدولة وأقساط لأعلى مديونية", en: "Propose an installment settlement plan for top overdue balance" },
    optimize_reminders: { ar: "ما هو أفضل وقت لإرسال تذكيرات السداد اليوم؟", en: "What is the optimal window to dispatch overdue reminders today?" },
    action_plan: { ar: "ما هي خطة العمل التشغيلية المقترحة اليوم؟", en: "What is today's recommended collection action plan?" },
    inbox_triage: { ar: "ما هي الإيصالات والاعتراضات التي تنتظر المراجعة؟", en: "Which receipt claims and disputes need triage?" },
  };

  const runCopilotIntent = async (
    intent:
      | "daily_summary"
      | "priority_customers"
      | "action_plan"
      | "inbox_triage"
      | "forecast_and_risk"
      | "settlement_options"
      | "optimize_reminders"
      | "custom_question",
    customText?: string,
  ) => {
    setAsking(true);
    setCopilotError(null);
    const promptAr = customText || INTENT_LABELS[intent]?.ar || "استعلام ذكي";
    const promptEn = customText || INTENT_LABELS[intent]?.en || "AI query";
    const shownPrompt = isEn ? promptEn : promptAr;
    if (customText) setQuestion("");

    const localAssistantId = `stream-${Date.now()}`;
    setStreamingMessageId(localAssistantId);
    setCopilotAnswer(null);
    setPersistedMessages((prev) => [
      ...prev,
      { id: `user-${Date.now()}`, role: "user", content: shownPrompt },
      { id: localAssistantId, role: "assistant", content: "" },
    ]);
    try {
      const response = await fetch("/api/ai/copilot/stream", {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ intent, question: customText, conversationId, locale: isEn ? "en" : "ar" }),
      });
      if (!response.ok || !response.body) throw new Error("stream unavailable");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      // Holder object (not a plain `let`): TS does not track assignments made
      // inside the `handleEvent` closure, so a plain variable narrows to its
      // `null` initializer and reads back as `never` here.
      const finalResponseHolder: { current: CopilotAnswer | null } = { current: null };
      const handleEvent = (block: string) => {
        const dataLine = block.split("\n").find((line) => line.startsWith("data: "));
        if (!dataLine) return;
        let event: { type: string; text?: string; response?: CopilotAnswer; message?: string };
        try {
          event = JSON.parse(dataLine.slice(6)) as { type: string; text?: string; response?: CopilotAnswer; message?: string };
        } catch {
          return;
        }
        if (event.type === "token" && event.text) {
          setPersistedMessages((prev) => prev.map((message) => message.id === localAssistantId
            ? { ...message, content: message.content + event.text } : message));
        } else if (event.type === "done" && event.response) {
          finalResponseHolder.current = event.response;
        } else if (event.type === "error") {
          throw new Error(event.message ?? "AI request failed");
        }
      };
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r/g, "");
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          handleEvent(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
        }
      }
      if (buffer.trim()) handleEvent(buffer);
      const typed = finalResponseHolder.current;
      if (!typed) throw new Error("No final AI response");
      setConversationId(typed.conversationId);
      setCopilotAnswer(typed);
      setPersistedMessages((prev) => prev.map((message) => message.id === localAssistantId
        ? {
            ...message,
            content: isEn ? typed.answerEn : typed.answerAr,
            toolCalls: typed.toolCalls,
            aiMode: typed.aiMode,
            aiModel: typed.aiModel,
            aiFallbackReason: typed.aiFallbackReason,
            matchedDebtor: typed.matchedDebtor,
            quickLinks: typed.quickLinks,
          } : message));
      void loadCopilotConversations();
    } catch (error) {
      setCopilotError(error instanceof Error && error.message === "GLOBAL_AI_BUDGET_EXCEEDED"
        ? (isEn ? "The platform AI monthly budget has been reached." : "تم الوصول إلى سقف إنفاق المنصة الشهري على AI.")
        : (isEn ? "The assistant could not complete this request. No action was executed." : "تعذر إكمال طلب المساعد. لم يتم تنفيذ أي إجراء."));
      setPersistedMessages((prev) => prev.filter((message) => message.id !== localAssistantId));
    } finally {
      setAsking(false);
      setStreamingMessageId(null);
    }
  };

  if (!isOpen) return null;

  const waHref =
    activeDebtor && !activeDebtor.optedOut && draftText
      ? `https://wa.me/${activeDebtor.phoneE164.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(draftText)}`
      : null;

  // Minimized floating header bar
  if (isMinimized) {
    return (
      <div
        role="dialog"
        aria-modal="false"
        data-testid="ai-copilot-drawer"
        className="fixed bottom-20 left-4 sm:left-6 z-50 flex w-[320px] items-center justify-between gap-2 rounded-2xl border border-primary/35 bg-surface/98 backdrop-blur-xl px-4 py-3 shadow-2xl animate-in fade-in slide-in-from-bottom-2 duration-200"
      >
        <button
          type="button"
          onClick={() => setIsMinimized(false)}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-start"
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-fg">
            <Sparkle size={16} weight="fill" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-extrabold text-text">
              {isEn ? "DAFQLY AI Assistant" : "مساعد دفقلي الذكي"}
            </p>
            <p className="truncate text-[10px] text-primary">
              {isEn ? "Click to restore window" : "اضغط لاستعادة النافذة"}
            </p>
          </div>
        </button>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setIsMinimized(false)}
            aria-label={isEn ? "Restore window" : "تكبير النافذة"}
            className="flex size-7 items-center justify-center rounded-lg bg-callout text-primary hover:bg-primary hover:text-primary-fg"
          >
            <ArrowsOutSimple size={14} weight="bold" aria-hidden />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={isEn ? "Close" : "إغلاق"}
            className="flex size-7 items-center justify-center rounded-lg text-text-muted hover:bg-surface-muted hover:text-text"
          >
            <X size={14} weight="bold" aria-hidden />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="false"
      data-testid="ai-copilot-drawer"
      className={`fixed left-4 z-50 flex flex-col overflow-hidden rounded-3xl border border-border-strong/40 bg-surface/95 dark:bg-surface/95 backdrop-blur-2xl shadow-2xl transition-all duration-200 sm:left-6 ${
        isExpanded
          ? "bottom-20 h-[min(84dvh,760px)] w-[min(94vw,760px)]"
          : "bottom-20 h-[min(76dvh,590px)] w-[min(92vw,430px)]"
      }`}
    >
      {/* Pop-up Window Header with Minimize, Expand/Restore & Close Controls */}
      <div className="flex shrink-0 items-center justify-between border-b border-border/70 bg-gradient-to-r from-primary/10 via-callout/40 to-transparent px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-fg shadow-xs">
            <Sparkle size={16} weight="fill" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h2 className="truncate text-xs font-extrabold text-text sm:text-sm">
                {isEn ? "DAFQLY AI Copilot" : "مساعد دفقلي الذكي"}
              </h2>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-callout px-2 py-0.5 text-[10px] font-bold text-primary">
                <Cpu size={10} weight="fill" aria-hidden />
                <span>{isEn ? "Live Agent" : "متصل ببياناتك"}</span>
              </span>
            </div>
            <p className="truncate text-[10px] text-text-muted">
              {isEn
                ? "Ask questions, draft messages & schedule reminders"
                : "تحليل فوري، صياغة ذكية، وجدولة تذكيرات في أفضل وقت"}
            </p>
          </div>
        </div>

        {/* Window Controls: Minimize, Expand/Collapse, Close */}
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            data-testid="copilot-minimize-btn"
            onClick={() => setIsMinimized(true)}
            title={isEn ? "Minimize window" : "تصغير النافذة"}
            aria-label={isEn ? "Minimize" : "تصغير"}
            className="flex size-7 items-center justify-center rounded-lg border border-border/60 bg-surface/80 text-text-muted transition-colors hover:bg-surface-muted hover:text-text"
          >
            <Minus size={14} weight="bold" aria-hidden />
          </button>
          <button
            type="button"
            data-testid="copilot-expand-btn"
            onClick={() => setIsExpanded((v) => !v)}
            title={
              isExpanded
                ? isEn
                  ? "Compact window size"
                  : "الحجم المصغّر"
                : isEn
                  ? "Expand window size"
                  : "تكبير النافذة"
            }
            aria-label={isExpanded ? (isEn ? "Restore size" : "تصغير الحجم") : isEn ? "Expand" : "تكبير"}
            className="flex size-7 items-center justify-center rounded-lg border border-border/60 bg-surface/80 text-text-muted transition-colors hover:bg-callout hover:text-primary"
          >
            {isExpanded ? (
              <ArrowsInSimple size={14} weight="bold" aria-hidden />
            ) : (
              <ArrowsOutSimple size={14} weight="bold" aria-hidden />
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={isEn ? "Close" : "إغلاق"}
            title={isEn ? "Close (Esc)" : "إغلاق (Esc)"}
            className="flex size-7 items-center justify-center rounded-lg border border-border/60 bg-surface/80 text-text-muted transition-colors hover:bg-danger-bg hover:text-danger"
          >
            <X size={14} weight="bold" aria-hidden />
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="grid shrink-0 grid-cols-3 gap-1 border-b border-border/60 bg-surface-muted/40 p-1.5">
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
            className={`flex items-center justify-center gap-1.5 rounded-xl px-2 py-1.5 text-xs font-bold transition-all ${
              tab === id
                ? "bg-surface text-primary shadow-2xs"
                : "text-text-muted hover:text-text"
            }`}
          >
            <Icon size={13} weight="fill" aria-hidden />
            <span>{isEn ? labelEn : labelAr}</span>
          </button>
        ))}
      </div>

      {/* Global Dispatch Feedback Banner */}
      {dispatchFeedback && (
        <div
          className={`mx-4 mt-2.5 flex shrink-0 items-start justify-between gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${
            dispatchFeedback.ok
              ? "border-status-paid-fg/30 bg-status-paid-bg text-status-paid-fg"
              : "border-status-overdue-fg/30 bg-status-overdue-bg text-status-overdue-fg"
          }`}
        >
          <span>{isEn ? dispatchFeedback.messageEn : dispatchFeedback.messageAr}</span>
          <button
            type="button"
            onClick={() => setDispatchFeedback(null)}
            className="shrink-0 opacity-75 hover:opacity-100"
            aria-label={isEn ? "Dismiss" : "إغلاق"}
          >
            <X size={13} weight="bold" />
          </button>
        </div>
      )}

      {/* Tab Body */}
      <div className="flex-1 overflow-y-auto p-4 no-scrollbar" style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}>
        {tab === "briefing" && (
          <div className="flex flex-col gap-3.5">
            {loadingOverview && !overview ? (
              <p className="py-10 text-center text-xs text-text-muted">
                {isEn ? "Analyzing workspace..." : "جاري تحليل بيانات التحصيل..."}
              </p>
            ) : overview ? (
              <>
                {/* Executive Summary Card */}
                <div className="rounded-2xl border border-border bg-callout/50 p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-0.5 text-[11px] font-bold text-primary">
                      <Sparkle size={11} weight="fill" aria-hidden />
                      {isEn ? "Executive Briefing" : "الملخص التنفيذي"}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
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
                  <h3 className="mt-2 text-xs font-bold text-text sm:text-sm">
                    {isEn ? overview.headlineEn : overview.headlineAr}
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-text-muted">
                    {isEn ? overview.summaryEn : overview.summaryAr}
                  </p>
                  <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border/50 pt-2.5 text-center">
                    <div>
                      <p className="text-[10px] text-text-muted">{isEn ? "Collection" : "نسبة التحصيل"}</p>
                      <p className="text-xs font-bold text-text sm:text-sm">{formatPct(overview.metrics.collectionRate)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-text-muted">{isEn ? "DSO" : "متوسط التحصيل"}</p>
                      <p className="text-xs font-bold text-text sm:text-sm">
                        {formatDso(overview.metrics.dsoDays)} {isEn ? "d" : "ي"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-text-muted">{isEn ? "Overdue" : "المتأخرات"}</p>
                      <p className="text-xs font-bold text-status-overdue-fg sm:text-sm">
                        {formatAmountOnly(BigInt(overview.metrics.overdueMinor))}
                      </p>
                    </div>
                  </div>

                  {/* 1-Click Optimal Schedule Optimizer */}
                  <div className="mt-3 border-t border-border/50 pt-2.5">
                    <button
                      type="button"
                      data-testid="optimize-all-reminders-btn"
                      disabled={optimizingSchedule}
                      onClick={() => void handleOptimizeAllReminders()}
                      className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-bold text-primary-fg transition-colors hover:bg-primary-hover disabled:opacity-50"
                    >
                      <ClockCountdown size={14} weight="fill" aria-hidden />
                      <span>
                        {optimizingSchedule
                          ? isEn
                            ? "Optimizing reminder schedule..."
                            : "جاري تحسين وجدولة التذكيرات..."
                          : isEn
                            ? "Optimize & Schedule Overdue Reminders"
                            : "جدولة تذكيرات المتأخرين في التوقيت الأمثل"}
                      </span>
                    </button>
                  </div>
                </div>

                {/* Portfolio Concentration & Liquidity Velocity Card */}
                {overview.portfolioRisk && (
                  <div className="rounded-2xl border border-border bg-surface p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-xs font-bold text-text">
                        <ChartLineUp size={14} weight="fill" className="text-primary" aria-hidden />
                        {isEn ? "Liquidity & Portfolio Risk" : "السيولة وتركز المحفظة"}
                      </span>
                      <span className="rounded-full bg-callout px-2 py-0.5 text-[10px] font-bold text-primary">
                        {isEn
                          ? `Velocity ${overview.portfolioRisk.velocityScore}/100`
                          : `السرعة ${overview.portfolioRisk.velocityScore}/100`}
                      </span>
                    </div>
                    <div className="mt-2.5 grid grid-cols-2 gap-2">
                      <div className="rounded-xl bg-surface-muted/50 p-2">
                        <p className="text-[10px] text-text-muted">
                          {isEn ? "14-Day Expected Inflow" : "سيولة متوقعة (١٤ يوماً)"}
                        </p>
                        <p className="mt-0.5 text-xs font-extrabold text-status-paid-fg" dir="ltr">
                          {formatAmountOnly(BigInt(overview.portfolioRisk.expectedNext14DaysMinor))} {currencySymbol}
                        </p>
                      </div>
                      <div className="rounded-xl bg-surface-muted/50 p-2">
                        <p className="text-[10px] text-text-muted">
                          {isEn ? "Top Debtor Share" : "تركز أعلى مدين"}
                        </p>
                        <p className="mt-0.5 text-xs font-extrabold text-text">
                          {overview.portfolioRisk.topDebtorSharePct}%
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Top Priority Customer Suggestions */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="flex items-center gap-1.5 text-xs font-bold text-text">
                      <UsersThree size={14} weight="fill" className="text-primary" aria-hidden />
                      {isEn ? "Recommended Customer Actions" : "اقتراحات متابعة العملاء"}
                    </h4>
                    <span className="text-[10px] text-text-muted">
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
                    <div className="flex flex-col gap-2">
                      {overview.topActions.map((d) => (
                        <div
                          key={d.debtorId}
                          className="rounded-xl border border-border bg-surface p-3 transition-colors hover:border-primary/40"
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
                                {formatAmountOnly(BigInt(d.outstandingMinor))} {currencySymbol}
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

                          <p className="mt-1.5 text-xs font-semibold text-primary">
                            {isEn ? d.recommendation.titleEn : d.recommendation.titleAr}
                          </p>

                          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleSelectDebtorForComposer(d, "reminder")}
                              className="inline-flex items-center gap-1 rounded-full bg-callout px-2.5 py-1 text-[11px] font-bold text-primary transition-opacity hover:opacity-85"
                            >
                              <Sparkle size={11} weight="fill" aria-hidden />
                              {isEn ? "Draft Reminder" : "صياغة تنبيه"}
                            </button>
                            {!d.optedOut && (
                              <button
                                type="button"
                                disabled={dispatchingReminder}
                                onClick={() => void handleDispatchSmartReminder(d.debtorId, d.recommendation.suggestedTone)}
                                className="inline-flex items-center gap-1 rounded-full bg-status-paid-bg px-2.5 py-1 text-[11px] font-bold text-status-paid-fg transition-opacity hover:opacity-90 disabled:opacity-50"
                              >
                                <ClockCountdown size={11} weight="fill" aria-hidden />
                                {isEn ? "Send at Best Time" : "إرسال في أفضل وقت"}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleSelectDebtorForComposer(d, "installment")}
                              className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-muted/60 px-2.5 py-1 text-[11px] font-bold text-text transition-colors hover:border-primary hover:text-primary"
                            >
                              <CalendarCheck size={11} weight="fill" aria-hidden />
                              {isEn ? "Installment Plan" : "جدولة أقساط"}
                            </button>
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
          <div className="flex flex-col gap-3.5">
            {/* Mode Switcher: Smart Reminder vs. Installment Plan */}
            <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-surface-muted/60 p-1">
              <button
                type="button"
                data-testid="composer-mode-reminder"
                onClick={() => {
                  setComposerMode("reminder");
                  setDraftText("");
                  setInstallmentPlan(null);
                }}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-bold transition-all ${
                  composerMode === "reminder"
                    ? "bg-surface text-primary shadow-2xs"
                    : "text-text-muted hover:text-text"
                }`}
              >
                <Sparkle size={12} weight="fill" aria-hidden />
                <span>{isEn ? "Smart Reminder" : "تذكير ذكي"}</span>
              </button>
              <button
                type="button"
                data-testid="composer-mode-installment"
                onClick={() => {
                  setComposerMode("installment");
                  setDraftText("");
                }}
                className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-bold transition-all ${
                  composerMode === "installment"
                    ? "bg-surface text-primary shadow-2xs"
                    : "text-text-muted hover:text-text"
                }`}
              >
                <CalendarCheck size={12} weight="fill" aria-hidden />
                <span>{isEn ? "Installment Plan" : "خطة جدولة وأقساط"}</span>
              </button>
            </div>

            <div className="flex flex-col gap-1">
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
                  setInstallmentPlan(null);
                }}
                className="min-h-[38px] rounded-xl border border-border-strong/60 bg-surface px-3 text-xs font-medium text-text focus:border-primary focus:outline-none"
              >
                {(overview?.debtorScores ?? []).map((d) => (
                  <option key={d.debtorId} value={d.debtorId}>
                    {d.displayName} — {formatAmountOnly(BigInt(d.outstandingMinor))} {currencySymbol}
                  </option>
                ))}
              </select>
            </div>

            {activeDebtor?.optedOut && (
              <div className="flex items-center gap-2 rounded-xl bg-status-overdue-bg px-3 py-2 text-xs font-semibold text-status-overdue-fg">
                <WarningCircle size={15} weight="fill" aria-hidden />
                <span>
                  {isEn
                    ? "Customer opted out of reminders. Automated dispatch is blocked."
                    : "العميل أوقف استقبال التذكيرات — الإرسال التلقائي محظور."}
                </span>
              </div>
            )}

            {composerMode === "reminder" ? (
              <div className="grid grid-cols-2 gap-2.5">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-bold text-text-muted">
                    {isEn ? "Message Tone" : "نبرة الرسالة"}
                  </label>
                  <select
                    value={tone}
                    onChange={(e) => setTone(e.target.value as NotificationTone)}
                    className="min-h-[38px] rounded-xl border border-border-strong/60 bg-surface px-2.5 text-xs text-text focus:border-primary focus:outline-none"
                  >
                    <option value="friendly">{isEn ? "Friendly" : "ودية"}</option>
                    <option value="polite">{isEn ? "Polite" : "رسمية مهذبة"}</option>
                    <option value="firm">{isEn ? "Firm" : "حازمة"}</option>
                    <option value="urgent">{isEn ? "Urgent" : "عاجلة"}</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-bold text-text-muted">
                    {isEn ? "Language" : "لغة الرسالة"}
                  </label>
                  <select
                    value={msgLocale}
                    onChange={(e) => setMsgLocale(e.target.value as "ar" | "en")}
                    className="min-h-[38px] rounded-xl border border-border-strong/60 bg-surface px-2.5 text-xs text-text focus:border-primary focus:outline-none"
                  >
                    <option value="ar">العربية</option>
                    <option value="en">English</option>
                  </select>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-bold text-text-muted">
                    {isEn ? "Installments" : "عدد الدفعات"}
                  </label>
                  <select
                    value={installmentsCount}
                    onChange={(e) => setInstallmentsCount(Number(e.target.value) as 2 | 3 | 4 | 6)}
                    className="min-h-[38px] rounded-xl border border-border-strong/60 bg-surface px-2 text-xs text-text focus:border-primary focus:outline-none"
                  >
                    <option value={2}>{isEn ? "2 payments" : "دفعتان (2)"}</option>
                    <option value={3}>{isEn ? "3 payments" : "٣ دفعات"}</option>
                    <option value={4}>{isEn ? "4 payments" : "٤ دفعات"}</option>
                    <option value={6}>{isEn ? "6 payments" : "٦ دفعات"}</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-bold text-text-muted">
                    {isEn ? "Cadence" : "الفترة"}
                  </label>
                  <select
                    value={interval}
                    onChange={(e) => setInterval(e.target.value as "weekly" | "biweekly" | "monthly")}
                    className="min-h-[38px] rounded-xl border border-border-strong/60 bg-surface px-2 text-xs text-text focus:border-primary focus:outline-none"
                  >
                    <option value="weekly">{isEn ? "Weekly" : "أسبوعي"}</option>
                    <option value="biweekly">{isEn ? "Bi-weekly" : "كل أسبوعين"}</option>
                    <option value="monthly">{isEn ? "Monthly" : "شهري"}</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-bold text-text-muted">
                    {isEn ? "Down Payment" : "الدفعة المقدمة"}
                  </label>
                  <select
                    value={downPaymentPct}
                    onChange={(e) => setDownPaymentPct(Number(e.target.value) as 0 | 10 | 20 | 25 | 30 | 50)}
                    className="min-h-[38px] rounded-xl border border-border-strong/60 bg-surface px-2 text-xs text-text focus:border-primary focus:outline-none"
                  >
                    <option value={0}>{isEn ? "None (0%)" : "بدون (0%)"}</option>
                    <option value={10}>10%</option>
                    <option value={20}>20%</option>
                    <option value={25}>25%</option>
                    <option value={30}>30%</option>
                    <option value={50}>50%</option>
                  </select>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="copilot-generate-btn"
                disabled={!activeDebtor || generatingMsg}
                onClick={() => void handleGenerateMessage()}
                className="inline-flex min-h-[38px] flex-1 items-center justify-center gap-1.5 rounded-full bg-primary px-4 text-xs font-bold text-primary-fg transition-colors hover:bg-primary-hover disabled:opacity-50"
              >
                <Sparkle size={14} weight="fill" aria-hidden />
                <span>
                  {generatingMsg
                    ? isEn
                      ? "Generating..."
                      : "جاري التوليد..."
                    : composerMode === "installment"
                      ? isEn
                        ? "Build Installment Proposal"
                        : "بناء خطة الجدولة وصياغة العرض"
                      : isEn
                        ? "Generate Smart Message"
                        : "صياغة الرسالة بالذكاء الاصطناعي"}
                </span>
              </button>

              {composerMode === "reminder" && activeDebtor && !activeDebtor.optedOut && (
                <button
                  type="button"
                  data-testid="copilot-dispatch-optimal-btn"
                  disabled={dispatchingReminder}
                  onClick={() => void handleDispatchSmartReminder(activeDebtor.debtorId, tone)}
                  className="inline-flex min-h-[38px] items-center justify-center gap-1.5 rounded-full border border-primary/40 bg-callout px-3.5 text-xs font-bold text-primary transition-colors hover:bg-primary hover:text-primary-fg disabled:opacity-50"
                >
                  <ClockCountdown size={14} weight="fill" aria-hidden />
                  <span>
                    {dispatchingReminder
                      ? isEn
                        ? "Scheduling..."
                        : "جاري الجدولة..."
                      : isEn
                        ? "Schedule Optimal Send"
                        : "جدولة في أفضل وقت"}
                  </span>
                </button>
              )}
            </div>

            {installmentPlan && composerMode === "installment" && (
              <div className="rounded-2xl border border-border bg-callout/35 p-3">
                {installmentPlan.settled ? (
                  <p className="text-xs font-medium text-text">
                    {isEn
                      ? (installmentPlan.settledMessageEn ?? "No outstanding balance — the account is fully settled.")
                      : (installmentPlan.settledMessageAr ?? "لا يوجد رصيد مستحق — الحساب مسدد بالكامل.")}
                  </p>
                ) : (
                  <>
                <div className="mb-1.5 flex items-center justify-between text-xs font-bold text-text">
                  <span>
                    {isEn ? "Installment Schedule" : "جدول الدفعات المقترح"} ({installmentPlan.formattedTotal}{" "}
                    {currencySymbol})
                  </span>
                  <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] text-primary">
                    {installmentPlan.installmentsCount} {isEn ? "tranches" : "أقساط"}
                  </span>
                </div>
                <ul className="divide-y divide-border/50 text-xs">
                  {installmentPlan.tranches.map((tr) => (
                    <li key={tr.sequence} className="flex items-center justify-between py-1">
                      <span className="font-medium text-text">
                        {isEn ? tr.labelEn : tr.labelAr}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-text-muted" dir="ltr">
                          {tr.dueDate}
                        </span>
                        <span className="tnum font-bold text-primary" dir="ltr">
                          {tr.formattedAmount}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
                  </>
                )}
              </div>
            )}

            {draftText && (
              <div className="flex flex-col gap-2 rounded-2xl border border-border bg-surface-muted/40 p-3">
                <div className="flex items-center justify-between text-[11px] text-text-muted">
                  <span>
                    {isEn ? "Suggested send window:" : "أفضل وقت للإرسال:"} {suggestedSendTime}
                  </span>
                  <span className="rounded-full bg-callout px-2 py-0.5 font-bold text-primary">
                    {composerMode === "installment"
                      ? (isEn ? "Calculated schedule" : "جدول محسوب")
                      : draftGenerationMode === "ai"
                        ? (isEn ? "AI-written · fact-checked" : "صياغة AI · حقائق متحققة")
                        : (isEn ? "Verified template" : "قالب آمن محكوم")}
                  </span>
                </div>
                <textarea
                  rows={5}
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  dir={msgLocale === "ar" ? "rtl" : "ltr"}
                  className="w-full rounded-xl border border-border-strong/60 bg-surface p-2.5 text-xs leading-relaxed text-text focus:border-primary focus:outline-none"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCopyDraft()}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-xs font-semibold text-text hover:border-primary"
                  >
                    {copied ? <Check size={13} weight="fill" className="text-primary" /> : <Copy size={13} weight="fill" />}
                    <span>{copied ? (isEn ? "Copied" : "تم النسخ") : isEn ? "Copy" : "نسخ"}</span>
                  </button>
                  {waHref && (
                    <a
                      href={waHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-full bg-status-paid-bg px-3 py-1 text-xs font-bold text-status-paid-fg transition-opacity hover:opacity-90"
                    >
                      <WhatsappLogo size={13} weight="fill" aria-hidden />
                      <span>{isEn ? "Open WhatsApp" : "فتح واتساب"}</span>
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "assistant" && (
          <div className="flex flex-col gap-3.5">
            <div className="flex items-center gap-2">
              <select
                aria-label={isEn ? "Saved AI conversations" : "المحادثات المحفوظة"}
                value={conversationId ?? ""}
                onChange={(event) => void openSavedConversation(event.target.value)}
                disabled={loadingConversation || asking}
                className="min-h-[36px] min-w-0 flex-1 rounded-xl border border-border bg-surface px-2.5 text-xs text-text disabled:opacity-60"
              >
                <option value="">{isEn ? "Current conversation" : "المحادثة الحالية"}</option>
                {conversationList.map((item) => (
                  <option key={item.id} value={item.id}>{item.title}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={startNewConversation}
                disabled={asking || loadingConversation}
                className="min-h-[36px] shrink-0 rounded-xl border border-border px-3 text-xs font-bold text-primary hover:bg-callout disabled:opacity-50"
              >
                {isEn ? "New chat" : "محادثة جديدة"}
              </button>
            </div>
            {loadingConversation && <p className="text-[11px] text-text-muted">{isEn ? "Loading conversation…" : "جارٍ تحميل المحادثة…"}</p>}
            {copilotError && <p role="alert" className="rounded-lg border border-status-overdue-fg/20 bg-status-overdue-bg px-3 py-2 text-xs text-status-overdue-fg">{copilotError}</p>}
            {conversationTotal > conversationList.length && (
              <p className="text-[11px] text-text-muted">
                {isEn
                  ? `Showing the latest ${conversationList.length} of ${conversationTotal} saved conversations.`
                  : `عرض أحدث ${conversationList.length} من أصل ${conversationTotal} محادثة محفوظة.`}
              </p>
            )}
            {totalMessages > persistedMessages.length && persistedMessages.length > 0 && (
              <p className="text-[11px] text-text-muted">
                {isEn
                  ? `Showing the latest ${persistedMessages.length} of ${totalMessages} messages in this conversation.`
                  : `عرض أحدث ${persistedMessages.length} من أصل ${totalMessages} رسالة في هذه المحادثة.`}
              </p>
            )}
            {persistedMessages.length > 24 && (
              <p className="text-[11px] text-text-muted">
                {isEn
                  ? `This view shows the latest 24 of ${persistedMessages.length} loaded messages.`
                  : `يعرض هذا العرض أحدث 24 من أصل ${persistedMessages.length} رسالة محمّلة.`}
              </p>
            )}
            {/* Unified Conversation Thread */}
            {persistedMessages.length > 0 && (
              <div
                className="flex max-h-[380px] flex-col gap-3 overflow-y-auto rounded-2xl border border-border bg-surface-muted/30 p-3.5 no-scrollbar"
                style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
              >
                {persistedMessages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex flex-col gap-1.5 ${message.role === "user" ? "items-end" : "items-start"}`}
                  >
                    {/* Tool Calls execution badge attached to assistant message */}
                    {message.role === "assistant" && message.toolCalls && message.toolCalls.length > 0 && (
                      <div className="flex flex-col gap-1.5 rounded-2xl border border-primary/25 bg-surface/95 p-2.5 text-[11px] shadow-xs max-w-[95%]">
                        <span className="flex items-center gap-1.5 font-bold text-primary">
                          <Cpu size={13} weight="fill" />
                          <span>
                            {message.aiMode === "live"
                              ? isEn
                                ? `AI used ${message.toolCalls.length} workspace tool(s)`
                                : `استخدم الـAI عدد ${message.toolCalls.length} من أدوات مساحة العمل`
                              : isEn
                                ? "Verified deterministic workspace analysis"
                                : "تحليل فعلي من محرك النظام الأساسي"}
                          </span>
                        </span>
                        <div className="flex flex-col gap-1">
                          {message.toolCalls.map((tc, idx) => (
                            <div
                              key={`${tc.toolName}-${idx}`}
                              data-testid={`copilot-tool-call-${tc.toolName}`}
                              className="flex items-center justify-between gap-2 rounded-lg bg-surface-muted px-2.5 py-1 text-[10px]"
                            >
                              <span className="font-bold text-text">
                                {isEn ? tc.titleEn : tc.titleAr}
                              </span>
                              <span className={`truncate ${tc.status === "failed" ? "text-status-overdue-fg" : "text-text-muted"}`}>
                                {isEn ? tc.summaryEn : tc.summaryAr}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Bubble */}
                    <div
                      className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-line shadow-xs ${
                        message.role === "user"
                          ? "bg-primary text-primary-fg"
                          : "border border-border bg-surface text-text"
                      }`}
                    >
                      {message.content}
                      {asking && message.id === streamingMessageId && (
                        <span className="inline-block h-3.5 w-1.5 ms-1 bg-primary animate-pulse align-middle" />
                      )}
                    </div>

                    {/* Matched Customer Interactive Action Card if present */}
                    {message.role === "assistant" && message.matchedDebtor && (
                      <div className="rounded-xl border border-primary/30 bg-callout/40 p-2.5 text-xs flex flex-col gap-1.5 max-w-[92%]">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-text">{message.matchedDebtor.displayName}</span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              message.matchedDebtor.optimalWindow?.canSend
                                ? "bg-status-paid-bg text-status-paid-fg"
                                : "bg-status-overdue-bg text-status-overdue-fg"
                            }`}
                          >
                            {isEn
                              ? message.matchedDebtor.optimalWindow?.windowLabelEn
                              : message.matchedDebtor.optimalWindow?.windowLabelAr}
                          </span>
                        </div>
                        <p className="text-[11px] text-text-muted">
                          {isEn
                            ? message.matchedDebtor.optimalWindow?.strategyReasonEn
                            : message.matchedDebtor.optimalWindow?.strategyReasonAr}
                        </p>
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {message.matchedDebtor.optimalWindow?.canSend && (
                            <button
                              type="button"
                              disabled={dispatchingReminder}
                              onClick={() =>
                                void handleDispatchSmartReminder(
                                  message.matchedDebtor!.debtorId,
                                  message.matchedDebtor!.optimalWindow.recommendedTone,
                                )
                              }
                              className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[10px] font-bold text-primary-fg hover:bg-primary-hover disabled:opacity-50"
                            >
                              <ClockCountdown size={12} weight="fill" aria-hidden />
                              <span>{isEn ? "Dispatch Smart Reminder" : "إرسال/جدولة تذكير ذكي"}</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              handleSelectDebtorForComposer(message.matchedDebtor!, "installment")
                            }
                            className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-muted/60 px-2.5 py-1 text-[10px] font-bold text-text hover:border-primary hover:text-primary"
                          >
                            <CalendarCheck size={11} weight="fill" aria-hidden />
                            <span>{isEn ? "Installment Plan" : "خطة تقسيط"}</span>
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Quick Action Links if present */}
                    {message.role === "assistant" && message.quickLinks && message.quickLinks.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 pt-1">
                        {message.quickLinks.map((lnk) => (
                          <Link
                            key={lnk.href}
                            href={`/${locale}${lnk.href}`}
                            onClick={onClose}
                            className="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 text-[10px] font-bold text-primary border border-primary/20 shadow-2xs hover:bg-primary hover:text-primary-fg transition-colors"
                          >
                            <span>{isEn ? lnk.labelEn : lnk.labelAr}</span>
                            <ArrowSquareOut size={10} weight="fill" aria-hidden />
                          </Link>
                        ))}
                      </div>
                    )}

                    {/* Assistant Message Metadata & Copy */}
                    {message.role === "assistant" && message.content && (
                      <div className="flex items-center gap-2 px-1 text-[10px] text-text-muted">
                        <button
                          type="button"
                          onClick={() => void navigator.clipboard.writeText(message.content)}
                          className="hover:text-primary transition-colors flex items-center gap-1"
                        >
                          <Copy size={11} />
                          <span>{isEn ? "Copy" : "نسخ الرد"}</span>
                        </button>
                        {message.aiModel && <span className="font-mono text-[9px] text-text-subtle">{message.aiModel}</span>}
                      </div>
                    )}
                  </div>
                ))}

                {/* Shimmering Radar Thinking Indicator while waiting for initial tokens */}
                {asking && (!streamingMessageId || persistedMessages.find((m) => m.id === streamingMessageId)?.content === "") && (
                  <div className="flex items-center gap-3 rounded-2xl border border-primary/25 bg-callout/40 p-3.5 text-xs text-text shadow-xs animate-in fade-in duration-200">
                    <div className="relative flex size-5 shrink-0 items-center justify-center">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-30" />
                      <Sparkle size={14} weight="fill" className="text-primary animate-spin" />
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-bold text-text">
                        {isEn ? "DAFQLY Live AI Reasoning" : "جارٍ استرجاع دفاتر المنشأة وتشغيل الأدوات الذكية..."}
                      </span>
                      <span className="text-[10px] text-text-muted">
                        {isEn ? "Calling workspace tools & checking invoices" : "استدعاء Google Gemini 3.1 وفحص سجلات الفواتير والمتأخرات"}
                      </span>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            )}

            {/* Quick Intents */}
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  { id: "daily_summary", en: "Daily Briefing", ar: "ملخص اليوم" },
                  { id: "priority_customers", en: "Priority Customers", ar: "أهم العملاء" },
                  { id: "optimize_reminders", en: "Optimal Reminders", ar: "توقيت التذكيرات الذكي" },
                  { id: "forecast_and_risk", en: "Liquidity & Risk", ar: "السيولة والمخاطر" },
                  { id: "settlement_options", en: "Settlement Plan", ar: "مقترح جدولة" },
                  { id: "action_plan", en: "Action Plan", ar: "خطة العمل" },
                  { id: "inbox_triage", en: "Pending Queue", ar: "صندوق المراجعة" },
                ] as const
              ).map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  disabled={asking}
                  onClick={() => void runCopilotIntent(chip.id)}
                  className="rounded-full border border-border bg-surface-muted/60 px-2.5 py-1 text-[11px] font-bold text-text transition-colors hover:border-primary hover:bg-callout hover:text-primary disabled:opacity-50"
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
                maxLength={2000}
                placeholder={
                  isEn
                    ? "Ask about any customer by name, overdue risk, optimal reminder time..."
                    : "اسأل عن أي عميل بالاسم، المتأخرات، أفضل وقت للتذكير، أو التقسيط..."
                }
                className="min-h-[38px] flex-1 rounded-xl border border-border-strong/60 bg-surface px-3 text-xs text-text placeholder:text-text-subtle focus:border-primary focus:outline-none"
              />
              <span className="shrink-0 text-[11px] text-text-muted" dir="ltr">{question.length}/2000</span>
              <button
                type="submit"
                disabled={!question.trim() || asking}
                aria-label={isEn ? "Ask" : "إرسال"}
                className="flex size-[38px] shrink-0 items-center justify-center rounded-xl bg-primary text-primary-fg transition-colors hover:bg-primary-hover disabled:opacity-50"
              >
                <PaperPlaneTilt size={15} weight="fill" aria-hidden />
              </button>
            </form>


            <div className="rounded-xl border border-border/60 bg-surface-muted/35 p-2.5 text-[10px] text-text-muted">
              <p className="flex items-center gap-1 font-semibold text-text">
                <ShieldWarning size={13} weight="fill" className="text-primary" aria-hidden />
                <span>{isEn ? "Tenant-Isolated AI Guardrails" : "حماية وعزل بيانات المنشأة"}</span>
              </p>
              <p className="mt-0.5 leading-relaxed">
                {isEn
                  ? "All AI function calls execute strictly on your RLS-scoped workspace ledger with quiet-hours enforcement and audit logging."
                  : "تُنفَّذ جميع استدعاءات الدوال حصرياً على دفاتر منشأتك المعزولة مع الالتزام بساعات الهدوء وسجل المراجعة."}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
