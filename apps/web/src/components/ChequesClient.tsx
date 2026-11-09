"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { formatEgp } from "@tahseel/core";
import { trpc } from "@/lib/trpc-client";

/**
 * F9 cheques UI: manual registration, photo pre-fill (extraction fills the
 * form; the merchant reviews and submits — nothing auto-registers),
 * lifecycle actions per the core state machine, due-week calendar, alerts.
 */
interface ChequeRow {
  id: string; debtorId: string; direction: string; number: string; bank: string;
  amountMinor: string; issueDate: string; dueDate: string; status: string;
  invoiceId: string | null; paymentId: string | null;
}
interface DebtorLite { id: string; displayName: string }
interface InvoiceLite { id: string; reference: string | null; amountMinor: string }
interface AlertRow { id: string; chequeId: string; alertKind: string; alertDate: string }
interface WeekGroup { weekStart: string; cheques: ChequeRow[] }

const NEXT: Record<string, { to: string; label: string }[]> = {
  held: [{ to: "deposited", label: "deposit" }, { to: "returned", label: "return" }, { to: "cancelled", label: "cancel" }],
  deposited: [{ to: "cleared", label: "clear" }, { to: "bounced", label: "bounce" }, { to: "returned", label: "return" }],
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

export function ChequesClient() {
  const t = useTranslations("cheques");
  const [cheques, setCheques] = useState<ChequeRow[]>([]);
  const [calendar, setCalendar] = useState<WeekGroup[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [debtors, setDebtors] = useState<DebtorLite[]>([]);
  const [invoices, setInvoices] = useState<InvoiceLite[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    debtorId: "", direction: "receivable", number: "", bank: "", amount: "",
    issueDate: "", dueDate: "", invoiceId: "", imageFileId: "",
  });

  const load = useCallback(async () => {
    const [list, cal, al, ds] = await Promise.all([
      trpc.cheques.list.query(), trpc.cheques.calendar.query(),
      trpc.cheques.alerts.query(), trpc.debtors.list.query({ limit: 50 }),
    ]);
    setCheques(list as ChequeRow[]);
    setCalendar(cal as WeekGroup[]);
    setAlerts(al as AlertRow[]);
    setDebtors((ds.items as DebtorLite[]).map((x) => ({ id: x.id, displayName: x.displayName })));
  }, []);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!form.debtorId) { setInvoices([]); return; }
    void trpc.debtors.get.query({ id: form.debtorId }).then((detail) => {
      setInvoices((detail.invoices as InvoiceLite[]).map((i) => ({ id: i.id, reference: i.reference, amountMinor: i.amountMinor })));
    });
  }, [form.debtorId]);

  async function onPhoto(file: File) {
    setBusy(true); setMsg(null);
    try {
      const out = await trpc.cheques.extractPhoto.mutate({
        fileName: file.name, mime: file.type || "image/png",
        contentBase64: await fileToBase64(file),
      });
      if (out.extraction) {
        setForm((f) => ({
          ...f,
          number: out.extraction!.number ?? f.number,
          bank: out.extraction!.bank ?? f.bank,
          amount: out.extraction!.amount_minor !== null ? (out.extraction!.amount_minor / 100).toFixed(2) : f.amount,
          issueDate: out.extraction!.issue_date ?? f.issueDate,
          dueDate: out.extraction!.due_date ?? f.dueDate,
          imageFileId: out.fileId,
        }));
        setMsg(t("prefilled"));
      }
    } catch { setMsg(t("failed")); } finally { setBusy(false); }
  }

  async function onRegister(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      await trpc.cheques.register.mutate({
        debtorId: form.debtorId,
        direction: form.direction as "receivable" | "payable",
        number: form.number, bank: form.bank, amount: form.amount,
        issueDate: form.issueDate, dueDate: form.dueDate,
        ...(form.invoiceId ? { invoiceId: form.invoiceId } : {}),
        ...(form.imageFileId ? { imageFileId: form.imageFileId } : {}),
      });
      setMsg(t("saved"));
      await load();
    } catch { setMsg(t("failed")); } finally { setBusy(false); }
  }

  async function onTransition(id: string, to: string) {
    setBusy(true);
    try {
      await trpc.cheques.transition.mutate({ id, to: to as "deposited" | "cleared" | "bounced" | "returned" | "cancelled" });
      await load();
    } catch { setMsg(t("failed")); } finally { setBusy(false); }
  }

  async function onRunAlerts() {
    setBusy(true);
    try { await trpc.cheques.runAlerts.mutate(); await load(); }
    catch { setMsg(t("failed")); } finally { setBusy(false); }
  }

  const debtorName = (id: string) => debtors.find((d) => d.id === id)?.displayName ?? id;
  const money = (minor: string) => <span className="tnum" dir="ltr">{formatEgp(BigInt(minor))}</span>;

  return (
    <section className="flex flex-col gap-6">
      {msg && <p role="status" className="font-bold">{msg}</p>}

      <form onSubmit={onRegister} className="flex flex-col gap-3 rounded-md border border-border bg-surface p-4">
        <h2 className="font-bold">{t("registerTitle")}</h2>
        <div className="flex flex-col gap-1 rounded-md border border-border p-3">
          <span className="font-bold">{t("photoTitle")}</span>
          <span className="text-sm text-text-muted">{t("photoHint")}</span>
          <input data-testid="cheque-photo" type="file" accept="image/*" disabled={busy}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void onPhoto(f); }} />
        </div>
        <label className="flex flex-col gap-1"><span>{t("debtor")}</span>
          <select data-testid="cheque-debtor" required value={form.debtorId} onChange={(e) => setForm({ ...form, debtorId: e.target.value, invoiceId: "" })} className="min-h-touch rounded-md border border-border bg-surface px-3">
            <option value="">—</option>
            {debtors.map((d) => <option key={d.id} value={d.id}>{d.displayName}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1"><span>{t("direction")}</span>
          <select data-testid="cheque-direction" value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })} className="min-h-touch rounded-md border border-border bg-surface px-3">
            <option value="receivable">{t("receivable")}</option>
            <option value="payable">{t("payable")}</option>
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1"><span>{t("number")}</span>
            <input data-testid="cheque-number" required value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} className="min-h-touch rounded-md border border-border bg-surface px-3" /></label>
          <label className="flex flex-col gap-1"><span>{t("bank")}</span>
            <input data-testid="cheque-bank" required value={form.bank} onChange={(e) => setForm({ ...form, bank: e.target.value })} className="min-h-touch rounded-md border border-border bg-surface px-3" /></label>
          <label className="flex flex-col gap-1"><span>{t("amount")}</span>
            <input data-testid="cheque-amount" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className="min-h-touch rounded-md border border-border bg-surface px-3" /></label>
          <label className="flex flex-col gap-1"><span>{t("invoice")}</span>
            <select data-testid="cheque-invoice" value={form.invoiceId} onChange={(e) => setForm({ ...form, invoiceId: e.target.value })} className="min-h-touch rounded-md border border-border bg-surface px-3">
              <option value="">{t("none")}</option>
              {invoices.map((i) => <option key={i.id} value={i.id}>{i.reference ?? i.id} — {formatEgp(BigInt(i.amountMinor))}</option>)}
            </select></label>
          <label className="flex flex-col gap-1"><span>{t("issueDate")}</span>
            <input data-testid="cheque-issue" required type="date" value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} className="min-h-touch rounded-md border border-border bg-surface px-3" /></label>
          <label className="flex flex-col gap-1"><span>{t("dueDate")}</span>
            <input data-testid="cheque-due" required type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="min-h-touch rounded-md border border-border bg-surface px-3" /></label>
        </div>
        <button data-testid="cheque-submit" type="submit" disabled={busy} className="min-h-touch rounded-md bg-primary px-4 py-2 font-bold text-primary-fg">{t("register")}</button>
      </form>

      <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold">{t("alertsTitle")}</h2>
          <button data-testid="cheque-run-alerts" onClick={onRunAlerts} disabled={busy} className="min-h-touch rounded-md border border-border px-3 py-1 font-bold">{t("runAlerts")}</button>
        </div>
        {alerts.map((a) => (
          <p key={a.id} data-testid="cheque-alert" className="text-sm">{t(a.alertKind as "due_in_3_days" | "due_today")} — {a.alertDate}</p>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-bold">{t("listTitle")}</h2>
        {cheques.length === 0 && <p className="text-text-muted">{t("empty")}</p>}
        {cheques.map((c) => (
          <article key={c.id} data-testid="cheque-row" className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-surface p-3">
            <span className="font-bold">{c.number}</span>
            <span>{c.bank}</span>
            <span>{debtorName(c.debtorId)}</span>
            <span>{t(c.direction as "receivable" | "payable")}</span>
            {money(c.amountMinor)}
            <span>{c.dueDate}</span>
            <span data-testid="cheque-status" className="font-bold">{t(c.status as "held")}</span>
            <span className="flex gap-2">
              {(NEXT[c.status] ?? []).map((n) => (
                <button key={n.to} data-testid={`cheque-to-${n.to}`} disabled={busy}
                  onClick={() => void onTransition(c.id, n.to)}
                  className="min-h-touch rounded-md border border-border px-3 py-1 font-bold">{t(n.label as "deposit")}</button>
              ))}
            </span>
          </article>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-bold">{t("calendarTitle")}</h2>
        {calendar.map((g) => (
          <div key={g.weekStart} className="rounded-md border border-border bg-surface p-3">
            <p className="font-bold">{t("weekOf")} <span dir="ltr">{g.weekStart}</span></p>
            {g.cheques.map((c) => <p key={c.id} className="text-sm">{c.number} — {c.dueDate} — {money(c.amountMinor)}</p>)}
          </div>
        ))}
      </div>
    </section>
  );
}
