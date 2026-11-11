"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { formatEgp } from "@tahseel/core";
import {
  BellRinging, BellSlash, Check, Clock, FileText, HandCoins, LinkSimple, PaperPlaneTilt, PencilSimple,
  Receipt, Sparkle, Trash, Wallet, WarningCircle,
} from "@phosphor-icons/react";
import { trpc } from "@/lib/trpc-client";
import type { DebtorIntelligenceView } from "@/server/intelligence";
import { openAiCopilot } from "./AiCopilotDrawer";
import { Panel, SecurityNotice, StatusPill, btnGhost, btnPrimary, btnSmall, inputCls, labelCls, linkAction } from "./ui";
import { WhatsAppShareButton, invoiceShareMessage, totalShareMessage } from "./WhatsAppShare";

interface Invoice { id: string; reference: string | null; amountMinor: string; paidMinor: string; outstandingMinor: string; status: string; dueOn: string; currencyWarning: boolean }
interface Detail {
  id: string; displayName: string; phoneE164: string; notes: string | null; optedOut: boolean; riskFlag?: boolean;
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

function copyTextSafe(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text);
      return;
    }
  } catch { /* fallback below */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  } catch { /* ignore */ }
}

export function DebtorDetailClient({ debtorId, businessName }: { debtorId: string; businessName?: string }) {
  const t = useTranslations("debtors");
  const tc = useTranslations("common");
  const ti = useTranslations("invoices");
  const tp = useTranslations("payments");
  const tg = useTranslations("gateway");
  const ts = useTranslations("statements");
  const locale = useLocale();
  const isAr = locale === "ar";
  const effectiveBusinessName = businessName || (isAr ? "منشأتك" : "Your Business");
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [statementLinks, setStatementLinks] = useState<StatementLink[]>([]);
  const [newStatementUrl, setNewStatementUrl] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [paymentLinks, setPaymentLinks] = useState<PaymentLink[]>([]);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [recon, setRecon] = useState<Recon | null>(null);
  const [debtorIntel, setDebtorIntel] = useState<DebtorIntelligenceView | null>(null);
  const [gwMsg, setGwMsg] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "instapay" | "bank" | "wallet" | "cheque" | "gateway" | "other">("cash");
  const [receivedOn, setReceivedOn] = useState(() => new Date().toISOString().slice(0, 10));
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Edit debtor state
  const [editingDebtor, setEditingDebtor] = useState(false);
  const [editName, setEditName] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editRisk, setEditRisk] = useState(false);

  // Inline refund state (replaces window.prompt)
  const [refundForId, setRefundForId] = useState<string | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoadError(null);
      const [d, tl, sl, pl, dp, rc, intelRes] = await Promise.all([
        trpc.debtors.get.query({ id: debtorId }),
        trpc.debtors.timeline.query({ id: debtorId }),
        trpc.statements.list.query({ debtorId }),
        trpc.payments.links.query({ debtorId }),
        trpc.statements.disputes.query({ debtorId }),
        trpc.payments.reconciliation.query(),
        trpc.intelligence.forDebtor.query({ debtorId }).catch(() => null),
      ]);
      const det = d as Detail;
      setDetail(det);
      setEditName(det.displayName);
      setEditNotes(det.notes ?? "");
      setEditRisk(Boolean(det.riskFlag));
      setTimeline(tl as TimelineEvent[]);
      setStatementLinks(sl as StatementLink[]);
      setPaymentLinks(pl as PaymentLink[]);
      setDisputes(dp as Dispute[]);
      setRecon(rc as Recon);
      setDebtorIntel(intelRes as DebtorIntelligenceView | null);
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : (locale === "en" ? "Debtor not found" : "تعذّر تحميل بيانات العميل"));
    }
  }, [debtorId, locale]);
  useEffect(() => { void load(); }, [load]);

  async function onSaveDebtor() {
    setBusy(true);
    try {
      await trpc.debtors.update.mutate({
        id: debtorId,
        displayName: editName.trim(),
        notes: editNotes.trim() || null,
        riskFlag: editRisk,
      });
      setEditingDebtor(false);
      await load();
    } finally { setBusy(false); }
  }

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

  async function onToggleReminders(enabled: boolean) {
    setBusy(true); setMsg(null);
    try {
      await trpc.debtors.toggleReminders.mutate({ id: debtorId, enabled });
      setMsg(enabled
        ? (isAr ? "تم إعادة تفعيل التذكيرات التلقائية لهذا العميل بنجاح." : "Automatic reminders re-enabled successfully.")
        : (isAr ? "تم إيقاف التذكيرات التلقائية لهذا العميل." : "Automatic reminders paused for this customer.")
      );
      await load();
    } catch {
      setMsg(isAr ? "تعذّر تعديل حالة التذكيرات" : "Failed to update reminder status");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    await trpc.debtors.remove.mutate({ id: debtorId });
    router.push(`/${locale}/debtors`);
    router.refresh();
  }

  async function onCreateStatement() {
    setGwMsg(null); setCopiedUrl(false);
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
    } catch (err: unknown) {
      setGwMsg((err instanceof Error ? err.message : null) || tg("failed"));
    }
  }

  async function onRefund(paymentId: string, customAmount?: string) {
    setGwMsg(null);
    try {
      const trimmed = customAmount?.trim();
      await trpc.payments.refund.mutate(trimmed ? { paymentId, amount: trimmed } : { paymentId });
      setGwMsg(tg("refunded"));
      setRefundForId(null);
      setRefundAmount("");
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

  if (loadError) {
    return (
      <div className="panel-shadow flex flex-col items-center justify-center gap-4 rounded-2xl border border-border bg-surface p-8 text-center">
        <WarningCircle size={40} weight="fill" className="text-status-overdue-fg" />
        <p className="font-bold text-text">{locale === "en" ? "Debtor not found or has been deleted" : "العميل غير موجود أو تم حذفه"}</p>
        <button
          type="button"
          onClick={() => router.push(`/${locale}/debtors`)}
          className={btnPrimary}
        >
          {locale === "en" ? "Return to Debtors" : "العودة إلى قائمة العملاء"}
        </button>
      </div>
    );
  }

  if (!detail) return <p className="text-text-muted">…</p>;
  const openInvoices = detail.invoices.filter((i) => i.status === "open" || i.status === "partially_paid");

  return (
    <section className="flex flex-col gap-6">
      {/* Identity + balance strip */}
      <section className="panel-shadow overflow-hidden rounded-2xl border border-border bg-surface">
        <div className="flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-extrabold">{detail.displayName}</h2>
              {debtorIntel && (
                <span
                  data-testid="debtor-health-pill"
                  className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                    debtorIntel.tier === "critical"
                      ? "bg-status-overdue-bg text-status-overdue-fg"
                      : debtorIntel.tier === "at_risk"
                        ? "bg-status-due-bg text-status-due-fg"
                        : debtorIntel.tier === "watch"
                          ? "bg-callout text-primary"
                          : "bg-status-paid-bg text-status-paid-fg"
                  }`}
                >
                  <Sparkle size={12} weight="fill" aria-hidden />
                  {isAr ? `الصحة الائتمانية ${debtorIntel.healthScore}/100` : `Health ${debtorIntel.healthScore}/100`}
                </span>
              )}
              {detail.riskFlag && (
                <span className="inline-flex items-center gap-1 rounded-full bg-status-overdue-bg px-2.5 py-0.5 text-xs font-bold text-status-overdue-fg">
                  <WarningCircle size={13} weight="fill" aria-hidden />
                  {locale === "ar" ? "شيك مرتد / مخاطرة" : "Bounced Cheque / High Risk"}
                </span>
              )}
            </div>
            <p className="text-text-muted" dir="ltr">{detail.phoneE164}</p>
            {detail.optedOut ? (
              <div className="mt-2 flex flex-wrap items-center gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                <span className="font-bold">⚠️ {isAr ? "التذكيرات التلقائية متوقفة لهذا العميل" : "Automatic reminders are paused for this customer"}</span>
                <button
                  type="button"
                  data-testid="debtor-resume-reminders"
                  disabled={busy}
                  onClick={() => void onToggleReminders(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 font-bold text-white shadow-xs hover:bg-emerald-700 active:scale-95 transition-all"
                >
                  <BellRinging size={14} weight="fill" />
                  <span>{isAr ? "تفعيل التذكيرات الآن" : "Re-enable Reminders Now"}</span>
                </button>
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 font-bold text-emerald-600 dark:text-emerald-400">
                  <BellRinging size={13} weight="fill" />
                  <span>{isAr ? "التذكيرات التلقائية مفعلة" : "Auto Reminders Active"}</span>
                </span>
                <button
                  type="button"
                  data-testid="debtor-pause-reminders"
                  disabled={busy}
                  onClick={() => void onToggleReminders(false)}
                  className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[11px] font-semibold text-text-muted hover:border-danger hover:text-danger active:scale-95 transition-all"
                  title={isAr ? "إيقاف التذكيرات التلقائية لهذا العميل مؤقتاً" : "Pause Automatic Reminders"}
                >
                  <BellSlash size={12} weight="fill" />
                  <span>{isAr ? "إيقاف التذكيرات" : "Pause Reminders"}</span>
                </button>
              </div>
            )}
            {detail.notes && <p className="text-sm text-text-muted">{detail.notes}</p>}
            {debtorIntel && (
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-border/70 bg-callout/45 px-3 py-2 text-xs">
                <Sparkle size={14} weight="fill" className="shrink-0 text-primary" aria-hidden />
                <span className="font-bold text-primary">
                  {isAr ? debtorIntel.recommendation.titleAr : debtorIntel.recommendation.titleEn}:
                </span>
                <span className="text-text-muted">
                  {isAr ? debtorIntel.recommendation.reasonAr : debtorIntel.recommendation.reasonEn}
                </span>
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {debtorIntel && (
              <button
                type="button"
                data-testid="debtor-ai-draft-btn"
                onClick={() =>
                  openAiCopilot({
                    tab: "composer",
                    debtorId,
                    tone: debtorIntel.recommendation.suggestedTone,
                  })
                }
                className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-callout px-5 text-sm font-bold text-primary transition-colors hover:bg-primary hover:text-primary-fg"
              >
                <Sparkle size={16} weight="fill" aria-hidden />
                <span>{isAr ? "صياغة تذكير ذكي" : "Draft AI Reminder"}</span>
              </button>
            )}
            <WhatsAppShareButton
              phone={detail.phoneE164}
              message={totalShareMessage({
                businessName: effectiveBusinessName,
                totalAmount: fmt(detail.totalOutstandingMinor),
                locale,
              })}
              size="md"
              label={locale === "ar" ? "مشاركة عبر واتساب" : "Share on WhatsApp"}
              showCopy
            />
            <button
              type="button"
              onClick={() => setEditingDebtor((v) => !v)}
              className={btnGhost}
            >
              <PencilSimple size={17} weight="fill" aria-hidden />
              {tc("save")}
            </button>
            <button data-testid="debtor-delete" onClick={() => void onDelete()} className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-status-overdue-fg/40 px-5 text-sm font-bold text-status-overdue-fg transition-colors hover:bg-danger-bg">
              <Trash size={17} weight="fill" aria-hidden />
              {t("delete")}
            </button>
          </div>
        </div>

        {editingDebtor && (
          <div className="flex flex-col gap-3 border-t border-border bg-callout p-5 sm:px-6">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelCls}><span>{t("name")}</span>
                <input className={inputCls} value={editName} onChange={(e) => setEditName(e.target.value)} /></label>
              <label className={labelCls}><span>{t("notes")}</span>
                <input className={inputCls} value={editNotes} onChange={(e) => setEditNotes(e.target.value)} /></label>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={editRisk} onChange={(e) => setEditRisk(e.target.checked)} />
                <span>{locale === "ar" ? "علامة مخاطرة ائتمانية (شيك مرتد / تأخر متكرر)" : "Credit Risk Flag (Bounced Cheque / Chronic Late Payer)"}</span>
              </label>
              <button type="button" disabled={busy} onClick={() => void onSaveDebtor()} className={btnPrimary}>
                <Check size={16} weight="bold" aria-hidden /> {tc("save")}
              </button>
            </div>
          </div>
        )}

        <dl className="grid grid-cols-2 gap-px border-t border-border bg-border">
          <div className="flex flex-col gap-1 bg-surface p-5 sm:p-6">
            <dt className="flex items-center gap-2 text-sm font-semibold text-text-muted">
              <Wallet size={16} weight="fill" aria-hidden className="text-primary" /> {t("outstanding")}
            </dt>
            <dd className="text-2xl font-extrabold text-primary"><span className="tnum" dir="ltr" data-testid="debtor-outstanding">{fmt(detail.totalOutstandingMinor)}</span></dd>
          </div>
          <div className="flex flex-col gap-1 bg-surface p-5 sm:p-6">
            <dt className="flex items-center gap-2 text-sm font-semibold text-text-muted">
              <HandCoins size={16} weight="fill" aria-hidden className="text-status-paid-fg" /> {t("credit")}
            </dt>
            <dd className="text-2xl font-extrabold text-status-paid-fg"><span className="tnum" dir="ltr" data-testid="debtor-credit">{fmt(detail.creditMinor)}</span></dd>
          </div>
        </dl>
      </section>

      <Panel title={tp("record")} icon={HandCoins}>
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void onPay(); }}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-text">{tp("amount")}</span>
                {BigInt(detail.totalOutstandingMinor) > 0n && (
                  <button
                    type="button"
                    onClick={() => setAmount((Number(detail.totalOutstandingMinor) / 100).toFixed(2))}
                    className="rounded-full bg-callout px-2.5 py-0.5 text-[11px] font-bold text-primary transition-colors hover:bg-primary hover:text-primary-fg"
                  >
                    {locale === "en" ? "Full Balance" : "كامل المستحق"} ({fmt(detail.totalOutstandingMinor)})
                  </button>
                )}
              </div>
              <input data-testid="pay-amount" className={inputCls} dir="ltr" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
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
            <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
              {openInvoices.map((i) => (
                <li key={i.id}>
                  <label className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <span className="flex-1 text-sm font-semibold">{i.reference ?? i.id.slice(0, 8)} — {ti("remaining")}: <span className="tnum" dir="ltr">{fmt(i.outstandingMinor)}</span></span>
                    <input data-testid={`pay-alloc-${i.id}`} className="min-h-[40px] w-32 rounded-lg border border-border-strong/60 bg-surface px-2.5 text-sm" dir="ltr" inputMode="decimal"
                      value={alloc[i.id] ?? ""} onChange={(e) => setAlloc((s) => ({ ...s, [i.id]: e.target.value }))} />
                  </label>
                </li>
              ))}
            </ul>
          )}
          {msg && <p role="status" data-testid="pay-msg" className="text-sm font-semibold text-primary">{msg}</p>}
          <div>
            <button data-testid="pay-submit" disabled={busy || amount.trim() === ""} className={btnPrimary}>{tp("record")}</button>
          </div>
        </form>
      </Panel>

      <Panel title={tg("title")} icon={LinkSimple}>
        <div className="flex flex-col gap-4">
          {gwMsg && <p role="status" data-testid="gw-msg" className="text-sm font-semibold text-primary">{gwMsg}</p>}
          <div>
            <button
              data-testid="gw-create-total"
              disabled={openInvoices.length === 0}
              onClick={() => void onCreateGatewayLink()}
              className={btnPrimary}
            >
              <LinkSimple size={17} weight="fill" aria-hidden />
              {tg("createTotalLink")}
            </button>
          </div>
          {paymentLinks.length > 0 && (
            <ul className="flex flex-col divide-y divide-border">
              {paymentLinks.map((l) => (
                <li key={l.id} data-testid="gw-link" className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-sm">
                  <span className="tnum font-extrabold text-primary" dir="ltr">{fmt(l.amountMinor)}</span>
                  <span className="rounded-full bg-callout px-2.5 py-0.5 text-xs font-bold text-primary">{l.status}</span>
                  <span className="text-text-muted">{tg("expires")}: <span dir="ltr">{l.expiresAt.slice(0, 16).replace("T", " ")}</span></span>
                  <a data-testid="gw-link-open" href={l.checkoutUrl} target="_blank" rel="noreferrer" className={`${linkAction} ms-auto`}>{tg("openLink")}</a>
                </li>
              ))}
            </ul>
          )}
          {recon && (
            <p data-testid="gw-recon" className="rounded-xl bg-callout px-4 py-3 text-sm text-text-muted">
              {tg("reconciliation")}: {tg("gatewayTotal")} <span className="tnum font-bold text-text" dir="ltr">{fmt(recon.gatewayTotalMinor)}</span> ·{" "}
              <span className="font-bold text-primary">{recon.balanced ? tg("balanced") : tg("discrepancies")}</span>
            </p>
          )}
          <SecurityNotice
            compact
            body={isAr ? "يتم تحديث حالة الفاتورة تلقائيًا فور إتمام العميل لعملية السداد." : "Invoice status is updated automatically as soon as the customer completes payment."}
          />
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
            <div data-testid="stmt-new-url" className="flex flex-col gap-2.5 rounded-2xl border border-primary/25 bg-callout p-4">
              <p className="text-sm font-bold text-primary">{ts("created")}</p>
              <p className="break-all rounded-lg bg-surface px-3 py-2 text-sm font-medium" dir="ltr">{newStatementUrl}</p>
              <div className="flex items-center gap-3">
                <button
                  data-testid="stmt-copy"
                  onClick={() => { copyTextSafe(newStatementUrl); setCopiedUrl(true); }}
                  className={btnPrimary}
                >
                  {copiedUrl ? ts("copied") : ts("copy")}
                </button>
              </div>
            </div>
          )}
          {statementLinks.length === 0 && !newStatementUrl && <p className="text-sm text-text-muted">{ts("none")}</p>}
          {statementLinks.length > 0 && (
            <ul className="flex flex-col divide-y divide-border">
              {statementLinks.map((l) => (
                <li key={l.id} data-testid="stmt-link" className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-sm">
                  <span data-testid="stmt-link-state" className="rounded-full bg-callout px-2.5 py-0.5 text-xs font-bold text-primary">{ts(l.state)}</span>
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
                <li key={x.id} data-testid="stmt-dispute" className="rounded-xl bg-status-disputed-bg px-4 py-3 text-sm text-status-disputed-fg">
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
            <li key={i.id} data-testid="detail-invoice" className="flex flex-col gap-1.5 p-4 transition-colors hover:bg-callout/40 sm:px-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-extrabold text-primary" dir="ltr">{i.reference ?? "—"}</span>
                <span className="ms-auto"><StatusPill status={i.status} label={ti(`statuses.${i.status}`)} testId={`detail-invoice-status-${i.id}`} /></span>
              </div>
              <p className="text-sm text-text-muted">
                {ti("amount")}: <span className="tnum font-bold text-text" dir="ltr">{fmt(i.amountMinor)}</span> · {ti("paid")}: <span className="tnum font-bold text-status-paid-fg" dir="ltr">{fmt(i.paidMinor)}</span> · {ti("dueOn")}: <span dir="ltr">{i.dueOn}</span>
              </p>
              {i.currencyWarning && <p className="text-sm font-semibold text-status-due-fg">{ti("currencyWarning")}</p>}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {(i.status === "open" || i.status === "partially_paid") && (
                  <button data-testid="gw-create-invoice" onClick={() => void onCreateGatewayLink(i.id)} className={linkAction}>
                    {tg("createInvoiceLink")}
                  </button>
                )}
                <WhatsAppShareButton
                  phone={detail.phoneE164}
                  message={invoiceShareMessage({
                    businessName: effectiveBusinessName,
                    amount: fmt(i.outstandingMinor),
                    dueDate: i.dueOn,
                    locale,
                  })}
                  size="sm"
                  label={locale === "ar" ? "مشاركة الفاتورة" : "Share Invoice"}
                />
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title={tg("history")} icon={HandCoins} padded={false} className="overflow-hidden">
        <ul className="flex flex-col divide-y divide-border">
          {detail.payments.map((p) => (
            <li key={p.id} data-testid="payment-row" className="flex flex-col gap-2 p-4 text-sm sm:px-6">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="tnum text-base font-extrabold" dir="ltr">{fmt(p.amountMinor)}</span>
                <span>{tp(`methods.${p.method}`)}</span>
                <span className="text-text-muted" dir="ltr">{p.receivedOn}</span>
                <StatusPill
                  status={p.status}
                  label={p.status === "claimed" ? tg("claimed") : p.status === "confirmed" ? tg("confirmed") : tg("rejected")}
                />
                {p.reversalOf && <span className="rounded-full bg-surface-muted px-2.5 py-0.5 text-xs font-bold">{tg("reversal")}</span>}
                <span className="ms-auto flex items-center gap-3">
                  {p.status === "claimed" && (
                    <>
                      <button data-testid="claim-confirm" onClick={() => void onConfirmClaim(p.id)} className={linkAction}>{tg("confirm")}</button>
                      <button data-testid="claim-reject" onClick={() => void onRejectClaim(p.id)} className={linkAction}>{tg("reject")}</button>
                    </>
                  )}
                  {p.status === "confirmed" && p.source === "gateway" && !p.reversalOf && BigInt(p.amountMinor) > 0n && (
                    <>
                      <button data-testid="gw-refund" onClick={() => void onRefund(p.id)} className={linkAction}>{tg("refund")}</button>
                      <button
                        type="button"
                        onClick={() => { setRefundForId(refundForId === p.id ? null : p.id); setRefundAmount(""); }}
                        className={btnSmall}
                      >
                        {isAr ? "مبلغ مخصص" : "Custom amount"}
                      </button>
                    </>
                  )}
                </span>
              </div>
              {refundForId === p.id && (
                <div className="flex flex-wrap items-center gap-2 rounded-xl bg-callout p-3">
                  <input
                    className={`${inputCls} max-w-[200px]`}
                    dir="ltr"
                    inputMode="decimal"
                    placeholder={tg("refundPrompt")}
                    value={refundAmount}
                    onChange={(e) => setRefundAmount(e.target.value)}
                  />
                  <button type="button" onClick={() => void onRefund(p.id, refundAmount)} className={btnSmall}>
                    {tg("refund")}
                  </button>
                </div>
              )}
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
                <span className={`absolute -start-[38px] top-0 flex size-[26px] items-center justify-center rounded-full ${isPayment ? "bg-callout text-primary" : "bg-surface-muted text-text-muted"}`}>
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
                  {e.amountMinor && <> · <span className="tnum font-bold text-primary" dir="ltr">{fmt(e.amountMinor)}</span></>}
                </p>
              </li>
            );
          })}
        </ol>
      </Panel>
    </section>
  );
}
