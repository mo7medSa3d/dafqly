"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowUp, Gauge, WarningCircle } from "@phosphor-icons/react";
import { trpc } from "@/lib/trpc-client";
import { Panel } from "./ui";

/**
 * F13 billing UI on the dashboard: the monthly quota banner (warn at 80%,
 * block banner at 100% — the dispatcher enforces the same numbers) and the
 * plan catalogue with upgrade buttons. Prices are PLACEHOLDERS pending the
 * human pricing decision and are labelled as such.
 */
interface Quota { used: number; quota: number | null; ratio: number; state: string; planKey: string; month: string }
interface Plan { key: string; nameAr: string; nameEn: string; monthlyMessageQuota: number | null; priceMinor: string }

export function BillingClient({ locale }: { locale: string }) {
  const t = useTranslations("reports");
  const [quota, setQuota] = useState<Quota | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [q, p] = await Promise.all([trpc.billing.quota.query(), trpc.billing.plans.query()]);
    setQuota(q as Quota);
    setPlans(p.plans as Plan[]);
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
        <p data-testid="quota-banner" role="alert" className="flex items-start gap-2.5 rounded-xl border border-status-due-fg/40 bg-status-due-bg p-4 font-bold text-status-due-fg">
          <WarningCircle size={20} weight="fill" aria-hidden className="mt-0.5 shrink-0" />
          <span>
            {quota.state === "exceeded" ? t("quotaExceeded") : t("quotaWarn")}
            {" — "}<span dir="ltr">{quota.used} {t("quotaOf")} {quota.quota ?? "∞"}</span>
          </span>
        </p>
      )}
      {msg && <p role="status" className="font-bold">{msg}</p>}
      <Panel title={t("plansTitle")} icon={Gauge}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-text-muted">{t("placeholderPrices")}</p>
          {quota && (
            <div className="flex flex-col gap-2">
              <p className="text-sm">
                {t("currentPlan")}: <span className="font-bold">{quota.planKey}</span> — <span dir="ltr">{quota.used} {t("quotaOf")} {quota.quota ?? "∞"}</span>
              </p>
              {pct !== null && (
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-muted" dir="ltr" role="img" aria-label={`${pct}%`}>
                  <span className={`block h-full rounded-full ${quota.state === "exceeded" ? "bg-status-overdue-fg" : quota.state === "warn" ? "bg-status-due-fg" : "bg-teal-500"}`} style={{ width: `${pct}%` }} />
                </div>
              )}
            </div>
          )}
          <ul className="flex flex-col divide-y divide-border">
            {plans.map((p) => (
              <li key={p.key} className="flex items-center justify-between gap-3 py-3">
                <span className="font-semibold">{locale === "ar" ? p.nameAr : p.nameEn} <span className="text-sm font-normal text-text-muted">— {p.monthlyMessageQuota ?? "∞"} {t("perMonth")}</span></span>
                {quota?.planKey !== p.key && (
                  <button data-testid={`upgrade-${p.key}`} disabled={busy} onClick={() => void upgrade(p.key)}
                    className="inline-flex min-h-touch shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-bold text-primary-fg transition-colors hover:bg-primary-hover disabled:opacity-60">
                    <ArrowUp size={15} weight="fill" aria-hidden />
                    {t("upgrade")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </Panel>
    </section>
  );
}
