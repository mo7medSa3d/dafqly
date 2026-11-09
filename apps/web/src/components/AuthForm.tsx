"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { BRAND } from "@tahseel/brand/brand";
import { signIn, signUp } from "@/lib/auth-client";
import { BrandMark } from "./BrandMark";
import { HeroBandArt } from "./illustrations";
import { inputCls, labelCls } from "./ui";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const t = useTranslations("auth");
  const locale = useLocale();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = mode === "signup"
      ? await signUp.email({ name, email, password })
      : await signIn.email({ email, password });
    setBusy(false);
    if (result.error) {
      setError(t("failed"));
      return;
    }
    router.push(`/${locale}`);
    router.refresh();
  }

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* Brand side (desktop): navy band, pattern, lockup, tagline, motif */}
      <aside className="hero-band relative hidden flex-col justify-between overflow-hidden p-10 text-white lg:flex">
        <div className="brand-pattern absolute inset-0" aria-hidden />
        <div className="relative flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-white/10">
            <BrandMark variant="white" size={26} />
          </span>
          <span className="text-lg font-extrabold">{BRAND.name}</span>
        </div>
        <div className="relative flex flex-col items-start gap-5">
          <HeroBandArt size={340} />
          <p className="text-3xl font-extrabold leading-snug">{BRAND.tagline}</p>
          <p className="max-w-sm text-navy-100">{BRAND.supportingLine}</p>
        </div>
        <p className="relative text-sm text-navy-200">{BRAND.descriptionAr}</p>
      </aside>

      {/* Form side */}
      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="flex w-full max-w-md flex-col gap-6">
          <div className="flex flex-col items-center gap-3 text-center lg:items-start lg:text-start">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-navy-700 lg:hidden">
              <BrandMark variant="white" size={32} />
            </span>
            <span className="hidden size-14 items-center justify-center rounded-2xl bg-surface-muted lg:flex">
              <BrandMark variant="color" size={32} />
            </span>
            <h1 className="text-2xl font-extrabold sm:text-[28px]">{mode === "signup" ? t("signupTitle") : t("loginTitle")}</h1>
          </div>
          <form onSubmit={onSubmit} className="flex w-full flex-col gap-4">
            {mode === "signup" && (
              <label className={labelCls}>
                <span>{t("name")}</span>
                <input data-testid="auth-name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required />
              </label>
            )}
            <label className={labelCls}>
              <span>{t("email")}</span>
              <input data-testid="auth-email" className={inputCls} type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label className={labelCls}>
              <span>{t("password")}</span>
              <input data-testid="auth-password" className={inputCls} type="password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
            </label>
            {error && <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-sm font-semibold text-danger">{error}</p>}
            <button data-testid="auth-submit" type="submit" disabled={busy} className="inline-flex min-h-touch items-center justify-center rounded-md bg-primary px-4 py-2.5 font-bold text-primary-fg transition-colors hover:bg-primary-hover disabled:opacity-60">
              {mode === "signup" ? t("signupCta") : t("loginCta")}
            </button>
          </form>
          <a className="text-center font-bold text-link underline-offset-4 hover:underline lg:text-start" href={`/${locale}/${mode === "signup" ? "login" : "signup"}`}>
            {mode === "signup" ? t("haveAccount") : t("noAccount")}
          </a>
        </div>
      </div>
    </main>
  );
}
