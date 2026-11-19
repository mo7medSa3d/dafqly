"use client";

import { cn, todayIso, toSafeLocalePath } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import { buttonVariants } from "@/components/ui/button";
import { inputVariants } from "@/components/ui/input";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowsInSimple, ArrowsOutSimple, ArrowSquareOut, CalendarCheck, ChartLineUp, Check, ClockCountdown, Copy, Cpu, Lightning, Minus, PaperPlaneTilt, PencilSimple, Robot, Sparkle, Trash, UsersThree, WarningCircle, X } from "@/components/ui/solid-icons";
import { WhatsappLogo } from "@/components/ui/icons";
import { formatPct, formatDso, type NotificationTone } from "@tahseel/core";
import { trpc } from "@/lib/trpc-client";
import { useCurrency } from "./CurrencyContext";
import { DafqlyAiMascot } from "./DafqlyAiMascot";
import type { ComposerMode, CopilotTab } from "./copilot-events";

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
  currency: string;
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
  aiFallbackReason: "provider_not_configured" | "daily_token_budget_exceeded" | "global_budget_exceeded" | "provider_error" | "empty_response" | null;
}


function stripMarkdownMarkers(text: string): string {
  return text
    .replace(/^#{1,4}\s+/gm, "")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/\*/g, "");
}

function renderInlineBold(text: string) {
  const parts = text.split(/(\*\*[^*\n]+\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={idx} className="font-bold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    const clean = part.replace(/\*/g, "");
    return clean ? <span key={idx}>{clean}</span> : null;
  });
}

function CopilotMessageBody({ content }: { content: string }) {
  const lines = content.replace(/\r/g, "").split("\n");
  return (
    <div className="flex flex-col gap-1.5 text-xs leading-relaxed">
      {lines.map((raw, idx) => {
        const line = raw.trim();
        if (!line) return <div key={idx} className="h-0.5" />;

        const isHeading = /^#{1,4}\s+/.test(line);
        const stripped = line.replace(/^#{1,4}\s+/, "");
        const bulletMatch = stripped.match(/^(?:[•\-*]|\d+[.)]|[٠-٩]+[.)])\s+(.*)$/);
        if (bulletMatch) {
          const marker = stripped.match(/^(\d+[.)]|[٠-٩]+[.)])/)?.[1] ?? "•";
          return (
            <div key={idx} className="flex items-start gap-2">
              <span className="shrink-0 font-bold text-primary" aria-hidden>{marker}</span>
              <span className="min-w-0 flex-1">{renderInlineBold(bulletMatch[1] ?? "")}</span>
            </div>
          );
        }

        const cleanLabel = stripped.replace(/\*/g, "");
        if (isHeading || (cleanLabel.endsWith(":") && cleanLabel.length <= 60)) {
          return (
            <p key={idx} className="pt-0.5 font-bold text-foreground">
              {renderInlineBold(stripped)}
            </p>
          );
        }

        return <p key={idx}>{renderInlineBold(stripped)}</p>;
      })}
    </div>
  );
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
  initialTab = "assistant",
  initialDebtorId,
  initialTone,
  initialMode = "reminder",
  initialPrompt,
}: {
  isOpen: boolean;
  onClose: () => void;
  locale: string;
  initialTab?: CopilotTab;
  initialDebtorId?: string;
  initialTone?: NotificationTone;
  initialMode?: ComposerMode;
  initialPrompt?: string;
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
  const [livePhase, setLivePhase] = useState<"reading_context" | "thinking" | "writing" | null>(null);
  const [liveTools, setLiveTools] = useState<{ id: string; titleAr: string; titleEn: string; state: "running" | "done" | "failed"; summaryAr?: string; summaryEn?: string }[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const lastPromptRef = useRef<string | undefined>(undefined);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const questionInputRef = useRef<HTMLInputElement | null>(null);
  const wasOpenRef = useRef(false);
  const [copilotAnswer, setCopilotAnswer] = useState<CopilotAnswer | null>(null);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [conversationList, setConversationList] = useState<{ id: string; title: string; updatedAt: string }[]>([]);
  // F-18: the server returns only the latest 20 conversations / 60
  // messages — keep the totals so the drawer can say what is hidden.
  const [_conversationTotal, setConversationTotal] = useState(0);
  const [_totalMessages, setTotalMessages] = useState(0);
  const [persistedMessages, setPersistedMessages] = useState<{ id: string; role: "user" | "assistant"; content: string }[]>([]);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [copilotError, setCopilotError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);

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
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [persistedMessages, asking]);

  useEffect(() => {
    if (isOpen && initialPrompt && initialPrompt !== lastPromptRef.current) {
      lastPromptRef.current = initialPrompt;
      setTab("assistant");
      void runCopilotIntent("custom_question", initialPrompt);
    }
  }, [isOpen, initialPrompt]);

  const handleDeleteConversation = async (id: string) => {
    if (!id || loadingConversation || asking) return;
    setLoadingConversation(true);
    setCopilotError(null);
    try {
      await trpc.intelligence.deleteCopilotConversation.mutate({ conversationId: id });
      setConversationList((prev) => prev.filter((c) => c.id !== id));
      setConversationTotal((n) => Math.max(0, n - 1));
      if (conversationId === id) {
        startNewConversation();
      }
    } catch {
      setCopilotError(isEn ? "Could not delete conversation." : "تعذر حذف المحادثة.");
    } finally {
      setLoadingConversation(false);
    }
  };

  const handleRenameConversation = async () => {
    if (!conversationId || !renameDraft.trim() || loadingConversation) return;
    setLoadingConversation(true);
    setCopilotError(null);
    try {
      const updated = await trpc.intelligence.renameCopilotConversation.mutate({
        conversationId,
        title: renameDraft.trim(),
      });
      setConversationList((prev) => prev.map((c) => (c.id === updated.id ? { ...c, title: updated.title } : c)));
      setRenaming(false);
    } catch {
      setCopilotError(isEn ? "Could not rename conversation." : "تعذر تعديل اسم المحادثة.");
    } finally {
      setLoadingConversation(false);
    }
  };

  const handleClearAllConversations = async () => {
    if (loadingConversation || asking) return;
    setLoadingConversation(true);
    setCopilotError(null);
    try {
      await trpc.intelligence.clearCopilotConversations.mutate();
      setConversationList([]);
      setConversationTotal(0);
      startNewConversation();
    } catch {
      setCopilotError(isEn ? "Could not clear conversations." : "تعذر مسح المحادثات.");
    } finally {
      setLoadingConversation(false);
    }
  };

  const handleCopyMessage = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedMsgId(id);
      setTimeout(() => setCopiedMsgId(null), 1500);
    } catch { /* ignore */ }
  };

  const startNewConversation = () => {
    setConversationId(undefined);
    setPersistedMessages([]);
    setTotalMessages(0);
    setCopilotAnswer(null);
    setQuestion("");
    setCopilotError(null);
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
    if (!isOpen) {
      abortRef.current?.abort();
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const frame = window.requestAnimationFrame(() => {
        if (tab === "assistant" && questionInputRef.current) {
          questionInputRef.current.focus();
        } else {
          closeBtnRef.current?.focus();
        }
      });
      wasOpenRef.current = true;
      return () => window.cancelAnimationFrame(frame);
    }
    if (!isOpen && wasOpenRef.current) {
      wasOpenRef.current = false;
      if (previousFocusRef.current?.isConnected) {
        previousFocusRef.current.focus();
      }
      previousFocusRef.current = null;
    }
  }, [isOpen, tab]);

  useEffect(() => () => { abortRef.current?.abort(); }, []);

  const activeDebtor = useMemo(
    () => overview?.debtorScores.find((d) => d.debtorId === selectedDebtorId) ?? null,
    [overview, selectedDebtorId],
  );
  const activeOutstandingMinor = activeDebtor ? BigInt(activeDebtor.outstandingMinor) : 0n;
  const isActiveSettled = activeDebtor ? activeOutstandingMinor <= 0n : false;

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
    const outstanding = BigInt(activeDebtor.outstandingMinor);
    if (outstanding <= 0n) {
      setDispatchFeedback({
        ok: false,
        messageAr: "لا يوجد رصيد مستحق على هذا العميل — الحساب مسدد بالكامل.",
        messageEn: "This customer has no outstanding balance — the account is fully settled.",
      });
      return;
    }
    const amountMinorNum = Number(outstanding);
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
          startDateIso: overview?.todayIso ?? todayIso(),
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
        setSuggestedSendTime(
          formatDateTime(new Date(), msgLocale === "en" ? "en-US" : "ar-EG-u-nu-latn", {
            hour: "2-digit",
            minute: "2-digit",
            timeZoneName: "short",
          }),
        );
      } else {
        const res = await trpc.aiWorkspace.generateNotification.mutate({
          debtorId: activeDebtor.debtorId,
          debtorName: activeDebtor.displayName,
          amountMinor: amountMinorNum,
          daysOverdue: activeDebtor.maxDaysOverdue,
          dueDate: overview?.todayIso ?? todayIso(),
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
      setDispatchFeedback({
        ok: false,
        messageAr: "تعذر توليد الرسالة أو خطة الجدولة. حاول مرة أخرى.",
        messageEn: "Could not generate the message or installment plan. Please try again.",
      });
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
    inbox_triage: { ar: "راجع الشيكات المستحقة والاعتراضات وردود الواتساب", en: "Review due/bounced cheques, open disputes, and WhatsApp replies" },
    settlement_options: { ar: "اقترح خطة جدولة وأقساط لأعلى مديونية", en: "Propose an installment settlement plan for top overdue balance" },
    optimize_reminders: { ar: "ما هو أفضل وقت لإرسال تذكيرات السداد اليوم؟", en: "What is the optimal window to dispatch overdue reminders today?" },
    action_plan: { ar: "ما هي خطة العمل التشغيلية المقترحة اليوم؟", en: "What is today's recommended collection action plan?" },
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

    abortRef.current?.abort();
    const localAssistantId = `stream-${Date.now()}`;
    const controller = new AbortController();
    abortRef.current = controller;
    setLivePhase("reading_context");
    setLiveTools([]);
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
        signal: controller.signal,
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
        const dataLine = block.split("\n").find((line) => line.startsWith("data:"));
        if (!dataLine) return;
        let event: {
          type: string; text?: string; response?: CopilotAnswer; message?: string; phase?: "reading_context" | "thinking" | "writing";
          id?: string; titleAr?: string; titleEn?: string; ok?: boolean; summaryAr?: string; summaryEn?: string;
        };
        try {
          event = JSON.parse(dataLine.slice(5).replace(/^ /, "")) as typeof event;
        } catch {
          return;
        }
        if (event.type === "status" && event.phase) setLivePhase(event.phase);
        else if (event.type === "tool_start" && event.id) {
          // Text written before a tool call is narration, not the answer: restart the bubble.
          setPersistedMessages((prev) => prev.map((m) => m.id === localAssistantId ? { ...m, content: "" } : m));
          setLiveTools((prev) => [...prev, { id: event.id!, titleAr: event.titleAr ?? "", titleEn: event.titleEn ?? "", state: "running" }]);
        } else if (event.type === "tool_result" && event.id) {
          setLiveTools((prev) => prev.map((t) => t.id === event.id ? { ...t, state: event.ok ? "done" : "failed", summaryAr: event.summaryAr, summaryEn: event.summaryEn } : t));
        } else if (event.type === "token" && event.text) {
          setLivePhase("writing");
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
        ? { ...message, content: isEn ? typed.answerEn : typed.answerAr } : message));
      void loadCopilotConversations();
    } catch (error) {
      if (controller.signal.aborted) {
        setPersistedMessages((prev) => prev.filter((message) => message.id !== localAssistantId || message.content));
        return;
      }
      setCopilotError(error instanceof Error && (error.message === "AI_GLOBAL_BUDGET_EXCEEDED" || error.message === "GLOBAL_AI_BUDGET_EXCEEDED")
        ? (isEn ? "The platform AI monthly budget has been reached." : "تم الوصول إلى سقف إنفاق المنصة الشهري على AI.")
        : (isEn ? "The assistant could not complete this request. No action was executed." : "تعذر إكمال طلب المساعد. لم يتم تنفيذ أي إجراء."));
      setPersistedMessages((prev) => prev.filter((message) => message.id !== localAssistantId));
    } finally {
      if (abortRef.current === controller) {
        setAsking(false);
        setLivePhase(null);
        abortRef.current = null;
      }
    }
  };

  const stopAsking = () => abortRef.current?.abort();

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
        className="fixed bottom-20 end-4 sm:end-5 z-50 flex w-[310px] items-center justify-between gap-2 rounded-2xl border border-border bg-card px-4 py-3 shadow-2xl"
      >
        <button
          type="button"
          onClick={() => setIsMinimized(false)}
          className="flex min-w-0 flex-1 items-center gap-2.5 text-start"
        >
          <DafqlyAiMascot size={34} mood={asking ? (livePhase === "writing" ? "writing" : "thinking") : "idle"} />
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
            className={cn(buttonVariants({ variant: "secondary", size: "icon" }), "size-7")}
          >
            <ArrowsOutSimple size={14} strokeWidth={2.5} aria-hidden />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={isEn ? "Close" : "إغلاق"}
            className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "size-7")}
          >
            <X size={14} strokeWidth={2.5} aria-hidden />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="ai-copilot-drawer-title"
      data-testid="ai-copilot-drawer"
      className={`fixed end-4 z-50 flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl transition-all duration-200 sm:end-5 ${
        isExpanded
          ? "bottom-20 h-[min(84dvh,760px)] w-[min(94vw,760px)]"
          : "bottom-20 h-[min(76dvh,590px)] w-[min(92vw,430px)]"
      }`}
    >
      {/* Pop-up Window Header with Minimize, Expand/Restore & Close Controls */}
      <div className="flex shrink-0 items-center justify-between border-b border-border bg-card px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <DafqlyAiMascot size={38} mood={asking ? (livePhase === "writing" ? "writing" : "thinking") : copilotAnswer ? "happy" : "idle"} followPointer />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h2 id="ai-copilot-drawer-title" className="truncate text-xs font-extrabold text-text sm:text-sm">
                {isEn ? "DAFQLY AI Copilot" : "مساعد دفقلي الذكي"}
              </h2>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 font-mono text-[10px] font-semibold text-foreground">
                <Cpu size={10} aria-hidden />
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
            className={cn(buttonVariants({ variant: "outline", size: "icon" }), "size-7")}
          >
            <Minus size={14} strokeWidth={2.5} aria-hidden />
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
            className={cn(buttonVariants({ variant: "outline", size: "icon" }), "size-7")}
          >
            {isExpanded ? (
              <ArrowsInSimple size={14} strokeWidth={2.5} aria-hidden />
            ) : (
              <ArrowsOutSimple size={14} strokeWidth={2.5} aria-hidden />
            )}
          </button>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label={isEn ? "Close" : "إغلاق"}
            title={isEn ? "Close (Esc)" : "إغلاق (Esc)"}
            className={cn(buttonVariants({ variant: "outline", size: "icon" }), "size-7")}
          >
            <X size={14} strokeWidth={2.5} aria-hidden />
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
            className={cn(buttonVariants({ variant: tab === id ? "secondary" : "ghost", size: "sm" }), !(tab === id) && "text-text-muted")}
          >
            <Icon size={13} aria-hidden />
            <span>{isEn ? labelEn : labelAr}</span>
          </button>
        ))}
      </div>

      {/* Global Dispatch Feedback Banner */}
      {dispatchFeedback && (
        <div
          role={dispatchFeedback.ok ? "status" : "alert"}
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
            <X size={13} strokeWidth={2.5} />
          </button>
        </div>
      )}

      {/* Tab Body */}
      <div className="flex-1 overflow-y-auto p-4">
        {tab === "briefing" && (
          <div className="flex flex-col gap-3.5">
            {loadingOverview && !overview ? (
              <p className="py-10 text-center text-xs text-text-muted">
                {isEn ? "Analyzing workspace..." : "جاري تحليل بيانات دفقلي..."}
              </p>
            ) : overview ? (
              <>
                {/* Executive Summary Card */}
                <div className="rounded-xl border border-border bg-muted/50 p-3.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded bg-surface px-2.5 py-0.5 text-[11px] font-bold text-primary">
                      <Sparkle size={11} aria-hidden />
                      {isEn ? "Executive Briefing" : "الملخص التنفيذي"}
                    </span>
                    <span
                      className={`rounded px-2.5 py-0.5 text-[10px] font-bold ${
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
                      <p className="text-xs font-bold text-text tabular-nums sm:text-sm">{formatPct(overview.metrics.collectionRate)}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-text-muted">{isEn ? "DSO" : "متوسط التحصيل"}</p>
                      <p className="text-xs font-bold text-text tabular-nums sm:text-sm">
                        {formatDso(overview.metrics.dsoDays)} {isEn ? "d" : "ي"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-text-muted">{isEn ? "Overdue" : "المتأخرات"}</p>
                      <p className="text-xs font-bold text-status-overdue-fg tabular-nums sm:text-sm" dir="ltr">
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
                      className={cn(buttonVariants({ variant: "default", size: "sm" }), "w-full")}
                    >
                      <ClockCountdown size={14} aria-hidden />
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
                  <div className="rounded-xl border border-border bg-surface p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 text-xs font-bold text-text">
                        <ChartLineUp size={14} className="text-primary" aria-hidden />
                        {isEn ? "Liquidity & Portfolio Risk" : "السيولة وتركز المحفظة"}
                      </span>
                      <span className="rounded bg-callout px-2 py-0.5 text-[10px] font-bold text-primary tabular-nums">
                        {isEn
                          ? `Velocity ${overview.portfolioRisk.velocityScore}/100`
                          : `السرعة ${overview.portfolioRisk.velocityScore}/100`}
                      </span>
                    </div>
                    <div className="mt-2.5 grid grid-cols-2 gap-2">
                      <div className="rounded-xl bg-surface-muted/50 p-2">
                        <p className="text-[10px] text-text-muted">
                          {isEn ? "14-Day Expected Inflow" : "سيولة متوقعة (14 يوماً)"}
                        </p>
                        <p className="mt-0.5 text-xs font-extrabold text-status-paid-fg tabular-nums" dir="ltr">
                          {formatAmountOnly(BigInt(overview.portfolioRisk.expectedNext14DaysMinor))} {currencySymbol}
                        </p>
                      </div>
                      <div className="rounded-xl bg-surface-muted/50 p-2">
                        <p className="text-[10px] text-text-muted">
                          {isEn ? "Top Debtor Share" : "تركز أعلى مدين"}
                        </p>
                        <p className="mt-0.5 text-xs font-extrabold text-text tabular-nums">
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
                      <UsersThree size={14} className="text-primary" aria-hidden />
                      {isEn ? "Recommended Customer Actions" : "اقتراحات متابعة العملاء"}
                    </h4>
                    <span className="text-[10px] text-text-muted tabular-nums">
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
                            <div className="min-w-0 flex-1">
                              <Link
                                href={`/${locale}/debtors/${d.debtorId}`}
                                onClick={onClose}
                                className="text-xs font-bold text-text hover:text-primary"
                              >
                                {d.displayName}
                              </Link>
                              <p className="mt-0.5 text-[11px] text-text-muted tabular-nums">
                                {formatAmountOnly(BigInt(d.outstandingMinor))} {currencySymbol}
                                {d.maxDaysOverdue > 0 &&
                                  ` · ${isEn ? `${d.maxDaysOverdue}d overdue` : `متأخر ${d.maxDaysOverdue} يوم`}`}
                              </p>
                            </div>
                            <span
                              className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold tabular-nums ${tierBadgeClass(d.tier)}`}
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
                              className={cn(buttonVariants({ variant: "soft", size: "xs" }))}
                            >
                              <Sparkle size={11} aria-hidden />
                              {isEn ? "Draft Reminder" : "صياغة تنبيه"}
                            </button>
                            {!d.optedOut && (
                              <button
                                type="button"
                                disabled={dispatchingReminder}
                                onClick={() => void handleDispatchSmartReminder(d.debtorId, d.recommendation.suggestedTone)}
                                className={cn(buttonVariants({ variant: "success", size: "xs" }), "text-status-paid-fg")}
                              >
                                <ClockCountdown size={11} aria-hidden />
                                {isEn ? "Send at Best Time" : "إرسال في أفضل وقت"}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleSelectDebtorForComposer(d, "installment")}
                              className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
                            >
                              <CalendarCheck size={11} aria-hidden />
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
                className={cn(buttonVariants({ variant: composerMode === "reminder" ? "secondary" : "ghost", size: "sm" }), !(composerMode === "reminder") && "text-text-muted")}
              >
                <Sparkle size={12} aria-hidden />
                <span>{isEn ? "Smart Reminder" : "تذكير ذكي"}</span>
              </button>
              <button
                type="button"
                data-testid="composer-mode-installment"
                disabled={isActiveSettled}
                onClick={() => {
                  setComposerMode("installment");
                  setDraftText("");
                }}
                className={cn(buttonVariants({ variant: composerMode === "installment" ? "secondary" : "ghost", size: "sm" }), !(composerMode === "installment") && "text-text-muted")}
              >
                <CalendarCheck size={12} aria-hidden />
                <span>{isEn ? "Installment Plan" : "خطة جدولة وأقساط"}</span>
              </button>
            </div>

            <div className="flex min-w-0 flex-col gap-1">
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
                className={cn(inputVariants)}
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
                <WarningCircle size={15} aria-hidden />
                <span>
                  {isEn
                    ? "Customer opted out of reminders. Automated dispatch is blocked."
                    : "العميل أوقف استقبال التذكيرات — الإرسال التلقائي محظور."}
                </span>
              </div>
            )}

            {composerMode === "reminder" ? (
              <div className="grid grid-cols-2 gap-2.5">
                <div className="flex min-w-0 flex-col gap-1">
                  <label className="text-xs font-bold text-text-muted">
                    {isEn ? "Message Tone" : "نبرة الرسالة"}
                  </label>
                  <select
                    value={tone}
                    onChange={(e) => setTone(e.target.value as NotificationTone)}
                    className={cn(inputVariants)}
                  >
                    <option value="friendly">{isEn ? "Friendly" : "ودية"}</option>
                    <option value="polite">{isEn ? "Polite" : "رسمية مهذبة"}</option>
                    <option value="firm">{isEn ? "Firm" : "حازمة"}</option>
                    <option value="urgent">{isEn ? "Urgent" : "عاجلة"}</option>
                  </select>
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                  <label className="text-xs font-bold text-text-muted">
                    {isEn ? "Language" : "لغة الرسالة"}
                  </label>
                  <select
                    value={msgLocale}
                    onChange={(e) => setMsgLocale(e.target.value as "ar" | "en")}
                    className={cn(inputVariants)}
                  >
                    <option value="ar">العربية</option>
                    <option value="en">English</option>
                  </select>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <label className="text-[11px] font-bold text-text-muted">
                    {isEn ? "Installments" : "عدد الدفعات"}
                  </label>
                  <select
                    value={installmentsCount}
                    onChange={(e) => setInstallmentsCount(Number(e.target.value) as 2 | 3 | 4 | 6)}
                    className={cn(inputVariants)}
                  >
                    <option value={2}>{isEn ? "2 payments" : "دفعتان (2)"}</option>
                    <option value={3}>{isEn ? "3 payments" : "3 دفعات"}</option>
                    <option value={4}>{isEn ? "4 payments" : "4 دفعات"}</option>
                    <option value={6}>{isEn ? "6 payments" : "6 دفعات"}</option>
                  </select>
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                  <label className="text-[11px] font-bold text-text-muted">
                    {isEn ? "Cadence" : "الفترة"}
                  </label>
                  <select
                    value={interval}
                    onChange={(e) => setInterval(e.target.value as "weekly" | "biweekly" | "monthly")}
                    className={cn(inputVariants)}
                  >
                    <option value="weekly">{isEn ? "Weekly" : "أسبوعي"}</option>
                    <option value="biweekly">{isEn ? "Bi-weekly" : "كل أسبوعين"}</option>
                    <option value="monthly">{isEn ? "Monthly" : "شهري"}</option>
                  </select>
                </div>
                <div className="flex min-w-0 flex-col gap-1">
                  <label className="text-[11px] font-bold text-text-muted">
                    {isEn ? "Down Payment" : "الدفعة المقدمة"}
                  </label>
                  <select
                    value={downPaymentPct}
                    onChange={(e) => setDownPaymentPct(Number(e.target.value) as 0 | 10 | 20 | 25 | 30 | 50)}
                    className={cn(inputVariants)}
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
                disabled={!activeDebtor || generatingMsg || isActiveSettled}
                onClick={() => void handleGenerateMessage()}
                className={cn(buttonVariants({ variant: "default", size: "sm" }), "flex-1")}
              >
                <Sparkle size={14} aria-hidden />
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
                  className={cn(buttonVariants({ variant: "soft", size: "sm" }))}
                >
                  <ClockCountdown size={14} aria-hidden />
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
              <div className="rounded-xl border border-border bg-callout/35 p-3">
                {installmentPlan.settled ? (
                  <p className="text-xs font-medium text-text">
                    {isEn
                      ? (installmentPlan.settledMessageEn ?? "No outstanding balance — the account is fully settled.")
                      : (installmentPlan.settledMessageAr ?? "لا يوجد رصيد مستحق — الحساب مسدد بالكامل.")}
                  </p>
                ) : (
                  <>
                <div className="mb-1.5 flex items-center justify-between text-xs font-bold text-text">
                  <span className="tabular-nums">
                    {isEn ? "Installment Schedule" : "جدول الدفعات المقترح"} ({installmentPlan.formattedTotal}{" "}
                    {installmentPlan.currency})
                  </span>
                  <span className="rounded bg-surface px-2 py-0.5 text-[10px] text-primary tabular-nums">
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
                        <span className="text-[11px] text-text-muted tabular-nums" dir="ltr">
                          {tr.dueDate}
                        </span>
                        <span className="tnum tabular-nums font-bold text-primary" dir="ltr">
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
              <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-muted/40 p-3">
                <div className="flex items-center justify-between text-[11px] text-text-muted">
                  <span>
                    {isEn ? "Suggested send window:" : "أفضل وقت للإرسال:"} {suggestedSendTime}
                  </span>
                  <span className="rounded bg-callout px-2 py-0.5 font-bold text-primary">
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
                  className={cn(inputVariants, "w-full")}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleCopyDraft()}
                    className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                  >
                    {copied ? <Check size={13} className="text-primary" /> : <Copy size={13} />}
                    <span>{copied ? (isEn ? "Copied" : "تم النسخ") : isEn ? "Copy" : "نسخ"}</span>
                  </button>
                  {waHref && (
                    <a
                      href={waHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded bg-status-paid-bg px-3 py-1 text-xs font-bold text-status-paid-fg transition-opacity hover:opacity-90"
                    >
                      <WhatsappLogo size={13} aria-hidden />
                      <span>{isEn ? "Open WhatsApp" : "فتح واتساب"}</span>
                    </a>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "assistant" && (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            {/* Top Conversation Management Bar */}
            <div className="flex flex-col gap-2">
              {renaming && conversationId ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleRenameConversation();
                  }}
                  className="flex items-center gap-1.5"
                >
                  <input
                    type="text"
                    value={renameDraft}
                    maxLength={80}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    placeholder={isEn ? "Conversation title..." : "اسم المحادثة..."}
                    className={cn(inputVariants, "h-8 min-h-0 flex-1 text-xs")}
                    autoFocus
                  />
                  <button type="submit" className={cn(buttonVariants({ variant: "default", size: "xs" }))}>
                    {isEn ? "Save" : "حفظ"}
                  </button>
                  <button type="button" onClick={() => setRenaming(false)} className={cn(buttonVariants({ variant: "ghost", size: "xs" }))}>
                    {isEn ? "Cancel" : "إلغاء"}
                  </button>
                </form>
              ) : (
                <div className="flex items-center gap-1.5">
                  <select
                    aria-label={isEn ? "Saved AI conversations" : "المحادثات المحفوظة"}
                    value={conversationId ?? ""}
                    onChange={(event) => void openSavedConversation(event.target.value)}
                    disabled={loadingConversation || asking}
                    className={cn(inputVariants, "h-8 min-h-0 min-w-0 flex-1 text-xs")}
                  >
                    <option value="">{isEn ? "New / Current chat" : "محادثة جديدة / الحالية"}</option>
                    {conversationList.map((item) => (
                      <option key={item.id} value={item.id}>{item.title}</option>
                    ))}
                  </select>
                  {conversationId && (
                    <>
                      <button
                        type="button"
                        title={isEn ? "Rename chat" : "إعادة تسمية"}
                        aria-label={isEn ? "Rename chat" : "إعادة تسمية"}
                        disabled={asking || loadingConversation}
                        onClick={() => {
                          const cur = conversationList.find((c) => c.id === conversationId);
                          setRenameDraft(cur?.title ?? "");
                          setRenaming(true);
                        }}
                        className={cn(buttonVariants({ variant: "outline", size: "iconSm" }), "size-8 shrink-0")}
                      >
                        <PencilSimple size={13} />
                      </button>
                      <button
                        type="button"
                        title={isEn ? "Delete chat" : "حذف المحادثة"}
                        aria-label={isEn ? "Delete chat" : "حذف المحادثة"}
                        disabled={asking || loadingConversation}
                        onClick={() => void handleDeleteConversation(conversationId)}
                        className={cn(buttonVariants({ variant: "outline", size: "iconSm" }), "size-8 shrink-0 text-danger hover:bg-danger-bg")}
                      >
                        <Trash size={13} />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={startNewConversation}
                    disabled={asking || loadingConversation}
                    className={cn(buttonVariants({ variant: "outline", size: "xs" }), "h-8 shrink-0")}
                  >
                    {isEn ? "New" : "جديد"}
                  </button>
                  {conversationList.length > 0 && (
                    <button
                      type="button"
                      onClick={() => void handleClearAllConversations()}
                      disabled={asking || loadingConversation}
                      title={isEn ? "Clear all chats" : "مسح كل المحادثات"}
                      className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "h-8 shrink-0 text-danger hover:bg-danger-bg")}
                    >
                      {isEn ? "Clear all" : "مسح الكل"}
                    </button>
                  )}
                </div>
              )}
              {loadingConversation && <p className="text-[11px] text-muted-foreground">{isEn ? "Loading…" : "جارٍ التحميل…"}</p>}
              {copilotError && <p role="alert" className="rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger">{copilotError}</p>}
            </div>

            {/* Middle Scrollable Q&A Chat Area (Questions + Answers + Tool Trace) */}
            <div
              role="log"
              aria-live="polite"
              aria-relevant="additions text"
              aria-label={isEn ? "AI Copilot conversation" : "محادثة المساعد الذكي"}
              className="flex min-h-[220px] flex-1 flex-col gap-3 overflow-y-auto scroll-smooth rounded-2xl border border-border bg-background/60 p-3.5"
            >
              {!asking && !copilotAnswer && persistedMessages.length === 0 && (
                <div className="my-auto flex flex-col items-center gap-3 py-5 text-center">
                  <DafqlyAiMascot size={68} mood="idle" followPointer />
                  <div className="flex flex-col gap-1">
                    <p className="text-xs font-bold text-foreground">
                      {isEn ? "Hi! I am your DAFQLY AI assistant." : "أهلاً بك! أنا مساعد دفقلي الذكي."}
                    </p>
                    <p className="max-w-xs text-[11px] text-muted-foreground">
                      {isEn ? "Ask me about any customer, overdue balance, or optimal reminder." : "اسألني عن أي عميل، المتأخرات، أو أفضل وقت للتذكير."}
                    </p>
                  </div>
                  <div className="mt-1 flex w-full max-w-xs flex-col gap-1.5">
                    {(
                      [
                        { id: "daily_summary", en: "Summarize today's collections & urgent items", ar: "لخّص تحصيلات اليوم والأمور العاجلة" },
                        { id: "priority_customers", en: "Who are the top overdue customers to follow up?", ar: "من هم أهم العملاء المتأخرين للمتابعة؟" },
                        { id: "forecast_and_risk", en: "Analyze 14-day cashflow & concentration risk", ar: "حلّل السيولة المتوقعة ومخاطر تركز المحفظة" },
                      ] as const
                    ).map((starter) => (
                      <button
                        key={starter.id}
                        type="button"
                        onClick={() => void runCopilotIntent(starter.id)}
                        className="rounded-xl border border-border/80 bg-card px-3 py-2 text-start text-[11px] font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-callout/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                      >
                        {isEn ? starter.en : starter.ar}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {persistedMessages.slice(-24).map((message) => {
                const isUser = message.role === "user";
                const isStreamingThis = asking && message.id.startsWith("stream-");
                return (
                  <div
                    key={message.id}
                    className={`ai-rise group flex max-w-[92%] flex-col gap-1 ${isUser ? "self-end items-end" : "self-start items-start"}`}
                  >
                    <div
                      className={`text-xs leading-relaxed whitespace-pre-line ${isStreamingThis && message.content ? "ai-caret " : ""}${
                        isUser
                          ? "rounded-2xl rounded-ee-sm bg-primary px-3.5 py-2.5 text-primary-foreground"
                          : "rounded-2xl rounded-es-sm border border-border bg-card px-3.5 py-2.5 text-foreground"
                      }`}
                    >
                      {message.content ? (
                        isUser ? message.content : <CopilotMessageBody content={message.content} />
                      ) : isStreamingThis ? (
                        <span className="ai-dots py-1" aria-label={isEn ? "Generating" : "جارٍ الكتابة"}><i /><i /><i /></span>
                      ) : null}
                    </div>
                    {!isUser && message.content && !isStreamingThis && (
                      <button
                        type="button"
                        onClick={() => void handleCopyMessage(message.id, stripMarkdownMarkers(message.content))}
                        className="inline-flex items-center gap-1 px-1 text-[10px] font-semibold text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                      >
                        {copiedMsgId === message.id ? <Check size={10} /> : <Copy size={10} />}
                        <span>{copiedMsgId === message.id ? (isEn ? "Copied" : "تم النسخ") : (isEn ? "Copy" : "نسخ")}</span>
                      </button>
                    )}
                  </div>
                );
              })}

              {/* Live Tool Execution Pills inside Chat */}
              {asking && liveTools.length > 0 && (
                <div className="ai-rise flex flex-col gap-1.5 rounded-xl border border-border bg-muted/40 p-2.5 text-[11px]" role="status" aria-live="polite">
                  {liveTools.map((tool, i) => (
                    <div key={tool.id} style={{ ["--i" as string]: i }} className="ai-step flex min-w-0 items-center justify-between gap-2 rounded-lg bg-card px-2.5 py-1.5">
                      <span className="flex shrink-0 items-center gap-1.5 font-bold">
                        {tool.state === "running" ? <span className="ai-spin" aria-hidden="true" /> : <span className={tool.state === "done" ? "text-status-paid-fg" : "text-destructive"} aria-hidden="true">{tool.state === "done" ? "✓" : "!"}</span>}
                        {isEn ? tool.titleEn : tool.titleAr}
                      </span>
                      {tool.state !== "running" && <span className="truncate text-muted-foreground">{isEn ? tool.summaryEn : tool.summaryAr}</span>}
                    </div>
                  ))}
                </div>
              )}

              {/* Inline Action Cards & Tool Trace for Latest Answer */}
              {copilotAnswer && !asking && (
                <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-muted/35 p-3 text-xs">
                  {copilotAnswer.toolCalls && copilotAnswer.toolCalls.length > 0 && (
                    <div className="flex flex-col gap-1">
                      <span className="flex items-center gap-1 text-[10px] font-bold text-muted-foreground">
                        <Cpu size={11} aria-hidden />
                        <span>
                          {copilotAnswer.aiMode === "live"
                            ? (isEn ? `Used ${copilotAnswer.toolCalls.length} workspace tool(s)` : `استخدم ${copilotAnswer.toolCalls.length} من أدوات مساحة العمل`)
                            : (isEn ? "Deterministic workspace analysis" : "تحليل مباشر من النظام")}
                          {copilotAnswer.aiMode !== "live" && copilotAnswer.aiFallbackReason ? (
                            <span className="ms-1.5 rounded bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
                              {copilotAnswer.aiFallbackReason === "global_budget_exceeded"
                                ? (isEn ? "AI budget cap reached" : "تم بلوغ حد ميزانية الذكاء الاصطناعي")
                                : copilotAnswer.aiFallbackReason === "daily_token_budget_exceeded"
                                  ? (isEn ? "Daily token limit reached" : "تم بلوغ الحد اليومي")
                                  : copilotAnswer.aiFallbackReason === "provider_not_configured"
                                    ? (isEn ? "AI provider not configured" : "مزود الذكاء غير مُفعّل")
                                    : copilotAnswer.aiFallbackReason === "provider_error"
                                      ? (isEn ? "AI provider error" : "خطأ في مزود الذكاء")
                                      : (isEn ? "Empty AI response" : "استجابة فارغة")}
                            </span>
                          ) : null}
                        </span>
                      </span>
                      <div className="flex flex-col gap-1">
                        {copilotAnswer.toolCalls.map((tc, idx) => (
                          <div
                            key={`${tc.toolName}-${idx}`}
                            data-testid={`copilot-tool-call-${tc.toolName}`}
                            className="flex min-w-0 items-center justify-between gap-2 rounded-lg bg-card px-2.5 py-1 text-[10px]"
                          >
                            <span className="shrink-0 font-bold text-foreground">{isEn ? tc.titleEn : tc.titleAr}</span>
                            <span className={`truncate ${tc.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}>
                              {isEn ? tc.summaryEn : tc.summaryAr}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {copilotAnswer.matchedDebtor && (
                    <div className="rounded-xl border border-border bg-card p-2.5">
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-xs font-bold text-foreground">{copilotAnswer.matchedDebtor.displayName}</span>
                        <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-bold ${copilotAnswer.matchedDebtor.optimalWindow.canSend ? "bg-status-paid-bg text-status-paid-fg" : "bg-danger-bg text-danger"}`}>
                          {isEn ? copilotAnswer.matchedDebtor.optimalWindow.windowLabelEn : copilotAnswer.matchedDebtor.optimalWindow.windowLabelAr}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {isEn ? copilotAnswer.matchedDebtor.optimalWindow.strategyReasonEn : copilotAnswer.matchedDebtor.optimalWindow.strategyReasonAr}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {copilotAnswer.matchedDebtor.optimalWindow.canSend && (
                          <button
                            type="button"
                            disabled={dispatchingReminder}
                            onClick={() => void handleDispatchSmartReminder(copilotAnswer.matchedDebtor!.debtorId, copilotAnswer.matchedDebtor!.optimalWindow.recommendedTone)}
                            className={cn(buttonVariants({ variant: "default", size: "xs" }))}
                          >
                            <ClockCountdown size={12} aria-hidden />
                            <span>{isEn ? "Dispatch Smart Reminder" : "إرسال تذكير ذكي"}</span>
                          </button>
                        )}
                        {BigInt(copilotAnswer.matchedDebtor.outstandingMinor) > 0n && (
                          <button
                            type="button"
                            onClick={() => handleSelectDebtorForComposer(copilotAnswer.matchedDebtor!, "installment")}
                            className={cn(buttonVariants({ variant: "secondary", size: "xs" }))}
                          >
                            <CalendarCheck size={11} aria-hidden />
                            <span>{isEn ? "Installment Plan" : "خطة تقسيط"}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}

                  {copilotAnswer.quickLinks.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5" data-testid="copilot-action-buttons">
                      {copilotAnswer.quickLinks.map((lnk) => {
                        const cleanPath = toSafeLocalePath(lnk.href, locale);
                        if (!cleanPath) return null;
                        return (
                          <button
                            key={lnk.href}
                            type="button"
                            onClick={() => {
                              setIsMinimized(true);
                              router.push(cleanPath);
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-primary/25 bg-primary/5 px-2.5 py-1.5 text-[11px] font-bold text-primary transition-colors hover:bg-primary/15"
                          >
                            <span>{isEn ? lnk.labelEn : lnk.labelAr}</span>
                            <ArrowSquareOut size={11} aria-hidden />
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        disabled={optimizingSchedule}
                        onClick={() => void handleOptimizeAllReminders()}
                        className={cn(buttonVariants({ variant: "outline", size: "xs" }))}
                      >
                        <ClockCountdown size={11} aria-hidden />
                        <span>{isEn ? "Optimize All" : "جدولة التذكيرات"}</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div ref={chatEndRef} />
            </div>

            {/* Bottom Pinned Quick Prompts + Typing Field (Nothing below this!) */}
            <div className="flex shrink-0 flex-col gap-2 pt-1">
              <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-0.5">
                {(
                  [
                    { id: "daily_summary", en: "Daily Briefing", ar: "ملخص اليوم" },
                    { id: "priority_customers", en: "Priority Customers", ar: "أهم العملاء" },
                    { id: "inbox_triage", en: "Cheques & Inbox", ar: "الشيكات والردود" },
                    { id: "optimize_reminders", en: "Optimal Reminders", ar: "توقيت التذكيرات" },
                    { id: "forecast_and_risk", en: "Liquidity & Risk", ar: "السيولة والمخاطر" },
                    { id: "settlement_options", en: "Settlement Plan", ar: "مقترح جدولة" },
                  ] as const
                ).map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    disabled={asking}
                    onClick={() => void runCopilotIntent(chip.id)}
                    className={cn(buttonVariants({ variant: "outline", size: "xs" }), "shrink-0 rounded-full")}
                  >
                    {isEn ? chip.en : chip.ar}
                  </button>
                ))}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!question.trim() || asking) return;
                  void runCopilotIntent("custom_question", question.trim());
                }}
                className="flex items-center gap-2 rounded-2xl border border-border bg-background p-1.5 shadow-xs transition-all duration-200 focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/20"
              >
                <input
                  ref={questionInputRef}
                  type="text"
                  data-testid="copilot-question-input"
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  maxLength={2000}
                  placeholder={isEn ? "Ask anything about your ledger..." : "اسأل عن أي عميل، فاتورة، أو خطة تحصيل..."}
                  className="min-w-0 flex-1 bg-transparent px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:outline-none"
                />
                {asking ? (
                  <button
                    type="button"
                    onClick={stopAsking}
                    aria-label={isEn ? "Stop generating" : "إيقاف التوليد"}
                    className={cn(buttonVariants({ variant: "destructive", size: "sm" }), "min-h-9 shrink-0 gap-1.5 rounded-full px-3.5 text-xs font-bold shadow-xs focus-visible:ring-2 focus-visible:ring-destructive focus-visible:ring-offset-1")}
                  >
                    <span className="size-2 rounded-[2px] bg-current" aria-hidden />
                    <span>{isEn ? "Stop" : "إيقاف"}</span>
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!question.trim()}
                    aria-label={isEn ? "Ask" : "إرسال"}
                    className={cn(buttonVariants({ variant: "default", size: "icon" }), "size-9 shrink-0 rounded-full")}
                  >
                    <PaperPlaneTilt size={15} aria-hidden />
                  </button>
                )}
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
