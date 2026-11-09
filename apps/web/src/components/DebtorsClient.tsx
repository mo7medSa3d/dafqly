"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { trpc } from "@/lib/trpc-client";

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

  const inputCls = "w-full rounded-md border border-border bg-surface px-3 min-h-touch text-text";
  return (
    <section className="flex flex-col gap-6">
      <form className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4" onSubmit={(e) => { e.preventDefault(); void onCreate(); }}>
        <h2 className="font-bold">{t("add")}</h2>
        <label className="flex flex-col gap-1"><span>{t("name")}</span>
          <input data-testid="debtor-name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <label className="flex flex-col gap-1"><span>{t("phone")}</span>
          <input data-testid="debtor-phone" className={inputCls} dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} required /></label>
        <label className="flex flex-col gap-1"><span>{t("notes")}</span>
          <input data-testid="debtor-notes" className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        {error && <p role="alert" className="text-sm">{error}</p>}
        <button data-testid="debtor-create" disabled={busy || name.trim().length < 1 || phone.trim().length < 3}
          className="min-h-touch rounded-md bg-primary px-4 font-bold text-primary-fg hover:bg-primary-hover disabled:opacity-60">{t("add")}</button>
      </form>

      <label className="flex flex-col gap-1"><span>{t("search")}</span>
        <input data-testid="debtor-search" className={inputCls} value={search}
          onChange={(e) => { setSearch(e.target.value); void load(e.target.value); }} /></label>

      {items.length === 0 ? (
        <p data-testid="debtors-empty" className="rounded-lg border border-border bg-surface p-6 text-center text-text-muted">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((d) => (
            <li key={d.id} data-testid="debtor-row" className="flex items-center justify-between rounded-lg border border-border bg-surface p-4">
              <div>
                <p className="font-bold">{d.displayName}</p>
                <p className="text-sm text-text-muted" dir="ltr">{d.phoneE164}</p>
              </div>
              <Link data-testid="debtor-view" href={`/${locale}/debtors/${d.id}`} className="min-h-touch rounded-md border border-border px-4 py-2 font-bold">{t("view")}</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
