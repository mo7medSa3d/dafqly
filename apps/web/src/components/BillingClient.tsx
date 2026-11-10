"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { formatEgp } from "@tahseel/core";
import { ArrowUp, Gauge, Receipt, WarningCircle } from "@phosphor-icons/react";
import { trpc } from "@/lib/trpc-client";
import { Panel, StatusPill, btnPrimary } from "./ui";

interface Quota { used: number; quota: number | null; ratio: number; state: string; planKey: string; month: string }
interface Plan { key: string; nameAr: string; nameEn: string; monthlyMessageQuota: number | null; priceMinor: string }
interface SubInvoice { id: string; planKey: string; periodStart: string; periodEnd: string; amountMinor: string; status: string }

export function BillingClient({ locale }: { locale: string }) {
  const t = useTranslations("reports");
  const [quota, setQuota] = useState<Quota | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subInvoices, setSubInvoices] = useState<SubInvoice[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [q, p, invs] = await Promise.all([
        trpc.billing.quota.query(),
        trpc.billing.plans.query(),
        trpc.billing.invoices.query().catch(() => []),
      ]);
      setQuota(q as Quota);
      setPlans(p.plans as Plan[]);
      setSubInvoices(invs as SubInvoice[]);
    } catch {
      /* ignore */
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function upgrade(planKey: string) {
    setBusy(true); setMsg(null);
    try {
      const out = await trpc.billing.changePlan.mutate({ planKey });
      setMsg(out.effectiveImmediately ? t("currentPlan") : t("quotaWarn"));
      await load();
    } catch { setMsg(null); } finally { setBusy(false); }
  }

  const pct = quota && quota.quota ? Math.min(100, Math.round((quota.used / quota.quota) * 100)) : null;
  return (
    <section className="flex flex-col gap-4">
      {quota && quota.state !== "ok" && (
        <p data-testid="quota-banner" role="alert" className="flex items-start gap-2.5 rounded-2xl border border-status-due-fg/40 bg-status-due-bg p-4 font-bold text-status-due-fg">
          <WarningCircle size={20} weight="fill" aria-hidden className="mt-0.5 shrink-0" />
          <span>
            {quota.state === "exceeded" ? t("quotaExceeded") : t("quotaWarn")}
            {" — "}<span dir="ltr">{quota.used} {t("quotaOf")} {quota.quota ?? "∞"}</span>
          </span>
        </p>
      )}
      {msg && <p role="status" className="font-bold text-primary">{msg}</p>}
      <Panel title={t("plansTitle")} icon={Gauge}>
        <div className="flex flex-col gap-4">
          <p className="text-xs text-text-muted">{t("placeholderPrices")}</p>
          {quota && (
            <div className="flex flex-col gap-2 rounded-xl bg-callout p-3.5">
              <p className="text-sm">
                {t("currentPlan")}: <span className="font-bold text-primary">{quota.planKey}</span> — <span className="tnum font-semibold" dir="ltr">{quota.used} {t("quotaOf")} {quota.quota ?? "∞"}</span>
              </p>
              {pct !== null && (
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface" dir="ltr" role="img" aria-label={`${pct}%`}>
                  <span className={`block h-full rounded-full ${quota.state === "exceeded" ? "bg-status-overdue-fg" : quota.state === "warn" ? "bg-status-due-fg" : "bg-primary"}`} style={{ width: `${pct}%` }} />
                </div>
              )}
            </div>
          )}
          <ul className="flex flex-col divide-y divide-border">
            {plans.map((p) => (
              <li key={p.key} className="flex items-center justify-between gap-3 py-3">
                <div className="flex flex-col">
                  <span className="font-bold">{locale === "ar" ? p.nameAr : p.nameEn}</span>
                  <span className="text-xs text-text-muted">{p.monthlyMessageQuota ?? "∞"} {t("perMonth")} · <span className="tnum" dir="ltr">{formatEgp(BigInt(p.priceMinor))}</span></span>
                </div>
                {quota?.planKey !== p.key && (
                  <button data-testid={`upgrade-${p.key}`} disabled={busy} onClick={() => void upgrade(p.key)}
                    className={`${btnPrimary} min-h-[38px] px-4 py-1.5 text-xs`}>
                    <ArrowUp size={14} weight="fill" aria-hidden />
                    {t("upgrade")}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {subInvoices.length > 0 && (
            <div className="border-t border-border pt-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-bold text-text-muted">
                <Receipt size={14} weight="fill" aria-hidden /> فواتير الاشتراك
              </p>
              <ul className="flex flex-col gap-1.5 text-xs">
                {subInvoices.slice(0, 5).map((inv) => (
                  <li key={inv.id} className="flex items-center justify-between rounded-lg bg-surface-muted/60 px-3 py-2">
                    <span className="font-bold">{inv.planKey}</span>
                    <span dir="ltr" className="tnum font-semibold">{formatEgp(BigInt(inv.amountMinor))}</span>
                    <StatusPill status={inv.status === "paid" ? "paid" : "open"} label={inv.status} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Panel>
    </section>
  );
}
