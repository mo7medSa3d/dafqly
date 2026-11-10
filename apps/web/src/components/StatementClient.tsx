"use client";
import { useState } from "react";
import { formatEgp } from "@tahseel/core";
import { BrandMark } from "./BrandMark";
import { PaymentSuccessIllustration, SecurityLockBadge } from "./illustrations";
import { SecurityNotice, StatusPill, btnGhost, btnPrimary } from "./ui";

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
      <header className="hero-band panel-shadow relative overflow-hidden rounded-3xl p-6 text-white">
        <div className="brand-pattern absolute inset-0" aria-hidden />
        <div className="relative flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-1">
              <p className="text-xs font-bold text-teal-200">كشف حساب رسمي ومؤمّن من</p>
              <h1 data-testid="statement-business" className="text-2xl font-extrabold leading-snug">{data.businessName}</h1>
              <p className="text-navy-100">{data.debtorName}</p>
            </div>
            <div className="flex items-center gap-2">
              <SecurityLockBadge size={36} />
              <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white/10">
                <BrandMark variant="white" size={26} />
              </span>
            </div>
          </div>
          <div className="border-t border-white/15 pt-4">
            <p className="text-sm text-navy-100">إجمالي المستحق</p>
            <p className="mt-1 text-4xl font-extrabold leading-none">
              <span data-testid="statement-total" className="tnum" dir="ltr">{fmt(data.totalDueMinor)}</span>
              <span className="ms-2 align-middle text-base font-bold text-navy-100">ج.م.</span>
            </p>
            {data.gatewayEnabled && openInvoices.length > 0 && (
              <button data-testid="statement-pay-total" disabled={busy} onClick={() => void onPay()}
                className="mt-4 inline-flex min-h-[48px] w-full items-center justify-center rounded-full bg-accent px-6 py-2.5 text-sm font-bold text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50">
                دفع الإجمالي الآن
              </button>
            )}
          </div>
        </div>
      </header>

      {msg && <p role="status" data-testid="statement-msg" className="rounded-2xl border border-primary/30 bg-callout p-4 text-sm font-semibold text-primary">{msg}</p>}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-extrabold">الفواتير</h2>
        {data.invoices.length === 0 && <p className="text-text-muted">لا توجد فواتير.</p>}
        <div className="panel-shadow overflow-hidden rounded-2xl border border-border bg-surface">
          <div className="flex flex-col divide-y divide-border">
            {data.invoices.map((inv) => (
              <article key={inv.id} data-testid="statement-invoice" className="flex flex-col gap-2.5 p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-extrabold text-primary" dir="ltr">{inv.reference ?? "فاتورة"}</span>
                  <span className="ms-auto">
                    <StatusPill status={inv.status} label={STATUS_AR[inv.status] ?? inv.status} testId={`statement-invoice-status-${inv.id}`} />
                  </span>
                </div>
                {inv.description && <p className="text-sm">{inv.description}</p>}
                <p className="text-sm text-text-muted">
                  المبلغ: <span className="tnum font-bold text-text" dir="ltr">{fmt(inv.amountMinor)}</span> · المدفوع:{" "}
                  <span className="tnum font-bold text-status-paid-fg" dir="ltr">{fmt(inv.paidMinor)}</span> · المتبقي:{" "}
                  <span className="tnum font-bold text-primary" dir="ltr">{fmt(inv.outstandingMinor)}</span>
                </p>
                <p className="text-sm text-text-muted">الاستحقاق: <span dir="ltr">{inv.dueOn}</span></p>
                {(inv.status === "open" || inv.status === "partially_paid") && (
                  <div className="mt-1.5 flex flex-col gap-2">
                    <div className="flex flex-wrap gap-2">
                      {data.gatewayEnabled && (
                        <button data-testid={`statement-pay-${inv.id}`} disabled={busy} onClick={() => void onPay(inv.id)}
                          className={`${btnPrimary} flex-1`}>
                          دفع هذه الفاتورة
                        </button>
                      )}
                      {!disputedIds.has(inv.id) && (
                        <button data-testid={`statement-dispute-${inv.id}`} disabled={busy}
                          onClick={() => setDisputeFor(disputeFor === inv.id ? null : inv.id)}
                          className={`${btnGhost} flex-1`}>
                          الاعتراض على الفاتورة
                        </button>
                      )}
                    </div>
                    {disputeFor === inv.id && (
                      <form className="flex flex-col gap-2 rounded-2xl bg-callout p-3.5" onSubmit={(e) => { e.preventDefault(); void onDispute(inv.id); }}>
                        <label className="flex flex-col gap-1.5 text-sm font-semibold">
                          <span>سبب الاعتراض</span>
                          <textarea data-testid={`dispute-reason-${inv.id}`} required maxLength={1000} value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            className="w-full rounded-xl border border-border-strong/60 bg-surface px-3 py-2 text-text" rows={3} />
                        </label>
                        <button data-testid={`dispute-submit-${inv.id}`} disabled={busy || reason.trim() === ""}
                          className={btnPrimary}>
                          إرسال الاعتراض
                        </button>
                      </form>
                    )}
                  </div>
                )}
                {disputedIds.has(inv.id) && <p className="rounded-xl bg-status-disputed-bg px-3.5 py-2 text-sm font-semibold text-status-disputed-fg">تم تسجيل اعتراض على هذه الفاتورة وجارٍ مراجعته.</p>}
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-extrabold">سجل المدفوعات</h2>
        {data.payments.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border-strong/60 bg-surface px-5 py-8 text-center">
            <PaymentSuccessIllustration size={120} />
            <p className="text-sm text-text-muted">لا توجد مدفوعات مسجلة بعد.</p>
          </div>
        )}
        {data.payments.length > 0 && (
          <div className="panel-shadow overflow-hidden rounded-2xl border border-border bg-surface">
            <ul className="flex flex-col divide-y divide-border">
              {data.payments.map((p) => (
                <li key={p.id} data-testid="statement-payment" className="flex flex-wrap items-center gap-x-2.5 gap-y-1 p-4 text-sm sm:px-5">
                  <span className="tnum text-base font-extrabold text-primary" dir="ltr">{fmt(p.amountMinor)}</span>
                  <span>ج.م.</span>
                  <span className="text-text-muted">· {METHOD_AR[p.method] ?? p.method} · <span dir="ltr">{p.receivedOn}</span></span>
                  <span className="ms-auto"><StatusPill status={p.status} label={STATUS_AR[p.status] ?? p.status} /></span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <SecurityNotice
        compact
        body="صفحة سداد ومراجعة آمنة. في حال وجود أي ملاحظة على الفاتورة يمكنك إرسالها مباشرة."
      />

      <footer className="flex items-center justify-center gap-2 pb-2 text-center text-xs text-text-muted">
        <BrandMark variant="mono" size={16} />
        <span>صفحة كشف حساب آمنة من {data.businessName} عبر دفقلي</span>
      </footer>
    </main>
  );
}
