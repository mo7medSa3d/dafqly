"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { Eye, EyeSlash, LockKey, ShieldCheck } from "@phosphor-icons/react";
import { BRAND } from "@tahseel/brand/brand";
import { signIn, signUp } from "@/lib/auth-client";
import { BrandLockup } from "./BrandMark";
import { ThemeToggle } from "./ThemeToggle";
import { LocaleToggle } from "./LocaleToggle";
import { SecurityNotice, btnPrimary, inputCls, labelCls } from "./ui";
import { SecurityLockBadge, SecuritySignInIllustration } from "./illustrations";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const t = useTranslations("auth");
  const locale = useLocale();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
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
    if (mode === "signup") {
      router.push(`/${locale}/onboarding`);
    } else {
      router.push(`/${locale}/dashboard`);
    }
    router.refresh();
  }

  return (
    <main className="glass-canvas relative grid min-h-dvh lg:grid-cols-[1.08fr_1fr]">
      {/* Top Floating Controls — single unified instance */}
      <div className="fixed top-4 end-4 z-30 flex items-center gap-2 sm:top-6 sm:end-6">
        <ThemeToggle />
        <LocaleToggle currentLocale={locale} />
      </div>

      {/* Brand & Security Artwork Panel (desktop) — Yaseir signin-art.svg + Lock Badge */}
      <aside className="hero-band relative hidden flex-col justify-between overflow-hidden p-10 text-white lg:flex">
        <div className="brand-pattern absolute inset-0" aria-hidden />
        <div className="relative flex items-center justify-between gap-3">
          <BrandLockup size="md" onDark showTagline locale={locale} />
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-1 text-xs font-bold text-teal-200">
            <ShieldCheck size={16} weight="fill" aria-hidden />
            <span>{locale === "en" ? "Enterprise Account Protection" : "حماية قياسية للحسابات"}</span>
          </span>
        </div>

        <div className="relative flex flex-col items-start gap-5">
          <div className="w-full flex justify-center"><SecuritySignInIllustration size={360} /></div>
          <div className="flex items-center gap-3"><SecurityLockBadge size={44}/><p className="text-sm font-bold text-navy-100">{locale === "en" ? "Secure, isolated business workspace" : "مساحة عمل آمنة ومعزولة لبيانات منشأتك"}</p></div>
          <div className="w-full rounded-3xl border border-white/15 bg-white/10 p-6 backdrop-blur-sm">
            <div className="flex items-center gap-3"><ShieldCheck size={28} weight="fill"/><span className="text-sm font-bold">{locale === "en" ? "Secure workspace access" : "دخول آمن لمساحة العمل"}</span></div>
            <p className="mt-4 text-sm leading-7 text-navy-100">{locale === "en" ? "Your workspace data is separated by tenant permissions and audited business operations." : "بيانات مساحة العمل معزولة بصلاحيات المنشأة، والعمليات المالية قابلة للمراجعة والتتبع."}</p>
          </div>
          <div className="flex items-center gap-3">
            <ShieldCheck size={38} weight="fill" />
            <div>
              <p className="text-2xl font-extrabold leading-snug">{locale === "en" ? BRAND.tagline : BRAND.taglineAr}</p>
              <p className="text-sm text-navy-100">{locale === "en" ? BRAND.supportingLine : "إدارة ذكية للمستحقات وتدفق نقدي أسرع."}</p>
            </div>
          </div>
        </div>

        <p className="relative text-xs text-navy-200">{locale === "en" ? BRAND.descriptionEn : BRAND.descriptionAr}</p>
      </aside>

      {/* Form Panel */}
      <div className="flex items-center justify-center p-6 sm:p-10">
        <div className="panel-shadow flex w-full max-w-md flex-col gap-6 rounded-3xl border border-border bg-surface p-6 sm:p-8">
          <div className="flex flex-col items-center gap-3 text-center lg:items-start lg:text-start">
            <div className="flex w-full items-center justify-between">
              <BrandLockup size="md" locale={locale} />
              <ShieldCheck size={24} weight="fill" className="text-primary" />
            </div>
            {/* Yaseir Capsule Tab Switcher */}
            <div className="mt-1 grid w-full grid-cols-2 rounded-full bg-surface-muted p-1 text-xs font-bold">
              <Link
                href={`/${locale}/login`}
                className={`flex min-h-[36px] items-center justify-center rounded-full transition-colors ${
                  mode === "login" ? "bg-primary text-primary-fg" : "text-text-muted hover:text-text"
                }`}
              >
                {t("loginTitle")}
              </Link>
              <Link
                href={`/${locale}/signup`}
                className={`flex min-h-[36px] items-center justify-center rounded-full transition-colors ${
                  mode === "signup" ? "bg-primary text-primary-fg" : "text-text-muted hover:text-text"
                }`}
              >
                {t("signupTitle")}
              </Link>
            </div>
            <h1 className="mt-1 text-[28px] font-bold leading-tight">{mode === "signup" ? t("signupTitle") : t("loginTitle")}</h1>
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
              <input data-testid="auth-email" className={inputCls} type="email" placeholder="name@example.com" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label className={labelCls}>
              <span>{t("password")}</span>
              <div className="relative block" dir="ltr">
                <input
                  data-testid="auth-password"
                  className={`${inputCls} text-left`}
                  style={{ paddingRight: "48px", paddingLeft: "14px" }}
                  type={showPass ? "text" : "password"}
                  dir="ltr"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  aria-label={showPass ? "Hide password" : "Show password"}
                  style={{ right: "10px", left: "auto" }}
                  className="absolute top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-text-muted transition-colors hover:bg-callout hover:text-primary"
                >
                  {showPass ? <EyeSlash size={18} weight="fill" aria-hidden /> : <Eye size={18} weight="fill" aria-hidden />}
                </button>
              </div>
            </label>
            {error && <p role="alert" className="rounded-xl bg-danger-bg px-3.5 py-2.5 text-sm font-semibold text-danger">{error}</p>}
            <button data-testid="auth-submit" type="submit" disabled={busy} className={`${btnPrimary} w-full`}>
              <LockKey size={18} weight="fill" aria-hidden />
              {mode === "signup" ? t("signupCta") : t("loginCta")}
            </button>
          </form>

          <SecurityNotice
            compact
            body={locale === "ar"
              ? "بيانات حسابك ومعاملاتك المالية مشفّرة ومحمية بالكامل."
              : "Your account and financial data are encrypted and protected."}
          />

          <a className="text-center text-sm font-bold text-link underline-offset-4 hover:underline" href={`/${locale}/${mode === "signup" ? "login" : "signup"}`}>
            {mode === "signup" ? t("haveAccount") : t("noAccount")}
          </a>
        </div>
      </div>
    </main>
  );
}
