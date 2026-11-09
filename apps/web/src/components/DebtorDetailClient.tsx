"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { formatEgp } from "@tahseel/core";
import { trpc } from "@/lib/trpc-client";

interface Invoice { id: string; reference: string | null; amountMinor: string; paidMinor: string; outstandingMinor: string; status: string; dueOn: string; currencyWarning: boolean }
interface Detail {
  id: string; displayName: string; phoneE164: string; notes: string | null; optedOut: boolean;
  creditMinor: string; totalOutstandingMinor: string;
  invoices: Invoice[];
  payments: { id: string; amountMinor: string; method: string; receivedOn: string; status: string; source: string; gatewayTransactionId: string | null; reversalOf: string | null }[];
}
interface StatementLink { id: string; expiresAt: string; revokedAt: string | null; lastViewedAt: string | null; state: string }
interface PaymentLink { id: string; invoiceId: string | null; amountMinor: string; checkoutUrl: string; status: string; expiresAt: string }
interface Dispute { id: string; invoiceId: string; raisedBy: string; reason: string; status: string; createdAt: string }
interface Recon { gatewayTotalMinor: string; balanced: boolean; discrepancies: { kind: string; id: string }[] }
interface TimelineEvent { id: string; kind: string; at: string; summary: string; amountMinor?: string; status?: string }

const fmt = (minor: string) => formatEgp(BigInt(minor));

export function DebtorDetailClient({ debtorId }: { debtorId: string }) {
  const t = useTranslations("debtors");
  const ti = useTranslations("invoices");
  const tp = useTranslations("payments");
  const tg = useTranslations("gateway");
  const ts = useTranslations("statements");
  const locale = useLocale();
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [statementLinks, setStatementLinks] = useState<StatementLink[]>([]);
  const [newStatementUrl, setNewStatementUrl] = useState<string | null>(null);
  const [paymentLinks, setPaymentLinks] = useState<PaymentLink[]>([]);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [recon, setRecon] = useState<Recon | null>(null);
  const [gwMsg, setGwMsg] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "instapay" | "bank" | "wallet" | "cheque" | "gateway" | "other">("cash");
  const [receivedOn, setReceivedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [d, tl, sl, pl, dp, rc] = await Promise.all([
      trpc.debtors.get.query({ id: debtorId }),
      trpc.debtors.timeline.query({ id: debtorId }),
      trpc.statements.list.query({ debtorId }),
      trpc.payments.links.query({ debtorId }),
      trpc.statements.disputes.query({ debtorId }),
      trpc.payments.reconciliation.query(),
    ]);
    setDetail(d as Detail);
    setTimeline(tl as TimelineEvent[]);
    setStatementLinks(sl as StatementLink[]);
    setPaymentLinks(pl as PaymentLink[]);
    setDisputes(dp as Dispute[]);
    setRecon(rc as Recon);
  }, [debtorId]);
  useEffect(() => { void load(); }, [load]);

  async function onPay() {
    setBusy(true); setMsg(null);
    try {
      const allocations = Object.entries(alloc)
        .filter(([, v]) => v.trim() !== "")
        .map(([invoiceId, v]) => ({ invoiceId, amount: v.trim() }));
      await trpc.payments.record.mutate({
        debtorId, amount, method, receivedOn,
        allocations: allocations.length > 0 ? allocations : undefined,
      });
      setAmount(""); setAlloc({});
      setMsg(tp("saved"));
      await load();
    } catch { setMsg(tp("failed")); } finally { setBusy(false); }
  }

  async function onDelete() {
    await trpc.debtors.remove.mutate({ id: debtorId });
    router.push(`/${locale}/debtors`);
    router.refresh();
  }

  async function onCreateStatement() {
    setGwMsg(null);
    try {
      const created = await trpc.statements.create.mutate({ debtorId }) as { path: string };
      setNewStatementUrl(`${window.location.origin}${created.path}`);
      await load();
    } catch { setGwMsg(ts("failed")); }
  }

  async function onRevokeStatement(linkId: string) {
    await trpc.statements.revoke.mutate({ linkId });
    await load();
  }

  async function onCreateGatewayLink(invoiceId?: string) {
    setGwMsg(null);
    try {
      await trpc.payments.createLink.mutate(invoiceId ? { debtorId, invoiceId } : { debtorId });
      setGwMsg(tg("linkCreated"));
      await load();
    } catch { setGwMsg(tg("failed")); }
  }

  async function onRefund(paymentId: string) {
    const amount = window.prompt(tg("refundPrompt")) ?? undefined;
    setGwMsg(null);
    try {
      await trpc.payments.refund.mutate(amount && amount.trim() !== "" ? { paymentId, amount: amount.trim() } : { paymentId });
      setGwMsg(tg("refunded"));
      await load();
    } catch { setGwMsg(tg("refundFailed")); }
  }

  async function onConfirmClaim(paymentId: string) {
    await trpc.payments.confirm.mutate({ paymentId });
    await load();
  }

  async function onRejectClaim(paymentId: string) {
    await trpc.payments.reject.mutate({ paymentId });
    await load();
  }

  if (!detail) return <p className="text-text-muted">…</p>;
  const inputCls = "w-full rounded-md border border-border bg-surface px-3 min-h-touch text-text";
  const openInvoices = detail.invoices.filter((i) => i.status === "open" || i.status === "partially_paid");

  return (
    <section className="flex flex-col gap-6">
      <header className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-bold">{detail.displayName}</h2>
          <p className="text-text-muted" dir="ltr">{detail.phoneE164}</p>
          {detail.optedOut && (
            <p data-testid="debtor-opted-out" className="mt-1 inline-block rounded-md bg-surface-muted px-2 py-1 text-xs font-bold text-text-muted border border-border-strong">{t("optedOut")}</p>
          )}
          {detail.notes && <p className="text-sm">{detail.notes}</p>}
        </div>
        <button data-testid="debtor-delete" onClick={() => void onDelete()} className="min-h-touch rounded-md border border-border px-4 font-bold">{t("delete")}</button>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <article className="rounded-lg border border-border bg-surface p-4">
          <p className="text-sm text-text-muted">{t("outstanding")}</p>
          <p className="text-xl font-bold"><span className="tnum" dir="ltr" data-testid="debtor-outstanding">{fmt(detail.totalOutstandingMinor)}</span></p>
        </article>
        <article className="rounded-lg border border-border bg-surface p-4">
          <p className="text-sm text-text-muted">{t("credit")}</p>
          <p className="text-xl font-bold"><span className="tnum" dir="ltr" data-testid="debtor-credit">{fmt(detail.creditMinor)}</span></p>
        </article>
      </div>

      <form className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4" onSubmit={(e) => { e.preventDefault(); void onPay(); }}>
        <h3 className="font-bold">{tp("record")}</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1"><span>{tp("amount")}</span>
            <input data-testid="pay-amount" className={inputCls} dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label>
          <label className="flex flex-col gap-1"><span>{tp("method")}</span>
            <select data-testid="pay-method" className={inputCls} value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
              {(["cash", "instapay", "bank", "wallet", "cheque", "gateway", "other"] as const).map((m) => (
                <option key={m} value={m}>{tp(`methods.${m}`)}</option>
              ))}
            </select></label>
          <label className="flex flex-col gap-1"><span>{tp("receivedOn")}</span>
            <input data-testid="pay-date" type="date" className={inputCls} dir="ltr" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} required /></label>
        </div>
        <p className="text-sm text-text-muted">{tp("allocateHint")}</p>
        {openInvoices.map((i) => (
          <label key={i.id} className="flex items-center gap-2">
            <span className="flex-1 text-sm">{i.reference ?? i.id.slice(0, 8)} — {ti("remaining")}: <span className="tnum" dir="ltr">{fmt(i.outstandingMinor)}</span></span>
            <input data-testid={`pay-alloc-${i.id}`} className="w-32 rounded-md border border-border bg-surface px-2 min-h-touch" dir="ltr" inputMode="decimal"
              value={alloc[i.id] ?? ""} onChange={(e) => setAlloc((s) => ({ ...s, [i.id]: e.target.value }))} />
          </label>
        ))}
        {msg && <p role="status" data-testid="pay-msg" className="text-sm">{msg}</p>}
        <button data-testid="pay-submit" disabled={busy || amount.trim() === ""} className="min-h-touch rounded-md bg-primary px-4 font-bold text-primary-fg hover:bg-primary-hover disabled:opacity-60">{tp("record")}</button>
      </form>

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <h3 className="font-bold">{tg("title")}</h3>
        {gwMsg && <p role="status" data-testid="gw-msg" className="text-sm">{gwMsg}</p>}
        <button data-testid="gw-create-total" onClick={() => void onCreateGatewayLink()} className="min-h-touch rounded-md bg-primary px-4 font-bold text-primary-fg hover:bg-primary-hover">
          {tg("createTotalLink")}
        </button>
        <ul className="flex flex-col gap-2">
          {paymentLinks.map((l) => (
            <li key={l.id} data-testid="gw-link" className="flex flex-wrap items-center gap-2 text-sm">
              <span className="tnum" dir="ltr">{fmt(l.amountMinor)}</span>
              <span>{l.status}</span>
              <span className="text-text-muted">{tg("expires")}: <span dir="ltr">{l.expiresAt.slice(0, 16).replace("T", " ")}</span></span>
              <a data-testid="gw-link-open" href={l.checkoutUrl} target="_blank" rel="noreferrer" className="font-bold text-primary underline">{tg("openLink")}</a>
            </li>
          ))}
        </ul>
        {recon && (
          <p data-testid="gw-recon" className="text-sm text-text-muted">
            {tg("reconciliation")}: {tg("gatewayTotal")} <span className="tnum" dir="ltr">{fmt(recon.gatewayTotalMinor)}</span> ·{" "}
            {recon.balanced ? tg("balanced") : tg("discrepancies")}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <h3 className="font-bold">{ts("title")}</h3>
        <button data-testid="stmt-create" onClick={() => void onCreateStatement()} className="min-h-touch rounded-md border border-border px-4 font-bold">
          {ts("create")}
        </button>
        {newStatementUrl && (
          <div data-testid="stmt-new-url" className="flex flex-col gap-2 rounded-md bg-surface-muted p-3">
            <p className="text-sm">{ts("created")}</p>
            <p className="break-all text-sm" dir="ltr">{newStatementUrl}</p>
            <button data-testid="stmt-copy" onClick={() => { void navigator.clipboard?.writeText(newStatementUrl); }} className="min-h-touch rounded-md bg-primary px-4 font-bold text-primary-fg">
              {ts("copy")}
            </button>
          </div>
        )}
        {statementLinks.length === 0 && !newStatementUrl && <p className="text-sm text-text-muted">{ts("none")}</p>}
        <ul className="flex flex-col gap-2">
          {statementLinks.map((l) => (
            <li key={l.id} data-testid="stmt-link" className="flex flex-wrap items-center gap-2 text-sm">
              <span data-testid="stmt-link-state">{ts(l.state)}</span>
              <span className="text-text-muted">{ts("expiresAt")}: <span dir="ltr">{l.expiresAt.slice(0, 10)}</span></span>
              <span className="text-text-muted">{ts("lastViewed")}: {l.lastViewedAt ? <span dir="ltr">{l.lastViewedAt.slice(0, 10)}</span> : ts("neverViewed")}</span>
              {l.state === "valid" && (
                <button data-testid="stmt-revoke" onClick={() => void onRevokeStatement(l.id)} className="font-bold text-primary underline">{ts("revoke")}</button>
              )}
            </li>
          ))}
        </ul>
        <h4 className="font-bold">{ts("disputesTitle")}</h4>
        {disputes.length === 0 && <p className="text-sm text-text-muted">{ts("noDisputes")}</p>}
        <ul className="flex flex-col gap-2">
          {disputes.map((x) => (
            <li key={x.id} data-testid="stmt-dispute" className="text-sm">
              <span>{ts(x.status)}</span> · {x.reason} · <span dir="ltr">{x.createdAt.slice(0, 10)}</span>
            </li>
          ))}
        </ul>
      </section>

      <div>
        <h3 className="mb-2 font-bold">{ti("title")}</h3>
        <ul className="flex flex-col gap-2">
          {detail.invoices.map((i) => (
            <li key={i.id} data-testid="detail-invoice" className="rounded-lg border border-border bg-surface p-4">
              <div className="flex justify-between">
                <span className="font-bold">{i.reference ?? "—"}</span>
                <span data-testid={`detail-invoice-status-${i.id}`}>{ti(`statuses.${i.status}`)}</span>
              </div>
              <p className="text-sm text-text-muted">
                {ti("amount")}: <span className="tnum" dir="ltr">{fmt(i.amountMinor)}</span> · {ti("paid")}: <span className="tnum" dir="ltr">{fmt(i.paidMinor)}</span> · {ti("dueOn")}: <span dir="ltr">{i.dueOn}</span>
              </p>
              {i.currencyWarning && <p className="text-sm">{ti("currencyWarning")}</p>}
              {(i.status === "open" || i.status === "partially_paid") && (
                <button data-testid="gw-create-invoice" onClick={() => void onCreateGatewayLink(i.id)} className="mt-2 font-bold text-primary underline">
                  {tg("createInvoiceLink")}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="mb-2 font-bold">{tg("history")}</h3>
        <ul className="flex flex-col gap-2">
          {detail.payments.map((p) => (
            <li key={p.id} data-testid="payment-row" className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-3 text-sm">
              <span className="tnum" dir="ltr">{fmt(p.amountMinor)}</span>
              <span>{tp(`methods.${p.method}`)}</span>
              <span dir="ltr">{p.receivedOn}</span>
              <span>{p.status === "claimed" ? tg("claimed") : p.status === "confirmed" ? tg("confirmed") : tg("rejected")}</span>
              {p.reversalOf && <span>{tg("reversal")}</span>}
              {p.status === "claimed" && (
                <>
                  <button data-testid="claim-confirm" onClick={() => void onConfirmClaim(p.id)} className="font-bold text-primary underline">{tg("confirm")}</button>
                  <button data-testid="claim-reject" onClick={() => void onRejectClaim(p.id)} className="font-bold text-primary underline">{tg("reject")}</button>
                </>
              )}
              {p.status === "confirmed" && p.source === "gateway" && !p.reversalOf && BigInt(p.amountMinor) > 0n && (
                <button data-testid="gw-refund" onClick={() => void onRefund(p.id)} className="font-bold text-primary underline">{tg("refund")}</button>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="mb-2 font-bold">{t("timeline")}</h3>
        <ol data-testid="timeline" className="flex flex-col gap-2">
          {timeline.map((e) => (
            <li key={e.id} data-testid={`timeline-${e.kind}`} className="rounded-lg border border-border bg-surface p-3 text-sm">
              <span className="font-bold">{e.kind}</span> · <span dir="ltr">{e.at.slice(0, 10)}</span> · {e.summary}
              {e.amountMinor && <> · <span className="tnum" dir="ltr">{fmt(e.amountMinor)}</span></>}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
