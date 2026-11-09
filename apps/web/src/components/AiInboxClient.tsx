"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { trpc } from "@/lib/trpc-client";

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
      {msg && <p role="status" className="font-bold">{msg}</p>}

      <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-4">
        <h2 className="font-bold">{t("receiptUploadTitle")}</h2>
        <label className="flex flex-col gap-1">
          <span>{t("debtor")}</span>
          <select data-testid="receipt-debtor" className="rounded-md border border-border bg-surface p-2"
            value={debtorId} onChange={(e) => setDebtorId(e.target.value)}>
            <option value="">{t("pickDebtor")}</option>
            {debtors.map((x) => <option key={x.id} value={x.id}>{x.displayName}</option>)}
          </select>
        </label>
        <input data-testid="receipt-file" type="file" accept="image/*" disabled={busy}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onReceiptFile(f); }} />
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-bold">{t("claimsTitle")}</h2>
        {claims.length === 0 && <p className="text-text-muted">{t("claimsEmpty")}</p>}
        <ul className="flex flex-col gap-2">
          {claims.map((c) => (
            <li key={c.id} data-testid={`claim-${c.id}`} className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface p-3">
              <span className="font-bold">{c.debtorName}</span>
              <span>{(Number(c.amountMinor) / 100).toFixed(2)}</span>
              <span className="text-text-muted">{c.method} · {c.receivedOn}{c.referenceNo ? ` · ${c.referenceNo}` : ""}</span>
              <button type="button" disabled={busy} className="rounded-md bg-primary px-3 py-1 font-bold text-primary-fg"
                onClick={() => void actOnClaim(c.id, "confirm")}>{t("confirm")}</button>
              <button type="button" disabled={busy} className="rounded-md border border-border px-3 py-1"
                onClick={() => void actOnClaim(c.id, "reject")}>{t("reject")}</button>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-bold">{t("intentsTitle")}</h2>
        {intents.length === 0 && <p className="text-text-muted">{t("intentsEmpty")}</p>}
        <ul className="flex flex-col gap-2">
          {intents.map((i) => (
            <li key={i.id} data-testid={`intent-${i.id}`} className="flex flex-col gap-1 rounded-md border border-border bg-surface p-3">
              <span className="font-bold">{i.debtorName ?? ""} · {i.intent} · {Math.round(i.confidence * 100)}%</span>
              {i.text && <span>{i.text}</span>}
              <span className="text-xs text-text-muted">{i.actionTaken ?? ""} · {i.createdAt.slice(0, 10)}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
