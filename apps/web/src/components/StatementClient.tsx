"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { formatMoney, getCurrencySymbol, normalizeCurrencyCode, parseMoney } from "@tahseel/core";
import { cn, todayIso } from "@/lib/utils";
import { inputVariants } from "@/components/ui/input";
import { Bank, Check, CloudArrowUp, Copy, LockKey } from "@/components/ui/solid-icons";
import { BrandMark } from "./BrandMark";
import { Panel, SecurityNotice, StatusPill, btnGhost, btnPrimary, btnSmall } from "./ui";

export interface StatementDataView {
  businessName: string;
  debtorName: string;
  totalDueMinor: string;
  currency?: string;
  language?: string;
  totalsByCurrency?: { currency: string; minor: string }[];
  gatewayEnabled?: boolean;
  paymentInstructions?: string | null;
  invoices: {
    id: string;
    reference: string | null;
    description: string | null;
    amountMinor: string;
    paidMinor: string;
    outstandingMinor: string;
    currency?: string;
    status: string;
    issuedOn: string;
    dueOn: string;
  }[];
  payments: {
    id: string;
    amountMinor: string;
    currency?: string;
    method: string;
    receivedOn: string;
    status: string;
  }[];
  openDisputes: { id: string; invoiceId: string; reason: string; createdAt: string }[];
  promises: {
    id: string;
    invoiceId: string | null;
    amountMinor: string;
    promisedOn: string;
    status: string;
    createdAt: string;
  }[];
}

const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

export function StatementClient({ token, initial }: { token: string; initial: StatementDataView }) {
  const [data, setData] = useState(initial);
  const t = useTranslations("statementPortal");
  const locale = useLocale();
  const currency = normalizeCurrencyCode(data.currency);
  const symbol = getCurrencySymbol(currency, locale);

  const fmt = (minor: string) => formatMoney(BigInt(minor), currency, { locale });
  const fmtCur = (minor: string, cur?: string) =>
    formatMoney(BigInt(minor), normalizeCurrencyCode(cur ?? currency), { locale });

  const statusLabel = (status: string) =>
    ({
      open: t("status.open"),
      partially_paid: t("status.partially_paid"),
      paid: t("status.paid"),
      disputed: t("status.disputed"),
      written_off: t("status.written_off"),
      cancelled: t("status.cancelled"),
      confirmed: t("status.confirmed"),
      claimed: t("status.claimed"),
    })[status] ?? status;

  const methodLabel = (method: string) =>
    ({
      cash: t("method.cash"),
      instapay: t("method.instapay"),
      bank: t("method.bank"),
      wallet: t("method.wallet"),
      cheque: t("method.cheque"),
      gateway: t("method.gateway"),
      other: t("method.other"),
    })[method] ?? method;

  const promiseStatusLabel = (status: string) =>
    ({
      pending: t("promiseStatus.pending"),
      accepted: t("promiseStatus.accepted"),
      kept: t("promiseStatus.kept"),
      broken: t("promiseStatus.broken"),
    })[status] ?? status;

  const [disputeFor, setDisputeFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [promiseInvoiceId, setPromiseInvoiceId] = useState("");
  const [promiseAmount, setPromiseAmount] = useState("");
  const [promiseDate, setPromiseDate] = useState(todayIso(1));
  const [promiseNote, setPromiseNote] = useState("");
  const promiseRef = useRef<HTMLElement | null>(null);

  async function refresh() {
    try {
      const res = await fetch(`/api/public/statement/${token}`);
      if (res.ok) setData((await res.json()) as StatementDataView);
    } catch {
      // Non-fatal: optimistic state already reflects submitted action
    }
  }

  async function onCopyInstructions() {
    if (!data.paymentInstructions || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(data.paymentInstructions);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked by browser policy
    }
  }

  async function onUploadReceipt(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_RECEIPT_BYTES) {
      setMsg({ kind: "err", text: t("receiptTooLarge") });
      return;
    }
    setUploading(true);
    setMsg(null);
    try {
      const form = new FormData();
      form.append("file", file);
      if (promiseInvoiceId) form.append("invoiceId", promiseInvoiceId);
      const res = await fetch(`/api/public/statement/${token}/receipt`, { method: "POST", body: form });
      if (!res.ok) throw new Error("upload failed");
      setMsg({ kind: "ok", text: t("receiptUploadOk") });
      await refresh();
    } catch {
      setMsg({ kind: "err", text: t("receiptUploadFailed") });
    } finally {
      setUploading(false);
    }
  }

  async function onDispute(invoiceId: string) {
    setBusy(true);
    setMsg(null);
    try {
      const disputeReason = reason.trim();
      const res = await fetch(`/api/public/statement/${token}/dispute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId, reason: disputeReason }),
      });
      if (!res.ok) throw new Error("dispute failed");
      setDisputeFor(null);
      setReason("");
      setData((prev) => ({
        ...prev,
        invoices: prev.invoices.map((inv) => (inv.id === invoiceId ? { ...inv, status: "disputed" } : inv)),
        openDisputes: [
          ...prev.openDisputes,
          { id: "pending", invoiceId, reason: disputeReason, createdAt: new Date().toISOString() },
        ],
      }));
      setMsg({ kind: "ok", text: t("disputeOk") });
      await refresh();
    } catch {
      setMsg({ kind: "err", text: t("disputeFailed") });
    } finally {
      setBusy(false);
    }
  }

  async function onRequestPromise() {
    const activeCurrency = openInvoices.find((i) => i.id === promiseInvoiceId)?.currency ?? currency;
    let amountMinor: bigint;
    try {
      amountMinor = parseMoney(promiseAmount, activeCurrency);
    } catch {
      setMsg({ kind: "err", text: t("promiseInvalid") });
      return;
    }
    if (amountMinor <= 0n) {
      setMsg({ kind: "err", text: t("promiseInvalid") });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/public/statement/${token}/promise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId: promiseInvoiceId || undefined,
          amountMinor: String(amountMinor),
          promisedOn: promiseDate,
          note: promiseNote.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error("promise request failed");
      setPromiseInvoiceId("");
      setPromiseAmount("");
      setPromiseNote("");
      setMsg({ kind: "ok", text: t("promiseOk") });
      await refresh();
    } catch {
      setMsg({ kind: "err", text: t("promiseFailed") });
    } finally {
      setBusy(false);
    }
  }

  function startPromiseForInvoice(invoiceId: string) {
    setPromiseInvoiceId(invoiceId);
    promiseRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  const disputedIds = new Set(data.openDisputes.map((x) => x.invoiceId));
  const openInvoices = data.invoices.filter((i) => i.status === "open" || i.status === "partially_paid");
  const showMultiCurrency =
    (data.totalsByCurrency?.length ?? 0) > 1 ||
    (data.totalsByCurrency?.length === 1 && normalizeCurrencyCode(data.totalsByCurrency[0]!.currency) !== currency);

  return (
    <main
      data-testid="statement-page"
      className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-5 overflow-x-hidden p-4 sm:p-6 lg:py-8"
    >
      {/* 1. Header & Total Due Summary */}
      <header className="rounded-2xl bg-primary p-5 text-primary-foreground sm:p-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1">
            <p className="flex items-center gap-1.5 text-xs font-bold opacity-80">
              <LockKey size={13} aria-hidden />
              <span>{t("secureStatementFrom")}</span>
            </p>
            <h1 data-testid="statement-business" className="truncate text-2xl font-extrabold leading-snug sm:text-3xl">
              {data.businessName}
            </h1>
            <p className="truncate text-sm opacity-90">{data.debtorName}</p>
          </div>

          <div className="flex items-end justify-between gap-4 border-t border-primary-foreground/20 pt-4 sm:border-t-0 sm:pt-0 sm:text-end">
            <div className="min-w-0">
              <p className="text-xs font-semibold opacity-80">{t("totalDue")}</p>
              <p className="mt-1 text-3xl font-extrabold leading-none sm:text-4xl">
                <span data-testid="statement-total" className="tnum" dir="ltr">
                  {fmt(data.totalDueMinor)}
                </span>
              </p>
              {showMultiCurrency && (
                <p className="mt-1.5 text-xs opacity-85" data-testid="statement-totals-by-currency">
                  {data.totalsByCurrency!.map((row) => fmtCur(row.minor, row.currency)).join(" · ")}
                </p>
              )}
            </div>
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-foreground/10 sm:hidden">
              <BrandMark variant="white" size={22} />
            </span>
          </div>
        </div>
      </header>

      {msg && (
        <p
          role={msg.kind === "err" ? "alert" : "status"}
          data-testid="statement-msg"
          className={cn(
            "rounded-xl border px-4 py-3 text-sm font-semibold",
            msg.kind === "err" ? "border-danger/30 bg-danger-bg text-danger" : "border-primary/30 bg-callout text-primary"
          )}
        >
          {msg.text}
        </p>
      )}

      {/* 2 & 3. Payment Instructions + One-Tap Receipt Upload */}
      {openInvoices.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          <Panel
            title={t("paymentInstructionsTitle")}
            icon={Bank}
            actions={
              data.paymentInstructions ? (
                <button
                  type="button"
                  onClick={() => void onCopyInstructions()}
                  data-testid="statement-copy-instructions"
                  className={cn(btnSmall, "min-h-10 gap-1.5 border border-border bg-background hover:bg-muted")}
                >
                  {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
                  <span>{copied ? t("copied") : t("copyInstructions")}</span>
                </button>
              ) : undefined
            }
          >
            {data.paymentInstructions ? (
              <p className="whitespace-pre-wrap break-words rounded-lg bg-muted/60 p-3 text-sm leading-relaxed text-foreground">
                {data.paymentInstructions}
              </p>
            ) : (
              <p className="text-sm text-text-muted">{t("paymentInstructionsEmpty")}</p>
            )}
          </Panel>

          <Panel title={t("receiptTitle")} subtitle={t("receiptHint")} icon={CloudArrowUp}>
            <label
              data-testid="statement-receipt-upload"
              className={cn(
                "flex min-h-[76px] cursor-pointer items-center justify-center gap-2.5 rounded-xl border border-dashed border-border-strong bg-muted/40 px-4 py-3 text-sm font-bold text-primary transition-colors hover:bg-muted",
                uploading && "pointer-events-none opacity-60"
              )}
            >
              <CloudArrowUp size={18} aria-hidden />
              <span>{uploading ? t("receiptUploading") : t("receiptAction")}</span>
              <input
                type="file"
                accept="image/*,application/pdf"
                disabled={uploading}
                onChange={(e) => void onUploadReceipt(e)}
                className="sr-only"
              />
            </label>
          </Panel>
        </div>
      )}

      {/* 4. Compact Invoice List (Cards on mobile, clean rows on desktop) */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-extrabold">{t("invoices")}</h2>
        {data.invoices.length === 0 ? (
          <p className="rounded-xl border border-border bg-surface p-5 text-sm text-text-muted">{t("noInvoices")}</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-surface divide-y divide-border">
            {data.invoices.map((inv) => {
              const actionable = inv.status === "open" || inv.status === "partially_paid";
              return (
                <article key={inv.id} data-testid="statement-invoice" className="flex flex-col gap-3 p-4 sm:p-5">
                  <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-extrabold text-primary" dir="ltr">
                          {inv.reference ?? t("invoiceFallback")}
                        </span>
                        <StatusPill status={inv.status} label={statusLabel(inv.status)} testId={`statement-invoice-status-${inv.id}`} />
                        <span className="text-xs text-text-muted">
                          {t("dueOn")}: <span dir="ltr">{inv.dueOn}</span>
                        </span>
                      </div>
                      {inv.description && <p className="truncate text-sm text-text-muted">{inv.description}</p>}
                    </div>

                    <div className="grid grid-cols-3 gap-3 text-xs sm:text-sm md:flex md:items-center md:gap-5">
                      <div className="min-w-0">
                        <span className="block text-xs text-text-muted">{t("amount")}</span>
                        <span className="tnum font-bold" dir="ltr">{fmtCur(inv.amountMinor, inv.currency)}</span>
                      </div>
                      <div className="min-w-0">
                        <span className="block text-xs text-text-muted">{t("paid")}</span>
                        <span className="tnum font-bold text-status-paid-fg" dir="ltr">{fmtCur(inv.paidMinor, inv.currency)}</span>
                      </div>
                      <div className="min-w-0">
                        <span className="block text-xs text-text-muted">{t("remaining")}</span>
                        <span className="tnum font-extrabold text-primary" dir="ltr">{fmtCur(inv.outstandingMinor, inv.currency)}</span>
                      </div>
                    </div>

                    {actionable && (
                      <div className="flex flex-wrap gap-2 pt-1 md:pt-0">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => startPromiseForInvoice(inv.id)}
                          className={cn(btnPrimary, "min-h-10 flex-1 md:flex-none")}
                        >
                          {t("promiseAction")}
                        </button>
                        {!disputedIds.has(inv.id) && (
                          <button
                            type="button"
                            data-testid={`statement-dispute-${inv.id}`}
                            disabled={busy}
                            aria-expanded={disputeFor === inv.id}
                            onClick={() => {
                              setDisputeFor(disputeFor === inv.id ? null : inv.id);
                              setReason("");
                            }}
                            className={cn(btnGhost, "min-h-10 flex-1 md:flex-none")}
                          >
                            {t("disputeInvoice")}
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {disputeFor === inv.id && (
                    <form
                      className="flex flex-col gap-2.5 rounded-xl bg-callout p-3.5"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void onDispute(inv.id);
                      }}
                    >
                      <label className="flex flex-col gap-1.5 text-sm font-semibold">
                        <span>{t("disputeReason")}</span>
                        <textarea
                          data-testid={`dispute-reason-${inv.id}`}
                          required
                          maxLength={1000}
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          className={cn(inputVariants, "w-full")}
                          rows={2}
                        />
                      </label>
                      <button
                        type="submit"
                        data-testid={`dispute-submit-${inv.id}`}
                        disabled={busy || reason.trim() === ""}
                        aria-busy={busy}
                        className={cn(btnPrimary, "min-h-10 sm:w-fit")}
                      >
                        {t("submitDispute")}
                      </button>
                    </form>
                  )}

                  {disputedIds.has(inv.id) && (
                    <p className="rounded-lg bg-status-disputed-bg px-3 py-2 text-xs font-semibold text-status-disputed-fg sm:text-sm">
                      {t("disputeRecorded")}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Promise to Pay Form & History */}
      {openInvoices.length > 0 && (
        <section id="promise-section" ref={promiseRef} className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 sm:p-5">
          <div>
            <h2 className="text-lg font-extrabold">{t("promiseTitle")}</h2>
            <p className="mt-0.5 text-xs text-text-muted">{t("promiseHint")}</p>
          </div>
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void onRequestPromise();
            }}
          >
            <label className="flex min-w-0 flex-col gap-1.5 text-sm font-semibold">
              <span>{t("promiseInvoice")}</span>
              <select
                className={cn(inputVariants, "min-h-10")}
                value={promiseInvoiceId}
                onChange={(e) => setPromiseInvoiceId(e.target.value)}
              >
                <option value="">{t("promiseAnyInvoice")}</option>
                {openInvoices.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.reference ?? t("invoiceFallback")} — {t("promiseRemaining")} {fmtCur(inv.outstandingMinor, inv.currency)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-0 flex-col gap-1.5 text-sm font-semibold">
              <span>
                {t("promiseAmount")} (
                {(() => {
                  const sel = openInvoices.find((i) => i.id === promiseInvoiceId);
                  return sel ? getCurrencySymbol(normalizeCurrencyCode(sel.currency ?? currency), locale) : symbol;
                })()}
                )
              </span>
              <input
                required
                dir="ltr"
                inputMode="decimal"
                className={cn(inputVariants, "min-h-10")}
                value={promiseAmount}
                onChange={(e) => setPromiseAmount(e.target.value)}
                placeholder="1500.00"
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5 text-sm font-semibold">
              <span>{t("promiseDate")}</span>
              <input
                required
                dir="ltr"
                type="date"
                min={todayIso()}
                className={cn(inputVariants, "min-h-10")}
                value={promiseDate}
                onChange={(e) => setPromiseDate(e.target.value)}
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5 text-sm font-semibold">
              <span>{t("promiseNote")}</span>
              <input
                maxLength={500}
                className={cn(inputVariants, "min-h-10")}
                value={promiseNote}
                onChange={(e) => setPromiseNote(e.target.value)}
                placeholder={t("promiseNotePlaceholder")}
              />
            </label>
            <button
              type="submit"
              disabled={busy || !promiseAmount.trim()}
              aria-busy={busy}
              className={cn(btnPrimary, "min-h-10 sm:col-span-2")}
            >
              {t("promiseSubmit")}
            </button>
          </form>
        </section>
      )}

      {data.promises.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-extrabold">{t("promisesTitle")}</h2>
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <ul className="divide-y divide-border">
              {data.promises.map((p) => {
                const inv = p.invoiceId ? data.invoices.find((i) => i.id === p.invoiceId) : undefined;
                return (
                  <li key={p.id} className="flex flex-wrap items-center gap-2 p-4 text-sm">
                    <span className="tnum font-extrabold" dir="ltr">{fmtCur(p.amountMinor, inv?.currency)}</span>
                    {inv?.reference && <span className="text-xs font-semibold text-primary" dir="ltr">{inv.reference}</span>}
                    <span className="text-text-muted">· <span dir="ltr">{p.promisedOn}</span></span>
                    <span
                      className={cn(
                        "ms-auto rounded px-2.5 py-1 text-xs font-bold",
                        p.status === "accepted"
                          ? "bg-status-paid-bg text-status-paid-fg"
                          : p.status === "pending"
                            ? "bg-status-due-bg text-status-due-fg"
                            : "bg-surface-muted text-text-subtle"
                      )}
                    >
                      {promiseStatusLabel(p.status)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      )}

      {/* 5. Payment History */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-extrabold">{t("paymentsTitle")}</h2>
        {data.payments.length === 0 ? (
          <p className="rounded-xl border border-border bg-surface p-5 text-center text-sm font-semibold text-text-muted">
            {t("noPayments")}
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            <ul className="flex flex-col divide-y divide-border">
              {data.payments.map((p) => (
                <li key={p.id} data-testid="statement-payment" className="flex flex-wrap items-center gap-x-2.5 gap-y-1 p-4 text-sm sm:px-5">
                  <span className="tnum text-base font-extrabold text-primary" dir="ltr">
                    {fmtCur(p.amountMinor, p.currency)}
                  </span>
                  <span className="text-text-muted">
                    · {methodLabel(p.method)} · <span dir="ltr">{p.receivedOn}</span>
                  </span>
                  <span className="ms-auto">
                    <StatusPill status={p.status} label={statusLabel(p.status)} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <SecurityNotice compact body={t("securityBody")} />

      <footer className="flex flex-wrap items-center justify-center gap-3 pb-2 text-center text-xs text-text-muted">
        <span className="flex items-center gap-2">
          <BrandMark variant="mono" size={16} />
          <span>{t("footer", { business: data.businessName })}</span>
        </span>
        <a href={`?lang=${locale === "ar" ? "en" : "ar"}`} className="font-semibold text-link underline-offset-4 hover:underline">
          {locale === "ar" ? "English" : "العربية"}
        </a>
      </footer>
    </main>
  );
}
