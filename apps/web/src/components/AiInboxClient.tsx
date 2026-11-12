"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations, useLocale } from "next-intl";
import { formatEgp } from "@tahseel/core";
import {
  ChatCircleDots,
  Check,
  CheckCircle,
  Clock,
  Copy,
  Robot,
  ShieldCheck,
  Sparkle,
  UploadSimple,
  User,
  XCircle,
} from "@phosphor-icons/react";
import { trpc } from "@/lib/trpc-client";
import { InitialAvatar, Panel, btnPrimary, inputCls, labelCls } from "./ui";

/**
 * The AI inbox (F7/F8): reply classifications a human must review, receipt
 * claims awaiting confirm/reject (the M3 claimed-payment path settles
 * them), a merchant receipt upload that runs the F7 pipeline, and AI Smart
 * Reply generation for 1-click contextual WhatsApp responses.
 */
interface IntentRow {
  id: string; intent: string; confidence: number; resolvedBy: string; actionTaken: string | null;
  text: string | null; debtorName: string | null; debtorId: string | null; debtorPhone: string | null; createdAt: string;
}
interface ClaimRow {
  id: string; debtorId: string; debtorName: string; amountMinor: string;
  method: string; receivedOn: string; referenceNo: string | null;
}
interface DebtorLite { id: string; displayName: string }
interface SuggestedReplyState {
  replyAr: string;
  replyEn: string;
  recommendedActionAr: string;
  recommendedActionEn: string;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

export function AiInboxClient() {
  const t = useTranslations("aiInbox");
  const locale = useLocale();
  const isAr = locale === "ar";
  const [intents, setIntents] = useState<IntentRow[]>([]);
  const [claims, setClaims] = useState<ClaimRow[]>([]);
  const [debtors, setDebtors] = useState<DebtorLite[]>([]);
  const [debtorId, setDebtorId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [aiReplies, setAiReplies] = useState<Record<string, SuggestedReplyState>>({});
  const [generatingReplyFor, setGeneratingReplyFor] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [i, c, ds] = await Promise.all([
      trpc.replies.listIntents.query({ onlyHuman: true }),
      trpc.receipts.listClaims.query(),
      trpc.debtors.list.query({ limit: 50 }),
    ]);
    setIntents(i as IntentRow[]);
    setClaims(c as ClaimRow[]);
    setDebtors((ds.items as DebtorLite[]).map((x) => ({ id: x.id, displayName: x.displayName })));
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function onReceiptFile(file: File) {
    if (!debtorId) { setMsg(t("pickDebtorFirst")); return; }
    setBusy(true); setMsg(null);
    try {
      const out = await trpc.receipts.uploadAndProcess.mutate({
        debtorId, fileName: file.name, mime: file.type || "image/png",
        contentBase64: await fileToBase64(file),
      });
      setMsg(t("receiptOutcome", { outcome: out.outcome }));
      await load();
    } catch { setMsg(t("failed")); } finally { setBusy(false); }
  }

  async function actOnClaim(paymentId: string, action: "confirm" | "reject") {
    setBusy(true);
    try {
      if (action === "confirm") await trpc.payments.confirm.mutate({ paymentId });
      else await trpc.payments.reject.mutate({ paymentId });
      await load();
    } catch { setMsg(t("failed")); } finally { setBusy(false); }
  }

  async function onResolveIntent(id: string, decision: string) {
    setBusy(true); setMsg(null);
    try {
      await trpc.replies.resolveIntent.mutate({ intentId: id, decision });
      setMsg(t("resolved"));
      await load();
    } catch { setMsg(t("failed")); } finally { setBusy(false); }
  }

  async function onSuggestReply(item: IntentRow) {
    setGeneratingReplyFor(item.id);
    try {
      const res = await trpc.aiWorkspace.suggestInboxReply.mutate({
        intentId: item.id,
        debtorId: item.debtorId ?? undefined,
        intent: item.intent,
        debtorName: item.debtorName ?? undefined,
        customerMessage: item.text ?? undefined,
      });
      setAiReplies((prev) => ({
        ...prev,
        [item.id]: {
          replyAr: res.replyAr,
          replyEn: res.replyEn,
          recommendedActionAr: res.recommendedActionAr,
          recommendedActionEn: res.recommendedActionEn,
        },
      }));
    } catch {
      setMsg(t("failed"));
    } finally {
      setGeneratingReplyFor(null);
    }
  }

  async function onCopyReply(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // Ignore clipboard failures
    }
  }

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
      {/* Main Review Column (8 cols) */}
      <section className="flex flex-col gap-6 lg:col-span-8">
        {msg && <p role="status" className="rounded-xl border border-border bg-surface px-4 py-3 font-bold text-primary">{msg}</p>}

        {/* Claims Section */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-extrabold text-text">{t("claimsTitle")}</h2>
            <span className="rounded-full bg-callout px-3 py-1 text-xs font-bold text-primary">
              {claims.length} {isAr ? "مطالبات" : "Claims"}
            </span>
          </div>

          {claims.length === 0 ? (
            <div className="panel-shadow flex items-center gap-3 rounded-2xl border border-border bg-surface p-6 text-sm text-text-muted">
              <Clock size={22} weight="fill" className="shrink-0 text-text-subtle" />
              <span>{t("claimsEmpty")}</span>
            </div>
          ) : (
            <div className="panel-shadow overflow-hidden rounded-2xl border border-border bg-surface">
              <ul className="flex flex-col divide-y divide-border">
                {claims.map((c) => (
                  <li key={c.id} data-testid={`claim-${c.id}`} className="flex flex-wrap items-center justify-between gap-4 p-4 sm:p-5">
                    <div className="flex min-w-0 items-center gap-3">
                      <InitialAvatar name={c.debtorName} size={40} />
                      <div className="min-w-0">
                        <p className="font-bold text-text">{c.debtorName}</p>
                        <p className="text-xs text-text-muted">{c.method} · <span dir="ltr">{c.receivedOn}</span>{c.referenceNo ? ` · ${c.referenceNo}` : ""}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="tnum text-lg font-extrabold text-primary" dir="ltr">{formatEgp(BigInt(c.amountMinor))}</span>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={busy}
                          className={`${btnPrimary} px-3 py-1.5 text-xs font-bold`}
                          onClick={() => void actOnClaim(c.id, "confirm")}
                        >
                          <CheckCircle size={15} weight="fill" aria-hidden />
                          {t("confirm")}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-bold text-text-muted transition-colors hover:border-danger hover:bg-danger-bg hover:text-danger disabled:opacity-60"
                          onClick={() => void actOnClaim(c.id, "reject")}
                        >
                          <XCircle size={15} weight="fill" aria-hidden />
                          {t("reject")}
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Customer Replies / Intents Section */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-lg font-extrabold text-text">
              <Robot size={22} weight="fill" aria-hidden className="text-primary" />
              <span>{t("intentsTitle")}</span>
            </h2>
            <span className="rounded-full bg-callout px-3 py-1 text-xs font-bold text-primary">
              {intents.length} {isAr ? "رسائل" : "Messages"}
            </span>
          </div>

          {intents.length === 0 ? (
            <div className="panel-shadow flex items-center gap-3 rounded-2xl border border-border bg-surface p-6 text-sm text-text-muted">
              <CheckCircle size={22} weight="fill" className="shrink-0 text-status-paid-fg" />
              <span>{t("intentsEmpty")}</span>
            </div>
          ) : (
            <div className="panel-shadow overflow-hidden rounded-2xl border border-border bg-surface">
              <ul className="flex flex-col divide-y divide-border">
                {intents.map((i) => {
                  const suggested = aiReplies[i.id];
                  const replyText = suggested ? (isAr ? suggested.replyAr : suggested.replyEn) : "";
                  const waHref = i.debtorPhone
                    ? `https://wa.me/${i.debtorPhone.replace(/\D/g, "")}${replyText ? `?text=${encodeURIComponent(replyText)}` : ""}`
                    : null;

                  return (
                    <li key={i.id} data-testid={`intent-${i.id}`} className="flex flex-col gap-2.5 p-4 transition-colors hover:bg-callout/40 sm:p-5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 font-bold text-text">
                          <span>{i.debtorName ?? (isAr ? "عميل غير محدد" : "Unassigned")}</span>
                          <span className="rounded-full bg-callout px-2.5 py-0.5 text-xs font-bold text-primary">{i.intent}</span>
                        </div>
                        <span className="tnum rounded-full border border-border bg-surface-muted px-2.5 py-0.5 text-xs font-semibold text-text-muted" dir="ltr">
                          {Math.round(i.confidence * 100)}% {isAr ? "ثقة" : "confidence"}
                        </span>
                      </div>
                      {i.text && <p className="rounded-xl bg-surface-muted/60 p-3 text-sm text-text">{i.text}</p>}

                      {/* AI Suggested Smart Reply Box */}
                      {suggested && (
                        <div
                          data-testid={`intent-ai-reply-${i.id}`}
                          className="flex flex-col gap-2 rounded-xl border border-primary/30 bg-callout/50 p-3.5 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-1 font-bold text-primary">
                              <Sparkle size={13} weight="fill" aria-hidden />
                              {isAr ? "الرد الذكي المقترح:" : "AI Suggested Reply:"}
                            </span>
                            <span className="rounded-full bg-surface px-2.5 py-0.5 text-[11px] font-semibold text-text-muted">
                              {isAr ? suggested.recommendedActionAr : suggested.recommendedActionEn}
                            </span>
                          </div>
                          <p className="leading-relaxed text-text">{replyText}</p>
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => void onCopyReply(i.id, replyText)}
                              className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-3 py-1 text-[11px] font-bold text-text hover:border-primary"
                            >
                              {copiedId === i.id ? <Check size={12} weight="bold" className="text-primary" /> : <Copy size={12} weight="fill" />}
                              <span>{copiedId === i.id ? (isAr ? "تم النسخ" : "Copied") : (isAr ? "نسخ الرد" : "Copy Reply")}</span>
                            </button>
                            {waHref && (
                              <a
                                href={waHref}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 rounded-full bg-status-paid-bg px-3 py-1 text-[11px] font-bold text-status-paid-fg hover:opacity-90"
                              >
                                <ChatCircleDots size={13} weight="fill" />
                                <span>{isAr ? "إرسال الرد عبر واتساب" : "Send Reply on WhatsApp"}</span>
                              </a>
                            )}
                          </div>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                        <p className="text-xs text-text-muted">
                          {i.actionTaken ?? (isAr ? "بانتظار قرارك" : "Awaiting action")} · <span dir="ltr">{i.createdAt.slice(0, 10)}</span>
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            data-testid={`intent-suggest-reply-${i.id}`}
                            disabled={generatingReplyFor === i.id}
                            onClick={() => void onSuggestReply(i)}
                            className="inline-flex min-h-[30px] items-center gap-1.5 rounded-lg bg-callout px-2.5 py-1 text-xs font-bold text-primary transition-all hover:bg-primary hover:text-primary-fg active:scale-95 disabled:opacity-50"
                          >
                            <Sparkle size={13} weight="fill" aria-hidden />
                            <span>
                              {generatingReplyFor === i.id
                                ? isAr
                                  ? "جاري التوليد..."
                                  : "Drafting..."
                                : isAr
                                  ? "اقتراح رد ذكي"
                                  : "AI Smart Reply"}
                            </span>
                          </button>
                          {waHref && (
                            <a
                              href={waHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex min-h-[30px] items-center gap-1.5 rounded-lg bg-status-paid-bg px-2.5 py-1 text-xs font-bold text-status-paid-fg transition-all hover:opacity-90 active:scale-95 shadow-2xs"
                            >
                              <ChatCircleDots size={14} weight="fill" />
                              <span>{t("chatWhatsapp")}</span>
                            </a>
                          )}
                          {i.debtorId && (
                            <Link
                              href={`/${locale}/debtors/${i.debtorId}`}
                              className="inline-flex min-h-[30px] items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1 text-xs font-bold text-text transition-colors hover:border-primary hover:bg-callout hover:text-primary active:scale-95"
                            >
                              <User size={13} weight="bold" />
                              <span>{t("viewDebtor")}</span>
                            </Link>
                          )}
                          <button
                            type="button"
                            onClick={() => void onResolveIntent(i.id, "reviewed_by_merchant")}
                            disabled={busy}
                            className="inline-flex min-h-[30px] items-center gap-1.5 rounded-lg bg-surface-muted px-2.5 py-1 text-xs font-bold text-text-muted transition-colors hover:bg-primary hover:text-primary-fg active:scale-95 disabled:opacity-50"
                          >
                            <Check size={13} weight="bold" />
                            <span>{t("resolve")}</span>
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </section>

      {/* Side Column: Upload Receipt & Guide (4 cols) */}
      <aside className="flex flex-col gap-6 lg:col-span-4">
        <Panel title={t("receiptUploadTitle")} icon={UploadSimple}>
          <div className="flex flex-col gap-4">
            <label className={labelCls}>
              <span>{t("debtor")}</span>
              <select
                data-testid="receipt-debtor"
                className={inputCls}
                value={debtorId}
                onChange={(e) => setDebtorId(e.target.value)}
              >
                <option value="">{t("pickDebtor")}</option>
                {debtors.map((x) => <option key={x.id} value={x.id}>{x.displayName}</option>)}
              </select>
            </label>

            <label className="brand-pattern-light flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-border/80 bg-surface-muted/40 p-6 text-center transition-all hover:border-primary/60 hover:bg-surface-muted/70 hover:shadow-xs">
              <UploadSimple size={28} weight="fill" aria-hidden className="text-primary" />
              <span className="font-bold text-sm text-text">{t("receiptUploadTitle")}</span>
              <span className="text-xs text-text-muted">
                {isAr
                  ? "يدعم صور التحويلات البنكية ومحافظ الهاتف (PNG, JPG)"
                  : "Supports bank transfers and mobile wallets (PNG, JPG)"}
              </span>
              <input
                data-testid="receipt-file"
                type="file"
                accept="image/*"
                disabled={busy}
                className="sr-only"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void onReceiptFile(f); }}
              />
            </label>
          </div>
        </Panel>

        <div className="panel-shadow flex flex-col gap-3 rounded-2xl border border-border bg-surface p-5 text-xs text-text-muted">
          <div className="flex items-center gap-2 text-sm font-bold text-text">
            <ShieldCheck size={18} weight="fill" className="text-primary" />
            <span>{isAr ? "سياسة التحقق والاعتماد" : "Verification Policy"}</span>
          </div>
          <p className="leading-relaxed">
            {isAr
              ? "تُسجل التحويلات فورياً كمدفوعات قيد التدقيق، لضمان مطابقة الإيداع البنكي الفعلي قبل تسوية الفواتير."
              : "Payments are logged as pending review to guarantee reconciliation against bank deposits before closing invoices."}
          </p>
        </div>
      </aside>
    </div>
  );
}
