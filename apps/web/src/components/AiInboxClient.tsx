"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { formatEgp } from "@tahseel/core";
import { CheckCircle, Robot, UploadSimple, XCircle } from "@phosphor-icons/react";
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
    <section className="flex flex-col gap-6">
      {msg && <p role="status" className="rounded-xl border border-border bg-surface px-4 py-3 font-bold">{msg}</p>}

      <Panel title={t("receiptUploadTitle")} icon={UploadSimple}>
        <div className="flex flex-col gap-4">
          <label className={labelCls}>
            <span>{t("debtor")}</span>
            <select data-testid="receipt-debtor" className={inputCls}
              value={debtorId} onChange={(e) => setDebtorId(e.target.value)}>
              <option value="">{t("pickDebtor")}</option>
              {debtors.map((x) => <option key={x.id} value={x.id}>{x.displayName}</option>)}
            </select>
          </label>
          <label className="brand-pattern-light flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border border-dashed border-border-strong bg-surface-muted/40 px-4 py-6 text-center transition-colors hover:bg-surface-muted/70">
            <UploadSimple size={26} weight="fill" aria-hidden className="text-teal-600 dark:text-teal-300" />
            <span className="font-bold">{t("receiptUploadTitle")}</span>
            <input data-testid="receipt-file" type="file" accept="image/*" disabled={busy} className="sr-only"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void onReceiptFile(f); }} />
          </label>
        </div>
      </Panel>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-extrabold">{t("claimsTitle")}</h2>
        {claims.length === 0
          ? <p className="rounded-xl border border-dashed border-border-strong bg-surface px-5 py-6 text-center text-text-muted">{t("claimsEmpty")}</p>
          : (
            <div className="panel-shadow overflow-hidden rounded-xl border border-border bg-surface">
              <ul className="flex flex-col divide-y divide-border">
                {claims.map((c) => (
                  <li key={c.id} data-testid={`claim-${c.id}`} className="flex flex-wrap items-center gap-3 p-4 sm:p-5">
                    <InitialAvatar name={c.debtorName} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="font-bold">{c.debtorName}</p>
                      <p className="text-sm text-text-muted">{c.method} · <span dir="ltr">{c.receivedOn}</span>{c.referenceNo ? ` · ${c.referenceNo}` : ""}</p>
                    </div>
                    <span className="tnum text-lg font-extrabold" dir="ltr">{formatEgp(BigInt(c.amountMinor))}</span>
                    <span className="flex gap-2">
                      <button type="button" disabled={busy} className={`${btnPrimary} px-3 py-1.5 text-sm`}
                        onClick={() => void actOnClaim(c.id, "confirm")}>
                        <CheckCircle size={16} weight="fill" aria-hidden />
                        {t("confirm")}
                      </button>
                      <button type="button" disabled={busy} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-bold transition-colors hover:border-border-strong disabled:opacity-60"
                        onClick={() => void actOnClaim(c.id, "reject")}>
                        <XCircle size={16} weight="fill" aria-hidden />
                        {t("reject")}
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-lg font-extrabold">
          <Robot size={22} weight="fill" aria-hidden className="text-teal-600 dark:text-teal-300" />
          {t("intentsTitle")}
        </h2>
        {intents.length === 0
          ? <p className="rounded-xl border border-dashed border-border-strong bg-surface px-5 py-6 text-center text-text-muted">{t("intentsEmpty")}</p>
          : (
            <div className="panel-shadow overflow-hidden rounded-xl border border-border bg-surface">
              <ul className="flex flex-col divide-y divide-border">
                {intents.map((i) => (
                  <li key={i.id} data-testid={`intent-${i.id}`} className="flex flex-col gap-1.5 p-4 sm:p-5">
                    <p className="flex flex-wrap items-center gap-2 font-bold">
                      {i.debtorName ?? ""}
                      <span className="rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-bold text-teal-700 dark:bg-surface-muted dark:text-teal-300">{i.intent}</span>
                      <span className="tnum text-sm text-text-muted" dir="ltr">{Math.round(i.confidence * 100)}%</span>
                    </p>
                    {i.text && <p className="text-text">{i.text}</p>}
                    <p className="text-xs text-text-muted">{i.actionTaken ?? ""} · <span dir="ltr">{i.createdAt.slice(0, 10)}</span></p>
                  </li>
                ))}
              </ul>
            </div>
          )}
      </div>
    </section>
  );
}
