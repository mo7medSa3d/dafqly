"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { ArrowLeft, CheckCircle } from "@phosphor-icons/react";
import { trpc } from "@/lib/trpc-client";
import { BrandLockup } from "./BrandMark";
import { ThemeToggle } from "./ThemeToggle";
import { LocaleToggle } from "./LocaleToggle";
import { OnboardingIllustration } from "./illustrations";
import { btnGhost, btnPrimary, inputCls, labelCls } from "./ui";

/** Tenant onboarding wizard (BUILD_PLAN F0): business → schedule policy → tone + consent. */
export function OnboardingWizard() {
  const t = useTranslations("onboarding");
  const tc = useTranslations("common");
  const locale = useLocale();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [businessNameAr, setBusinessNameAr] = useState("");
  const [businessNameEn, setBusinessNameEn] = useState("");
  const [timezone, setTimezone] = useState("Africa/Cairo");
  const [quietStart, setQuietStart] = useState("21:00");
  const [quietEnd, setQuietEnd] = useState("09:00");
  const [fridayMorningSkip, setFridayMorningSkip] = useState(false);
  const [defaultTermsDays, setDefaultTermsDays] = useState(14);
  const [tone, setTone] = useState<"polite" | "firm">("polite");
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onCreate() {
    if (!consent) { setError(t("consentRequired")); return; }
    setBusy(true);
    setError(null);
    try {
      await trpc.tenant.create.mutate({
        businessNameAr,
        businessNameEn: businessNameEn || undefined,
        timezone, quietStart, quietEnd, fridayMorningSkip, defaultTermsDays, tone,
        consent: true,
      });
      router.push(`/${locale}/dashboard`);
      router.refresh();
    } catch {
      setBusy(false);
      setError(t("failed"));
    }
  }

  const steps = [t("stepBusiness"), t("stepSchedule"), t("stepTone")];
  const backBtn = `${btnGhost} px-3`;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-7 p-6 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BrandLockup size="md" locale={locale} />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <LocaleToggle currentLocale={locale} />
        </div>
      </div>
      <h1 className="text-xl font-extrabold">{t("title")}</h1>

      {/* Stepper: numbered/filled nodes joined by a progress track */}
      <ol className="flex items-center gap-2" aria-label="steps">
        {steps.map((label, i) => {
          const done = i < step;
          const current = i === step;
          return (
            <li key={label} className="flex flex-1 items-center gap-2 last:flex-none">
              <span className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ${done || current ? "bg-primary text-primary-fg" : "bg-surface-muted text-text-muted"}`}>
                {done ? <CheckCircle size={17} weight="fill" aria-hidden /> : <span className="tnum" dir="ltr">{i + 1}</span>}
              </span>
              <span className={`hidden text-sm sm:block ${current ? "font-bold" : done ? "font-semibold" : "text-text-muted"}`}>{label}</span>
              {i < steps.length - 1 && <span className={`mx-1 h-0.5 flex-1 rounded-full ${done ? "bg-teal-500" : "bg-border"}`} aria-hidden />}
            </li>
          );
        })}
      </ol>

      <section className="panel-shadow rounded-2xl border border-border bg-surface p-5 sm:p-7">
        {step === 0 && (
          <div className="flex flex-col gap-4">
            <div className="flex justify-center"><OnboardingIllustration size={110} /></div>
            <label className={labelCls}><span>{t("businessNameAr")}</span>
              <input data-testid="ob-name-ar" className={inputCls} value={businessNameAr} onChange={(e) => setBusinessNameAr(e.target.value)} required /></label>
            <label className={labelCls}><span>{t("businessNameEn")}</span>
              <input data-testid="ob-name-en" className={inputCls} dir="ltr" value={businessNameEn} onChange={(e) => setBusinessNameEn(e.target.value)} /></label>
            <label className={labelCls}><span>{t("timezone")}</span>
              <select data-testid="ob-timezone" className={inputCls} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                <option value="Africa/Cairo">Africa/Cairo</option>
                <option value="Africa/Alexandria">Africa/Alexandria</option>
                <option value="Asia/Riyadh">Asia/Riyadh</option>
                <option value="Asia/Dubai">Asia/Dubai</option>
              </select></label>
            <div>
              <button data-testid="ob-next" className={btnPrimary} disabled={businessNameAr.trim().length < 2} onClick={() => setStep(1)}>{tc("continue")}</button>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={labelCls}><span>{t("quietStart")}</span>
                <input data-testid="ob-quiet-start" className={inputCls} type="time" dir="ltr" value={quietStart} onChange={(e) => setQuietStart(e.target.value)} /></label>
              <label className={labelCls}><span>{t("quietEnd")}</span>
                <input data-testid="ob-quiet-end" className={inputCls} type="time" dir="ltr" value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} /></label>
            </div>
            <label className="flex min-h-touch items-center gap-2.5">
              <input data-testid="ob-friday" type="checkbox" className="size-[18px] accent-[var(--teal-600)]" checked={fridayMorningSkip} onChange={(e) => setFridayMorningSkip(e.target.checked)} />
              <span className="font-semibold">{t("fridaySkip")}</span></label>
            <label className={labelCls}><span>{t("defaultTermsDays")}</span>
              <input data-testid="ob-terms" className={inputCls} type="number" dir="ltr" min={0} max={120} value={defaultTermsDays} onChange={(e) => setDefaultTermsDays(Number(e.target.value))} /></label>
            <div className="flex gap-2">
              <button className={backBtn} onClick={() => setStep(0)} aria-label={tc("back")}>
                <ArrowLeft size={18} weight="fill" aria-hidden className="rtl:-scale-x-100" />
              </button>
              <button data-testid="ob-next" className={`${btnPrimary} flex-1`} onClick={() => setStep(2)}>{t("stepTone")}</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-4">
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 font-bold">{t("tone")}</legend>
              {([
                { value: "polite" as const, label: t("tonePolite") },
                { value: "firm" as const, label: t("toneFirm") },
              ]).map((o) => (
                <label key={o.value} className={`flex min-h-touch cursor-pointer items-center gap-2.5 rounded-lg border px-4 py-2.5 font-semibold transition-colors ${tone === o.value ? "border-teal-600 bg-teal-50 dark:bg-surface-muted" : "border-border hover:border-border-strong"}`}>
                  <input type="radio" name="tone" className="size-[18px] accent-[var(--teal-600)]" checked={tone === o.value} onChange={() => setTone(o.value)} />
                  <span>{o.label}</span>
                </label>
              ))}
            </fieldset>
            <label className="flex items-start gap-2.5 rounded-lg bg-surface-muted/60 px-4 py-3">
              <input data-testid="ob-consent" type="checkbox" className="mt-1 size-[18px] shrink-0 accent-[var(--teal-600)]" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span className="text-sm">{t("consent")}</span></label>
            {error && <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm font-semibold text-danger">{error}</p>}
            <div className="flex gap-2">
              <button className={backBtn} onClick={() => setStep(1)} aria-label={tc("back")}>
                <ArrowLeft size={18} weight="fill" aria-hidden className="rtl:-scale-x-100" />
              </button>
              <button data-testid="ob-create" disabled={busy} onClick={onCreate} className={`${btnPrimary} flex-1`}>{t("createCta")}</button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
