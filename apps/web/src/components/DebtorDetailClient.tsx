"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { formatEgp } from "@tahseel/core";
import {
  Clock, FileText, HandCoins, LinkSimple, PaperPlaneTilt, Receipt, Trash, Wallet,
} from "@phosphor-icons/react";
import { trpc } from "@/lib/trpc-client";
import { Panel, StatusPill, btnGhost, btnPrimary, inputCls, labelCls, linkAction } from "./ui";

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
  const openInvoices = detail.invoices.filter((i) => i.status === "open" || i.status === "partially_paid");

  return (
    <section className="flex flex-col gap-6">
      {/* Identity + balance strip */}
      <section className="panel-shadow overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-extrabold">{detail.displayName}</h2>
            <p className="text-text-muted" dir="ltr">{detail.phoneE164}</p>
            {detail.optedOut && (
              <p data-testid="debtor-opted-out" className="mt-1 inline-flex w-fit items-center gap-1.5 rounded-full bg-surface-muted px-2.5 py-1 text-xs font-bold text-text-muted">
                {t("optedOut")}
              </p>
            )}
            {detail.notes && <p className="text-sm text-text-muted">{detail.notes}</p>}
          </div>
          <button data-testid="debtor-delete" onClick={() => void onDelete()} className="inline-flex min-h-touch items-center gap-2 rounded-md border border-border px-4 font-bold text-status-overdue-fg transition-colors hover:border-status-overdue-fg/50 hover:bg-danger-bg">
            <Trash size={17} weight="fill" aria-hidden />
            {t("delete")}
          </button>
        </div>
        <dl className="grid grid-cols-2 gap-px border-t border-border bg-border">
          <div className="flex flex-col gap-1 bg-surface p-5 sm:p-6">
            <dt className="flex items-center gap-2 text-sm font-semibold text-text-muted">
              <Wallet size={16} weight="fill" aria-hidden /> {t("outstanding")}
            </dt>
            <dd className="text-2xl font-extrabold"><span className="tnum" dir="ltr" data-testid="debtor-outstanding">{fmt(detail.totalOutstandingMinor)}</span></dd>
          </div>
          <div className="flex flex-col gap-1 bg-surface p-5 sm:p-6">
            <dt className="flex items-center gap-2 text-sm font-semibold text-text-muted">
              <HandCoins size={16} weight="fill" aria-hidden /> {t("credit")}
            </dt>
            <dd className="text-2xl font-extrabold"><span className="tnum" dir="ltr" data-testid="debtor-credit">{fmt(detail.creditMinor)}</span></dd>
          </div>
        </dl>
      </section>

      <Panel title={tp("record")} icon={HandCoins}>
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void onPay(); }}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className={labelCls}><span>{tp("amount")}</span>
              <input data-testid="pay-amount" className={inputCls} dir="ltr" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label>
            <label className={labelCls}><span>{tp("method")}</span>
              <select data-testid="pay-method" className={inputCls} value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                {(["cash", "instapay", "bank", "wallet", "cheque", "gateway", "other"] as const).map((m) => (
                  <option key={m} value={m}>{tp(`methods.${m}`)}</option>
                ))}
              </select></label>
            <label className={labelCls}><span>{tp("receivedOn")}</span>
              <input data-testid="pay-date" type="date" className={inputCls} dir="ltr" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} required /></label>
          </div>
          <p className="text-sm text-text-muted">{tp("allocateHint")}</p>
          {openInvoices.length > 0 && (
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
              {openInvoices.map((i) => (
                <li key={i.id}>
                  <label className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <span className="flex-1 text-sm font-semibold">{i.reference ?? i.id.slice(0, 8)} — {ti("remaining")}: <span className="tnum" dir="ltr">{fmt(i.outstandingMinor)}</span></span>
                    <input data-testid={`pay-alloc-${i.id}`} className="min-h-touch w-32 rounded-md border border-border bg-surface px-2" dir="ltr" inputMode="decimal"
                      value={alloc[i.id] ?? ""} onChange={(e) => setAlloc((s) => ({ ...s, [i.id]: e.target.value }))} />
                  </label>
                </li>
              ))}
            </ul>
          )}
          {msg && <p role="status" data-testid="pay-msg" className="text-sm font-semibold">{msg}</p>}
          <div>
            <button data-testid="pay-submit" disabled={busy || amount.trim() === ""} className={btnPrimary}>{tp("record")}</button>
          </div>
        </form>
      </Panel>

      <Panel title={tg("title")} icon={LinkSimple}>
        <div className="flex flex-col gap-4">
          {gwMsg && <p role="status" data-testid="gw-msg" className="text-sm font-semibold">{gwMsg}</p>}
          <div>
            <button data-testid="gw-create-total" onClick={() => void onCreateGatewayLink()} className={btnPrimary}>
              <LinkSimple size={17} weight="fill" aria-hidden />
              {tg("createTotalLink")}
            </button>
          </div>
          {paymentLinks.length > 0 && (
            <ul className="flex flex-col divide-y divide-border">
              {paymentLinks.map((l) => (
                <li key={l.id} data-testid="gw-link" className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-sm">
                  <span className="tnum font-extrabold" dir="ltr">{fmt(l.amountMinor)}</span>
                  <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-bold">{l.status}</span>
                  <span className="text-text-muted">{tg("expires")}: <span dir="ltr">{l.expiresAt.slice(0, 16).replace("T", " ")}</span></span>
                  <a data-testid="gw-link-open" href={l.checkoutUrl} target="_blank" rel="noreferrer" className={`${linkAction} ms-auto`}>{tg("openLink")}</a>
                </li>
              ))}
            </ul>
          )}
          {recon && (
            <p data-testid="gw-recon" className="rounded-lg bg-surface-muted px-4 py-3 text-sm text-text-muted">
              {tg("reconciliation")}: {tg("gatewayTotal")} <span className="tnum font-bold text-text" dir="ltr">{fmt(recon.gatewayTotalMinor)}</span> ·{" "}
              {recon.balanced ? tg("balanced") : tg("discrepancies")}
            </p>
          )}
        </div>
      </Panel>

      <Panel title={ts("title")} icon={FileText}>
        <div className="flex flex-col gap-4">
          <div>
            <button data-testid="stmt-create" onClick={() => void onCreateStatement()} className={btnGhost}>
              <FileText size={17} weight="fill" aria-hidden />
              {ts("create")}
            </button>
          </div>
          {newStatementUrl && (
            <div data-testid="stmt-new-url" className="flex flex-col gap-2 rounded-lg bg-teal-50 p-4 dark:bg-surface-muted">
              <p className="text-sm font-bold">{ts("created")}</p>
              <p className="break-all text-sm" dir="ltr">{newStatementUrl}</p>
              <div>
                <button data-testid="stmt-copy" onClick={() => { void navigator.clipboard?.writeText(newStatementUrl); }} className={btnPrimary}>
                  {ts("copy")}
                </button>
              </div>
            </div>
          )}
          {statementLinks.length === 0 && !newStatementUrl && <p className="text-sm text-text-muted">{ts("none")}</p>}
          {statementLinks.length > 0 && (
            <ul className="flex flex-col divide-y divide-border">
              {statementLinks.map((l) => (
                <li key={l.id} data-testid="stmt-link" className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-sm">
                  <span data-testid="stmt-link-state" className="font-bold">{ts(l.state)}</span>
                  <span className="text-text-muted">{ts("expiresAt")}: <span dir="ltr">{l.expiresAt.slice(0, 10)}</span></span>
                  <span className="text-text-muted">{ts("lastViewed")}: {l.lastViewedAt ? <span dir="ltr">{l.lastViewedAt.slice(0, 10)}</span> : ts("neverViewed")}</span>
                  {l.state === "valid" && (
                    <button data-testid="stmt-revoke" onClick={() => void onRevokeStatement(l.id)} className={`${linkAction} ms-auto`}>{ts("revoke")}</button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-border pt-4">
            <h3 className="mb-2 font-bold">{ts("disputesTitle")}</h3>
            {disputes.length === 0 && <p className="text-sm text-text-muted">{ts("noDisputes")}</p>}
            <ul className="flex flex-col gap-2">
              {disputes.map((x) => (
                <li key={x.id} data-testid="stmt-dispute" className="rounded-lg bg-status-disputed-bg px-4 py-3 text-sm text-status-disputed-fg">
                  <span className="font-bold">{ts(x.status)}</span> · {x.reason} · <span dir="ltr">{x.createdAt.slice(0, 10)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Panel>

      <Panel title={ti("title")} icon={Receipt} padded={false} className="overflow-hidden">
        <ul className="flex flex-col divide-y divide-border">
          {detail.invoices.map((i) => (
            <li key={i.id} data-testid="detail-invoice" className="flex flex-col gap-1.5 p-4 transition-colors hover:bg-surface-muted/50 sm:px-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-extrabold" dir="ltr">{i.reference ?? "—"}</span>
                <span className="ms-auto"><StatusPill status={i.status} label={ti(`statuses.${i.status}`)} testId={`detail-invoice-status-${i.id}`} /></span>
              </div>
              <p className="text-sm text-text-muted">
                {ti("amount")}: <span className="tnum font-bold text-text" dir="ltr">{fmt(i.amountMinor)}</span> · {ti("paid")}: <span className="tnum font-bold text-text" dir="ltr">{fmt(i.paidMinor)}</span> · {ti("dueOn")}: <span dir="ltr">{i.dueOn}</span>
              </p>
              {i.currencyWarning && <p className="text-sm font-semibold text-status-due-fg">{ti("currencyWarning")}</p>}
              {(i.status === "open" || i.status === "partially_paid") && (
                <div>
                  <button data-testid="gw-create-invoice" onClick={() => void onCreateGatewayLink(i.id)} className={linkAction}>
                    {tg("createInvoiceLink")}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title={tg("history")} icon={HandCoins} padded={false} className="overflow-hidden">
        <ul className="flex flex-col divide-y divide-border">
          {detail.payments.map((p) => (
            <li key={p.id} data-testid="payment-row" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 p-4 text-sm sm:px-6">
              <span className="tnum text-base font-extrabold" dir="ltr">{fmt(p.amountMinor)}</span>
              <span>{tp(`methods.${p.method}`)}</span>
              <span className="text-text-muted" dir="ltr">{p.receivedOn}</span>
              <StatusPill
                status={p.status}
                label={p.status === "claimed" ? tg("claimed") : p.status === "confirmed" ? tg("confirmed") : tg("rejected")}
              />
              {p.reversalOf && <span className="rounded-full bg-surface-muted px-2 py-0.5 text-xs font-bold">{tg("reversal")}</span>}
              <span className="ms-auto flex gap-3">
                {p.status === "claimed" && (
                  <>
                    <button data-testid="claim-confirm" onClick={() => void onConfirmClaim(p.id)} className={linkAction}>{tg("confirm")}</button>
                    <button data-testid="claim-reject" onClick={() => void onRejectClaim(p.id)} className={linkAction}>{tg("reject")}</button>
                  </>
                )}
                {p.status === "confirmed" && p.source === "gateway" && !p.reversalOf && BigInt(p.amountMinor) > 0n && (
                  <button data-testid="gw-refund" onClick={() => void onRefund(p.id)} className={linkAction}>{tg("refund")}</button>
                )}
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title={t("timeline")} icon={Clock}>
        <ol data-testid="timeline" className="relative flex flex-col gap-5 border-s-2 border-border ps-6 ms-2">
          {timeline.map((e) => {
            const isPayment = e.kind === "payment";
            const isMessage = e.kind === "message";
            return (
              <li key={e.id} data-testid={`timeline-${e.kind}`} className="relative text-sm">
                <span className={`absolute -start-[38px] top-0 flex size-[26px] items-center justify-center rounded-full ${isPayment ? "bg-teal-100 text-teal-700 dark:bg-surface-muted dark:text-teal-300" : "bg-surface-muted text-text-muted"}`}>
                  {isPayment
                    ? <HandCoins size={14} weight="fill" aria-hidden />
                    : isMessage
                      ? <PaperPlaneTilt size={14} weight="fill" aria-hidden />
                      : <Clock size={14} weight="fill" aria-hidden />}
                </span>
                <p>
                  <span className="font-bold">{e.kind}</span>
                  {" · "}<span className="text-text-muted" dir="ltr">{e.at.slice(0, 10)}</span>
                  {" · "}{e.summary}
                  {e.amountMinor && <> · <span className="tnum font-bold" dir="ltr">{fmt(e.amountMinor)}</span></>}
                </p>
              </li>
            );
          })}
        </ol>
      </Panel>
    </section>
  );
}
