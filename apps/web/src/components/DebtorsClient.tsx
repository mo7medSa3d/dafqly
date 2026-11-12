"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { formatEgp } from "@tahseel/core";
import {
  ArrowLeft, BellRinging, BellSlash, CheckCircle, CurrencyCircleDollar,
  MagnifyingGlass, Phone, Plus, SortAscending, Sparkle, Users,
  WarningCircle, WhatsappLogo, X,
} from "@phosphor-icons/react";
import { trpc } from "@/lib/trpc-client";
import type { DebtorIntelligenceView } from "@/server/intelligence";
import { openAiCopilot } from "./AiCopilotDrawer";
import { useCurrency } from "./CurrencyContext";
import { EmptyState, InitialAvatar, Panel, btnPrimary, inputCls, labelCls } from "./ui";

interface Debtor {
  id: string;
  displayName: string;
  phoneE164: string;
  whatsappStatus: string;
  optedOut: boolean;
  notes?: string | null;
  riskFlag?: boolean;
  totalOutstandingMinor?: string;
  totalPaidMinor?: string;
  openInvoicesCount?: number;
  totalInvoicesCount?: number;
}

type FilterType = "all" | "ai_priority" | "has_balance" | "settled" | "opted_out" | "risk";
type SortType = "default" | "ai_priority" | "balance_desc" | "newest" | "name_asc";

const fmt = (minor: string | undefined) => formatEgp(BigInt(minor || "0"));

export function DebtorsClient({ businessName }: { businessName?: string }) {
  const router = useRouter();
  const t = useTranslations("debtors");
  const locale = useLocale();
  const isAr = locale === "ar";
  const { symbol: currencySymbol } = useCurrency();
  const effectiveBusinessName = businessName || (isAr ? "منشأتك" : "Your Business");

  const [items, setItems] = useState<Debtor[]>([]);
  const [intelById, setIntelById] = useState<Record<string, DebtorIntelligenceView>>({});
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");
  const [sort, setSort] = useState<SortType>("default");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<string | null>(null);

  const loadIntel = useCallback(async () => {
    try {
      const intelRes = await trpc.intelligence.overview.query({ syncNotifications: false });
      if (intelRes) {
        const map: Record<string, DebtorIntelligenceView> = {};
        for (const score of intelRes.debtorScores) {
          map[score.debtorId] = score;
        }
        setIntelById(map);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadIntel();
  }, [loadIntel]);

  const load = useCallback(async (q: string) => {
    try {
      const page = await trpc.debtors.list.query({ search: q || undefined, limit: 200 });
      setItems((page.items as unknown) as Debtor[]);
    } catch {
      /* ignore */
    }
  }, []);

  // Debounce search input to avoid flood of network calls on typing
  useEffect(() => {
    const timer = setTimeout(() => {
      void load(search);
    }, 200);
    return () => clearTimeout(timer);
  }, [search, load]);

  async function onCreate() {
    setBusy(true);
    setError(null);
    try {
      await trpc.debtors.create.mutate({ displayName: name, phone, notes: notes || undefined });
      setName("");
      setPhone("");
      setNotes("");
      await Promise.all([load(search), loadIntel()]);
      router.refresh();
      setFeedbackMsg(isAr ? "تمت إضافة العميل بنجاح." : "Customer added successfully.");
      setTimeout(() => setFeedbackMsg(null), 3000);
    } catch {
      setError(t("saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function onToggleReminders(debtorId: string, enabled: boolean) {
    setTogglingId(debtorId);
    try {
      await trpc.debtors.toggleReminders.mutate({ id: debtorId, enabled });
      setItems((prev) =>
        prev.map((d) => (d.id === debtorId ? { ...d, optedOut: !enabled } : d))
      );
      setFeedbackMsg(
        enabled
          ? (isAr ? "تم تفعيل التذكيرات التلقائية بنجاح." : "Auto reminders enabled successfully.")
          : (isAr ? "تم إيقاف التذكيرات التلقائية مؤقتاً." : "Auto reminders paused.")
      );
      setTimeout(() => setFeedbackMsg(null), 3500);
    } catch {
      setFeedbackMsg(isAr ? "تعذّر تغيير حالة التذكيرات" : "Failed to toggle reminders");
      setTimeout(() => setFeedbackMsg(null), 3000);
    } finally {
      setTogglingId(null);
    }
  }

  // Aggregate Metrics
  const totalOutstandingMinor = useMemo(() => {
    return items.reduce((sum, d) => sum + BigInt(d.totalOutstandingMinor || "0"), 0n);
  }, [items]);

  const debtCount = useMemo(() => {
    return items.filter((d) => BigInt(d.totalOutstandingMinor || "0") > 0n).length;
  }, [items]);

  const settledCount = useMemo(() => {
    return items.filter((d) => BigInt(d.totalOutstandingMinor || "0") === 0n).length;
  }, [items]);

  const optedOutCount = useMemo(() => {
    return items.filter((d) => d.optedOut).length;
  }, [items]);

  const riskCount = useMemo(() => {
    return items.filter((d) => d.riskFlag).length;
  }, [items]);

  const aiPriorityCount = useMemo(() => {
    return items.filter((d) => (intelById[d.id]?.priorityScore ?? 0) >= 30).length;
  }, [items, intelById]);

  // Filtering & Sorting
  const filteredItems = useMemo(() => {
    let result = items;
    if (filter === "ai_priority") {
      result = result.filter((d) => (intelById[d.id]?.priorityScore ?? 0) >= 30);
    } else if (filter === "has_balance") {
      result = result.filter((d) => BigInt(d.totalOutstandingMinor || "0") > 0n);
    } else if (filter === "settled") {
      result = result.filter((d) => BigInt(d.totalOutstandingMinor || "0") === 0n);
    } else if (filter === "opted_out") {
      result = result.filter((d) => d.optedOut);
    } else if (filter === "risk") {
      result = result.filter((d) => d.riskFlag);
    }

    return [...result].sort((a, b) => {
      if (sort === "ai_priority" || filter === "ai_priority") {
        const pa = intelById[a.id]?.priorityScore ?? 0;
        const pb = intelById[b.id]?.priorityScore ?? 0;
        return pb - pa;
      }
      if (sort === "balance_desc") {
        const balA = BigInt(a.totalOutstandingMinor || "0");
        const balB = BigInt(b.totalOutstandingMinor || "0");
        return balB > balA ? 1 : balB < balA ? -1 : 0;
      }
      if (sort === "name_asc") {
        return a.displayName.localeCompare(b.displayName);
      }
      return 0;
    });
  }, [items, intelById, filter, sort]);

  function getWhatsAppMessage(d: Debtor): string {
    const balance = BigInt(d.totalOutstandingMinor || "0");
    if (balance > 0n) {
      return isAr
        ? `مرحباً ${d.displayName}، تحية طيبة من ${effectiveBusinessName}. نود تذكيركم بوجود مستحقات بقيمة ${fmt(d.totalOutstandingMinor)} ${currencySymbol}. للتفاصيل أو السداد نسعد بتواصلكم.`
        : `Hello ${d.displayName}, greeting from ${effectiveBusinessName}. A gentle reminder that your outstanding balance is ${fmt(d.totalOutstandingMinor)} ${currencySymbol}. Thank you!`;
    }
    return isAr
      ? `مرحباً ${d.displayName}، تحية طيبة من ${effectiveBusinessName}. نود شكركم لتعاملكم الراقي، حسابكم لدينا مسدد بالكامل.`
      : `Hello ${d.displayName}, thank you for your business with ${effectiveBusinessName}. Your account is fully settled!`;
  }

  function openWhatsApp(d: Debtor) {
    const text = encodeURIComponent(getWhatsAppMessage(d));
    const cleanPhone = d.phoneE164.replace(/^\+/, "").replace(/\s+/g, "");
    window.open(`https://wa.me/${cleanPhone}?text=${text}`, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Top Overview Financial Summary Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:gap-4">
        <div className="panel-shadow flex flex-col gap-1 rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between text-text-muted">
            <span className="text-xs font-semibold">{isAr ? "إجمالي المستحق" : "Total Outstanding"}</span>
            <CurrencyCircleDollar size={18} weight="fill" className="text-primary" />
          </div>
          <span className="tnum text-xl font-black text-text" dir="ltr">
            {formatEgp(totalOutstandingMinor)} <span className="text-xs font-bold text-text-muted">{currencySymbol}</span>
          </span>
          <span className="text-[11px] text-text-muted">
            {isAr ? `على ${debtCount} عميل مدين` : `Across ${debtCount} debtors`}
          </span>
        </div>

        <div className="panel-shadow flex flex-col gap-1 rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between text-text-muted">
            <span className="text-xs font-semibold">{isAr ? "مسددين بالكامل" : "Fully Settled"}</span>
            <CheckCircle size={18} weight="fill" className="text-emerald-500" />
          </div>
          <span className="tnum text-xl font-black text-emerald-600 dark:text-emerald-400" dir="ltr">
            {settledCount}
          </span>
          <span className="text-[11px] text-text-muted">
            {isAr ? "حساباتهم خالصة 100%" : "Zero balance customers"}
          </span>
        </div>

        <div className="panel-shadow flex flex-col gap-1 rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between text-text-muted">
            <span className="text-xs font-semibold">{isAr ? "إجمالي العملاء" : "Total Customers"}</span>
            <Users size={18} weight="fill" className="text-primary" />
          </div>
          <span className="tnum text-xl font-black text-text" dir="ltr">
            {items.length}
          </span>
          <span className="text-[11px] text-text-muted">
            {isAr ? "مسجلين بالنظام" : "In the ledger"}
          </span>
        </div>

        <div className="panel-shadow flex flex-col gap-1 rounded-2xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between text-text-muted">
            <span className="text-xs font-semibold">{isAr ? "تذكيرات متوقفة" : "Paused Reminders"}</span>
            <BellSlash size={18} weight="fill" className="text-amber-500" />
          </div>
          <span className="tnum text-xl font-black text-amber-600 dark:text-amber-400" dir="ltr">
            {optedOutCount}
          </span>
          <span className="text-[11px] text-text-muted">
            {isAr ? "يمكنك تفعيلهم بنقرة" : "One-click resumable"}
          </span>
        </div>
      </div>

      {/* Live Customer Portfolio Health & Risk Distribution Chart */}
      {items.length > 0 && (() => {
        const scores = Object.values(intelById);
        const healthyCnt = scores.filter((s) => s.tier === "healthy").length || settledCount;
        const watchCnt = scores.filter((s) => s.tier === "watch").length;
        const atRiskCnt = scores.filter((s) => s.tier === "at_risk").length;
        const criticalCnt = scores.filter((s) => s.tier === "critical").length;
        const total = Math.max(1, healthyCnt + watchCnt + atRiskCnt + criticalCnt);
        return (
          <div data-testid="debtors-health-distribution" className="panel-shadow flex flex-col gap-2.5 rounded-2xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-bold text-text">
                {isAr ? "توزيع الصحة الائتمانية ومخاطر العملاء" : "Customer Credit Health & Risk Distribution"}
              </span>
              <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold text-text-muted">
                <span className="inline-flex items-center gap-1">
                  <span className="size-2 rounded-full bg-status-paid-fg" aria-hidden />
                  {isAr ? `منتظم (${healthyCnt})` : `Healthy (${healthyCnt})`}
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="size-2 rounded-full bg-primary" aria-hidden />
                  {isAr ? `مراقبة (${watchCnt})` : `Watch (${watchCnt})`}
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="size-2 rounded-full bg-yaseir-yellow" aria-hidden />
                  {isAr ? `مخاطرة (${atRiskCnt})` : `At Risk (${atRiskCnt})`}
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="size-2 rounded-full bg-status-overdue-fg" aria-hidden />
                  {isAr ? `حرج (${criticalCnt})` : `Critical (${criticalCnt})`}
                </span>
              </div>
            </div>
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-muted p-0.5">
              {healthyCnt > 0 && <div style={{ width: `${Math.max(5, Math.round((healthyCnt / total) * 100))}%` }} className="h-full bg-status-paid-fg first:rounded-s-full last:rounded-e-full" />}
              {watchCnt > 0 && <div style={{ width: `${Math.max(5, Math.round((watchCnt / total) * 100))}%` }} className="h-full bg-primary first:rounded-s-full last:rounded-e-full" />}
              {atRiskCnt > 0 && <div style={{ width: `${Math.max(5, Math.round((atRiskCnt / total) * 100))}%` }} className="h-full bg-yaseir-yellow first:rounded-s-full last:rounded-e-full" />}
              {criticalCnt > 0 && <div style={{ width: `${Math.max(5, Math.round((criticalCnt / total) * 100))}%` }} className="h-full bg-status-overdue-fg first:rounded-s-full last:rounded-e-full" />}
            </div>
          </div>
        );
      })()}

      {feedbackMsg && (
        <div
          role="status"
          className="flex items-center justify-between rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-700 dark:text-emerald-300"
        >
          <span>{feedbackMsg}</span>
          <button
            type="button"
            onClick={() => setFeedbackMsg(null)}
            className="text-text-muted hover:text-text"
          >
            <X size={16} weight="bold" />
          </button>
        </div>
      )}

      {/* Main Content Layout */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
        {/* Main List Column (8 cols) */}
        <section className="flex flex-col gap-4 lg:col-span-8">
          {/* Quick Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition-all ${
                filter === "all"
                  ? "bg-primary text-primary-fg shadow-xs"
                  : "border border-border bg-surface text-text-muted hover:bg-callout hover:text-text"
              }`}
            >
              <span>{isAr ? "الكل" : "All"}</span>
              <span className="rounded-full bg-surface/20 px-1.5 py-0.2 text-[10px]">{items.length}</span>
            </button>

            <button
              type="button"
              data-testid="filter-ai-priority"
              onClick={() => setFilter("ai_priority")}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition-all ${
                filter === "ai_priority"
                  ? "bg-primary text-primary-fg shadow-xs"
                  : "border border-border bg-surface text-text-muted hover:bg-callout hover:text-primary"
              }`}
            >
              <Sparkle size={14} weight="fill" aria-hidden />
              <span>{isAr ? "الأولوية الذكية" : "AI Priority"}</span>
              {aiPriorityCount > 0 && (
                <span className="rounded-full bg-callout px-1.5 py-0.2 text-[10px] text-primary">
                  {aiPriorityCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setFilter("has_balance")}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition-all ${
                filter === "has_balance"
                  ? "bg-primary text-primary-fg shadow-xs"
                  : "border border-border bg-surface text-text-muted hover:bg-callout hover:text-text"
              }`}
            >
              <span>{isAr ? "عليهم متبقي" : "Has Balance"}</span>
              <span className="rounded-full bg-red-500/20 px-1.5 py-0.2 text-[10px] text-red-500">
                {debtCount}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setFilter("settled")}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition-all ${
                filter === "settled"
                  ? "bg-emerald-600 text-white shadow-xs"
                  : "border border-border bg-surface text-text-muted hover:bg-callout hover:text-text"
              }`}
            >
              <CheckCircle size={14} weight="fill" className={filter === "settled" ? "text-white" : "text-emerald-500"} />
              <span>{isAr ? "مسددين بالكامل" : "Fully Settled"}</span>
              <span className="rounded-full bg-emerald-500/20 px-1.5 py-0.2 text-[10px] text-emerald-600 dark:text-emerald-400">
                {settledCount}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setFilter("opted_out")}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition-all ${
                filter === "opted_out"
                  ? "bg-amber-600 text-white shadow-xs"
                  : "border border-border bg-surface text-text-muted hover:bg-callout hover:text-text"
              }`}
            >
              <BellSlash size={14} weight="fill" className={filter === "opted_out" ? "text-white" : "text-amber-500"} />
              <span>{isAr ? "تذكيرات متوقفة" : "Paused"}</span>
              <span className="rounded-full bg-amber-500/20 px-1.5 py-0.2 text-[10px]">
                {optedOutCount}
              </span>
            </button>

            {riskCount > 0 && (
              <button
                type="button"
                onClick={() => setFilter("risk")}
                className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-bold transition-all ${
                  filter === "risk"
                    ? "bg-red-600 text-white shadow-xs"
                    : "border border-border bg-surface text-status-overdue-fg hover:bg-danger-bg"
                }`}
              >
                <WarningCircle size={14} weight="fill" />
                <span>{isAr ? "مخاطرة وشيكات" : "Risk"}</span>
                <span className="rounded-full bg-red-500/20 px-1.5 py-0.2 text-[10px]">
                  {riskCount}
                </span>
              </button>
            )}
          </div>

          {/* Search & Sort Toolbar */}
          <div className="panel-shadow flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-3.5 sm:p-4">
            <div className="relative min-w-[220px] flex-1">
              <span className="sr-only">{t("search")}</span>
              <MagnifyingGlass
                size={16}
                weight="fill"
                aria-hidden
                className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-text-subtle"
              />
              <input
                data-testid="debtor-search"
                className={`${inputCls} ps-9.5 text-xs sm:text-sm`}
                placeholder={isAr ? "ابحث بالاسم أو رقم الهاتف..." : "Search by name or phone..."}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text"
                >
                  <X size={14} weight="bold" />
                </button>
              )}
            </div>

            {/* Sort Selector */}
            <div className="flex items-center gap-2">
              <SortAscending size={16} weight="bold" className="text-text-muted" />
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortType)}
                className="rounded-xl border border-border bg-surface px-3 py-2 text-xs font-semibold text-text focus:border-primary focus:outline-hidden"
              >
                <option value="default">{isAr ? "الترتيب الافتراضي" : "Default"}</option>
                <option value="ai_priority">{isAr ? "أولوية المتابعة (AI)" : "AI Follow-up Priority"}</option>
                <option value="balance_desc">{isAr ? "الأعلى مديونية أولاً" : "Highest Balance First"}</option>
                <option value="name_asc">{isAr ? "أبجدي بالاسم (A-Z)" : "Alphabetical (A-Z)"}</option>
              </select>
            </div>
          </div>

          {/* Debtors List */}
          {filteredItems.length === 0 ? (
            <EmptyState
              testId="debtors-empty"
              title={
                search
                  ? (isAr ? `لا توجد نتائج مطابقة لـ "${search}"` : `No customers matching "${search}"`)
                  : t("empty")
              }
            />
          ) : (
            <div className="panel-shadow overflow-hidden rounded-2xl border border-border bg-surface">
              <ul className="flex flex-col divide-y divide-border">
                {filteredItems.map((d) => {
                  const balance = BigInt(d.totalOutstandingMinor || "0");
                  const hasDebt = balance > 0n;
                  const isToggling = togglingId === d.id;

                  return (
                    <li
                      key={d.id}
                      data-testid="debtor-row"
                      className="flex flex-col justify-between gap-3 p-4 transition-colors hover:bg-callout/40 sm:flex-row sm:items-center sm:p-5"
                    >
                      {/* Left: Avatar & Identity Details */}
                      <div className="flex min-w-0 items-start gap-3.5">
                        <InitialAvatar name={d.displayName} size={44} />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link
                              href={`/${locale}/debtors/${d.id}`}
                              className="truncate text-base font-bold text-text hover:text-primary transition-colors"
                            >
                              {d.displayName}
                            </Link>

                            {/* Debt / Settled status pill */}
                            {hasDebt ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-status-overdue-bg px-2.5 py-0.5 text-xs font-extrabold text-status-overdue-fg">
                                <span>{isAr ? "مستحق:" : "Due:"}</span>
                                <span className="tnum" dir="ltr">{fmt(d.totalOutstandingMinor)}</span>
                                <span className="text-[10px] font-bold">{currencySymbol}</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                                <CheckCircle size={13} weight="fill" />
                                <span>{isAr ? "خالص ومسدد" : "Fully Settled"}</span>
                              </span>
                            )}

                            {/* Risk Flag */}
                            {d.riskFlag && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-bold text-red-600 dark:text-red-400">
                                <WarningCircle size={12} weight="fill" />
                                <span>{isAr ? "شيك مرتد" : "Bounced Cheque"}</span>
                              </span>
                            )}

                            {/* Opted Out Pill */}
                            {d.optedOut && (
                              <span
                                data-testid="debtor-opted-out"
                                className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-bold text-amber-600 dark:text-amber-400"
                              >
                                <BellSlash size={12} weight="fill" />
                                <span>{isAr ? "تذكيرات متوقفة" : "Reminders Paused"}</span>
                              </span>
                            )}

                            {/* AI Health Score Pill */}
                            {intelById[d.id] && (
                              <span
                                className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                                  intelById[d.id]!.tier === "critical"
                                    ? "bg-status-overdue-bg text-status-overdue-fg"
                                    : intelById[d.id]!.tier === "at_risk"
                                      ? "bg-status-due-bg text-status-due-fg"
                                      : intelById[d.id]!.tier === "watch"
                                        ? "bg-callout text-primary"
                                        : "bg-status-paid-bg text-status-paid-fg"
                                }`}
                              >
                                <Sparkle size={11} weight="fill" aria-hidden />
                                <span>{intelById[d.id]!.healthScore}/100</span>
                              </span>
                            )}
                          </div>

                          {/* AI Suggested Next Action */}
                          {intelById[d.id] && hasDebt && (
                            <p className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold text-primary">
                              <Sparkle size={12} weight="fill" aria-hidden className="shrink-0" />
                              <span>
                                {isAr
                                  ? intelById[d.id]!.recommendation.titleAr
                                  : intelById[d.id]!.recommendation.titleEn}
                              </span>
                            </p>
                          )}

                          {/* Phone & Invoices summary */}
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
                            <span className="flex items-center gap-1" dir="ltr">
                              <Phone size={12} weight="fill" className="text-primary" />
                              <span>{d.phoneE164}</span>
                            </span>
                            {d.openInvoicesCount !== undefined && d.openInvoicesCount > 0 && (
                              <span>
                                • {isAr ? `${d.openInvoicesCount} فواتير مفتوحة` : `${d.openInvoicesCount} open invoices`}
                              </span>
                            )}
                            {d.totalPaidMinor && BigInt(d.totalPaidMinor) > 0n && (
                              <span>
                                • {isAr ? `مسدد: ${fmt(d.totalPaidMinor)} ${currencySymbol}` : `Paid: ${fmt(d.totalPaidMinor)} ${currencySymbol}`}
                              </span>
                            )}
                          </div>

                          {d.notes && (
                            <p className="mt-1 line-clamp-1 text-xs text-text-subtle">
                              💬 {d.notes}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Right: Direct Actions (AI Draft, WhatsApp, Toggle Reminders, View) */}
                      <div className="flex flex-wrap items-center gap-2 self-end sm:self-center">
                        {hasDebt && (
                          <button
                            type="button"
                            onClick={() =>
                              openAiCopilot({
                                tab: "composer",
                                debtorId: d.id,
                                tone: intelById[d.id]?.recommendation.suggestedTone,
                              })
                            }
                            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-full bg-callout px-3 py-1.5 text-xs font-bold text-primary transition-colors hover:bg-primary hover:text-primary-fg"
                            title={isAr ? "صياغة تنبيه بالذكاء الاصطناعي" : "Draft AI reminder"}
                          >
                            <Sparkle size={14} weight="fill" aria-hidden />
                            <span className="hidden xl:inline">{isAr ? "صياغة ذكية" : "AI Draft"}</span>
                          </button>
                        )}
                        {/* 1. Direct WhatsApp Chat Button */}
                        <button
                          type="button"
                          onClick={() => openWhatsApp(d)}
                          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-600 transition-all hover:bg-emerald-500/20 active:scale-95 dark:text-emerald-400"
                          title={isAr ? "محادثة مباشرة عبر واتساب" : "Chat on WhatsApp"}
                        >
                          <WhatsappLogo size={16} weight="fill" />
                          <span className="hidden md:inline">{isAr ? "واتساب" : "WhatsApp"}</span>
                        </button>

                        {/* 2. Re-enable or Pause Reminders Button */}
                        {d.optedOut ? (
                          <button
                            type="button"
                            data-testid="debtor-resume-reminders"
                            disabled={isToggling}
                            onClick={() => void onToggleReminders(d.id, true)}
                            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-bold text-emerald-600 transition-all hover:bg-emerald-500/20 active:scale-95 dark:text-emerald-400"
                            title={isAr ? "إعادة تفعيل التذكيرات التلقائية لهذا العميل" : "Re-enable automatic reminders"}
                          >
                            <BellRinging size={15} weight="fill" />
                            <span>{isAr ? "تفعيل التذكير" : "Resume"}</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            data-testid="debtor-pause-reminders"
                            disabled={isToggling}
                            onClick={() => void onToggleReminders(d.id, false)}
                            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-text-muted transition-all hover:border-amber-500/40 hover:text-amber-600 active:scale-95"
                            title={isAr ? "إيقاف التذكيرات التلقائية مؤقتاً" : "Pause automatic reminders"}
                          >
                            <BellSlash size={15} weight="fill" />
                            <span className="hidden lg:inline">{isAr ? "إيقاف التذكير" : "Pause"}</span>
                          </button>
                        )}

                        {/* 3. View Details */}
                        <Link
                          data-testid="debtor-view"
                          href={`/${locale}/debtors/${d.id}`}
                          className="inline-flex min-h-[38px] shrink-0 items-center gap-1 rounded-full border border-border-strong/60 bg-surface px-3.5 py-1.5 text-xs font-bold transition-colors hover:border-primary hover:bg-callout hover:text-primary sm:text-xs"
                        >
                          <span>{t("view")}</span>
                          <ArrowLeft size={13} weight="fill" aria-hidden className="rtl:-scale-x-100" />
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>

        {/* Side Column: Quick Add & Summary (4 cols) */}
        <aside className="flex flex-col gap-6 lg:col-span-4">
          <Panel title={t("add")} icon={Plus}>
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void onCreate();
              }}
            >
              <label className={labelCls}>
                <span>{t("name")}</span>
                <input
                  data-testid="debtor-name"
                  className={inputCls}
                  placeholder={isAr ? "مثال: شركة النيل للتجارة" : "e.g. Nile Trading Co."}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </label>
              <label className={labelCls}>
                <span>{t("phone")}</span>
                <input
                  data-testid="debtor-phone"
                  className={inputCls}
                  dir="ltr"
                  placeholder="+2010..."
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                />
              </label>
              <label className={labelCls}>
                <span>{t("notes")}</span>
                <input
                  data-testid="debtor-notes"
                  className={inputCls}
                  placeholder={isAr ? "ملاحظات اختيارية عن العميل" : "Optional notes"}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
              {error && <p role="alert" className="text-sm font-semibold text-status-overdue-fg">{error}</p>}
              <button
                data-testid="debtor-create"
                disabled={busy || name.trim().length < 1 || phone.trim().length < 3}
                className={`${btnPrimary} w-full justify-center`}
              >
                <Plus size={18} weight="fill" aria-hidden />
                {t("add")}
              </button>
            </form>
          </Panel>

          <div className="panel-shadow flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5">
            <div className="flex items-center gap-2 text-sm font-bold text-text">
              <Users size={18} weight="fill" className="text-primary" />
              <span>{isAr ? "إدارة التذكيرات والتواصل" : "Reminders & Communication"}</span>
            </div>
            <p className="text-xs leading-relaxed text-text-muted">
              {isAr
                ? "إمكانية إيقاف أو استئناف التذكيرات التلقائية بنقرة واحدة لكل عميل."
                : "Pause or resume automated WhatsApp reminders with one click per customer."}
            </p>
            <div className="rounded-xl bg-callout p-3 text-xs text-text-muted">
              {isAr
                ? "تُحترم ساعات الهدوء، وتتوقف التذكيرات تلقائياً للفواتير المسددة."
                : "Quiet hours are honored, and reminders pause automatically for paid invoices."}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
