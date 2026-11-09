"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { ArrowLeft, MagnifyingGlass, Phone, Plus, Prohibit } from "@phosphor-icons/react";
import { trpc } from "@/lib/trpc-client";
import { EmptyState, InitialAvatar, Panel, btnPrimary, inputCls, labelCls } from "./ui";

interface Debtor { id: string; displayName: string; phoneE164: string; whatsappStatus: string; optedOut: boolean; notes: string | null }

export function DebtorsClient() {
  const t = useTranslations("debtors");
  const locale = useLocale();
  const [items, setItems] = useState<Debtor[]>([]);
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (q: string) => {
    const page = await trpc.debtors.list.query({ search: q || undefined, limit: 50 });
    setItems(page.items as Debtor[]);
  }, []);
  useEffect(() => { void load(""); }, [load]);

  async function onCreate() {
    setBusy(true); setError(null);
    try {
      await trpc.debtors.create.mutate({ displayName: name, phone, notes: notes || undefined });
      setName(""); setPhone(""); setNotes("");
      await load(search);
    } catch { setError(t("saveFailed")); } finally { setBusy(false); }
  }

  return (
    <section className="flex flex-col gap-6">
      <Panel title={t("add")} icon={Plus}>
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void onCreate(); }}>
          <div className="grid gap-4 sm:grid-cols-3">
            <label className={labelCls}><span>{t("name")}</span>
              <input data-testid="debtor-name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required /></label>
            <label className={labelCls}><span>{t("phone")}</span>
              <input data-testid="debtor-phone" className={inputCls} dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} required /></label>
            <label className={labelCls}><span>{t("notes")}</span>
              <input data-testid="debtor-notes" className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
          </div>
          {error && <p role="alert" className="text-sm font-semibold text-status-overdue-fg">{error}</p>}
          <div>
            <button data-testid="debtor-create" disabled={busy || name.trim().length < 1 || phone.trim().length < 3} className={btnPrimary}>
              <Plus size={18} weight="fill" aria-hidden />
              {t("add")}
            </button>
          </div>
        </form>
      </Panel>

      <label className={labelCls}><span>{t("search")}</span>
        <span className="relative block max-w-md">
          <MagnifyingGlass size={17} weight="fill" aria-hidden className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-text-subtle" />
          <input data-testid="debtor-search" className={`${inputCls} ps-9`} value={search}
            onChange={(e) => { setSearch(e.target.value); void load(e.target.value); }} />
        </span></label>

      {items.length === 0 ? (
        <EmptyState testId="debtors-empty" title={t("empty")} />
      ) : (
        <div className="panel-shadow overflow-hidden rounded-xl border border-border bg-surface">
          <ul className="flex flex-col divide-y divide-border">
            {items.map((d) => (
              <li key={d.id} data-testid="debtor-row" className="flex items-center gap-3.5 p-4 transition-colors hover:bg-surface-muted/50 sm:p-5">
                <InitialAvatar name={d.displayName} size={44} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-bold">
                    <span className="truncate">{d.displayName}</span>
                    {d.optedOut && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-bold text-text-muted">
                        <Prohibit size={12} weight="fill" aria-hidden />
                        {t("optedOut")}
                      </span>
                    )}
                  </p>
                  <p className="flex items-center gap-1.5 text-sm text-text-muted">
                    <Phone size={13} weight="fill" aria-hidden />
                    <span dir="ltr">{d.phoneE164}</span>
                  </p>
                  {d.notes && <p className="truncate text-sm text-text-subtle">{d.notes}</p>}
                </div>
                <Link data-testid="debtor-view" href={`/${locale}/debtors/${d.id}`}
                  className="inline-flex min-h-touch shrink-0 items-center gap-1.5 rounded-md border border-border px-4 py-2 font-bold transition-colors hover:border-border-strong hover:bg-surface-muted">
                  {t("view")}
                  <ArrowLeft size={15} weight="fill" aria-hidden className="rtl:-scale-x-100" />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
