"use client";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { formatEgp } from "@tahseel/core";
import {
  ArrowUp,
  Buildings,
  Check,
  Crown,
  Gauge,
  Lightning,
  Receipt,
  ShieldCheck,
  Sparkle,
  WarningCircle,
} from "@phosphor-icons/react";
import { trpc } from "@/lib/trpc-client";
import { Panel, StatusPill } from "./ui";

interface Quota {
  used: number;
  quota: number | null;
  ratio: number;
  state: string;
  planKey: string;
  month: string;
}

interface Plan {
  key: string;
  nameAr: string;
  nameEn: string;
  monthlyMessageQuota: number | null;
  priceMinor: string;
}

interface SubInvoice {
  id: string;
  planKey: string;
  periodStart: string;
  periodEnd: string;
  amountMinor: string;
  status: string;
}

export function BillingClient({
  locale,
  compact = false,
}: {
  locale: string;
  compact?: boolean;
}) {
  const t = useTranslations("reports");
  const isAr = locale === "ar";
  const [quota, setQuota] = useState<Quota | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subInvoices, setSubInvoices] = useState<SubInvoice[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isAnnual, setIsAnnual] = useState(false);

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

  useEffect(() => {
    void load();
  }, [load]);

  async function upgrade(planKey: string) {
    setBusy(true);
    setMsg(null);
    try {
      const out = await trpc.billing.changePlan.mutate({ planKey });
      setMsg(out.effectiveImmediately ? t("currentPlan") : t("quotaWarn"));
      await load();
    } catch {
      setMsg(null);
    } finally {
      setBusy(false);
    }
  }

  const pct = quota && quota.quota ? Math.min(100, Math.round((quota.used / quota.quota) * 100)) : null;

  // COMPACT MODE: Used in Dashboard Side Rail (clean, no distracting progress bar)
  if (compact) {
    return (
      <section className="flex flex-col gap-4">
        {quota && quota.state !== "ok" && (
          <p
            data-testid="quota-banner"
            role="alert"
            className="flex items-start gap-2.5 rounded-2xl bg-amber-500/10 p-3.5 text-xs font-bold text-amber-600 dark:text-amber-400"
          >
            <WarningCircle size={18} weight="fill" aria-hidden className="mt-0.5 shrink-0" />
            <span>
              {quota.state === "exceeded" ? t("quotaExceeded") : t("quotaWarn")}
              {" — "}
              <span dir="ltr">
                {quota.used} {t("quotaOf")} {quota.quota ?? "∞"}
              </span>
            </span>
          </p>
        )}
        {msg && <p role="status" className="text-xs font-bold text-primary">{msg}</p>}

        <Panel title={t("plansTitle")} icon={Gauge}>
          <div className="flex flex-col gap-4">
            <p className="text-[11px] text-text-muted">{t("placeholderPrices")}</p>
            {quota && (
              <div className="flex flex-col gap-2 rounded-2xl bg-surface-muted/50 p-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-text-muted">{t("currentPlan")}</span>
                  <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary capitalize">
                    {quota.planKey}
                  </span>
                </div>
                <div className="flex items-baseline justify-between pt-1">
                  <span className="text-sm font-extrabold text-text">
                    <span className="tnum" dir="ltr">{quota.used}</span>
                    <span className="text-xs font-normal text-text-muted mx-1">{t("quotaOf")}</span>
                    <span className="tnum" dir="ltr">{quota.quota ?? "∞"}</span>
                  </span>
                  {pct !== null && (
                    <span className="rounded-md bg-surface px-2 py-0.5 text-xs font-bold text-primary">
                      {pct}%
                    </span>
                  )}
                </div>
              </div>
            )}

            <ul className="flex flex-col divide-y divide-border/60">
              {plans.map((p) => {
                const isCurrent = quota?.planKey === p.key;
                return (
                  <li key={p.key} className="flex items-center justify-between gap-3 py-3">
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-text">{isAr ? p.nameAr : p.nameEn}</span>
                      <span className="text-[11px] text-text-muted">
                        {p.monthlyMessageQuota ?? "∞"} {t("perMonth")} ·{" "}
                        <span className="tnum" dir="ltr">{formatEgp(BigInt(p.priceMinor))}</span>
                      </span>
                    </div>
                    {!isCurrent ? (
                      <button
                        data-testid={`upgrade-${p.key}`}
                        disabled={busy}
                        onClick={() => void upgrade(p.key)}
                        className="inline-flex min-h-[34px] items-center gap-1.5 rounded-xl bg-primary px-3 py-1 text-xs font-bold text-white shadow-xs transition-all hover:bg-primary-hover active:scale-95 disabled:opacity-50"
                      >
                        <ArrowUp size={13} weight="bold" aria-hidden />
                        <span>{t("upgrade")}</span>
                      </button>
                    ) : (
                      <span className="rounded-lg bg-surface-muted px-2.5 py-1 text-[11px] font-semibold text-text-muted">
                        {isAr ? "الخطة الحالية" : "Current"}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        </Panel>
      </section>
    );
  }

  // FULL MODE: 2026 World-Class 3-Tier Luxury Pricing Grid (`/billing`)
  const starterPlan = plans.find((p) => p.key === "starter") ?? plans[1];
  const trialPlan = plans.find((p) => p.key === "trial") ?? plans[0];
  const growthPlan = plans.find((p) => p.key === "growth") ?? plans[2];

  const discountMultiplier = isAnnual ? 0.8 : 1.0;

  const tiers = [
    {
      key: "trial",
      titleAr: "البداية التجريبية",
      titleEn: "Starter Trial",
      subtitleAr: "للمتاجر الصغيرة والمشاريع الناشئة لتجربة النظام",
      subtitleEn: "For small merchants and freelancers starting out",
      planKey: "trial",
      planObj: trialPlan,
      icon: Lightning,
      badge: null,
      highlighted: false,
      featuresAr: [
        "١٠٠ تذكير واتساب ورسائل شهرياً",
        "استيراد ملفات الإكسل وCSV تلقائياً",
        "متابعة أرصدة المدينين والتحصيل",
        "لوحة متابعة مالية أساسية",
        "دعم فني عبر البريد الإلكتروني",
      ],
      featuresEn: [
        "100 WhatsApp reminders / month",
        "Smart Excel & CSV ledger imports",
        "Debtors receivables ledger tracking",
        "Essential financial analytics",
        "Standard email support",
      ],
    },
    {
      key: "starter",
      titleAr: "النمو الذكي",
      titleEn: "Growth Pro",
      subtitleAr: "للشركات المتوسطة والتجار الذين يريدون أتمتة كاملة",
      subtitleEn: "For growing businesses automating receivables",
      planKey: "starter",
      planObj: starterPlan ?? growthPlan,
      icon: Sparkle,
      badge: isAr ? "الأكثر طلباً" : "Most Popular",
      highlighted: true,
      featuresAr: [
        "٥٠٠ إلى ٢,٠٠٠ تذكير ذكي شهرياً",
        "فحص ومطابقة إيصالات الدفع بالذكاء الاصطناعي (OCR)",
        "روابط دفع إلكتروني آمنة ومباشرة (Paymob)",
        "جدولة ذكية للتذكيرات مع مراعاة ساعات الهدوء",
        "كشوف حساب إلكترونية مؤمنة ومشاركة واتساب فورية",
        "تقارير التنبؤ بالسيولة النقدية لـ ٨ أسابيع",
        "أولوية دعم فني عبر واتساب",
      ],
      featuresEn: [
        "500 to 2,000 smart reminders / month",
        "AI-powered payment receipt OCR & anti-fraud",
        "Direct Paymob instant payment links",
        "Quiet-hours compliant automated scheduling",
        "Secure interactive debtor statements",
        "8-week predictive cash-flow forecasting",
        "Priority WhatsApp support",
      ],
    },
    {
      key: "enterprise",
      titleAr: "المؤسسات الكبرى",
      titleEn: "Enterprise",
      subtitleAr: "للشركات الكبرى والمصانع ذات الحجم المالي الكبير",
      subtitleEn: "For large companies, factories & distributors",
      planKey: "growth",
      planObj: growthPlan,
      icon: Buildings,
      badge: isAr ? "مخصصة للمؤسسات" : "Custom Scale",
      highlighted: false,
      featuresAr: [
        "رسائل وتذكيرات غير محدودة (حسب الاستهلاك)",
        "ربط مباشر مع برامج المحاسبة وERP (API خاص)",
        "فحص تلقائي للشيكات البنكية وإشعارات الارتجاع",
        "إدارة متعددة الصلاحيات لفريق الحسابات",
        "مدير حساب شخصي ومتابعة مخصصة",
        "اتفاقية مستوى خدمة وضمان استقرار 99.9%",
      ],
      featuresEn: [
        "Unlimited custom monthly reminder quota",
        "Full ERP & accounting software integration",
        "Automated cheque registry & bounce alerts",
        "Granular RBAC multi-user finance team access",
        "Dedicated account manager & phone support",
        "99.9% uptime SLA guarantee",
      ],
    },
  ];

  return (
    <div className="flex flex-col gap-8 pb-10">
      {/* Page Header */}
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3.5 py-1 text-xs font-extrabold text-primary">
          <Crown size={15} weight="fill" aria-hidden />
          <span>{isAr ? "الباقات والاشتراكات ٢٠٢٦" : "Plans & Billing 2026"}</span>
        </span>
        <h1 className="text-3xl font-black text-text sm:text-4xl">
          {isAr ? "اختر الخطة المناسبة لحجم معاملاتك" : "Choose the Plan Built for Your Scale"}
        </h1>
        <p className="max-w-2xl text-sm text-text-muted sm:text-base">
          {isAr
            ? "نظام تسعير شفاف بدون رسوم خفية. احصل على أسرع معدل تحصيل لمستحقاتك وزد من سيولتك النقدية."
            : "Transparent pricing without hidden fees. Accelerate receivables collection and protect your cash flow."}
        </p>

        {/* Placeholder Price Disclaimer Badge */}
        <p className="text-xs text-text-muted rounded-full bg-surface-muted/70 px-3 py-1">
          {t("placeholderPrices")}
        </p>

        {/* Monthly vs Annual Toggle */}
        <div className="mt-4 flex items-center gap-3 rounded-2xl bg-surface-muted/60 p-1.5 shadow-2xs">
          <button
            type="button"
            onClick={() => setIsAnnual(false)}
            className={`rounded-xl px-4 py-2 text-xs font-bold transition-all ${
              !isAnnual ? "bg-surface text-text shadow-xs" : "text-text-muted hover:text-text"
            }`}
          >
            {isAr ? "الدفع الشهري" : "Monthly Billing"}
          </button>
          <button
            type="button"
            onClick={() => setIsAnnual(true)}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
              isAnnual ? "bg-primary text-white shadow-xs" : "text-text-muted hover:text-text"
            }`}
          >
            <span>{isAr ? "الدفع السنوي" : "Annual Billing"}</span>
            <span className="rounded-full bg-emerald-400/20 px-2 py-0.5 text-[10px] font-extrabold text-emerald-600 dark:text-emerald-300">
              {isAr ? "وفّر ٢٠٪" : "Save 20%"}
            </span>
          </button>
        </div>
      </div>

      {/* Quota Banner if Warning/Exceeded */}
      {quota && quota.state !== "ok" && (
        <div
          data-testid="quota-banner"
          role="alert"
          className="flex items-center gap-3 rounded-2xl bg-amber-500/10 p-4 font-bold text-amber-700 dark:text-amber-300"
        >
          <WarningCircle size={22} weight="fill" aria-hidden className="shrink-0" />
          <span>
            {quota.state === "exceeded" ? t("quotaExceeded") : t("quotaWarn")}
            {" — "}
            <span dir="ltr">
              {quota.used} {t("quotaOf")} {quota.quota ?? "∞"}
            </span>
          </span>
        </div>
      )}

      {msg && (
        <div role="status" className="rounded-2xl bg-primary/10 p-4 text-center font-bold text-primary">
          {msg}
        </div>
      )}

      {/* 3-Tier Pricing Cards Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 items-stretch">
        {tiers.map((tier) => {
          const planKey = tier.planKey;
          const isCurrent = quota?.planKey === planKey;
          const rawPrice = tier.planObj ? Number(tier.planObj.priceMinor) : 0;
          const calculatedPriceMinor = Math.round(rawPrice * discountMultiplier);

          return (
            <div
              key={tier.key}
              className={`relative flex flex-col justify-between rounded-3xl p-6 sm:p-7 transition-all duration-300 ${
                tier.highlighted
                  ? "bg-surface shadow-xl shadow-primary/10 ring-2 ring-primary dark:shadow-primary/5"
                  : "bg-surface shadow-sm hover:shadow-md"
              }`}
            >
              {/* Most Popular Floating Badge */}
              {tier.badge && (
                <div className="absolute -top-3.5 start-1/2 -translate-x-1/2 rtl:translate-x-1/2">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1 text-xs font-black text-white shadow-md shadow-primary/30">
                    <Sparkle size={13} weight="fill" aria-hidden />
                    <span>{tier.badge}</span>
                  </span>
                </div>
              )}

              {/* Card Header */}
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <tier.icon size={26} weight="duotone" />
                  </div>
                  {isCurrent && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-extrabold text-emerald-600 dark:text-emerald-400">
                      <Check size={13} weight="bold" />
                      <span>{isAr ? "خطتك الحالية" : "Current Plan"}</span>
                    </span>
                  )}
                </div>

                <div>
                  <h3 className="text-xl font-black text-text">{isAr ? tier.titleAr : tier.titleEn}</h3>
                  <p className="mt-1 text-xs text-text-muted leading-relaxed">
                    {isAr ? tier.subtitleAr : tier.subtitleEn}
                  </p>
                </div>

                {/* Price Display */}
                <div className="my-2 rounded-2xl bg-surface-muted/40 p-4">
                  {tier.planObj ? (
                    <div className="flex items-baseline gap-1.5">
                      <span className="tnum text-3xl sm:text-4xl font-black text-text" dir="ltr">
                        {formatEgp(BigInt(calculatedPriceMinor))}
                      </span>
                      <span className="text-xs font-semibold text-text-muted">
                        /{isAr ? "شهرياً" : "month"}
                      </span>
                    </div>
                  ) : (
                    <span className="text-2xl font-black text-text">{isAr ? "مخصص" : "Custom"}</span>
                  )}
                  {isAnnual && tier.planObj && rawPrice > 0 && (
                    <p className="mt-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                      {isAr ? "يتم احتساب الخصم السنوي ٢٠٪" : "Billed annually (20% saved)"}
                    </p>
                  )}
                </div>

                {/* Feature List */}
                <div className="flex flex-col gap-2.5 pt-1">
                  <span className="text-xs font-extrabold text-text">
                    {isAr ? "المزايا المشمولة:" : "Included features:"}
                  </span>
                  <ul className="flex flex-col gap-2.5">
                    {(isAr ? tier.featuresAr : tier.featuresEn).map((feat) => (
                      <li key={feat} className="flex items-start gap-2.5 text-xs text-text-muted">
                        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                          <Check size={11} weight="bold" />
                        </span>
                        <span className="leading-tight">{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Action Button */}
              <div className="mt-8 pt-4">
                {!isCurrent ? (
                  <button
                    data-testid={`upgrade-${planKey}`}
                    disabled={busy}
                    onClick={() => void upgrade(planKey)}
                    className={`w-full min-h-[46px] flex items-center justify-center gap-2 rounded-2xl text-xs font-extrabold transition-all duration-200 active:scale-98 disabled:opacity-50 ${
                      tier.highlighted
                        ? "bg-primary text-white shadow-md shadow-primary/25 hover:bg-primary-hover"
                        : "bg-surface-muted hover:bg-callout text-text hover:text-primary"
                    }`}
                  >
                    <ArrowUp size={15} weight="bold" aria-hidden />
                    <span>{isAr ? `الترقية إلى ${tier.titleAr}` : `Upgrade to ${tier.titleEn}`}</span>
                  </button>
                ) : (
                  <div className="w-full min-h-[46px] flex items-center justify-center rounded-2xl bg-surface-muted/80 text-xs font-bold text-text-muted">
                    {isAr ? "أنت مشترك في هذه الباقة" : "Active Plan"}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Subscription Invoices History Section */}
      {subInvoices.length > 0 && (
        <div className="mt-4 flex flex-col gap-4 rounded-3xl bg-surface p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-base font-extrabold text-text">
              <Receipt size={18} weight="fill" className="text-primary" />
              <span>{isAr ? "سجل فواتير الاشتراك" : "Subscription Invoice History"}</span>
            </h2>
            <span className="text-xs text-text-muted">
              {subInvoices.length} {isAr ? "فاتورة مسجلة" : "invoices recorded"}
            </span>
          </div>

          <div className="overflow-x-auto rounded-2xl">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-surface-muted/50 text-text-muted">
                  <th className="px-4 py-3 text-start font-bold">{isAr ? "الباقة" : "Plan"}</th>
                  <th className="px-4 py-3 text-start font-bold">{isAr ? "فترة الاشتراك" : "Billing Period"}</th>
                  <th className="px-4 py-3 text-start font-bold">{isAr ? "المبلغ" : "Amount"}</th>
                  <th className="px-4 py-3 text-start font-bold">{isAr ? "الحالة" : "Status"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {subInvoices.map((inv) => {
                  const planTitle = isAr
                    ? (inv.planKey === "trial" ? "فترة تجريبية" : inv.planKey === "starter" ? "الباقة الأساسية" : inv.planKey === "growth" ? "باقة النمو" : inv.planKey === "pro" ? "الباقة الاحترافية" : inv.planKey)
                    : (inv.planKey === "trial" ? "Trial Period" : inv.planKey === "starter" ? "Starter Plan" : inv.planKey === "growth" ? "Growth Plan" : inv.planKey === "pro" ? "Pro Plan" : inv.planKey);
                  const isFree = BigInt(inv.amountMinor) === 0n;
                  const formattedAmt = isFree
                    ? (isAr ? "0.00 ج.م (مجاناً)" : "0.00 EGP (Free)")
                    : `${formatEgp(BigInt(inv.amountMinor))} ${isAr ? "ج.م" : "EGP"}`;
                  const statusLabel = isAr
                    ? (inv.status === "paid" ? "تم السداد" : inv.status === "open" ? "معلقة" : inv.status)
                    : (inv.status === "paid" ? "Paid" : inv.status === "open" ? "Open" : inv.status);

                  return (
                    <tr key={inv.id} className="transition-colors hover:bg-callout/40">
                      <td className="px-4 py-3 font-bold text-text">{planTitle}</td>
                      <td className="px-4 py-3 text-text-muted" dir="ltr">
                        {inv.periodStart} → {inv.periodEnd}
                      </td>
                      <td className="tnum px-4 py-3 font-extrabold text-text" dir="ltr">
                        {formattedAmt}
                      </td>
                      <td className="px-4 py-3">
                        <StatusPill status={inv.status === "paid" ? "paid" : "open"} label={statusLabel} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Trust & Guarantee Callout */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl bg-surface-muted/40 p-5 sm:p-6 text-xs text-text-muted">
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ShieldCheck size={22} weight="fill" />
          </div>
          <div>
            <p className="font-bold text-text">
              {isAr ? "دفع آمن ومشفّر عبر بوابة Paymob" : "Bank-Grade Encryption Powered by Paymob"}
            </p>
            <p>
              {isAr
                ? "جميع المدفوعات مطابقة لأعلى معايير الأمان PCI-DSS. يمكنك ترقية أو تغيير باقتك في أي وقت."
                : "All payments adhere to PCI-DSS standards. You can change or upgrade your plan anytime."}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
