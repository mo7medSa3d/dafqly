"use client";
import { cn, todayIso as localTodayIso } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useCurrency } from "./CurrencyContext";
import { BellRinging, CalendarBlank, Camera, Checks, ShieldCheck, Sparkle } from "@/components/ui/solid-icons";
import { trpc } from "@/lib/trpc-client";
import { EmptyState, LoadingState, Panel, StatusPill, btnGhost, btnPrimary, inputCls, labelCls } from "./ui";
import { ChequesIllustration } from "./illustrations";

/**
 * F9 cheques UI: manual registration, photo pre-fill (extraction fills the
 * form; the merchant reviews and submits — nothing auto-registers),
 * lifecycle actions per the core state machine, due-week calendar, alerts.
 */
interface ChequeRow {
  id: string; debtorId: string; direction: string; number: string; bank: string;
  amountMinor: string; currency: string; issueDate: string; dueDate: string; status: string;
  invoiceId: string | null; paymentId: string | null;
}
interface DebtorLite { id: string; displayName: string }
interface InvoiceLite { id: string; reference: string | null; amountMinor: string; currency?: string }
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
  const { formatAmountOnly } = useCurrency();
  const [cheques, setCheques] = useState<ChequeRow[]>([]);
  const [calendar, setCalendar] = useState<WeekGroup[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [debtors, setDebtors] = useState<DebtorLite[]>([]);
  const [invoices, setInvoices] = useState<InvoiceLite[]>([]);
  const [msg, setMsg] = useState<{ text: string; isError?: boolean } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const todayIso = localTodayIso();
  const due30Iso = localTodayIso(30);
  const [matchedInfo, setMatchedInfo] = useState<{
    debtorName: string;
    invoiceRef: string | null;
  } | null>(null);
  const [form, setForm] = useState({
    debtorId: "", direction: "receivable", number: "", bank: "", amount: "",
    issueDate: todayIso, dueDate: due30Iso, invoiceId: "", imageFileId: "",
  });

  // F-17: first-load flag only — see DebtorsClient.
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const [list, cal, al, ds] = await Promise.all([
        trpc.cheques.list.query(), trpc.cheques.calendar.query(),
        trpc.cheques.alerts.query(), trpc.debtors.list.query({ limit: 200 }),
      ]);
      setCheques(list as ChequeRow[]);
      setCalendar(cal as WeekGroup[]);
      setAlerts(al as AlertRow[]);
      setDebtors((ds.items as DebtorLite[]).map((x) => ({ id: x.id, displayName: x.displayName })));
    } catch (err: unknown) {
      setLoadError(err instanceof Error && err.message ? err.message : t("failed"));
    } finally {
      setLoading(false);
    }
  }, [t]);
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
    setBusy(true); setMsg(null); setMatchedInfo(null);
    try {
      const out = await trpc.cheques.extractPhoto.mutate({
        fileName: file.name, mime: file.type || "image/png",
        contentBase64: await fileToBase64(file),
      });
      if (out.extraction) {
        const matchedDebtorId = out.matchedDebtor?.id ?? "";
        const matchedInvoiceId = out.matchedInvoice?.id ?? "";

        setForm((f) => ({
          ...f,
          debtorId: matchedDebtorId || f.debtorId,
          invoiceId: matchedInvoiceId || f.invoiceId,
          number: out.extraction!.number ?? f.number,
          bank: out.extraction!.bank ?? f.bank,
          amount: out.extraction!.amount_minor !== null ? formatAmountOnly(out.extraction!.amount_minor) : f.amount,
          issueDate: out.extraction!.issue_date ?? f.issueDate,
          dueDate: out.extraction!.due_date ?? f.dueDate,
          imageFileId: out.fileId,
        }));

        if (out.matchedDebtor) {
          setMatchedInfo({
            debtorName: out.matchedDebtor.displayName,
            invoiceRef: out.matchedInvoice?.reference ?? null,
          });
        }
        setMsg({ text: t("prefilled") });
      }
    } catch (err: unknown) {
      setMsg({ text: err instanceof Error && err.message ? err.message : t("failed"), isError: true });
    } finally { setBusy(false); }
  }

  async function onRegister(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !form.debtorId || !form.number.trim() || !form.bank.trim() || !form.amount.trim()) return;
    setBusy(true); setMsg(null);
    try {
      await trpc.cheques.register.mutate({
        debtorId: form.debtorId,
        direction: form.direction as "receivable" | "payable",
        number: form.number.trim(),
        bank: form.bank.trim(),
        amount: form.amount.trim(),
        issueDate: form.issueDate,
        dueDate: form.dueDate,
        invoiceId: form.direction === "receivable" ? (form.invoiceId || undefined) : undefined,
        imageFileId: form.imageFileId || undefined,
      });
      setForm({
        debtorId: "", direction: "receivable", number: "", bank: "", amount: "",
        issueDate: todayIso, dueDate: due30Iso, invoiceId: "", imageFileId: "",
      });
      setMatchedInfo(null);
      setMsg({ text: t("registered") });
      await load();
    } catch (err: unknown) {
      setMsg({ text: err instanceof Error && err.message ? err.message : t("failed"), isError: true });
    } finally { setBusy(false); }
  }

  async function onTransition(id: string, to: string) {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      await trpc.cheques.transition.mutate({ id, to: to as never });
      setMsg({ text: t("saved") });
      await load();
    } catch (err: unknown) {
      setMsg({ text: err instanceof Error && err.message ? err.message : t("failed"), isError: true });
    } finally { setBusy(false); }
  }

  async function onRunAlerts() {
    if (busy) return;
    setBusy(true); setMsg(null);
    try { await trpc.cheques.runAlerts.mutate(); await load(); }
    catch (err: unknown) {
      setMsg({ text: err instanceof Error && err.message ? err.message : t("failed"), isError: true });
    } finally { setBusy(false); }
  }

  const debtorMap = useMemo(() => new Map(debtors.map((d) => [d.id, d.displayName])), [debtors]);
  const debtorName = (id: string) => debtorMap.get(id) ?? id;

  const portfolioSummary = useMemo(() => {
    const held = new Map<string, bigint>();
    const cleared = new Map<string, bigint>();
    const bounced = new Map<string, bigint>();
    for (const c of cheques) {
      const amt = BigInt(c.amountMinor || "0");
      if (c.status === "held" || c.status === "deposited") {
        held.set(c.currency, (held.get(c.currency) ?? 0n) + amt);
      } else if (c.status === "cleared") {
        cleared.set(c.currency, (cleared.get(c.currency) ?? 0n) + amt);
      } else if (c.status === "bounced") {
        bounced.set(c.currency, (bounced.get(c.currency) ?? 0n) + amt);
      }
    }
    const toSorted = (m: Map<string, bigint>) => [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
    return { held: toSorted(held), cleared: toSorted(cleared), bounced: toSorted(bounced) };
  }, [cheques]);
  const money = (minor: string, currency: string) => (
    <span className="tnum" dir="ltr">
      {formatAmountOnly(BigInt(minor), { currency })} <span className="text-[11px] font-bold text-text-muted">{currency}</span>
    </span>
  );

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
      {/* Main Column: Cheques List, Alerts, Calendar (8 cols) */}
      <section className="flex min-w-0 flex-col gap-6 lg:col-span-8">
        {loadError && (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger-bg px-4 py-3 text-sm font-semibold text-danger">
            <span>{loadError}</span>
            <button type="button" onClick={() => void load()} className={cn(buttonVariants({ variant: "ghost", size: "xs" }), "underline")}>
              {isAr ? "إعادة المحاولة" : "Retry"}
            </button>
          </div>
        )}
        {msg && <p role={msg.isError ? "alert" : "status"} className={cn("rounded-xl border px-4 py-3 font-bold", msg.isError ? "border-danger/30 bg-danger-bg text-danger" : "border-border bg-surface text-primary")}>{msg.text}</p>}

        {/* Cheques Portfolio Visual Summary Strip */}
        {cheques.length > 0 && (() => {
          const { held, cleared, bounced } = portfolioSummary;
          const totals = (items: Array<[string, bigint]>) => items.length === 0
            ? <span className="tnum text-lg font-extrabold text-text-muted">—</span>
            : items.map(([currency, minor]) => <span key={currency} className="tnum text-lg font-extrabold text-primary" dir="ltr">{formatAmountOnly(minor, { currency })} <span className="text-xs font-bold text-text-muted">{currency}</span></span>);
          return (
            <div data-testid="cheques-visual-summary" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="panel-shadow flex flex-col gap-1 rounded-xl border border-border bg-surface p-4">
                <span className="text-xs font-semibold text-text-muted">{isAr ? "شيكات برسم التحصيل" : "Held & Deposited"}</span>
                <div className="flex flex-col gap-1">{totals(held)}</div>
              </div>
              <div className="panel-shadow flex flex-col gap-1 rounded-xl border border-border bg-surface p-4">
                <span className="text-xs font-semibold text-text-muted">{isAr ? "شيكات محصّلة" : "Cleared Cheques"}</span>
                <div className="flex flex-col gap-1">{totals(cleared)}</div>
              </div>
              <div className="panel-shadow flex flex-col gap-1 rounded-xl border border-border bg-surface p-4">
                <span className="text-xs font-semibold text-text-muted">{isAr ? "شيكات مرتدة" : "Bounced Cheques"}</span>
                <div className="flex flex-col gap-1">{totals(bounced)}</div>
              </div>
            </div>
          );
        })()}

        {/* Due Alerts Panel */}
        <Panel
          title={t("alertsTitle")}
          icon={BellRinging}
          actions={<button data-testid="cheque-run-alerts" onClick={onRunAlerts} disabled={busy} className={btnGhost}>{t("runAlerts")}</button>}
        >
          {loading ? (
            <LoadingState isAr={isAr} />
          ) : alerts.length === 0 ? (
            <div className="flex items-center gap-2.5 rounded-xl bg-surface-muted/60 px-4 py-3 text-xs text-text-muted">
              <BellRinging size={16} className="shrink-0 text-status-paid-fg dark:text-status-paid-fg" />
              <span>{isAr ? "لا توجد تنبيهات استحقاق عاجلة حالياً — جميع الشيكات في مواعيدها." : "No urgent cheque alerts at the moment."}</span>
            </div>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {alerts.map((a) => (
                <li key={a.id} data-testid="cheque-alert" className="flex items-center gap-2.5 py-2.5 text-sm">
                  <BellRinging size={16} aria-hidden className="shrink-0 text-status-due-fg" />
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
            <span className="rounded bg-callout px-3 py-1 text-xs font-bold text-primary">
              {cheques.length} {isAr ? "شيك" : "Cheques"}
            </span>
          </div>

          {loading ? (
            <LoadingState isAr={isAr} />
          ) : cheques.length === 0 ? (
            <EmptyState illustration={<ChequesIllustration size={150} />} title={t("empty")} body={isAr ? "سجّل أول شيك لبدء متابعة مواعيد التحصيل والإيداع والارتداد." : "Register a cheque to track collection, deposit and bounce dates."} />
          ) : (
            <div className="panel-shadow overflow-hidden rounded-xl border border-border bg-surface">
              <ul className="flex flex-col divide-y divide-border">
                {cheques.map((c) => (
                  <li key={c.id} data-testid="cheque-row" className="flex flex-col gap-2.5 p-4 transition-colors hover:bg-callout/40 sm:p-5">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                      <span className="font-extrabold text-primary" dir="ltr">{c.number}</span>
                      <span className="text-text-muted">{c.bank}</span>
                      <span className="min-w-0 break-words font-semibold">{debtorName(c.debtorId)}</span>
                      <span className="rounded bg-surface-muted px-2.5 py-0.5 text-xs font-bold">{t(c.direction as "receivable" | "payable")}</span>
                      <span className="ms-auto"><StatusPill status={c.status} label={t(c.status as "held")} testId="cheque-status" /></span>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border/50 pt-2">
                      <div className="flex items-center gap-3">
                        <span className="tnum text-base font-extrabold text-text">{money(c.amountMinor, c.currency)}</span>
                        <span className="text-xs text-text-muted">{t("dueDate")}: <span dir="ltr" className="font-semibold text-text">{c.dueDate}</span></span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {(NEXT[c.status] ?? []).map((n) => (
                          <button
                            key={n.to}
                            type="button"
                            data-testid={`cheque-to-${n.to}`}
                            disabled={busy}
                            onClick={() => void onTransition(c.id, n.to)}
                            className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
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
            <CalendarBlank size={20} className="text-primary" />
            <h2 className="text-lg font-extrabold">{t("calendarTitle")}</h2>
          </div>
          {loading ? (
            <LoadingState isAr={isAr} />
          ) : calendar.length === 0 ? (
            <div className="rounded-xl border border-border bg-surface p-5 text-center text-xs text-text-muted">
              {isAr ? "لا توجد شيكات مجدولة للأسابيع القادمة." : "No scheduled cheques for upcoming weeks."}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {calendar.map((g) => (
                <div key={g.weekStart} className="panel-shadow rounded-xl border border-border bg-surface p-4 sm:p-5">
                  <p className="mb-2 font-bold text-sm text-text">{t("weekOf")} <span dir="ltr">{g.weekStart}</span></p>
                  <ul className="flex flex-col divide-y divide-border">
                    {g.cheques.map((c) => (
                      <li key={c.id} className="flex flex-wrap items-center gap-2 py-2 text-xs sm:text-sm">
                        <span dir="ltr" className="font-semibold">{c.number}</span>
                        <span className="text-text-muted" dir="ltr">{c.dueDate}</span>
                        <span className="ms-auto font-bold">{money(c.amountMinor, c.currency)}</span>
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
      <aside className="flex min-w-0 flex-col gap-6 lg:col-span-4">
        <Panel title={t("registerTitle")} icon={Checks}>
          <form onSubmit={onRegister} className="flex flex-col gap-4">
            <label className="flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border border-border/80 bg-surface-muted/40 px-4 py-5 text-center transition-all hover:border-primary/60 hover:bg-surface-muted/70">
              <Camera size={26} aria-hidden className="text-status-paid-fg dark:text-status-paid-fg" />
              <span className="font-bold text-sm">{t("photoTitle")}</span>
              <span className="text-xs text-text-muted">{t("photoHint")}</span>
              <input data-testid="cheque-photo" type="file" accept="image/*" disabled={busy} className="sr-only"
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void onPhoto(f); }} />
            </label>

            {matchedInfo && (
              <div
                data-testid="ai-cheque-match-badge"
                className="flex flex-col gap-1.5 rounded-xl border border-primary/40 bg-callout/60 p-3.5 text-xs animate-in fade-in slide-in-from-top-2 duration-300"
              >
                <div className="flex items-center gap-1.5 font-extrabold text-primary">
                  <Sparkle size={15} />
                  <span>{isAr ? "استخراج AI ومطابقة تلقائية" : "AI extraction · automatic matching"}</span>
                </div>
                <p className="leading-relaxed text-text">
                  {isAr
                    ? `تم التعرف على صاحب الشيك: «${matchedInfo.debtorName}» ${
                        matchedInfo.invoiceRef
                          ? `وربطه تلقائياً بالفاتورة رقم #${matchedInfo.invoiceRef}`
                          : "وتعبئة بيانات السداد"
                      }.`
                    : `Identified drawer: "${matchedInfo.debtorName}" ${
                        matchedInfo.invoiceRef ? `linked to invoice #${matchedInfo.invoiceRef}` : ""
                      }.`}
                </p>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <label className={labelCls}><span>{t("debtor")}</span>
                <select data-testid="cheque-debtor" required value={form.debtorId} onChange={(e) => setForm({ ...form, debtorId: e.target.value, invoiceId: "" })} className={inputCls}>
                  <option value="">—</option>
                  {debtors.map((d) => <option key={d.id} value={d.id}>{d.displayName}</option>)}
                </select>
              </label>
              <label className={labelCls}><span>{t("direction")}</span>
                <select data-testid="cheque-direction" value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value, invoiceId: e.target.value === "payable" ? "" : form.invoiceId })} className={inputCls}>
                  <option value="receivable">{t("receivable")}</option>
                  <option value="payable">{t("payable")}</option>
                </select>
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
              <label className={labelCls}><span>{t("number")}</span>
                <input data-testid="cheque-number" required maxLength={40} value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} className={inputCls} /></label>
              <label className={labelCls}><span>{t("bank")}</span>
                <input data-testid="cheque-bank" required maxLength={160} value={form.bank} onChange={(e) => setForm({ ...form, bank: e.target.value })} className={inputCls} /></label>
              <label className={labelCls}><span>{t("amount")}</span>
                <input data-testid="cheque-amount" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={inputCls} /></label>
              {form.direction === "receivable" && (
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
                        amount: inv && !form.amount ? formatAmountOnly(BigInt(inv.amountMinor), inv.currency ? { currency: inv.currency } : undefined) : form.amount,
                      });
                    }}
                    className={inputCls}
                  >
                    <option value="">{t("none")}</option>
                    {invoices.map((i) => <option key={i.id} value={i.id}>{i.reference ?? i.id} — {formatAmountOnly(BigInt(i.amountMinor), i.currency ? { currency: i.currency } : undefined)}</option>)}
                  </select></label>
              )}
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

        <div className="panel-shadow flex items-start gap-3 rounded-xl border border-border bg-surface p-4 text-xs text-text-muted">
          <ShieldCheck size={20} className="shrink-0 text-status-paid-fg dark:text-status-paid-fg" />
          <p className="leading-relaxed">
            {isAr
              ? "تُعلّق التذكيرات تلقائياً للشيكات المسجلة، مع إرسال تنبيهات قبل الاستحقاق بـ 3 أيام."
              : "Reminders pause automatically for registered cheques, with alerts sent 3 days prior."}
          </p>
        </div>
      </aside>
    </div>
  );
}
