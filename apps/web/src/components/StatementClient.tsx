"use client";
import { useState } from "react";
import { formatEgp } from "@tahseel/core";

/**
 * The debtor-facing statement (F10): business name, open invoices, payment
 * history, total due, Pay button (gateway) and a per-invoice dispute button.
 * Arabic-first RTL, mobile-first. All data comes from the allowlisted
 * statement payload — internal merchant notes are never part of it.
 */
export interface StatementDataView {
  businessName: string;
  debtorName: string;
  totalDueMinor: string;
  gatewayEnabled: boolean;
  invoices: {
    id: string; reference: string | null; description: string | null;
    amountMinor: string; paidMinor: string; outstandingMinor: string;
    status: string; issuedOn: string; dueOn: string;
  }[];
  payments: { id: string; amountMinor: string; method: string; receivedOn: string; status: string }[];
  openDisputes: { id: string; invoiceId: string; reason: string; createdAt: string }[];
}

const fmt = (minor: string) => formatEgp(BigInt(minor));
const STATUS_AR: Record<string, string> = {
  open: "مفتوحة", partially_paid: "مدفوعة جزئيًا", paid: "مدفوعة",
  disputed: "متنازع عليها", written_off: "معدومة", cancelled: "ملغاة",
  confirmed: "مؤكدة", claimed: "قيد التأكد",
};
const METHOD_AR: Record<string, string> = {
  cash: "نقدًا", instapay: "إنستا باي", bank: "تحويل بنكي", wallet: "محفظة",
  cheque: "شيك", gateway: "دفع إلكتروني", other: "أخرى",
};

export function StatementClient({ token, initial }: { token: string; initial: StatementDataView }) {
  const [data, setData] = useState(initial);
  const [disputeFor, setDisputeFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

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
      setMsg("تعذّر بدء الدفع الآن. حاول مرة أخرى.");
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
      setDisputeFor(null); setReason("");
      setMsg("تم تسجيل اعتراضك. سنتواصل معك لمراجعة الفاتورة، وتم إيقاف التذكيرات الخاصة بها مؤقتًا.");
      await refresh();
    } catch {
      setMsg("تعذّر تسجيل الاعتراض. حاول مرة أخرى.");
    } finally { setBusy(false); }
  }

  const disputedIds = new Set(data.openDisputes.map((x) => x.invoiceId));
  const openInvoices = data.invoices.filter((i) => i.status === "open" || i.status === "partially_paid");

  return (
    <main data-testid="statement-page" className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-5 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-text-muted">كشف حساب من</p>
        <h1 data-testid="statement-business" className="text-2xl font-bold">{data.businessName}</h1>
        <p className="text-text-muted">{data.debtorName}</p>
      </header>

      <section className="rounded-lg border border-border bg-surface p-4">
        <p className="text-sm text-text-muted">إجمالي المستحق</p>
        <p className="mt-1 text-3xl font-bold">
          <span data-testid="statement-total" className="tnum" dir="ltr">{fmt(data.totalDueMinor)}</span>
          <span className="text-base font-normal"> ج.م.</span>
        </p>
        {data.gatewayEnabled && openInvoices.length > 0 && (
          <button data-testid="statement-pay-total" disabled={busy} onClick={() => void onPay()}
            className="mt-3 min-h-touch w-full rounded-md bg-primary px-4 font-bold text-primary-fg hover:bg-primary-hover disabled:opacity-60">
            دفع الإجمالي الآن
          </button>
        )}
      </section>

      {msg && <p role="status" data-testid="statement-msg" className="rounded-lg border border-border bg-surface p-3 text-sm">{msg}</p>}

      <section className="flex flex-col gap-2">
        <h2 className="font-bold">الفواتير</h2>
        {data.invoices.length === 0 && <p className="text-text-muted">لا توجد فواتير.</p>}
        {data.invoices.map((inv) => (
          <article key={inv.id} data-testid="statement-invoice" className="rounded-lg border border-border bg-surface p-4">
            <div className="flex items-center justify-between">
              <span className="font-bold">{inv.reference ?? "فاتورة"}</span>
              <span data-testid={`statement-invoice-status-${inv.id}`}>{STATUS_AR[inv.status] ?? inv.status}</span>
            </div>
            {inv.description && <p className="text-sm">{inv.description}</p>}
            <p className="text-sm text-text-muted">
              المبلغ: <span className="tnum" dir="ltr">{fmt(inv.amountMinor)}</span> · المدفوع:{" "}
              <span className="tnum" dir="ltr">{fmt(inv.paidMinor)}</span> · المتبقي:{" "}
              <span className="tnum" dir="ltr">{fmt(inv.outstandingMinor)}</span>
            </p>
            <p className="text-sm text-text-muted">الاستحقاق: <span dir="ltr">{inv.dueOn}</span></p>
            {(inv.status === "open" || inv.status === "partially_paid") && (
              <div className="mt-3 flex flex-col gap-2">
                <div className="flex gap-2">
                  {data.gatewayEnabled && (
                    <button data-testid={`statement-pay-${inv.id}`} disabled={busy} onClick={() => void onPay(inv.id)}
                      className="min-h-touch flex-1 rounded-md bg-primary px-4 font-bold text-primary-fg hover:bg-primary-hover disabled:opacity-60">
                      دفع هذه الفاتورة
                    </button>
                  )}
                  {!disputedIds.has(inv.id) && (
                    <button data-testid={`statement-dispute-${inv.id}`} disabled={busy}
                      onClick={() => setDisputeFor(disputeFor === inv.id ? null : inv.id)}
                      className="min-h-touch flex-1 rounded-md border border-border px-4 font-bold">
                      الاعتراض على الفاتورة
                    </button>
                  )}
                </div>
                {disputeFor === inv.id && (
                  <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void onDispute(inv.id); }}>
                    <label className="flex flex-col gap-1">
                      <span className="text-sm">سبب الاعتراض</span>
                      <textarea data-testid={`dispute-reason-${inv.id}`} required maxLength={1000} value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-text" rows={3} />
                    </label>
                    <button data-testid={`dispute-submit-${inv.id}`} disabled={busy || reason.trim() === ""}
                      className="min-h-touch rounded-md bg-primary px-4 font-bold text-primary-fg hover:bg-primary-hover disabled:opacity-60">
                      إرسال الاعتراض
                    </button>
                  </form>
                )}
              </div>
            )}
            {disputedIds.has(inv.id) && <p className="mt-2 text-sm">تم تسجيل اعتراض على هذه الفاتورة وجارٍ مراجعته.</p>}
          </article>
        ))}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="font-bold">سجل المدفوعات</h2>
        {data.payments.length === 0 && <p className="text-text-muted">لا توجد مدفوعات مسجلة بعد.</p>}
        <ul className="flex flex-col gap-2">
          {data.payments.map((p) => (
            <li key={p.id} data-testid="statement-payment" className="rounded-lg border border-border bg-surface p-3 text-sm">
              <span className="tnum" dir="ltr">{fmt(p.amountMinor)}</span> ج.م. · {METHOD_AR[p.method] ?? p.method} ·{" "}
              <span dir="ltr">{p.receivedOn}</span> · {STATUS_AR[p.status] ?? p.status}
            </li>
          ))}
        </ul>
      </section>

      <footer className="text-center text-xs text-text-muted">صفحة كشف حساب آمنة من {data.businessName} عبر تحصيل</footer>
    </main>
  );
}
