"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { trpc } from "@/lib/trpc-client";

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

  return (
    <section className="flex flex-col gap-3">
      {quota && quota.state !== "ok" && (
        <p data-testid="quota-banner" role="alert" className="rounded-md border border-border bg-surface p-3 font-bold">
          {quota.state === "exceeded" ? t("quotaExceeded") : t("quotaWarn")}
          {" — "}<span dir="ltr">{quota.used} {t("quotaOf")} {quota.quota ?? "∞"}</span>
        </p>
      )}
      {msg && <p role="status" className="font-bold">{msg}</p>}
      <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-4">
        <h2 className="font-bold">{t("plansTitle")}</h2>
        <p className="text-sm text-text-muted">{t("placeholderPrices")}</p>
        {quota && <p className="text-sm">{t("currentPlan")}: <span className="font-bold">{quota.planKey}</span> — <span dir="ltr">{quota.used} {t("quotaOf")} {quota.quota ?? "∞"}</span></p>}
        {plans.map((p) => (
          <div key={p.key} className="flex items-center justify-between gap-3">
            <span>{locale === "ar" ? p.nameAr : p.nameEn} — {p.monthlyMessageQuota ?? "∞"} {t("perMonth")}</span>
            {quota?.planKey !== p.key && (
              <button data-testid={`upgrade-${p.key}`} disabled={busy} onClick={() => void upgrade(p.key)}
                className="min-h-touch rounded-md bg-primary px-3 py-1 font-bold text-primary-fg">{t("upgrade")}</button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
