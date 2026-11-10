"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { formatEgp } from "@tahseel/core";
import { BellRinging, CalendarBlank, Camera, Checks, ShieldCheck } from "@phosphor-icons/react";
import { trpc } from "@/lib/trpc-client";
import { ChequesIllustration } from "./illustrations";
import { EmptyState, Panel, StatusPill, btnGhost, btnPrimary, inputCls, labelCls } from "./ui";

/**
 * F9 cheques UI: manual registration, photo pre-fill (extraction fills the
 * form; the merchant reviews and submits — nothing auto-registers),
 * lifecycle actions per the core state machine, due-week calendar, alerts.
 */
interface ChequeRow {
  id: string; debtorId: string; direction: string; number: string; bank: string;
  amountMinor: string; issueDate: string; dueDate: string; status: string;
  invoiceId: string | null; paymentId: string | null;
}
interface DebtorLite { id: string; displayName: string }
interface InvoiceLite { id: string; reference: string | null; amountMinor: string }
interface AlertRow { id: string; chequeId: string; alertKind: string; alertDate: string }
interface WeekGroup { weekStart: string; cheques: ChequeRow[] }

const NEXT: Record<string, { to: string; label: string }[]> = {
  held: [{ to: "deposited", label: "deposit" }, { to: "returned", label: "return" }, { to: "cancelled", label: "cancel" }],
  deposited: [{ to: "cleared", label: "clear" }, { to: "bounced", label: "bounce" }, { to: "returned", label: "return" }],
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

export function ChequesClient() {
  const t = useTranslations("cheques");
  const locale = useLocale();
  const isAr = locale === "ar";
  const [cheques, setCheques] = useState<ChequeRow[]>([]);
  const [calendar, setCalendar] = useState<WeekGroup[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [debtors, setDebtors] = useState<DebtorLite[]>([]);
  const [invoices, setInvoices] = useState<InvoiceLite[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const todayIso = new Date().toISOString().slice(0, 10);
  const due30Iso = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const [form, setForm] = useState({
    debtorId: "", direction: "receivable", number: "", bank: "", amount: "",
    issueDate: todayIso, dueDate: due30Iso, invoiceId: "", imageFileId: "",
  });

  const load = useCallback(async () => {
    const [list, cal, al, ds] = await Promise.all([
      trpc.cheques.list.query(), trpc.cheques.calendar.query(),
      trpc.cheques.alerts.query(), trpc.debtors.list.query({ limit: 50 }),
    ]);
    setCheques(list as ChequeRow[]);
    setCalendar(cal as WeekGroup[]);
    setAlerts(al as AlertRow[]);
    setDebtors((ds.items as DebtorLite[]).map((x) => ({ id: x.id, displayName: x.displayName })));
  }, []);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!form.debtorId) { setInvoices([]); return; }
    void trpc.debtors.get.query({ id: form.debtorId }).then((detail) => {
      setInvoices((detail.invoices as InvoiceLite[]).map((i) => ({ id: i.id, reference: i.reference, amountMinor: i.amountMinor })));
    }).catch(() => {
      setInvoices([]);
    });
  }, [form.debtorId]);

  async function onPhoto(file: File) {
    setBusy(true); setMsg(null);
    try {
      const out = await trpc.cheques.extractPhoto.mutate({
        fileName: file.name, mime: file.type || "image/png",
        contentBase64: await fileToBase64(file),
      });
      if (out.extraction) {
        setForm((f) => ({
          ...f,
          number: out.extraction!.number ?? f.number,
          bank: out.extraction!.bank ?? f.bank,
          amount: out.extraction!.amount_minor !== null ? (out.extraction!.amount_minor / 100).toFixed(2) : f.amount,
          issueDate: out.extraction!.issue_date ?? f.issueDate,
          dueDate: out.extraction!.due_date ?? f.dueDate,
          imageFileId: out.fileId,
        }));
        setMsg(t("prefilled"));
      }
    } catch { setMsg(t("failed")); } finally { setBusy(false); }
  }

  async function onRegister(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      await trpc.cheques.register.mutate({
        debtorId: form.debtorId,
        direction: form.direction as "receivable" | "payable",
        number: form.number,
        bank: form.bank,
        amount: form.amount,
        issueDate: form.issueDate,
        dueDate: form.dueDate,
        invoiceId: form.invoiceId || undefined,
        imageFileId: form.imageFileId || undefined,
      });
      setForm({
        debtorId: "", direction: "receivable", number: "", bank: "", amount: "",
        issueDate: todayIso, dueDate: due30Iso, invoiceId: "", imageFileId: "",
      });
      setMsg(t("registered"));
      await load();
    } catch { setMsg(t("failed")); } finally { setBusy(false); }
  }

  async function onTransition(id: string, to: string) {
    setBusy(true); setMsg(null);
    try {
      await trpc.cheques.transition.mutate({ id, to: to as never });
      await load();
    } catch { setMsg(t("failed")); } finally { setBusy(false); }
  }

  async function onRunAlerts() {
    setBusy(true);
    try { await trpc.cheques.runAlerts.mutate(); await load(); }
    catch { setMsg(t("failed")); } finally { setBusy(false); }
  }

  const debtorName = (id: string) => debtors.find((d) => d.id === id)?.displayName ?? id;
  const money = (minor: string) => <span className="tnum" dir="ltr">{formatEgp(BigInt(minor))}</span>;

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
      {/* Main Column: Cheques List, Alerts, Calendar (8 cols) */}
      <section className="flex flex-col gap-6 lg:col-span-8">
        {msg && <p role="status" className="rounded-xl border border-border bg-surface px-4 py-3 font-bold text-primary">{msg}</p>}

        {/* Due Alerts Panel */}
        <Panel
          title={t("alertsTitle")}
          icon={BellRinging}
          actions={<button data-testid="cheque-run-alerts" onClick={onRunAlerts} disabled={busy} className={btnGhost}>{t("runAlerts")}</button>}
        >
          {alerts.length === 0 ? (
            <div className="flex items-center gap-2.5 rounded-xl bg-surface-muted/60 px-4 py-3 text-xs text-text-muted">
              <BellRinging size={16} weight="fill" className="shrink-0 text-teal-600 dark:text-teal-300" />
              <span>{isAr ? "لا توجد تنبيهات استحقاق عاجلة حالياً — جميع الشيكات في مواعيدها." : "No urgent cheque alerts at the moment."}</span>
            </div>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {alerts.map((a) => (
                <li key={a.id} data-testid="cheque-alert" className="flex items-center gap-2.5 py-2.5 text-sm">
                  <BellRinging size={16} weight="fill" aria-hidden className="shrink-0 text-status-due-fg" />
                  <span>{t(a.alertKind as "due_in_3_days" | "due_today")} — <span dir="ltr">{a.alertDate}</span></span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* Registered Cheques */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-extrabold">{t("listTitle")}</h2>
            <span className="rounded-full bg-callout px-3 py-1 text-xs font-bold text-primary">
              {cheques.length} {isAr ? "شيك" : "Cheques"}
            </span>
          </div>

          {cheques.length === 0 ? (
            <EmptyState illustration={<ChequesIllustration size={84} />} title={t("empty")} />
          ) : (
            <div className="panel-shadow overflow-hidden rounded-2xl border border-border bg-surface">
              <ul className="flex flex-col divide-y divide-border">
                {cheques.map((c) => (
                  <li key={c.id} data-testid="cheque-row" className="flex flex-col gap-2.5 p-4 transition-colors hover:bg-callout/40 sm:p-5">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <span className="font-extrabold text-primary" dir="ltr">{c.number}</span>
                      <span className="text-text-muted">{c.bank}</span>
                      <span className="font-semibold">{debtorName(c.debtorId)}</span>
                      <span className="rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-bold">{t(c.direction as "receivable" | "payable")}</span>
                      <span className="ms-auto"><StatusPill status={c.status} label={t(c.status as "held")} testId="cheque-status" /></span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border/50 pt-2">
                      <div className="flex items-center gap-3">
                        <span className="tnum text-base font-extrabold text-text">{money(c.amountMinor)}</span>
                        <span className="text-xs text-text-muted">{t("dueDate")}: <span dir="ltr" className="font-semibold text-text">{c.dueDate}</span></span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {(NEXT[c.status] ?? []).map((n) => (
                          <button
                            key={n.to}
                            data-testid={`cheque-to-${n.to}`}
                            disabled={busy}
                            onClick={() => void onTransition(c.id, n.to)}
                            className="inline-flex min-h-[30px] items-center rounded-full border border-border px-3 py-0.5 text-xs font-bold transition-colors hover:border-primary hover:bg-callout hover:text-primary disabled:opacity-60"
                          >
                            {t(n.label as "deposit")}
                          </button>
                        ))}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Due Calendar */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <CalendarBlank size={20} weight="fill" className="text-primary" />
            <h2 className="text-lg font-extrabold">{t("calendarTitle")}</h2>
          </div>
          {calendar.length === 0 ? (
            <div className="rounded-xl border border-border bg-surface p-5 text-center text-xs text-text-muted">
              {isAr ? "لا توجد شيكات مجدولة للأسابيع القادمة." : "No scheduled cheques for upcoming weeks."}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {calendar.map((g) => (
                <div key={g.weekStart} className="panel-shadow rounded-2xl border border-border bg-surface p-4 sm:p-5">
                  <p className="mb-2 font-bold text-sm text-text">{t("weekOf")} <span dir="ltr">{g.weekStart}</span></p>
                  <ul className="flex flex-col divide-y divide-border">
                    {g.cheques.map((c) => (
                      <li key={c.id} className="flex items-center gap-2 py-2 text-xs sm:text-sm">
                        <span dir="ltr" className="font-semibold">{c.number}</span>
                        <span className="text-text-muted" dir="ltr">{c.dueDate}</span>
                        <span className="ms-auto font-bold">{money(c.amountMinor)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Side Column: Registration Form (4 cols) */}
      <aside className="flex flex-col gap-6 lg:col-span-4">
        <Panel title={t("registerTitle")} icon={Checks}>
          <form onSubmit={onRegister} className="flex flex-col gap-4">
            <label className="brand-pattern-light flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 border-dashed border-border-strong bg-surface-muted/40 px-4 py-5 text-center transition-colors hover:bg-surface-muted/70">
              <Camera size={26} weight="fill" aria-hidden className="text-teal-600 dark:text-teal-300" />
              <span className="font-bold text-sm">{t("photoTitle")}</span>
              <span className="text-xs text-text-muted">{t("photoHint")}</span>
              <input data-testid="cheque-photo" type="file" accept="image/*" disabled={busy} className="sr-only"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPhoto(f); }} />
            </label>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <label className={labelCls}><span>{t("debtor")}</span>
                <select data-testid="cheque-debtor" required value={form.debtorId} onChange={(e) => setForm({ ...form, debtorId: e.target.value, invoiceId: "" })} className={inputCls}>
                  <option value="">—</option>
                  {debtors.map((d) => <option key={d.id} value={d.id}>{d.displayName}</option>)}
                </select>
              </label>
              <label className={labelCls}><span>{t("direction")}</span>
                <select data-testid="cheque-direction" value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })} className={inputCls}>
                  <option value="receivable">{t("receivable")}</option>
                  <option value="payable">{t("payable")}</option>
                </select>
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <label className={labelCls}><span>{t("number")}</span>
                <input data-testid="cheque-number" required value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} className={inputCls} /></label>
              <label className={labelCls}><span>{t("bank")}</span>
                <input data-testid="cheque-bank" required value={form.bank} onChange={(e) => setForm({ ...form, bank: e.target.value })} className={inputCls} /></label>
              <label className={labelCls}><span>{t("amount")}</span>
                <input data-testid="cheque-amount" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={inputCls} /></label>
              <label className={labelCls}><span>{t("invoice")}</span>
                <select
                  data-testid="cheque-invoice"
                  value={form.invoiceId}
                  onChange={(e) => {
                    const invId = e.target.value;
                    const inv = invoices.find((x) => x.id === invId);
                    setForm({
                      ...form,
                      invoiceId: invId,
                      amount: inv && !form.amount ? (Number(inv.amountMinor) / 100).toFixed(2) : form.amount,
                    });
                  }}
                  className={inputCls}
                >
                  <option value="">{t("none")}</option>
                  {invoices.map((i) => <option key={i.id} value={i.id}>{i.reference ?? i.id} — {formatEgp(BigInt(i.amountMinor))}</option>)}
                </select></label>
              <label className={labelCls}><span>{t("issueDate")}</span>
                <input data-testid="cheque-issue" required type="date" value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} className={inputCls} /></label>
              <label className={labelCls}><span>{t("dueDate")}</span>
                <input data-testid="cheque-due" required type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className={inputCls} /></label>
            </div>

            <button data-testid="cheque-submit" type="submit" disabled={busy} className={`${btnPrimary} w-full justify-center`}>
              {t("register")}
            </button>
          </form>
        </Panel>

        <div className="panel-shadow flex items-start gap-3 rounded-2xl border border-border bg-surface p-4 text-xs text-text-muted">
          <ShieldCheck size={20} weight="fill" className="shrink-0 text-teal-600 dark:text-teal-300" />
          <p className="leading-relaxed">
            {isAr
              ? "متابعة الشيكات تمنع تضارب التذكيرات التلقائية وتتيح تصنيف العملاء وتنبيهك قبل موعد الإيداع أو الاستحقاق بـ 3 أيام."
              : "Cheque tracking prevents reminder conflicts and notifies you 3 days prior to due dates."}
          </p>
        </div>
      </aside>
    </div>
  );
}
