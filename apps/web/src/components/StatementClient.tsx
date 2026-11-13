"use client";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatMoney, getCurrencySymbol, parseMoney, type SupportedCurrency } from "@tahseel/core";
import { BrandMark } from "./BrandMark";
import { SecurityNotice, StatusPill, btnGhost, btnPrimary } from "./ui";
import { PaymentSuccessIllustration, SecurityLockBadge } from "./illustrations";

export interface StatementDataView {
  businessName: string;
  debtorName: string;
  totalDueMinor: string;
  /** Tenant display currency (default EGP when older payloads omit it). */
  currency?: string;
  /** Tenant portal language (default ar when older payloads omit it). */
  language?: string;
  /** Per-currency totals (F02): the headline total is the display-currency
   * subtotal when the debtor has invoices in several currencies. */
  totalsByCurrency?: { currency: string; minor: string }[];
  gatewayEnabled: boolean;
  invoices: {
    id: string; reference: string | null; description: string | null;
    amountMinor: string; paidMinor: string; outstandingMinor: string;
    currency?: string;
    status: string; issuedOn: string; dueOn: string;
  }[];
  payments: { id: string; amountMinor: string; currency?: string; method: string; receivedOn: string; status: string }[];
  openDisputes: { id: string; invoiceId: string; reason: string; createdAt: string }[];
  promises: { id: string; invoiceId: string | null; amountMinor: string; promisedOn: string; status: string; createdAt: string }[];
}

export function StatementClient({ token, initial }: { token: string; initial: StatementDataView }) {
  const [data, setData] = useState(initial);
  // F-08: the portal renders in the tenant's language (?lang= overrides it
  // — see app/s/[token]/page.tsx) via the statementPortal messages.
  const t = useTranslations("statementPortal");
  const locale = useLocale();
  const currency = (data.currency ?? "EGP") as SupportedCurrency;
  const symbol = getCurrencySymbol(currency, locale);
  const fmt = (minor: string) => formatMoney(BigInt(minor), currency, { locale });
  const fmtCur = (minor: string, cur?: string) =>
    formatMoney(BigInt(minor), ((cur ?? currency) as SupportedCurrency), { locale });
  // All keys exist in the statementPortal messages; unknown future values
  // fall back to the raw status/method string.
  const statusLabel = (status: string) =>
    ({ open: t("status.open"), partially_paid: t("status.partially_paid"), paid: t("status.paid"), disputed: t("status.disputed"), written_off: t("status.written_off"), cancelled: t("status.cancelled"), confirmed: t("status.confirmed"), claimed: t("status.claimed") })[status] ?? status;
  const methodLabel = (method: string) =>
    ({ cash: t("method.cash"), instapay: t("method.instapay"), bank: t("method.bank"), wallet: t("method.wallet"), cheque: t("method.cheque"), gateway: t("method.gateway"), other: t("method.other") })[method] ?? method;
  const promiseStatusLabel = (status: string) =>
    ({ pending: t("promiseStatus.pending"), accepted: t("promiseStatus.accepted"), kept: t("promiseStatus.kept"), broken: t("promiseStatus.broken") })[status] ?? status;
  const [disputeFor, setDisputeFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [promiseInvoiceId, setPromiseInvoiceId] = useState("");
  const [promiseAmount, setPromiseAmount] = useState("");
  const [promiseDate, setPromiseDate] = useState(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  const [promiseNote, setPromiseNote] = useState("");

  async function refresh() {
    const res = await fetch(`/api/public/statement/${token}`);
    if (res.ok) setData((await res.json()) as StatementDataView);
  }

  async function onPay(invoiceId?: string) {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/public/statement/${token}/pay`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(invoiceId ? { invoiceId } : {}),
      });
      const body = (await res.json()) as { checkoutUrl?: string };
      if (!res.ok || !body.checkoutUrl) throw new Error("pay failed");
      window.location.assign(body.checkoutUrl);
    } catch {
      setMsg(t("payFailed"));
      setBusy(false);
    }
  }

  async function onDispute(invoiceId: string) {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/public/statement/${token}/dispute`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId, reason: reason.trim() }),
      });
      if (!res.ok) throw new Error("dispute failed");
      setDisputeFor(null);
      const disputeReason = reason.trim();
      setReason("");
      setData((prev) => ({
        ...prev,
        invoices: prev.invoices.map((inv) =>
          inv.id === invoiceId ? { ...inv, status: "disputed" } : inv
        ),
        openDisputes: [
          ...prev.openDisputes,
          { id: "pending", invoiceId, reason: disputeReason, createdAt: new Date().toISOString() },
        ],
      }));
      setMsg(t("disputeOk"));
      await refresh();
    } catch {
      setMsg(t("disputeFailed"));
    } finally { setBusy(false); }
  }

  async function onRequestPromise() {
    // F-06: parse the typed amount in the tenant currency (exponent-aware:
    // KWD 3 decimals, JPY 0) — the old Math.round(x * 100) assumed EGP.
    let amountMinor: bigint;
    try {
      amountMinor = parseMoney(promiseAmount, currency);
    } catch {
      setMsg(t("promiseInvalid")); return;
    }
    if (amountMinor <= 0n) { setMsg(t("promiseInvalid")); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/public/statement/${token}/promise`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: promiseInvoiceId || undefined, amountMinor: String(amountMinor), promisedOn: promiseDate, note: promiseNote.trim() || undefined }),
      });
      if (!res.ok) throw new Error("promise request failed");
      setPromiseAmount(""); setPromiseNote("");
      setMsg(t("promiseOk"));
      await refresh();
    } catch { setMsg(t("promiseFailed")); }
    finally { setBusy(false); }
  }

  const disputedIds = new Set(data.openDisputes.map((x) => x.invoiceId));
  const openInvoices = data.invoices.filter((i) => i.status === "open" || i.status === "partially_paid");

  return (
    <div className="min-h-dvh glass-canvas py-4 sm:py-8"><main data-testid="statement-page" className="glass-frame mx-auto flex w-full max-w-xl flex-col gap-5 rounded-[28px] p-4 sm:rounded-[32px] sm:p-6">
      <header className="hero-band panel-shadow relative overflow-hidden rounded-3xl p-6 text-white">
        <div className="brand-pattern absolute inset-0" aria-hidden />
        <div className="relative flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <p className="text-xs font-bold text-teal-200">{t("secureStatementFrom")}</p>
              <h1 data-testid="statement-business" className="text-2xl font-extrabold leading-snug">{data.businessName}</h1>
              <p className="text-navy-100">{data.debtorName}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="flex size-9 items-center justify-center rounded-full bg-white/10"><SecurityLockBadge size={30} /></span>
              <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white/10">
                <BrandMark variant="white" size={26} />
              </span>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-white/15 pt-4">
            <div className="min-w-0 flex-1"><p className="text-sm text-navy-100">{t("totalDue")}</p>
            <p className="mt-1 text-4xl font-extrabold leading-none">
              <span data-testid="statement-total" className="tnum" dir="ltr">{fmt(data.totalDueMinor)}</span>
              
            </p>
            {(data.totalsByCurrency?.length ?? 0) > 1 && (
              <p className="mt-2 text-xs text-navy-100" data-testid="statement-totals-by-currency">
                {data.totalsByCurrency!.map((t) => `${fmtCur(t.minor, t.currency)}`).join(" · ")}
              </p>
            )}
            {data.gatewayEnabled && openInvoices.length > 0 && (
              <button data-testid="statement-pay-total" disabled={busy} onClick={() => void onPay()}
                className="mt-4 inline-flex min-h-[48px] w-full items-center justify-center rounded-full bg-accent px-6 py-2.5 text-sm font-bold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50">
                {t("payTotal")}
              </button>
            )}</div>
            <div className="hidden shrink-0 sm:block" aria-hidden><PaymentSuccessIllustration size={116} /></div>
          </div>
        </div>
      </header>

      {msg && <p role="status" data-testid="statement-msg" className="rounded-2xl border border-primary/30 bg-callout p-4 text-sm font-semibold text-primary">{msg}</p>}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-extrabold">{t("invoices")}</h2>
        {data.invoices.length === 0 && <p className="text-text-muted">{t("noInvoices")}</p>}
        <div className="panel-shadow overflow-hidden rounded-2xl border border-border bg-surface">
          <div className="flex flex-col divide-y divide-border">
            {data.invoices.map((inv) => (
              <article key={inv.id} data-testid="statement-invoice" className="flex flex-col gap-2.5 p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-black text-text" dir="ltr">{inv.reference ?? t("invoiceFallback")}</span>
                  <span className="ms-auto">
                    <StatusPill status={inv.status} label={statusLabel(inv.status)} testId={`statement-invoice-status-${inv.id}`} />
                  </span>
                </div>
                {inv.description && <p className="text-sm">{inv.description}</p>}
                <p className="text-sm text-text-muted">
                  {t("amount")}: <span className="tnum font-bold text-text" dir="ltr">{fmtCur(inv.amountMinor, inv.currency)}</span> · {t("paid")}:{" "}
                  <span className="tnum font-bold text-text" dir="ltr">{fmtCur(inv.paidMinor, inv.currency)}</span> · {t("remaining")}:{" "}
                  <span className="tnum font-bold text-text" dir="ltr">{fmtCur(inv.outstandingMinor, inv.currency)}</span>
                </p>
                <p className="text-sm text-text-muted">{t("dueOn")}: <span dir="ltr">{inv.dueOn}</span></p>
                {(inv.status === "open" || inv.status === "partially_paid") && (
                  <div className="mt-1.5 flex flex-col gap-2">
                    <div className="flex flex-wrap gap-2">
                      {data.gatewayEnabled && (
                        <button data-testid={`statement-pay-${inv.id}`} disabled={busy} onClick={() => void onPay(inv.id)}
                          className={`${btnPrimary} flex-1`}>
                          {t("payThisInvoice")}
                        </button>
                      )}
                      {!disputedIds.has(inv.id) && (
                        <button data-testid={`statement-dispute-${inv.id}`} disabled={busy}
                          onClick={() => setDisputeFor(disputeFor === inv.id ? null : inv.id)}
                          className={`${btnGhost} flex-1`}>
                          {t("disputeInvoice")}
                        </button>
                      )}
                    </div>
                    {disputeFor === inv.id && (
                      <form className="flex flex-col gap-2 rounded-2xl bg-callout p-3.5" onSubmit={(e) => { e.preventDefault(); void onDispute(inv.id); }}>
                        <label className="flex flex-col gap-1.5 text-sm font-semibold">
                          <span>{t("disputeReason")}</span>
                          <textarea data-testid={`dispute-reason-${inv.id}`} required maxLength={1000} value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            className="w-full rounded-xl border border-border-strong/60 bg-surface px-3 py-2 text-text" rows={3} />
                        </label>
                        <button data-testid={`dispute-submit-${inv.id}`} disabled={busy || reason.trim() === ""}
                          className={btnPrimary}>
                          {t("submitDispute")}
                        </button>
                      </form>
                    )}
                  </div>
                )}
                {disputedIds.has(inv.id) && <p className="rounded-xl bg-status-disputed-bg px-3.5 py-2 text-sm font-semibold text-status-disputed-fg">{t("disputeRecorded")}</p>}
              </article>
            ))}
          </div>
        </div>
      </section>

      {openInvoices.length > 0 && <section className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 sm:p-5">
        <div><h2 className="text-lg font-extrabold">{t("promiseTitle")}</h2><p className="mt-1 text-xs text-text-muted">{t("promiseHint")}</p></div>
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void onRequestPromise(); }}>
          <label className="flex flex-col gap-1.5 text-sm font-semibold"><span>{t("promiseInvoice")}</span><select className="min-h-11 rounded-xl border border-border bg-surface px-3" value={promiseInvoiceId} onChange={(e) => setPromiseInvoiceId(e.target.value)}><option value="">{t("promiseAnyInvoice")}</option>{openInvoices.map((inv) => <option key={inv.id} value={inv.id}>{inv.reference ?? t("invoiceFallback")} — {t("promiseRemaining")} {fmt(inv.outstandingMinor)}</option>)}</select></label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold"><span>{t("promiseAmount")} ({symbol})</span><input required inputMode="decimal" className="min-h-11 rounded-xl border border-border bg-surface px-3" value={promiseAmount} onChange={(e) => setPromiseAmount(e.target.value)} placeholder="1500.00"/></label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold"><span>{t("promiseDate")}</span><input required type="date" min={new Date().toISOString().slice(0, 10)} className="min-h-11 rounded-xl border border-border bg-surface px-3" value={promiseDate} onChange={(e) => setPromiseDate(e.target.value)}/></label>
          <label className="flex flex-col gap-1.5 text-sm font-semibold"><span>{t("promiseNote")}</span><input maxLength={500} className="min-h-11 rounded-xl border border-border bg-surface px-3" value={promiseNote} onChange={(e) => setPromiseNote(e.target.value)} placeholder={t("promiseNotePlaceholder")}/></label>
          <button type="submit" disabled={busy || Number(promiseAmount) <= 0} className={`${btnPrimary} sm:col-span-2`}>{t("promiseSubmit")}</button>
        </form>
      </section>}

      {data.promises.length > 0 && <section className="flex flex-col gap-3"><h2 className="text-lg font-extrabold">{t("promisesTitle")}</h2><div className="overflow-hidden rounded-2xl border border-border bg-surface"><ul className="divide-y divide-border">{data.promises.map((p) => <li key={p.id} className="flex flex-wrap items-center gap-2 p-4 text-sm"><span className="font-extrabold" dir="ltr">{fmt(p.amountMinor)}</span><span className="text-text-muted">· {p.promisedOn}</span><span className={`ms-auto rounded-full px-2.5 py-1 text-xs font-bold ${p.status === "accepted" ? "bg-status-paid-bg text-status-paid-fg" : p.status === "pending" ? "bg-status-due-bg text-status-due-fg" : "bg-surface-muted text-text-muted"}`}>{promiseStatusLabel(p.status)}</span></li>)}</ul></div></section>}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-extrabold">{t("paymentsTitle")}</h2>
        {data.payments.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-border/70 bg-surface px-5 py-8 text-center shadow-xs">
            <p className="text-sm font-semibold text-text-muted">{t("noPayments")}</p>
          </div>
        )}
        {data.payments.length > 0 && (
          <div className="panel-shadow overflow-hidden rounded-2xl border border-border bg-surface">
            <ul className="flex flex-col divide-y divide-border">
              {data.payments.map((p) => (
                <li key={p.id} data-testid="statement-payment" className="flex flex-wrap items-center gap-x-2.5 gap-y-1 p-4 text-sm sm:px-5">
                  <span className="tnum text-base font-black text-text" dir="ltr">{fmtCur(p.amountMinor, p.currency)}</span>
                  <span className="text-text-muted">· {methodLabel(p.method)} · <span dir="ltr">{p.receivedOn}</span></span>
                  <span className="ms-auto"><StatusPill status={p.status} label={statusLabel(p.status)} /></span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <SecurityNotice
        compact
        body={t("securityBody")}
      />

      <footer className="flex items-center justify-center gap-2 pb-2 text-center text-xs text-text-muted">
        <BrandMark variant="mono" size={16} />
        <span>{t("footer", { business: data.businessName })}</span>
      </footer>
    </main></div>
  );
}
