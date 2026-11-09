"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { trpc } from "@/lib/trpc-client";
import { BrandMark } from "./BrandMark";

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

  const inputCls = "w-full rounded-md border border-border bg-surface px-3 min-h-touch text-text";

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

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <BrandMark variant="color" size={40} />
        <h1 className="text-xl font-bold">{t("title")}</h1>
      </div>
      <ol className="flex gap-2 text-sm" aria-label="steps">
        {[t("stepBusiness"), t("stepSchedule"), t("stepTone")].map((label, i) => (
          <li key={label} className={i === step ? "font-bold text-primary" : "text-text-muted"}>{`${i + 1}. ${label}`}</li>
        ))}
      </ol>

      {step === 0 && (
        <section className="flex flex-col gap-4">
          <label className="flex flex-col gap-1"><span>{t("businessNameAr")}</span>
            <input data-testid="ob-name-ar" className={inputCls} value={businessNameAr} onChange={(e) => setBusinessNameAr(e.target.value)} required /></label>
          <label className="flex flex-col gap-1"><span>{t("businessNameEn")}</span>
            <input data-testid="ob-name-en" className={inputCls} dir="ltr" value={businessNameEn} onChange={(e) => setBusinessNameEn(e.target.value)} /></label>
          <label className="flex flex-col gap-1"><span>{t("timezone")}</span>
            <select data-testid="ob-timezone" className={inputCls} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              <option value="Africa/Cairo">Africa/Cairo</option>
              <option value="Africa/Alexandria">Africa/Alexandria</option>
              <option value="Asia/Riyadh">Asia/Riyadh</option>
              <option value="Asia/Dubai">Asia/Dubai</option>
            </select></label>
          <button data-testid="ob-next" className="min-h-touch rounded-md bg-primary px-4 font-bold text-primary-fg hover:bg-primary-hover disabled:opacity-60" disabled={businessNameAr.trim().length < 2} onClick={() => setStep(1)}>{tc("continue")}</button>
        </section>
      )}

      {step === 1 && (
        <section className="flex flex-col gap-4">
          <label className="flex flex-col gap-1"><span>{t("quietStart")}</span>
            <input data-testid="ob-quiet-start" className={inputCls} type="time" dir="ltr" value={quietStart} onChange={(e) => setQuietStart(e.target.value)} /></label>
          <label className="flex flex-col gap-1"><span>{t("quietEnd")}</span>
            <input data-testid="ob-quiet-end" className={inputCls} type="time" dir="ltr" value={quietEnd} onChange={(e) => setQuietEnd(e.target.value)} /></label>
          <label className="flex items-center gap-2 min-h-touch">
            <input data-testid="ob-friday" type="checkbox" checked={fridayMorningSkip} onChange={(e) => setFridayMorningSkip(e.target.checked)} />
            <span>{t("fridaySkip")}</span></label>
          <label className="flex flex-col gap-1"><span>{t("defaultTermsDays")}</span>
            <input data-testid="ob-terms" className={inputCls} type="number" dir="ltr" min={0} max={120} value={defaultTermsDays} onChange={(e) => setDefaultTermsDays(Number(e.target.value))} /></label>
          <div className="flex gap-2">
            <button className="min-h-touch rounded-md border border-border px-4" onClick={() => setStep(0)}>‹</button>
            <button data-testid="ob-next" className="min-h-touch flex-1 rounded-md bg-primary px-4 font-bold text-primary-fg hover:bg-primary-hover" onClick={() => setStep(2)}>{t("stepTone")}</button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend>{t("tone")}</legend>
            <label className="flex items-center gap-2 min-h-touch">
              <input type="radio" name="tone" checked={tone === "polite"} onChange={() => setTone("polite")} /><span>{t("tonePolite")}</span></label>
            <label className="flex items-center gap-2 min-h-touch">
              <input type="radio" name="tone" checked={tone === "firm"} onChange={() => setTone("firm")} /><span>{t("toneFirm")}</span></label>
          </fieldset>
          <label className="flex items-start gap-2">
            <input data-testid="ob-consent" type="checkbox" className="mt-2" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>{t("consent")}</span></label>
          {error && <p role="alert" className="text-sm">{error}</p>}
          <div className="flex gap-2">
            <button className="min-h-touch rounded-md border border-border px-4" onClick={() => setStep(1)}>‹</button>
            <button data-testid="ob-create" disabled={busy} onClick={onCreate} className="min-h-touch flex-1 rounded-md bg-primary px-4 font-bold text-primary-fg hover:bg-primary-hover disabled:opacity-60">{t("createCta")}</button>
          </div>
        </section>
      )}
    </main>
  );
}
