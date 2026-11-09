"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { formatEgp } from "@tahseel/core";
import { MagnifyingGlass, Plus, WarningCircle } from "@phosphor-icons/react";
import { trpc } from "@/lib/trpc-client";
import { EmptyInvoicesIllustration } from "./illustrations";
import { EmptyState, Panel, StatusPill, btnGhost, btnPrimary, inputCls, labelCls } from "./ui";

interface Invoice {
  id: string; debtorId: string; reference: string | null; description: string | null;
  amountMinor: string; paidMinor: string; outstandingMinor: string; currency: string; currencyWarning: boolean;
  issuedOn: string; dueOn: string; status: string; overdue: boolean; agingBucket: string; source: string;
}
interface DebtorLite { id: string; displayName: string }

const STATUSES = ["open", "partially_paid", "paid", "disputed", "written_off", "cancelled"] as const;
const BUCKETS = ["current", "0-7", "8-30", "31-60", "60+"] as const;
const fmt = (minor: string) => formatEgp(BigInt(minor));

export function InvoicesClient() {
  const t = useTranslations("invoices");
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
  const [dueOn, setDueOn] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const page = await trpc.invoices.list.query({
      limit: 100,
      search: search || undefined,
      status: (status || undefined) as never,
      overdue: overdueOnly || undefined,
      agingBucket: bucket || undefined,
    });
    setItems(page.items as Invoice[]);
  }, [search, status, overdueOnly, bucket]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    void trpc.debtors.list.query({ limit: 100 }).then((p) => {
      const list = (p.items as DebtorLite[]);
      setDebtors(list);
      if (list[0]) setDebtorId((cur) => cur || list[0]!.id);
    });
  }, []);

  async function onCreate() {
    setError(null);
    try {
      await trpc.invoices.create.mutate({
        debtorId, amount, issuedOn, dueOn: dueOn || undefined, reference: reference || undefined,
      });
      setAmount(""); setReference("");
      await load();
    } catch { setError(t("title")); }
  }

  async function onTransition(id: string, to: string) {
    await trpc.invoices.transition.mutate({ id, to: to as never });
    await load();
  }

  async function onBulk() {
    if (selected.size === 0) return;
    await trpc.invoices.bulkTransition.mutate({ ids: [...selected], to: bulkTo as never });
    setSelected(new Set());
    await load();
  }

  return (
    <section className="flex flex-col gap-6">
      <Panel title={t("add")} icon={Plus}>
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void onCreate(); }}>
          <label className={labelCls}><span>{t("debtor")}</span>
            <select data-testid="inv-debtor" className={inputCls} value={debtorId} onChange={(e) => setDebtorId(e.target.value)}>
              {debtors.map((d) => <option key={d.id} value={d.id}>{d.displayName}</option>)}
            </select></label>
          <div className="grid grid-cols-2 gap-4">
            <label className={labelCls}><span>{t("amount")}</span>
              <input data-testid="inv-amount" className={inputCls} dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label>
            <label className={labelCls}><span>{t("reference")}</span>
              <input data-testid="inv-reference" className={inputCls} value={reference} onChange={(e) => setReference(e.target.value)} /></label>
            <label className={labelCls}><span>{t("issuedOn")}</span>
              <input data-testid="inv-issued" type="date" className={inputCls} dir="ltr" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} required /></label>
            <label className={labelCls}><span>{t("dueOn")}</span>
              <input data-testid="inv-due" type="date" className={inputCls} dir="ltr" value={dueOn} onChange={(e) => setDueOn(e.target.value)} /></label>
          </div>
          {error && <p role="alert" className="text-sm text-status-overdue-fg">{error}</p>}
          <div>
            <button data-testid="inv-create" disabled={!debtorId || amount.trim() === ""} className={btnPrimary}>
              <Plus size={18} weight="fill" aria-hidden />
              {t("add")}
            </button>
          </div>
        </form>
      </Panel>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <label className={labelCls}><span>{t("search")}</span>
          <span className="relative block">
            <MagnifyingGlass size={17} weight="fill" aria-hidden className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-text-subtle" />
            <input data-testid="inv-search" className={`${inputCls} ps-9`} value={search} onChange={(e) => setSearch(e.target.value)} />
          </span></label>
        <label className={labelCls}><span>{t("status")}</span>
          <select data-testid="inv-status-filter" className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t("allStatuses")}</option>
            {STATUSES.map((s) => <option key={s} value={s}>{t(`statuses.${s}`)}</option>)}
          </select></label>
        <label className={labelCls}><span>{t("aging")}</span>
          <select data-testid="inv-aging-filter" className={inputCls} value={bucket} onChange={(e) => setBucket(e.target.value)}>
            <option value="">—</option>
            {BUCKETS.map((b) => <option key={b} value={b}>{t(`buckets.${b}`)}</option>)}
          </select></label>
        <label className="flex items-center gap-2 self-end pb-2">
          <input data-testid="inv-overdue-filter" type="checkbox" className="size-[18px] accent-[var(--teal-600)]" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
          <span className="font-semibold">{t("overdueOnly")}</span></label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select data-testid="inv-bulk-to" className="min-h-touch rounded-md border border-border bg-surface px-3" value={bulkTo} onChange={(e) => setBulkTo(e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{t(`statuses.${s}`)}</option>)}
        </select>
        <button data-testid="inv-bulk-apply" onClick={() => void onBulk()} className={btnGhost}>{t("bulkApply")}</button>
        <span className="ms-auto inline-flex items-center gap-2 text-sm text-text-muted">
          {t("title")}: <span data-testid="inv-count" className="tnum font-bold text-text" dir="ltr">{items.length}</span>
        </span>
      </div>

      {items.length === 0 ? (
        <EmptyState testId="invoices-empty" illustration={<EmptyInvoicesIllustration size={84} />} title={t("empty")} />
      ) : (
        <div className="panel-shadow overflow-hidden rounded-xl border border-border bg-surface">
          <ul className="flex flex-col divide-y divide-border">
            {items.map((i) => (
              <li key={i.id} data-testid="invoice-row" className="flex flex-col gap-2.5 p-4 transition-colors hover:bg-surface-muted/50 sm:p-5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <label className="flex items-center gap-2.5">
                    <input type="checkbox" data-testid="inv-select" className="size-[18px] accent-[var(--teal-600)]" checked={selected.has(i.id)}
                      onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(i.id); else n.delete(i.id); return n; })} />
                    <span className="font-extrabold" dir="ltr">{i.reference ?? "—"}</span>
                  </label>
                  {i.description && <span className="text-sm text-text-muted">{i.description}</span>}
                  <span className="ms-auto flex items-center gap-2">
                    {i.overdue && (
                      <span data-testid="invoice-overdue" className="inline-flex items-center gap-1 text-xs font-bold text-status-overdue-fg">
                        <WarningCircle size={14} weight="fill" aria-hidden />
                        {t("overdueOnly")}
                      </span>
                    )}
                    <StatusPill status={i.status} label={t(`statuses.${i.status}`)} testId="invoice-status" />
                  </span>
                </div>
                <p className="text-sm text-text-muted">
                  {t("amount")}: <span className="tnum font-bold text-text" dir="ltr">{fmt(i.amountMinor)}</span>
                  {" · "}{t("remaining")}: <span className="tnum font-bold text-text" dir="ltr">{fmt(i.outstandingMinor)}</span>
                  {" · "}{t("dueOn")}: <span dir="ltr">{i.dueOn}</span>
                </p>
                {i.currencyWarning && <p className="text-sm font-semibold text-status-due-fg">{t("currencyWarning")}</p>}
                <div className="flex flex-wrap gap-1.5">
                  {(["disputed", "written_off", "cancelled", "open"] as const).map((to) => (
                    <button key={to} data-testid={`inv-transition-${to}`} onClick={() => void onTransition(i.id, to)}
                      className="inline-flex min-h-[32px] items-center rounded-full border border-border px-3 py-1 text-xs font-bold transition-colors hover:border-border-strong hover:bg-surface-muted">
                      {t(`statuses.${to}`)}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
