"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { formatEgp } from "@tahseel/core";
import { trpc } from "@/lib/trpc-client";

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

  const inputCls = "w-full rounded-md border border-border bg-surface px-3 min-h-touch text-text";
  return (
    <section className="flex flex-col gap-6">
      <form className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4" onSubmit={(e) => { e.preventDefault(); void onCreate(); }}>
        <h2 className="font-bold">{t("add")}</h2>
        <label className="flex flex-col gap-1"><span>{t("debtor")}</span>
          <select data-testid="inv-debtor" className={inputCls} value={debtorId} onChange={(e) => setDebtorId(e.target.value)}>
            {debtors.map((d) => <option key={d.id} value={d.id}>{d.displayName}</option>)}
          </select></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1"><span>{t("amount")}</span>
            <input data-testid="inv-amount" className={inputCls} dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label>
          <label className="flex flex-col gap-1"><span>{t("reference")}</span>
            <input data-testid="inv-reference" className={inputCls} value={reference} onChange={(e) => setReference(e.target.value)} /></label>
          <label className="flex flex-col gap-1"><span>{t("issuedOn")}</span>
            <input data-testid="inv-issued" type="date" className={inputCls} dir="ltr" value={issuedOn} onChange={(e) => setIssuedOn(e.target.value)} required /></label>
          <label className="flex flex-col gap-1"><span>{t("dueOn")}</span>
            <input data-testid="inv-due" type="date" className={inputCls} dir="ltr" value={dueOn} onChange={(e) => setDueOn(e.target.value)} /></label>
        </div>
        {error && <p role="alert" className="text-sm">{error}</p>}
        <button data-testid="inv-create" disabled={!debtorId || amount.trim() === ""} className="min-h-touch rounded-md bg-primary px-4 font-bold text-primary-fg hover:bg-primary-hover disabled:opacity-60">{t("add")}</button>
      </form>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <label className="flex flex-col gap-1"><span>{t("search")}</span>
          <input data-testid="inv-search" className={inputCls} value={search} onChange={(e) => setSearch(e.target.value)} /></label>
        <label className="flex flex-col gap-1"><span>{t("status")}</span>
          <select data-testid="inv-status-filter" className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t("allStatuses")}</option>
            {STATUSES.map((s) => <option key={s} value={s}>{t(`statuses.${s}`)}</option>)}
          </select></label>
        <label className="flex flex-col gap-1"><span>{t("aging")}</span>
          <select data-testid="inv-aging-filter" className={inputCls} value={bucket} onChange={(e) => setBucket(e.target.value)}>
            <option value="">—</option>
            {BUCKETS.map((b) => <option key={b} value={b}>{t(`buckets.${b}`)}</option>)}
          </select></label>
        <label className="flex items-center gap-2 pt-6">
          <input data-testid="inv-overdue-filter" type="checkbox" checked={overdueOnly} onChange={(e) => setOverdueOnly(e.target.checked)} />
          <span>{t("overdueOnly")}</span></label>
      </div>

      <div className="flex items-center gap-2">
        <select data-testid="inv-bulk-to" className="rounded-md border border-border bg-surface px-3 min-h-touch" value={bulkTo} onChange={(e) => setBulkTo(e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{t(`statuses.${s}`)}</option>)}
        </select>
        <button data-testid="inv-bulk-apply" onClick={() => void onBulk()} className="min-h-touch rounded-md border border-border px-4 font-bold">{t("bulkApply")}</button>
        <span data-testid="inv-count" className="text-sm text-text-muted">{items.length}</span>
      </div>

      {items.length === 0 ? (
        <p data-testid="invoices-empty" className="rounded-lg border border-border bg-surface p-6 text-center text-text-muted">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((i) => (
            <li key={i.id} data-testid="invoice-row" className="rounded-lg border border-border bg-surface p-4">
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2">
                  <input type="checkbox" data-testid="inv-select" checked={selected.has(i.id)}
                    onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(i.id); else n.delete(i.id); return n; })} />
                  <span className="font-bold">{i.reference ?? "—"}</span>
                </label>
                <span data-testid="invoice-status">{t(`statuses.${i.status}`)}</span>
              </div>
              <p className="text-sm text-text-muted">
                {t("amount")}: <span className="tnum" dir="ltr">{fmt(i.amountMinor)}</span> · {t("remaining")}: <span className="tnum" dir="ltr">{fmt(i.outstandingMinor)}</span> · {t("dueOn")}: <span dir="ltr">{i.dueOn}</span>
                {i.overdue && <> · <span data-testid="invoice-overdue">{t("overdueOnly")}</span></>}
              </p>
              {i.currencyWarning && <p className="text-sm">{t("currencyWarning")}</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                {(["disputed", "written_off", "cancelled", "open"] as const).map((to) => (
                  <button key={to} data-testid={`inv-transition-${to}`} onClick={() => void onTransition(i.id, to)}
                    className="rounded-md border border-border px-3 py-1 text-sm">{t(`statuses.${to}`)}</button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
