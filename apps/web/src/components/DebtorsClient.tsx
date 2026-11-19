"use client";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { inputVariants } from "@/components/ui/input";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { formatCurrencyMinor } from "@tahseel/core";
import { ArrowLeft, BellRinging, BellSlash, CheckCircle, CurrencyCircleDollar, MagnifyingGlass, Phone, Plus, SortAscending, Sparkle, Users, WarningCircle, X } from "@/components/ui/solid-icons";
import { WhatsappLogo } from "@/components/ui/icons";
import { trpc } from "@/lib/trpc-client";
import type { DebtorIntelligenceView } from "@/server/intelligence";
import { openAiCopilot } from "./copilot-events";
import { useCurrency } from "./CurrencyContext";
import { EmptyState, InitialAvatar, LoadingState, Panel, btnPrimary, inputCls, labelCls } from "./ui";

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
  /** H09: the frozen remainder of disputed invoices (never part of the
   * outstanding balance above). */
  totalDisputedMinor?: string;
  disputedInvoicesCount?: number;
  /** F02: per-currency outstanding; the headline balance is the
   * default-currency subtotal when the debtor is mixed-currency. */
  outstandingByCurrency?: { currency: string; minor: string }[];
}

type FilterType = "all" | "ai_priority" | "has_balance" | "settled" | "opted_out" | "risk";
type SortType = "default" | "ai_priority" | "balance_desc" | "name_asc";

export function DebtorsClient({ businessName }: { businessName?: string }) {
  const router = useRouter();
  const t = useTranslations("debtors");
  const locale = useLocale();
  const isAr = locale === "ar";
  const { symbol: currencySymbol, currency, formatAmountOnly } = useCurrency();
  // F-06: amounts render in the tenant currency (exponent-aware: KWD 3
  // decimals, JPY 0), not hardcoded EGP.
  const fmt = (minor: string | undefined) => formatAmountOnly(minor || "0");
  const effectiveBusinessName = businessName || (isAr ? "منشأتك" : "Your Business");

  const [items, setItems] = useState<Debtor[]>([]);
  const [intelById, setIntelById] = useState<Record<string, DebtorIntelligenceView>>({});
  const [intelTruncated, setIntelTruncated] = useState<{ shown: number; total: number } | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");
  const [sort, setSort] = useState<SortType>("default");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState<{ text: string; isError?: boolean } | null>(null);

  const loadIntel = useCallback(async () => {
    try {
      const intelRes = await trpc.intelligence.overview.query({ syncNotifications: false });
      if (intelRes) {
        const map: Record<string, DebtorIntelligenceView> = {};
        for (const score of intelRes.debtorScores) {
          map[score.debtorId] = score;
        }
        setIntelById(map);
        // The intelligence list is capped at the 500 highest-outstanding
        // debtors; say so instead of silently leaving the rest unscored.
        setIntelTruncated(
          intelRes.debtorScoresTruncated
            ? { shown: intelRes.debtorScoresShown, total: intelRes.debtorTotalCount }
            : null,
        );
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void loadIntel();
  }, [loadIntel]);

  // F-15: the list loads the first 200 rows; the header aggregates below
  // are computed from those rows, so the server total is needed to say
  // whether the numbers cover the whole ledger or only the rows shown.
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const truncated = totalCount !== null && totalCount > items.length;
  // F-17: first-load flag only — the list must not flash its empty state
  // before the first round-trip; later refetches keep the stale list.
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const load = useCallback(async (q: string) => {
    try {
      setLoadError(null);
      const page = await trpc.debtors.list.query({ search: q || undefined, limit: 200 });
      setItems((page.items as unknown) as Debtor[]);
      setTotalCount(typeof page.totalCount === "number" ? page.totalCount : null);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : (isAr ? "تعذّر تحميل قائمة العملاء" : "Failed to load customers"));
    } finally {
      setLoading(false);
    }
  }, [isAr]);

  // Debounce search input to avoid flood of network calls on typing
  useEffect(() => {
    const timer = setTimeout(() => {
      void load(search);
    }, 200);
    return () => clearTimeout(timer);
  }, [search, load]);

  async function onCreate() {
    if (busy || name.trim().length < 1 || phone.trim().length < 3) return;
    setBusy(true);
    setError(null);
    try {
      await trpc.debtors.create.mutate({ displayName: name, phone, notes: notes || undefined });
      setName("");
      setPhone("");
      setNotes("");
      await Promise.all([load(search), loadIntel()]);
      router.refresh();
      setFeedbackMsg({ text: isAr ? "تمت إضافة العميل بنجاح." : "Customer added successfully." });
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
      setFeedbackMsg({
        text: enabled
          ? (isAr ? "تم تفعيل التذكيرات التلقائية بنجاح." : "Auto reminders enabled successfully.")
          : (isAr ? "تم إيقاف التذكيرات التلقائية مؤقتاً." : "Auto reminders paused."),
      });
      setTimeout(() => setFeedbackMsg(null), 3500);
    } catch {
      setFeedbackMsg({ text: isAr ? "تعذّر تغيير حالة التذكيرات" : "Failed to toggle reminders", isError: true });
      setTimeout(() => setFeedbackMsg(null), 3000);
    } finally {
      setTogglingId(null);
    }
  }

  // Aggregate Metrics (single pass over items)
  const { totalOutstandingMinor, debtCount, settledCount, optedOutCount, riskCount, rankedExposure } = useMemo(() => {
    let total = 0n;
    let debtors = 0;
    let settled = 0;
    let optedOut = 0;
    let risk = 0;
    const withBalance: Debtor[] = [];
    for (const d of items) {
      const bal = BigInt(d.totalOutstandingMinor || "0");
      total += bal;
      if (bal > 0n) {
        debtors += 1;
        withBalance.push(d);
      } else {
        settled += 1;
      }
      if (d.optedOut) optedOut += 1;
      if (d.riskFlag) risk += 1;
    }
    withBalance.sort((a, b) => {
      const aa = BigInt(a.totalOutstandingMinor || "0");
      const bb = BigInt(b.totalOutstandingMinor || "0");
      return aa === bb ? a.displayName.localeCompare(b.displayName) : aa > bb ? -1 : 1;
    });
    return {
      totalOutstandingMinor: total,
      debtCount: debtors,
      settledCount: settled,
      optedOutCount: optedOut,
      riskCount: risk,
      rankedExposure: withBalance.slice(0, 5),
    };
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
    const cleanPhone = d.phoneE164.replace(/[^\d]/g, "");
    const url = cleanPhone ? `https://wa.me/${cleanPhone}?text=${text}` : `https://wa.me/?text=${text}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Top Overview Financial Summary Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:gap-4">
        <div className="panel-shadow flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between text-text-muted">
            <span className="text-xs font-semibold">{isAr ? "إجمالي المستحق" : "Total Outstanding"}</span>
            <CurrencyCircleDollar size={18} className="text-primary" />
          </div>
          <span className="tnum tabular-nums text-xl font-black text-text" dir="ltr">
            {formatAmountOnly(totalOutstandingMinor)} <span className="text-xs font-bold text-text-muted">{currencySymbol}</span>
          </span>
          <span className="tabular-nums text-[11px] text-text-muted">
            {isAr ? `على ${debtCount} عميل مدين` : `Across ${debtCount} debtors`}
          </span>
        </div>

        <div className="panel-shadow flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between text-text-muted">
            <span className="text-xs font-semibold">{isAr ? "مسددين بالكامل" : "Fully Settled"}</span>
            <CheckCircle size={18} className="text-status-paid-fg" />
          </div>
          <span className="tnum tabular-nums text-xl font-black text-status-paid-fg dark:text-status-paid-fg" dir="ltr">
            {settledCount}
          </span>
          <span className="text-[11px] text-text-muted">
            {isAr ? "حساباتهم خالصة 100%" : "Zero balance customers"}
          </span>
        </div>

        <div className="panel-shadow flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between text-text-muted">
            <span className="text-xs font-semibold">{isAr ? "إجمالي العملاء" : "Total Customers"}</span>
            <Users size={18} className="text-primary" />
          </div>
          <span className="tnum tabular-nums text-xl font-black text-text" dir="ltr">
            {totalCount ?? items.length}
          </span>
          <span className="text-[11px] text-text-muted">
            {isAr ? "مسجلين بالنظام" : "In the ledger"}
          </span>
          {truncated && (
            <span className="text-[11px] text-status-due-fg dark:text-status-due-fg">
              {isAr
                ? `عرض ${items.length} من أصل ${totalCount} — الإجماليات أعلاه تغطي الصفوف المعروضة فقط`
                : `Showing ${items.length} of ${totalCount} — the totals above cover only the rows shown`}
            </span>
          )}
          {intelTruncated && (
            <span className="text-[11px] text-status-due-fg dark:text-status-due-fg">
              {isAr
                ? `تقييم الذكاء يشمل أعلى ${intelTruncated.shown} عميل من أصل ${intelTruncated.total} حسب الرصيد`
                : `Intelligence scores cover the top ${intelTruncated.shown} of ${intelTruncated.total} debtors by balance`}
            </span>
          )}
        </div>

        <div className="panel-shadow flex min-w-0 flex-col gap-1 rounded-xl border border-border bg-surface p-4">
          <div className="flex items-center justify-between text-text-muted">
            <span className="text-xs font-semibold">{isAr ? "تذكيرات متوقفة" : "Paused Reminders"}</span>
            <BellSlash size={18} className="text-status-due-fg" />
          </div>
          <span className="tnum tabular-nums text-xl font-black text-status-due-fg dark:text-status-due-fg" dir="ltr">
            {optedOutCount}
          </span>
          <span className="text-[11px] text-text-muted">
            {isAr ? "يمكنك تفعيلهم بنقرة" : "One-click resumable"}
          </span>
        </div>
      </div>

      {/* Ranked customer exposure: a directly actionable view, based on ledger balances. */}
      {rankedExposure.length > 0 && (() => {
        const max = BigInt(rankedExposure[0]?.totalOutstandingMinor || "1");
        return <section data-testid="debtors-top-exposure" className="panel-shadow flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 sm:p-5">
          <div className="flex flex-wrap items-end justify-between gap-2"><div><h2 className="text-sm font-extrabold text-text">{isAr ? "أكبر أرصدة تحتاج متابعة" : "Largest customer exposures"}</h2><p className="mt-1 text-xs text-text-muted">{isAr ? "أعلى خمسة أرصدة مفتوحة في النتائج الحالية، مرتبة حسب القيمة" : "Top five open balances in the current result set, ranked by value"}</p></div><span className="text-xs font-semibold text-text-muted">{isAr ? "الرصيد المفتوح" : "Open balance"}</span></div>
          <div className="flex flex-col gap-3">{rankedExposure.map((item, index) => {
            const balance = BigInt(item.totalOutstandingMinor || "0");
            const width = max > 0n ? Math.max(3, Number((balance * 10000n) / max) / 100) : 0;
            const otherCurrencies = (item.outstandingByCurrency ?? []).filter((b) => b.currency !== currency);
            return <div key={item.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5">
              <Link href={`/${locale}/debtors/${item.id}`} className="min-w-0 truncate text-sm font-bold text-text hover:text-primary">{index + 1}. {item.displayName}</Link>
              <span className="tnum tabular-nums text-sm font-extrabold text-text" dir="ltr">{fmt(item.totalOutstandingMinor)}</span>
              {otherCurrencies.length > 0 && (
                <span className="col-span-2 tabular-nums text-xs text-text-muted" dir="ltr">
                  + {otherCurrencies.map((b) => `${formatCurrencyMinor(BigInt(b.minor), b.currency)} ${b.currency}`).join(" · ")}
                </span>
              )}
              <div className="col-span-2 h-2 overflow-hidden rounded bg-surface-muted"><div className="h-full rounded bg-primary" style={{ width: `${width}%` }} /></div>
            </div>;
          })}</div>
        </section>;
      })()}

      {feedbackMsg && (
        <div
          role={feedbackMsg.isError ? "alert" : "status"}
          className={cn(
            "flex items-center justify-between rounded-xl border px-4 py-3 text-sm font-bold",
            feedbackMsg.isError
              ? "border-danger/30 bg-danger-bg text-danger"
              : "border-status-paid-fg/30 bg-status-paid-bg text-status-paid-fg dark:text-status-paid-fg",
          )}
        >
          <span>{feedbackMsg.text}</span>
          <button
            type="button"
            onClick={() => setFeedbackMsg(null)}
            className={cn(buttonVariants({ variant: "ghost", size: "iconSm" }), "text-text-muted")}
          >
            <X size={16} strokeWidth={2.5} />
          </button>
        </div>
      )}

      {/* Main Content Layout */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
        {/* Main List Column (8 cols) */}
        <section className="flex min-w-0 flex-col gap-4 lg:col-span-8">
          {/* Quick Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={cn(buttonVariants({ variant: filter === "all" ? "default" : "outline", size: "sm" }), !(filter === "all") && "text-text-muted")}
            >
              <span>{isAr ? "الكل" : "All"}</span>
              <span className="tabular-nums rounded bg-surface/20 px-1.5 py-0.2 text-[10px]">{items.length}</span>
            </button>

            <button
              type="button"
              data-testid="filter-ai-priority"
              onClick={() => setFilter("ai_priority")}
              className={cn(buttonVariants({ variant: filter === "ai_priority" ? "default" : "outline", size: "sm" }), !(filter === "ai_priority") && "text-text-muted")}
            >
              <Sparkle size={14} aria-hidden />
              <span>{isAr ? "الأولوية الذكية" : "AI Priority"}</span>
              {aiPriorityCount > 0 && (
                <span className="tabular-nums rounded bg-callout px-1.5 py-0.2 text-[10px] text-primary">
                  {aiPriorityCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setFilter("has_balance")}
              className={cn(buttonVariants({ variant: filter === "has_balance" ? "default" : "outline", size: "sm" }), !(filter === "has_balance") && "text-text-muted")}
            >
              <span>{isAr ? "عليهم متبقي" : "Has Balance"}</span>
              <span className="tabular-nums rounded bg-status-overdue-bg px-1.5 py-0.2 text-[10px] text-status-overdue-fg">
                {debtCount}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setFilter("settled")}
              className={cn(buttonVariants({ variant: filter === "settled" ? "ghost" : "outline", size: "sm" }), filter === "settled" && "bg-status-paid-bg text-status-paid-fg ring-1 ring-status-paid-fg/30", !(filter === "settled") && "text-text-muted")}
            >
              <CheckCircle size={14} className={"text-status-paid-fg"} />
              <span>{isAr ? "مسددين بالكامل" : "Fully Settled"}</span>
              <span className="tabular-nums rounded bg-status-paid-bg px-1.5 py-0.2 text-[10px] text-status-paid-fg dark:text-status-paid-fg">
                {settledCount}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setFilter("opted_out")}
              className={cn(buttonVariants({ variant: filter === "opted_out" ? "ghost" : "outline", size: "sm" }), filter === "opted_out" && "bg-status-due-bg text-status-due-fg ring-1 ring-status-due-fg/30", !(filter === "opted_out") && "text-text-muted")}
            >
              <BellSlash size={14} className={"text-status-due-fg"} />
              <span>{isAr ? "تذكيرات متوقفة" : "Paused"}</span>
              <span className="tabular-nums rounded bg-status-due-bg px-1.5 py-0.2 text-[10px]">
                {optedOutCount}
              </span>
            </button>

            {riskCount > 0 && (
              <button
                type="button"
                onClick={() => setFilter("risk")}
                className={cn(buttonVariants({ variant: filter === "risk" ? "ghost" : "outline", size: "sm" }), filter === "risk" && "bg-status-overdue-bg text-status-overdue-fg ring-1 ring-status-overdue-fg/30", !(filter === "risk") && "text-status-overdue-fg")}
              >
                <WarningCircle size={14} />
                <span>{isAr ? "مخاطرة وشيكات" : "Risk"}</span>
                <span className="tabular-nums rounded bg-status-overdue-bg px-1.5 py-0.2 text-[10px]">
                  {riskCount}
                </span>
              </button>
            )}
          </div>

          {/* Search & Sort Toolbar */}
          <div className="panel-shadow flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3.5 sm:p-4">
            <div className="relative w-full min-w-0 sm:w-auto sm:flex-1 sm:min-w-[220px]">
              <span className="sr-only">{t("search")}</span>
              <MagnifyingGlass
                size={16}
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
                  className={cn(buttonVariants({ variant: "ghost", size: "iconSm" }), "absolute end-2 top-1/2 -translate-y-1/2 text-text-muted")}
                >
                  <X size={14} strokeWidth={2.5} />
                </button>
              )}
            </div>

            {/* Sort Selector */}
            <div className="flex w-full items-center gap-2 sm:w-auto">
              <SortAscending size={16} strokeWidth={2.5} className="shrink-0 text-text-muted" />
              <select
                aria-label={t("sortLabel")}
                value={sort}
                onChange={(e) => setSort(e.target.value as SortType)}
                className={cn(inputVariants, "w-full sm:w-auto sm:min-w-[180px]")}
              >
                <option value="default">{isAr ? "الترتيب الافتراضي" : "Default"}</option>
                <option value="ai_priority">{isAr ? "أولوية المتابعة (AI)" : "AI Follow-up Priority"}</option>
                <option value="balance_desc">{isAr ? "الأعلى مديونية أولاً" : "Highest Balance First"}</option>
                <option value="name_asc">{isAr ? "أبجدي بالاسم (A-Z)" : "Alphabetical (A-Z)"}</option>
              </select>
            </div>
          </div>

          {/* Debtors List */}
          {loadError && (
            <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger-bg px-4 py-3 text-sm font-semibold text-danger">
              <span>{loadError}</span>
              <button type="button" onClick={() => void load(search)} className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "underline")}>
                {isAr ? "إعادة المحاولة" : "Retry"}
              </button>
            </div>
          )}
          {loading ? (
            <LoadingState isAr={isAr} />
          ) : filteredItems.length === 0 && !loadError ? (
            <EmptyState
              testId="debtors-empty"
              title={
                search.trim()
                  ? (isAr ? `لا توجد نتائج مطابقة لـ "${search}"` : `No customers matching "${search}"`)
                  : filter !== "all"
                    ? (isAr ? "لا يوجد عملاء ضمن هذا التصنيف" : "No customers in this filter")
                    : t("empty")
              }
              body={
                search.trim() || filter !== "all"
                  ? (isAr ? "جرّب مسح البحث أو إعادة تعيين التصنيف لعرض جميع العملاء." : "Clear your search or reset the active filter to see all customers.")
                  : (isAr ? "أضف أول عميل لبدء متابعة الفواتير والتذكيرات التلقائية." : "Add your first customer to start tracking invoices and automated reminders.")
              }
            >
              {search.trim() || filter !== "all" ? (
                <button
                  type="button"
                  onClick={() => { setSearch(""); setFilter("all"); }}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-1")}
                >
                  {isAr ? "إعادة تعيين الفلاتر" : "Reset filters"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => document.querySelector<HTMLInputElement>('[data-testid="debtor-name"]')?.focus()}
                  className={`${btnPrimary} mt-1`}
                >
                  <Plus size={16} aria-hidden />
                  {t("add")}
                </button>
              )}
            </EmptyState>
          ) : filteredItems.length === 0 ? null : (
            <div className="panel-shadow overflow-x-auto rounded-xl border border-border bg-surface">
              <table className="w-full min-w-[640px] border-collapse text-start">
                <thead className="border-b border-border bg-surface-muted/60 text-xs font-bold text-text-muted">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-start">{t("name")}</th>
                    <th scope="col" className="px-4 py-3 text-start">{isAr ? "الرصيد والحالة" : "Balance & Status"}</th>
                    <th scope="col" className="px-4 py-3 text-end">{isAr ? "الإجراءات" : "Actions"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredItems.map((d) => {
                    const balance = BigInt(d.totalOutstandingMinor || "0");
                    const hasDebt = balance > 0n;
                    const isToggling = togglingId === d.id;

                    return (
                      <tr
                        key={d.id}
                        data-testid="debtor-row"
                        className="align-top transition-colors hover:bg-callout/40"
                      >
                        {/* Customer identity & ledger summary */}
                        <td className="px-4 py-4">
                          <div className="flex min-w-0 items-start gap-3">
                            <InitialAvatar name={d.displayName} size={40} />
                            <div className="min-w-0 flex-1">
                              <Link
                                href={`/${locale}/debtors/${d.id}`}
                                className="block max-w-full truncate text-sm font-bold text-text transition-colors hover:text-primary sm:text-base"
                              >
                                {d.displayName}
                              </Link>

                              {/* Rules-based next action recommendation */}
                              {intelById[d.id] && hasDebt && (
                                <p className="mt-1 flex items-center gap-1.5 text-[11px] font-semibold text-primary">
                                  <Sparkle size={12} aria-hidden className="shrink-0" />
                                  <span>
                                    {isAr
                                      ? intelById[d.id]!.recommendation.titleAr
                                      : intelById[d.id]!.recommendation.titleEn}
                                  </span>
                                </p>
                              )}

                              {/* Phone & Invoices summary */}
                              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
                                <span className="tabular-nums flex items-center gap-1" dir="ltr">
                                  <Phone size={12} className="text-primary" />
                                  <span>{d.phoneE164}</span>
                                </span>
                                {d.openInvoicesCount !== undefined && d.openInvoicesCount > 0 && (
                                  <span className="tabular-nums">
                                    • {isAr ? `${d.openInvoicesCount} فواتير مفتوحة` : `${d.openInvoicesCount} open invoices`}
                                  </span>
                                )}
                                {d.totalPaidMinor && BigInt(d.totalPaidMinor) > 0n && (
                                  <span className="tabular-nums">
                                    • {isAr ? `مسدد: ${fmt(d.totalPaidMinor)} ${currencySymbol}` : `Paid: ${fmt(d.totalPaidMinor)} ${currencySymbol}`}
                                  </span>
                                )}
                                {d.totalDisputedMinor && BigInt(d.totalDisputedMinor) > 0n && (
                                  <span className="tabular-nums">
                                    • {isAr ? `متنازع عليه (مجمّد): ${fmt(d.totalDisputedMinor)} ${currencySymbol}` : `Disputed (frozen): ${fmt(d.totalDisputedMinor)} ${currencySymbol}`}
                                  </span>
                                )}
                              </div>

                              {d.notes && (
                                <p className="mt-1 line-clamp-1 text-xs text-text-subtle">
                                  {d.notes}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Balance & Status pills */}
                        <td className="px-4 py-4">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {hasDebt ? (
                              <span className="inline-flex items-center gap-1 whitespace-nowrap rounded bg-status-overdue-bg px-2.5 py-0.5 text-xs font-extrabold text-status-overdue-fg">
                                <span>{isAr ? "مستحق:" : "Due:"}</span>
                                <span className="tnum tabular-nums" dir="ltr">{fmt(d.totalOutstandingMinor)}</span>
                                <span className="text-[10px] font-bold">{currencySymbol}</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 whitespace-nowrap rounded bg-status-paid-bg px-2.5 py-0.5 text-[11px] font-bold text-status-paid-fg dark:text-status-paid-fg">
                                <CheckCircle size={13} />
                                <span>{isAr ? "خالص ومسدد" : "Fully Settled"}</span>
                              </span>
                            )}

                            {d.riskFlag && (
                              <span className="inline-flex items-center gap-1 whitespace-nowrap rounded bg-status-overdue-bg px-2 py-0.5 text-[11px] font-bold text-status-overdue-fg dark:text-status-overdue-fg">
                                <WarningCircle size={12} />
                                <span>{isAr ? "شيك مرتد" : "Bounced Cheque"}</span>
                              </span>
                            )}

                            {d.optedOut && (
                              <span
                                data-testid="debtor-opted-out"
                                className="inline-flex items-center gap-1 whitespace-nowrap rounded bg-status-due-bg px-2 py-0.5 text-[11px] font-bold text-status-due-fg dark:text-status-due-fg"
                              >
                                <BellSlash size={12} />
                                <span>{isAr ? "تذكيرات متوقفة" : "Reminders Paused"}</span>
                              </span>
                            )}

                            {intelById[d.id] && (
                              <span
                                className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-2 py-0.5 text-[11px] font-bold ${
                                  intelById[d.id]!.tier === "critical"
                                    ? "bg-status-overdue-bg text-status-overdue-fg"
                                    : intelById[d.id]!.tier === "at_risk"
                                      ? "bg-status-due-bg text-status-due-fg"
                                      : intelById[d.id]!.tier === "watch"
                                        ? "bg-callout text-primary"
                                        : "bg-status-paid-bg text-status-paid-fg"
                                }`}
                              >
                                <Sparkle size={11} aria-hidden />
                                <span className="tnum tabular-nums" dir="ltr">{intelById[d.id]!.healthScore}/100</span>
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Direct Actions */}
                        <td className="px-4 py-4">
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            {hasDebt && (
                              <button
                                type="button"
                                onClick={() =>
                                  openAiCopilot({
                                    tab: "composer",
                                    debtorId: d.id,
                                    tone: intelById[d.id]?.recommendation.suggestedTone,
                                    mode: "reminder",
                                  })
                                }
                                className={cn(buttonVariants({ variant: "secondary", size: "sm" }))}
                                title={isAr ? "صياغة تنبيه بالذكاء الاصطناعي" : "Draft AI reminder"}
                              >
                                <Sparkle size={14} aria-hidden />
                                <span className="hidden xl:inline">{isAr ? "صياغة ذكية" : "AI Draft"}</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => openWhatsApp(d)}
                              className={cn(buttonVariants({ variant: "success", size: "sm" }), "border-status-paid-fg/30 text-status-paid-fg dark:text-status-paid-fg")}
                              title={isAr ? "محادثة مباشرة عبر واتساب" : "Chat on WhatsApp"}
                            >
                              <WhatsappLogo size={16} />
                              <span className="hidden md:inline">{isAr ? "واتساب" : "WhatsApp"}</span>
                            </button>

                            {d.optedOut ? (
                              <button
                                type="button"
                                data-testid="debtor-resume-reminders"
                                disabled={isToggling}
                                aria-busy={isToggling}
                                onClick={() => void onToggleReminders(d.id, true)}
                                className={cn(buttonVariants({ variant: "success", size: "sm" }), "border-status-paid-fg/40 text-status-paid-fg dark:text-status-paid-fg")}
                                title={isAr ? "إعادة تفعيل التذكيرات التلقائية لهذا العميل" : "Re-enable automatic reminders"}
                              >
                                <BellRinging size={15} />
                                <span>{isToggling ? (isAr ? "جارٍ..." : "Updating...") : (isAr ? "تفعيل التذكير" : "Resume")}</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                data-testid="debtor-pause-reminders"
                                disabled={isToggling}
                                aria-busy={isToggling}
                                onClick={() => void onToggleReminders(d.id, false)}
                                className={cn(buttonVariants({ variant: "outline", size: "sm" }), "text-text-muted hover:border-status-due-fg/40 hover:text-status-due-fg")}
                                title={isAr ? "إيقاف التذكيرات التلقائية مؤقتاً" : "Pause automatic reminders"}
                              >
                                <BellSlash size={15} />
                                <span className="hidden lg:inline">{isToggling ? (isAr ? "جارٍ..." : "Updating...") : (isAr ? "إيقاف التذكير" : "Pause")}</span>
                              </button>
                            )}

                            <Link
                              data-testid="debtor-view"
                              href={`/${locale}/debtors/${d.id}`}
                              className="inline-flex min-h-[38px] shrink-0 items-center gap-1 rounded border border-border-strong/60 bg-surface px-3.5 py-1.5 text-xs font-bold transition-colors hover:border-primary hover:bg-callout hover:text-primary sm:text-xs"
                            >
                              <span>{t("view")}</span>
                              <ArrowLeft size={13} aria-hidden className="rtl:-scale-x-100" />
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Side Column: Quick Add & Summary (4 cols) */}
        <aside className="flex min-w-0 flex-col gap-6 lg:col-span-4">
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
                  placeholder={isAr ? "مثال: شركة الأفق للتجارة" : "e.g. Horizon Trading Co."}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={160}
                  required
                />
              </label>
              <label className={labelCls}>
                <span>{t("phone")}</span>
                <input
                  data-testid="debtor-phone"
                  className={inputCls}
                  dir="ltr"
                  placeholder="+1234567890"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  maxLength={32}
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
                  maxLength={2000}
                />
              </label>
              {error && <p role="alert" className="text-sm font-semibold text-status-overdue-fg">{error}</p>}
              <button
                type="submit"
                data-testid="debtor-create"
                disabled={busy || name.trim().length < 1 || phone.trim().length < 3}
                aria-busy={busy}
                className={`${btnPrimary} w-full justify-center`}
              >
                <Plus size={18} aria-hidden />
                {busy ? (isAr ? "جارٍ الحفظ..." : "Saving...") : t("add")}
              </button>
            </form>
          </Panel>

        </aside>
      </div>
    </div>
  );
}
