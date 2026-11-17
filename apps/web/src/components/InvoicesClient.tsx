"use client";
import { cn, todayIso } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { inputVariants } from "@/components/ui/input";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { canTransition, formatCurrencyMinor, getCurrencySymbol, type InvoiceStatus } from "@tahseel/core";
import { useCurrency } from "./CurrencyContext";
import { Check, MagnifyingGlass, PencilSimple, Plus, Sparkle, WarningCircle, X } from "@/components/ui/solid-icons";
import { trpc } from "@/lib/trpc-client";
import { EmptyState, LoadingState, Panel, StatusPill, btnGhost, btnPrimary, btnSmall, inputCls, labelCls } from "./ui";
import { WhatsAppShareButton, invoiceShareMessage } from "./WhatsAppShare";
import { EmptyInvoicesIllustration } from "./illustrations";

interface Invoice {
  id: string; debtorId: string; reference: string | null; description: string | null;
  amountMinor: string; paidMinor: string; outstandingMinor: string; currency: string; currencyWarning: boolean;
  issuedOn: string; dueOn: string; status: string; overdue: boolean; agingBucket: string; source: string;
}
interface DebtorLite { id: string; displayName: string; phoneE164?: string }

const STATUSES = ["open", "partially_paid", "paid", "disputed", "written_off", "cancelled"] as const;
const BUCKETS = ["current", "0-7", "8-30", "31-60", "60+"] as const;
function addDaysIso(baseIso: string, days: number): string {
  const d = new Date(`${baseIso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return baseIso;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function InvoicesClient({ businessName, initialOverdueOnly = false }: { businessName?: string; initialOverdueOnly?: boolean }) {
  const router = useRouter();
  const t = useTranslations("invoices");
  const tc = useTranslations("common");
  const locale = useLocale();
  const isAr = locale === "ar";
  const { currency: tenantCurrency, symbol: currencySymbol, formatAmountOnly } = useCurrency();
  // F-06: amounts render in the invoice's own currency, falling back to tenant currency.
  const fmt = (minor: string, invCurrency?: string) => formatAmountOnly(BigInt(minor), invCurrency ? { currency: invCurrency } : undefined);
  const effectiveBusinessName = businessName || (isAr ? "منشأتك" : "Your Business");
  const [items, setItems] = useState<Invoice[]>([]);
  const [debtors, setDebtors] = useState<DebtorLite[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<string>("");
  const [overdueOnly, setOverdueOnly] = useState(initialOverdueOnly);
  const [bucket, setBucket] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTo, setBulkTo] = useState<string>("cancelled");
  const [debtorId, setDebtorId] = useState("");
  const [amount, setAmount] = useState("");
  const [issuedOn, setIssuedOn] = useState(() => todayIso());
  const [dueOn, setDueOn] = useState(() => addDaysIso(todayIso(), 14));
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ reference: string; description: string; amount: string; dueOn: string }>({
    reference: "", description: "", amount: "", dueOn: "",
  });
  const [createError, setCreateError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const nextAutoReference = `INV-${issuedOn.slice(0, 4)}-${items.length + 1001}`;

  // Debounce search input to eliminate redundant queries
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(timer);
  }, [search]);

  // F-15: the aging panel sums the loaded page (first 100); the server
  // total says whether that page is the whole filtered set or a subset.
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const truncated = totalCount !== null && totalCount > items.length;
  // F-17: first-load flag only — see DebtorsClient.
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const page = await trpc.invoices.list.query({
        limit: 100,
        search: debouncedSearch || undefined,
        status: (status || undefined) as never,
        overdue: overdueOnly || undefined,
        agingBucket: bucket || undefined,
      });
      setItems(page.items as Invoice[]);
      setTotalCount(typeof page.totalCount === "number" ? page.totalCount : null);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : (isAr ? "تعذّر تحميل الفواتير" : "Failed to load invoices"));
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, status, overdueOnly, bucket, isAr]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void trpc.debtors.list.query({ limit: 200 }).then((p) => {
      const list = (p.items as DebtorLite[]);
      setDebtors(list);
      if (list[0]) setDebtorId((cur) => cur || list[0]!.id);
    }).catch(() => {});
  }, []);

  async function onCreate() {
    if (busy || !debtorId || amount.trim() === "") return;
    setBusy(true);
    setCreateError(null);
    try {
      await trpc.invoices.create.mutate({
        debtorId,
        amount: amount.trim(),
        issuedOn,
        dueOn: dueOn || undefined,
        reference: reference.trim() || undefined,
        description: description.trim() || undefined,
      });
      setAmount(""); setReference(""); setDescription("");
      await load();
      router.refresh();
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : (isAr ? "فشل إنشاء الفاتورة" : "Failed to create invoice"));
    } finally {
      setBusy(false);
    }
  }

  function startEdit(inv: Invoice) {
    setEditingId(inv.id);
    setEditForm({
      reference: inv.reference ?? "",
      description: inv.description ?? "",
      amount: formatCurrencyMinor(BigInt(inv.amountMinor), inv.currency),
      dueOn: inv.dueOn,
    });
  }

  async function onSaveEdit(id: string) {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await trpc.invoices.update.mutate({
        id,
        reference: editForm.reference.trim() || null,
        description: editForm.description.trim() || null,
        amount: editForm.amount.trim() || undefined,
        dueOn: editForm.dueOn || undefined,
      });
      setEditingId(null);
      await load();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : (isAr ? "فشل تحديث الفاتورة" : "Failed to update invoice"));
    } finally {
      setBusy(false);
    }
  }

  async function onTransition(id: string, to: InvoiceStatus) {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await trpc.invoices.transition.mutate({ id, to });
      await load();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : (isAr ? "فشل تغيير حالة الفاتورة" : "Failed to update invoice status"));
    } finally {
      setBusy(false);
    }
  }

  async function onBulk() {
    if (busy || selected.size === 0) return;
    setBusy(true);
    setActionError(null);
    try {
      await trpc.invoices.bulkTransition.mutate({ ids: [...selected], to: bulkTo as never });
      setSelected(new Set());
      await load();
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : (isAr ? "فشل تنفيذ العملية المجمعة" : "Failed to apply bulk transition"));
    } finally {
      setBusy(false);
    }
  }

  const debtorMap = useMemo(() => new Map(debtors.map((d) => [d.id, d])), [debtors]);
  const debtorName = (id: string) => debtorMap.get(id)?.displayName ?? "—";
  const debtorPhone = (id: string) => debtorMap.get(id)?.phoneE164;

  const agingSummary = useMemo(() => {
    const definitions = [
      { key: "current", label: isAr ? "غير مستحقة" : "Current" },
      { key: "0-7", label: isAr ? "1–7 أيام" : "1–7 days" },
      { key: "8-30", label: isAr ? "8–30 يومًا" : "8–30 days" },
      { key: "31-60", label: isAr ? "31–60 يومًا" : "31–60 days" },
      { key: "60+", label: isAr ? "أكثر من 60 يومًا" : "60+ days" },
    ];
    const totals = new Map<string, bigint>(definitions.map((d) => [d.key, 0n]));
    for (const inv of items) {
      if (
        inv.currency === tenantCurrency &&
        inv.status !== "paid" &&
        inv.status !== "cancelled" &&
        inv.status !== "written_off" &&
        inv.status !== "disputed" &&
        totals.has(inv.agingBucket)
      ) {
        totals.set(inv.agingBucket, (totals.get(inv.agingBucket) ?? 0n) + BigInt(inv.outstandingMinor || "0"));
      }
    }
    const rows = definitions.map((d) => ({ ...d, amount: totals.get(d.key) ?? 0n }));
    const total = rows.reduce((sum, row) => sum + row.amount, 0n);
    return { rows, total };
  }, [items, tenantCurrency, isAr]);

  return (
    <section className="flex flex-col gap-6">
      {/* Top Section: Create Invoice */}
      <div className="grid items-stretch gap-6 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-12">
          <Panel title={t("add")} icon={Plus}>
            <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void onCreate(); }}>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--icon-box-border)] bg-[var(--icon-box-bg)] px-3.5 py-2 text-xs font-bold text-[var(--icon-box-fg)]">
                <span className="inline-flex items-center gap-1.5">
                  <Sparkle size={14} aria-hidden />
                  <span>{isAr ? "رقم الفاتورة يُنشأ تلقائيًا بدون إدخال يدوي" : "Invoice ID is generated automatically"}</span>
                </span>
                <span className="rounded bg-surface px-2.5 py-0.5 font-extrabold text-primary" dir="ltr">
                  {reference.trim() || nextAutoReference}
                </span>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className={labelCls}><span>{t("debtor")}</span>
                  <select data-testid="inv-debtor" className={inputCls} value={debtorId} onChange={(e) => setDebtorId(e.target.value)}>
                    {debtors.length === 0 && <option value="">—</option>}
                    {debtors.map((d) => <option key={d.id} value={d.id}>{d.displayName}</option>)}
                  </select></label>
                <label className={labelCls}><span>{t("amount")}</span>
                  <input data-testid="inv-amount" className={inputCls} dir="ltr" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className={labelCls}><span>{t("description")}</span>
                  <input data-testid="inv-description" className={inputCls} placeholder={isAr ? "اختياري: مثال دفعة توريد أو خدمات" : "Optional: e.g. Supply batch or services"} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} /></label>
                <label className={labelCls}>
                  <span>{t("reference")}</span>
                  <input
                    data-testid="inv-reference"
                    className={inputCls}
                    dir="ltr"
                    placeholder={`${nextAutoReference} (${isAr ? "تلقائي" : "Auto"})`}
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    maxLength={80}
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className={labelCls}><span>{t("issuedOn")}</span>
                  <input data-testid="inv-issued" type="date" className={inputCls} dir="ltr" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} required /></label>
                <div className="flex flex-col gap-1.5">
                  <label className={labelCls}><span>{t("dueOn")}</span>
                    <input data-testid="inv-due" type="date" className={inputCls} dir="ltr" value={dueOn} onChange={(e) => setDueOn(e.target.value)} /></label>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { days: 7, label: isAr ? "+7 أيام" : "+7d" },
                      { days: 14, label: isAr ? "+14 يوم" : "+14d" },
                      { days: 30, label: isAr ? "+30 يوم" : "+30d" },
                    ].map((q) => (
                      <button
                        key={q.days}
                        type="button"
                        onClick={() => setDueOn(addDaysIso(issuedOn, q.days))}
                        className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                      >
                        {q.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {createError && <p role="alert" className="text-sm font-semibold text-status-overdue-fg">{createError}</p>}
              <div>
                <button data-testid="inv-create" disabled={busy || !debtorId || amount.trim() === ""} className={btnPrimary}>
                  <Plus size={18} aria-hidden />
                  {t("add")}
                </button>
              </div>
            </form>
          </Panel>
        </div>

      </div>

      {(actionError || loadError) && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger-bg px-4 py-3 text-sm font-semibold text-danger">
          <span>{actionError ?? loadError}</span>
          <div className="flex items-center gap-2">
            {loadError && (
              <button type="button" onClick={() => void load()} className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "underline hover:bg-danger/10")}>
                {isAr ? "إعادة المحاولة" : "Retry"}
              </button>
            )}
            {actionError && (
              <button type="button" onClick={() => setActionError(null)} className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "underline hover:bg-danger/10")}>
                {isAr ? "إغلاق" : "Dismiss"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Invoice aging analysis: balances grouped by aging bucket, not a decorative status strip. */}
      {items.length > 0 && (() => {
        const { rows, total } = agingSummary;
        const tones = ["bg-status-paid-fg", "bg-[var(--chart-2)]", "bg-status-due-fg", "bg-[var(--chart-1)]", "bg-status-overdue-fg"];
        return <section data-testid="inv-aging-analysis" className="panel-shadow flex flex-col gap-4 rounded-xl border border-border bg-surface p-4 sm:p-5">
          <div className="flex flex-wrap items-end justify-between gap-2"><div><h2 className="text-sm font-extrabold">{isAr ? "أعمار الأرصدة المفتوحة" : "Open receivables aging"}</h2><p className="mt-1 text-xs text-text-muted">{isAr ? "قيمة المتبقي حسب مدة التأخير ضمن النتائج الحالية" : "Outstanding balance by age in the current filtered results"}{truncated && (isAr ? ` — عرض ${items.length} من أصل ${totalCount} فاتورة` : ` — showing ${items.length} of ${totalCount} invoices`)}</p></div><strong className="tnum text-base" dir="ltr">{formatAmountOnly(total)} {currencySymbol}</strong></div>
          <div className="flex h-3 w-full overflow-hidden rounded bg-surface-muted">{rows.map((row, i) => row.amount > 0n && <div key={row.key} className={`${tones[i]} h-full`} style={{ width: `${Number((row.amount * 10000n) / (total || 1n)) / 100}%` }} />)}</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">{rows.map((row, i) => <div key={row.key} className="min-w-0 text-start"><div className="flex items-center gap-2 text-xs font-semibold text-text-muted"><span className={`size-2.5 shrink-0 rounded-sm ${tones[i]}`} /><span className="truncate">{row.label}</span></div><p className="mt-1 truncate text-sm font-extrabold"><span className="tnum inline-block" dir="ltr">{formatAmountOnly(row.amount)} {currencySymbol}</span></p><p className="tnum mt-0.5 text-[11px] text-text-muted"><span className="inline-block" dir="ltr">{total > 0n ? `${Number((row.amount * 10000n) / total) / 100}%` : "0%"}</span></p></div>)}</div>
        </section>;
      })()}

      {/* Filters bar */}
      <div className="panel-shadow flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-4 sm:gap-4 sm:p-5">
        <label className="w-full min-w-0 sm:w-auto sm:flex-1 sm:min-w-[200px]">
          <span className="sr-only">{t("search")}</span>
          <span className="relative block">
            <MagnifyingGlass size={17} aria-hidden className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-text-subtle" />
            <input data-testid="inv-search" className={`${inputCls} ps-10`} placeholder={t("search")} value={search} onChange={(e) => setSearch(e.target.value)} />
          </span>
        </label>
        <label className="w-full min-w-0 sm:w-auto sm:min-w-[150px]">
          <span className="sr-only">{t("status")}</span>
          <select data-testid="inv-status-filter" className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t("allStatuses")}</option>
            {STATUSES.map((s) => <option key={s} value={s}>{t(`statuses.${s}`)}</option>)}
          </select>
        </label>
        <label className="w-full min-w-0 sm:w-auto sm:min-w-[140px]">
          <span className="sr-only">{t("aging")}</span>
          <select data-testid="inv-aging-filter" className={inputCls} value={bucket} onChange={(e) => setBucket(e.target.value)}>
            <option value="">{isAr ? "جميع الأعمار" : "All Aging"}</option>
            {BUCKETS.map((b) => <option key={b} value={b}>{t(`buckets.${b}`)}</option>)}
          </select>
        </label>
        <label className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl border border-border bg-surface-muted/60 px-3.5 py-2.5 transition-colors hover:bg-surface-muted sm:w-auto">
          <input
            data-testid="inv-overdue-filter"
            type="checkbox"
            className="size-4.5 rounded border border-border bg-surface accent-[var(--primary)] focus:ring-1 focus:ring-primary focus:ring-offset-0 cursor-pointer"
            checked={overdueOnly}
            onChange={(e) => setOverdueOnly(e.target.checked)}
          />
          <span className="text-xs font-bold text-text">{t("overdueOnly")}</span>
        </label>
      </div>

      {/* Bulk actions & count */}
      <div className="flex flex-wrap items-center gap-2.5">
        <select data-testid="inv-bulk-to" aria-label={t("bulkTargetStatus")} className={cn(inputVariants, "w-auto sm:min-w-[160px]")} value={bulkTo} onChange={(e) => setBulkTo(e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{t(`statuses.${s}`)}</option>)}
        </select>
        <button type="button" data-testid="inv-bulk-apply" disabled={busy || selected.size === 0} onClick={() => void onBulk()} className={btnGhost}>{selected.size > 0 ? `${t("bulkApply")} (${selected.size})` : t("bulkApply")}</button>
        <span className="ms-auto inline-flex items-center gap-2 rounded bg-callout px-3.5 py-1.5 text-xs font-medium text-text-subtle">
          <span>{t("title")}:</span>
          <span data-testid="inv-count" className="tnum font-bold text-primary" dir="ltr">{items.length}</span>
        </span>
      </div>

      {loading ? (
        <LoadingState isAr={isAr} />
      ) : items.length === 0 && !loadError ? (
        <EmptyState illustration={<EmptyInvoicesIllustration size={190} />} testId="invoices-empty" title={t("empty")} body={isAr ? "أنشئ فاتورة أو استورد ملفاً لبدء متابعة الاستحقاقات والتحصيل." : "Create an invoice or import a file to start tracking due dates and collections."} />
      ) : items.length === 0 ? null : (
        <div className="panel-shadow overflow-hidden rounded-xl border border-border bg-surface">
          <ul className="flex flex-col divide-y divide-border">
            {items.map((i, idx) => (
              <li key={i.id} data-testid="invoice-row" className="flex flex-col gap-3 p-4 transition-colors hover:bg-callout/40 sm:p-5">
                {/* Header row: Checkbox, Reference, Customer, Status, Edit */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                    <label className="flex cursor-pointer items-center gap-2.5">
                      <input
                        type="checkbox"
                        data-testid="inv-select"
                        className="size-4.5 rounded border border-border bg-surface accent-[var(--primary)] focus:ring-1 focus:ring-primary focus:ring-offset-0 cursor-pointer"
                        checked={selected.has(i.id)}
                        onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(i.id); else n.delete(i.id); return n; })}
                      />
                      <span className="text-base font-extrabold text-primary" dir="ltr">
                        {i.reference ?? `INV-${i.issuedOn.slice(0, 4)}-${1001 + idx}`}
                      </span>
                    </label>
                    <span className="max-w-full truncate rounded bg-surface-muted px-2.5 py-0.5 text-xs font-bold text-text">
                      {debtorName(i.debtorId)}
                    </span>
                    {i.description && (
                      <span className="hidden truncate text-xs text-text-muted md:inline-block max-w-sm">
                        {i.description}
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {i.overdue && (
                      <span data-testid="invoice-overdue" className="inline-flex items-center gap-1 rounded bg-status-overdue-bg px-2.5 py-0.5 text-xs font-bold text-status-overdue-fg">
                        <WarningCircle size={14} aria-hidden />
                        {t("overdueOnly")}
                      </span>
                    )}
                    <StatusPill status={i.status} label={t(`statuses.${i.status}`)} testId="invoice-status" />
                    <WhatsAppShareButton
                      phone={debtorPhone(i.debtorId)}
                      message={invoiceShareMessage({
                        businessName: effectiveBusinessName,
                        amount: `${fmt(i.outstandingMinor, i.currency)} ${getCurrencySymbol(i.currency, locale)}`,
                        dueDate: i.dueOn,
                        locale,
                      })}
                      size="sm"
                    />
                    <button
                      type="button"
                      onClick={() => editingId === i.id ? setEditingId(null) : startEdit(i)}
                      className={cn(buttonVariants({ variant: "outline", size: "icon" }), "size-8")}
                      title={tc.has("edit") ? tc("edit") : (isAr ? "تعديل" : "Edit")}
                    >
                      <PencilSimple size={15} aria-hidden />
                    </button>
                  </div>
                </div>

                {editingId === i.id && (
                  <div className="grid grid-cols-1 gap-3 rounded-xl border border-primary/30 bg-callout p-3.5 sm:grid-cols-2 lg:grid-cols-4">
                    <input className={cn(inputCls, "min-w-0")} placeholder={t("reference")} value={editForm.reference} onChange={(e) => setEditForm((f) => ({ ...f, reference: e.target.value }))} />
                    <input className={cn(inputCls, "min-w-0")} placeholder={t("description")} value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} />
                    <input className={cn(inputCls, "min-w-0")} dir="ltr" inputMode="decimal" placeholder={t("amount")} value={editForm.amount} onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))} />
                    <div className="flex min-w-0 flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-1">
                      <input type="date" className={cn(inputCls, "min-w-[130px] flex-1")} dir="ltr" value={editForm.dueOn} onChange={(e) => setEditForm((f) => ({ ...f, dueOn: e.target.value }))} />
                      <div className="flex shrink-0 items-center gap-2">
                        <button type="button" disabled={busy || editForm.amount.trim() === ""} onClick={() => void onSaveEdit(i.id)} className={btnSmall}>
                          <Check size={14} strokeWidth={2.5} aria-hidden /> {tc("save")}
                        </button>
                        <button type="button" onClick={() => setEditingId(null)} className={btnSmall}>
                          <X size={14} strokeWidth={2.5} aria-hidden />
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Sub row: Amount breakdown & Transition Actions */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/50 pt-2.5 text-xs sm:text-sm text-text-muted">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span>{t("amount")}: <b className="tnum font-bold text-text" dir="ltr">{fmt(i.amountMinor, i.currency)}</b> <span className="text-[11px] font-bold text-text-muted">{getCurrencySymbol(i.currency, locale)}</span></span>
                    <span>·</span>
                    <span>{t("paid")}: <b className="tnum font-bold text-status-paid-fg" dir="ltr">{fmt(i.paidMinor, i.currency)}</b> <span className="text-[11px] font-bold text-text-muted">{getCurrencySymbol(i.currency, locale)}</span></span>
                    <span>·</span>
                    <span>{t("remaining")}: <b className="tnum font-bold text-primary" dir="ltr">{fmt(i.outstandingMinor, i.currency)}</b> <span className="text-[11px] font-bold text-text-muted">{getCurrencySymbol(i.currency, locale)}</span></span>
                    <span>·</span>
                    <span>{t("dueOn")}: <span className="font-semibold text-text" dir="ltr">{i.dueOn}</span></span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {(["disputed", "written_off", "cancelled", "open"] as const)
                      .filter((to) => to !== i.status && canTransition(i.status as InvoiceStatus, to))
                      .map((to) => (
                        <button
                          key={to}
                          type="button"
                          data-testid={`inv-transition-${to}`}
                          disabled={busy}
                          onClick={() => void onTransition(i.id, to)}
                          className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                        >
                          {t(`statuses.${to}`)}
                        </button>
                      ))}
                  </div>
                </div>
                {i.currencyWarning && <p className="text-sm font-semibold text-status-due-fg">{t("currencyWarning")}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
