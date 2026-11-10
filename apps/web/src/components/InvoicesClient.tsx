"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { formatEgp, canTransition, type InvoiceStatus } from "@tahseel/core";
import { Check, MagnifyingGlass, PencilSimple, Plus, Sparkle, WarningCircle, X } from "@phosphor-icons/react";
import { trpc } from "@/lib/trpc-client";
import { EmptyInvoicesIllustration, ReceivablesIllustration } from "./illustrations";
import { EmptyState, Panel, SecurityNotice, StatusPill, btnGhost, btnPrimary, btnSmall, inputCls, labelCls } from "./ui";

interface Invoice {
  id: string; debtorId: string; reference: string | null; description: string | null;
  amountMinor: string; paidMinor: string; outstandingMinor: string; currency: string; currencyWarning: boolean;
  issuedOn: string; dueOn: string; status: string; overdue: boolean; agingBucket: string; source: string;
}
interface DebtorLite { id: string; displayName: string }

const STATUSES = ["open", "partially_paid", "paid", "disputed", "written_off", "cancelled"] as const;
const BUCKETS = ["current", "0-7", "8-30", "31-60", "60+"] as const;
const fmt = (minor: string) => formatEgp(BigInt(minor));

function addDaysIso(baseIso: string, days: number): string {
  const d = new Date(`${baseIso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return baseIso;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function InvoicesClient() {
  const t = useTranslations("invoices");
  const tc = useTranslations("common");
  const locale = useLocale();
  const isAr = locale === "ar";
  const [items, setItems] = useState<Invoice[]>([]);
  const [debtors, setDebtors] = useState<DebtorLite[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string>("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [bucket, setBucket] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTo, setBulkTo] = useState<string>("cancelled");
  const [debtorId, setDebtorId] = useState("");
  const [amount, setAmount] = useState("");
  const [issuedOn, setIssuedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueOn, setDueOn] = useState(() => addDaysIso(new Date().toISOString().slice(0, 10), 14));
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ reference: string; description: string; amount: string; dueOn: string }>({
    reference: "", description: "", amount: "", dueOn: "",
  });
  const [error, setError] = useState<string | null>(null);

  const nextAutoReference = `INV-${issuedOn.slice(0, 4)}-${items.length + 1001}`;

  const load = useCallback(async () => {
    try {
      const page = await trpc.invoices.list.query({
        limit: 100,
        search: search || undefined,
        status: (status || undefined) as never,
        overdue: overdueOnly || undefined,
        agingBucket: bucket || undefined,
      });
      setItems(page.items as Invoice[]);
    } catch {
      /* ignore */
    }
  }, [search, status, overdueOnly, bucket]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void trpc.debtors.list.query({ limit: 100 }).then((p) => {
      const list = (p.items as DebtorLite[]);
      setDebtors(list);
      if (list[0]) setDebtorId((cur) => cur || list[0]!.id);
    }).catch(() => {});
  }, []);

  async function onCreate() {
    setError(null);
    try {
      await trpc.invoices.create.mutate({
        debtorId,
        amount,
        issuedOn,
        dueOn: dueOn || undefined,
        reference: reference.trim() || nextAutoReference,
        description: description.trim() || undefined,
      });
      setAmount(""); setReference(""); setDescription("");
      await load();
    } catch { setError(t("title")); }
  }

  function startEdit(inv: Invoice) {
    setEditingId(inv.id);
    setEditForm({
      reference: inv.reference ?? "",
      description: inv.description ?? "",
      amount: (Number(inv.amountMinor) / 100).toFixed(2),
      dueOn: inv.dueOn,
    });
  }

  async function onSaveEdit(id: string) {
    setError(null);
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
    } catch { setError(t("title")); }
  }

  async function onTransition(id: string, to: InvoiceStatus) {
    setError(null);
    try {
      await trpc.invoices.transition.mutate({ id, to });
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : (isAr ? "فشل تغيير حالة الفاتورة" : "Failed to update invoice status"));
    }
  }

  async function onBulk() {
    if (selected.size === 0) return;
    setError(null);
    try {
      await trpc.invoices.bulkTransition.mutate({ ids: [...selected], to: bulkTo as never });
      setSelected(new Set());
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : (isAr ? "فشل تنفيذ العملية المجمعة" : "Failed to apply bulk transition"));
    }
  }

  const debtorName = (id: string) => debtors.find((d) => d.id === id)?.displayName ?? "—";

  return (
    <section className="flex flex-col gap-6">
      {/* Top Section: Form (8 cols) + Info Card (4 cols) */}
      <div className="grid items-stretch gap-6 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <Panel title={t("add")} icon={Plus}>
            <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void onCreate(); }}>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--icon-box-border)] bg-[var(--icon-box-bg)] px-3.5 py-2 text-xs font-bold text-[var(--icon-box-fg)]">
                <span className="inline-flex items-center gap-1.5">
                  <Sparkle size={14} weight="fill" aria-hidden />
                  <span>{isAr ? "رقم الفاتورة يُنشأ تلقائيًا بدون إدخال يدوي" : "Invoice ID is generated automatically"}</span>
                </span>
                <span className="rounded-full bg-surface px-2.5 py-0.5 font-extrabold text-primary" dir="ltr">
                  {reference.trim() || nextAutoReference}
                </span>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className={labelCls}><span>{t("debtor")}</span>
                  <select data-testid="inv-debtor" className={inputCls} value={debtorId} onChange={(e) => setDebtorId(e.target.value)}>
                    {debtors.map((d) => <option key={d.id} value={d.id}>{d.displayName}</option>)}
                  </select></label>
                <label className={labelCls}><span>{t("amount")}</span>
                  <input data-testid="inv-amount" className={inputCls} dir="ltr" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className={labelCls}><span>{t("description")}</span>
                  <input data-testid="inv-description" className={inputCls} placeholder={isAr ? "اختياري: مثال دفعة توريد أو خدمات" : "Optional: e.g. Supply batch or services"} value={description} onChange={(e) => setDescription(e.target.value)} /></label>
                <label className={labelCls}>
                  <span>{t("reference")}</span>
                  <input
                    data-testid="inv-reference"
                    className={inputCls}
                    dir="ltr"
                    placeholder={`${nextAutoReference} (${isAr ? "تلقائي" : "Auto"})`}
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
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
                        className="rounded-full border border-border px-2.5 py-0.5 text-[11px] font-bold text-text-muted transition-colors hover:border-primary hover:bg-callout hover:text-primary"
                      >
                        {q.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {error && <p role="alert" className="text-sm font-semibold text-status-overdue-fg">{error}</p>}
              <div>
                <button data-testid="inv-create" disabled={!debtorId || amount.trim() === ""} className={btnPrimary}>
                  <Plus size={18} weight="fill" aria-hidden />
                  {t("add")}
                </button>
              </div>
            </form>
          </Panel>
        </div>

        <div className="panel-shadow flex flex-col justify-between gap-4 rounded-2xl border border-border bg-surface p-5 sm:p-6 lg:col-span-4">
          <div className="flex justify-center">
            <ReceivablesIllustration size={220} />
          </div>
          <SecurityNotice
            compact
            body={isAr
              ? "يُنشأ رقم الفاتورة تلقائيًا وتُجدول تذكيرات السداد للعميل في مواعيدها دون أي إعداد يدوي."
              : "Invoice IDs are generated automatically and reminders are scheduled on time with zero manual setup."}
          />
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-center justify-between rounded-2xl border border-danger/30 bg-danger-bg px-4 py-3 text-sm font-semibold text-danger shadow-sm">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="rounded-lg px-2 py-1 text-xs font-bold underline hover:bg-danger/10">
            {isAr ? "إغلاق" : "Dismiss"}
          </button>
        </div>
      )}

      {/* Filters bar */}
      <div className="panel-shadow flex flex-wrap items-center gap-4 rounded-2xl border border-border bg-surface p-4 sm:p-5">
        <label className="min-w-[200px] flex-1">
          <span className="sr-only">{t("search")}</span>
          <span className="relative block">
            <MagnifyingGlass size={17} weight="fill" aria-hidden className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-text-subtle" />
            <input data-testid="inv-search" className={`${inputCls} ps-10`} placeholder={t("search")} value={search} onChange={(e) => setSearch(e.target.value)} />
          </span>
        </label>
        <label className="min-w-[150px]">
          <span className="sr-only">{t("status")}</span>
          <select data-testid="inv-status-filter" className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t("allStatuses")}</option>
            {STATUSES.map((s) => <option key={s} value={s}>{t(`statuses.${s}`)}</option>)}
          </select>
        </label>
        <label className="min-w-[140px]">
          <span className="sr-only">{t("aging")}</span>
          <select data-testid="inv-aging-filter" className={inputCls} value={bucket} onChange={(e) => setBucket(e.target.value)}>
            <option value="">{isAr ? "جميع الأعمار" : "All Aging"}</option>
            {BUCKETS.map((b) => <option key={b} value={b}>{t(`buckets.${b}`)}</option>)}
          </select>
        </label>
        <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-border bg-surface-muted/60 px-3.5 py-2.5 transition-colors hover:bg-surface-muted">
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
        <select data-testid="inv-bulk-to" className="min-h-[40px] rounded-full border border-border-strong/60 bg-surface px-4 text-xs font-medium" value={bulkTo} onChange={(e) => setBulkTo(e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{t(`statuses.${s}`)}</option>)}
        </select>
        <button data-testid="inv-bulk-apply" onClick={() => void onBulk()} className={btnGhost}>{t("bulkApply")}</button>
        <span className="ms-auto inline-flex items-center gap-2 rounded-full bg-callout px-3.5 py-1.5 text-xs font-medium text-text-muted">
          <span>{t("title")}:</span>
          <span data-testid="inv-count" className="tnum font-bold text-primary" dir="ltr">{items.length}</span>
        </span>
      </div>

      {items.length === 0 ? (
        <EmptyState testId="invoices-empty" illustration={<EmptyInvoicesIllustration size={140} />} title={t("empty")} />
      ) : (
        <div className="panel-shadow overflow-hidden rounded-2xl border border-border bg-surface">
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
                    <span className="rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-bold text-text">
                      {debtorName(i.debtorId)}
                    </span>
                    {i.description && (
                      <span className="hidden truncate text-xs text-text-muted md:inline-block max-w-sm">
                        {i.description}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {i.overdue && (
                      <span data-testid="invoice-overdue" className="inline-flex items-center gap-1 rounded-full bg-status-overdue-bg px-2.5 py-0.5 text-xs font-bold text-status-overdue-fg">
                        <WarningCircle size={14} weight="fill" aria-hidden />
                        {t("overdueOnly")}
                      </span>
                    )}
                    <StatusPill status={i.status} label={t(`statuses.${i.status}`)} testId="invoice-status" />
                    <button
                      type="button"
                      onClick={() => editingId === i.id ? setEditingId(null) : startEdit(i)}
                      className="inline-flex size-8 items-center justify-center rounded-full border border-border text-text-muted transition-colors hover:border-primary hover:bg-callout hover:text-primary"
                      title={tc("save")}
                    >
                      <PencilSimple size={15} weight="fill" aria-hidden />
                    </button>
                  </div>
                </div>

                {editingId === i.id && (
                  <div className="grid gap-3 rounded-xl border border-primary/30 bg-callout p-3.5 sm:grid-cols-4">
                    <input className={inputCls} placeholder={t("reference")} value={editForm.reference} onChange={(e) => setEditForm((f) => ({ ...f, reference: e.target.value }))} />
                    <input className={inputCls} placeholder={t("description")} value={editForm.description} onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))} />
                    <input className={inputCls} dir="ltr" inputMode="decimal" placeholder={t("amount")} value={editForm.amount} onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))} />
                    <div className="flex items-center gap-2">
                      <input type="date" className={inputCls} dir="ltr" value={editForm.dueOn} onChange={(e) => setEditForm((f) => ({ ...f, dueOn: e.target.value }))} />
                      <button type="button" onClick={() => void onSaveEdit(i.id)} className={btnSmall}>
                        <Check size={14} weight="bold" aria-hidden /> {tc("save")}
                      </button>
                      <button type="button" onClick={() => setEditingId(null)} className={btnSmall}>
                        <X size={14} weight="bold" aria-hidden />
                      </button>
                    </div>
                  </div>
                )}

                {/* Sub row: Amount breakdown & Transition Actions */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/50 pt-2.5 text-xs sm:text-sm text-text-muted">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span>{t("amount")}: <b className="tnum font-bold text-text" dir="ltr">{fmt(i.amountMinor)}</b></span>
                    <span>·</span>
                    <span>{t("paid")}: <b className="tnum font-bold text-status-paid-fg" dir="ltr">{fmt(i.paidMinor)}</b></span>
                    <span>·</span>
                    <span>{t("remaining")}: <b className="tnum font-bold text-primary" dir="ltr">{fmt(i.outstandingMinor)}</b></span>
                    <span>·</span>
                    <span>{t("dueOn")}: <span className="font-semibold text-text" dir="ltr">{i.dueOn}</span></span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {(["disputed", "written_off", "cancelled", "open"] as const)
                      .filter((to) => to !== i.status && canTransition(i.status as InvoiceStatus, to))
                      .map((to) => (
                        <button
                          key={to}
                          data-testid={`inv-transition-${to}`}
                          onClick={() => void onTransition(i.id, to)}
                          className="inline-flex min-h-[30px] items-center rounded-full border border-border-strong/50 bg-surface px-3 py-0.5 text-xs font-bold transition-colors hover:border-primary hover:bg-callout hover:text-primary"
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
