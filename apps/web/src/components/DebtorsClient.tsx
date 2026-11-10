"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { ArrowLeft, MagnifyingGlass, Phone, Plus, Prohibit, Users, WarningCircle } from "@phosphor-icons/react";
import { trpc } from "@/lib/trpc-client";
import { EmptyState, InitialAvatar, Panel, btnPrimary, inputCls, labelCls } from "./ui";

interface Debtor {
  id: string; displayName: string; phoneE164: string; whatsappStatus: string;
  optedOut: boolean; notes?: string | null; riskFlag?: boolean;
}

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
    try {
      const page = await trpc.debtors.list.query({ search: q || undefined, limit: 100 });
      setItems(page.items as Debtor[]);
    } catch {
      /* ignore */
    }
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

  const optedOutCount = items.filter((d) => d.optedOut).length;
  const riskCount = items.filter((d) => d.riskFlag).length;

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
      {/* Main List Section (8 cols) */}
      <section className="flex flex-col gap-5 lg:col-span-8">
        {/* Search & Filter Toolbar */}
        <div className="panel-shadow flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-4">
          <label className="relative min-w-[260px] flex-1">
            <span className="sr-only">{t("search")}</span>
            <MagnifyingGlass
              size={17}
              weight="fill"
              aria-hidden
              className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-text-subtle"
            />
            <input
              data-testid="debtor-search"
              className={`${inputCls} ps-10`}
              placeholder={t("search")}
              value={search}
              onChange={(e) => { setSearch(e.target.value); void load(e.target.value); }}
            />
          </label>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-callout px-3.5 py-2 text-xs font-bold text-primary">
            <span data-testid="debtors-count" className="tnum font-extrabold" dir="ltr">{items.length}</span>
            <span>{locale === "en" ? "Customers" : "عميل"}</span>
          </span>
        </div>

        {/* Debtors List */}
        {items.length === 0 ? (
          <EmptyState testId="debtors-empty" title={t("empty")} />
        ) : (
          <div className="panel-shadow overflow-hidden rounded-2xl border border-border bg-surface">
            <ul className="flex flex-col divide-y divide-border">
              {items.map((d) => (
                <li
                  key={d.id}
                  data-testid="debtor-row"
                  className="flex flex-wrap items-center justify-between gap-4 p-4 transition-colors hover:bg-callout/40 sm:p-5"
                >
                  <div className="flex min-w-0 items-center gap-3.5">
                    <InitialAvatar name={d.displayName} size={44} />
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-bold">
                        <span className="truncate text-base">{d.displayName}</span>
                        {d.optedOut && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2.5 py-0.5 text-[11px] font-bold text-text-muted">
                            <Prohibit size={12} weight="fill" aria-hidden />
                            {t("optedOut")}
                          </span>
                        )}
                        {d.riskFlag && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-status-overdue-bg px-2.5 py-0.5 text-[11px] font-bold text-status-overdue-fg">
                            <WarningCircle size={12} weight="fill" aria-hidden />
                            {locale === "en" ? "Bounced Cheque / Risk" : "شيك مرتد / مخاطرة"}
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-sm text-text-muted">
                        <Phone size={13} weight="fill" aria-hidden className="text-primary" />
                        <span dir="ltr">{d.phoneE164}</span>
                      </p>
                      {d.notes && <p className="mt-0.5 truncate text-xs text-text-subtle">{d.notes}</p>}
                    </div>
                  </div>

                  <Link
                    data-testid="debtor-view"
                    href={`/${locale}/debtors/${d.id}`}
                    className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-full border border-border-strong/60 bg-surface px-4 py-2 text-xs font-bold transition-colors hover:border-primary hover:bg-callout hover:text-primary sm:text-sm"
                  >
                    <span>{t("view")}</span>
                    <ArrowLeft size={14} weight="fill" aria-hidden className="rtl:-scale-x-100" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Side Column: Quick Add & Summary (4 cols) */}
      <aside className="flex flex-col gap-6 lg:col-span-4">
        <Panel title={t("add")} icon={Plus}>
          <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void onCreate(); }}>
            <label className={labelCls}>
              <span>{t("name")}</span>
              <input
                data-testid="debtor-name"
                className={inputCls}
                placeholder={locale === "en" ? "e.g. Nile Trading Co." : "مثال: شركة النيل للتجارة"}
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
                placeholder={locale === "en" ? "Optional merchant notes" : "ملاحظات اختيارية"}
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
            <span>{locale === "en" ? "Customer Summary" : "ملخص سجل المدينين"}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-xl bg-surface-muted p-2.5">
              <p className="text-xs text-text-muted">{locale === "en" ? "Total Debtors" : "إجمالي العملاء"}</p>
              <p className="tnum text-lg font-extrabold text-primary" dir="ltr">{items.length}</p>
            </div>
            <div className="rounded-xl bg-surface-muted p-2.5">
              <p className="text-xs text-text-muted">{locale === "en" ? "Opted Out" : "متوقف تذكيرهم"}</p>
              <p className="tnum text-lg font-extrabold text-text" dir="ltr">{optedOutCount}</p>
            </div>
          </div>
          {riskCount > 0 && (
            <p className="rounded-xl bg-status-overdue-bg p-2.5 text-xs font-bold text-status-overdue-fg">
              ⚠️ {locale === "en" ? `${riskCount} customer(s) with bounced cheques or risk flags` : `يوجد ${riskCount} عميل مرتبط بشيك مرتد أو مخاطرة`}
            </p>
          )}
          <p className="text-xs leading-relaxed text-text-muted">
            🛡️ {locale === "en"
              ? "WhatsApp reminders are sent automatically per invoice due dates, honoring quiet hours and instant opt-outs."
              : "تذكيرات واتساب تُرسل تلقائيًا لكل عميل وفق مواعيد استحقاق فواتيره، مع احترام ساعات الهدوء والإيقاف الفوري بطلب العميل."}
          </p>
        </div>
      </aside>
    </div>
  );
}
