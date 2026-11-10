"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { formatEgp } from "@tahseel/core";
import { CheckCircle, Clock, Robot, ShieldCheck, UploadSimple, XCircle } from "@phosphor-icons/react";
import { trpc } from "@/lib/trpc-client";
import { InitialAvatar, Panel, btnPrimary, inputCls, labelCls } from "./ui";

/**
 * The AI inbox (F7/F8): reply classifications a human must review, receipt
 * claims awaiting confirm/reject (the M3 claimed-payment path settles
 * them), and a merchant receipt upload that runs the F7 pipeline.
 */
interface IntentRow {
  id: string; intent: string; confidence: number; resolvedBy: string; actionTaken: string | null;
  text: string | null; debtorName: string | null; debtorId: string | null; createdAt: string;
}
interface ClaimRow {
  id: string; debtorId: string; debtorName: string; amountMinor: string;
  method: string; receivedOn: string; referenceNo: string | null;
}
interface DebtorLite { id: string; displayName: string }

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
                {intents.map((i) => (
                  <li key={i.id} data-testid={`intent-${i.id}`} className="flex flex-col gap-2 p-4 transition-colors hover:bg-callout/40 sm:p-5">
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
                    <p className="text-xs text-text-muted">{i.actionTaken ?? (isAr ? "بانتظار قرارك" : "Awaiting action")} · <span dir="ltr">{i.createdAt.slice(0, 10)}</span></p>
                  </li>
                ))}
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

            <label className="brand-pattern-light flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border-strong bg-surface-muted/40 p-6 text-center transition-colors hover:bg-surface-muted/70">
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
            <span>{isAr ? "معايير المراجعة البشرية" : "Human Verification Rules"}</span>
          </div>
          <p className="leading-relaxed">
            {isAr
              ? "لحماية أموالك، لا يغلق النظام أي فاتورة تلقائياً بناءً على صورة إيصال فقط. إيصال التحويل يُعتبر ادعاءً بالسداد حتى تؤكده بنفسك أو تفعّل التحصيل الآلي التام."
              : "To protect your business, receipts are claims until confirmed by you."}
          </p>
        </div>
      </aside>
    </div>
  );
}
