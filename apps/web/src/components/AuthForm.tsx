"use client";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { CheckCircle, Eye, EyeSlash, LockKey, SpinnerGap } from "@/components/ui/solid-icons";
import { BRAND } from "@tahseel/brand/brand";
import { signIn, signUp } from "@/lib/auth-client";
import { BrandLockup } from "./BrandMark";
import { ThemeToggle } from "./ThemeToggle";
import { LocaleToggle } from "./LocaleToggle";
import { SecurityNotice, btnPrimary, inputCls, labelCls } from "./ui";
import { SecurityLockBadge } from "./illustrations";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const t = useTranslations("auth");
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialBiz = searchParams.get("business") ?? "";
  const initialEmail = searchParams.get("email") ?? "";
  const selectedPlan = searchParams.get("plan") ?? "";
  const [name, setName] = useState(initialBiz);
  const [email, setEmail] = useState(initialEmail);

  useEffect(() => {
    if (initialBiz || initialEmail) return;
    try {
      const raw = window.localStorage.getItem("dafqly:workspace-card");
      if (!raw) return;
      const parsed = JSON.parse(raw) as { businessName?: string; email?: string };
      if (!name && parsed.businessName) setName(parsed.businessName);
      if (!email && parsed.email) setEmail(parsed.email);
    } catch (err) { console.warn("[AuthForm] saved workspace card unreadable, ignoring it", err); }
  }, [initialBiz, initialEmail]);
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);
  const ar = locale === "ar";
  const strength = Math.min(4, (password.length >= 8 ? 1 : 0) + (password.length >= 12 ? 1 : 0) + (/[A-Za-z]/.test(password) && /\d/.test(password) ? 1 : 0) + (/[^A-Za-z0-9]/.test(password) ? 1 : 0));
  const strengthLabel = [ar ? "ضعيفة جداً" : "Very weak", ar ? "ضعيفة" : "Weak", ar ? "مقبولة" : "Fair", ar ? "جيدة" : "Good", ar ? "قوية" : "Strong"][strength];

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
      setShake((n) => n + 1);
      return;
    }
    if (mode === "signup") {
      router.push(`/${locale}/onboarding`);
    } else {
      router.push(`/${locale}/dashboard`);
    }
    router.refresh();
  }

  const perks = [
    { t: ar ? "جدولة تذكيرات سداد ذكية ومؤتمتة" : "Smart automated payment reminders" },
    { t: ar ? "مساعد ذكي على بياناتك الحقيقية" : "A copilot on your real data" },
    { t: ar ? "موافقتك قبل أي إجراء مهم" : "Your approval before any action" },
  ];

  return (
    <main className="relative grid min-h-dvh bg-background text-foreground lg:grid-cols-[1.05fr_1fr]">
      <div className="fixed top-4 end-4 z-30 flex items-center gap-2 sm:top-6 sm:end-6">
        <ThemeToggle />
        <LocaleToggle currentLocale={locale} className="rounded-full" />
      </div>

      {/* Swiss-editorial monochrome poster aside */}
      <aside className="relative hidden flex-col justify-between overflow-hidden border-e border-border bg-primary p-12 text-primary-foreground lg:flex">
        <div className="hero-glow absolute inset-0" aria-hidden />
        <div className="grid-lines absolute inset-0" aria-hidden />
        <svg className="pointer-events-none absolute -end-24 -top-24 size-[420px] opacity-15" viewBox="0 0 100 100" fill="none" aria-hidden>
          <circle cx="50" cy="50" r="48" stroke="currentColor" strokeWidth="0.4" />
          <circle cx="50" cy="50" r="32" stroke="currentColor" strokeWidth="0.4" strokeDasharray="1 3" />
        </svg>

        <div className="relative"><BrandLockup size="md" onDark showTagline locale={locale} /></div>

        <div className="relative flex flex-col gap-8">
          <div className="flex flex-col gap-3">
            <span className="inline-flex w-fit items-center rounded-full border border-current/25 px-3 py-1 font-mono text-[11px] font-bold uppercase tracking-wider">
              {ar ? "مساحة العمل" : "WORKSPACE"}
            </span>
            <h2 className="text-[40px] font-extrabold leading-[1.15]">{ar ? BRAND.taglineAr : BRAND.tagline}</h2>
            <p className="max-w-md leading-8 opacity-80">{ar ? "إدارة ذكية للمستحقات وتدفق نقدي أسرع." : BRAND.supportingLine}</p>
          </div>
          <ul className="flex flex-col gap-3">
            {perks.map((p, i) => (
              <li key={p.t} className="ai-step flex items-center gap-3 text-sm font-medium" style={{ ["--i" as string]: i }}>
                <CheckCircle size={20} className="text-[var(--chart-1)]" aria-hidden />{p.t}
              </li>
            ))}
          </ul>
          <div className="float-slow relative w-full max-w-sm rounded-2xl border border-current/20 bg-current/5 p-5 backdrop-blur-md" aria-hidden>
            <div className="flex items-center gap-3">
              <SecurityLockBadge size={40} />
              <div>
                <p className="text-sm font-bold">{ar ? "دخول آمن لمساحة العمل" : "Secure workspace access"}</p>
                <p className="text-xs opacity-75">{ar ? "معزولة بصلاحيات المنشأة وقابلة للمراجعة" : "Tenant-isolated and auditable"}</p>
              </div>
            </div>
          </div>
        </div>
        <p className="relative font-mono text-xs opacity-70">{ar ? BRAND.descriptionAr : BRAND.descriptionEn}</p>
      </aside>

      <div className="flex items-center justify-center p-6 sm:p-10">
        <div key={mode} className="ai-rise flex w-full max-w-md flex-col gap-6">
          <div className="flex flex-col gap-4">
            <div className="lg:hidden"><BrandLockup size="md" locale={locale} /></div>
            <div className="relative grid w-full grid-cols-2 rounded-full border border-border bg-muted p-1 text-sm font-bold">
              <span
                aria-hidden
                className="absolute inset-y-1 w-[calc(50%-4px)] rounded-full bg-card shadow-xs transition-transform duration-500 [transition-timing-function:var(--ease-spring)]"
                style={{ insetInlineStart: 4, transform: `translateX(${mode === "login" ? "0%" : (ar ? "-100%" : "100%")})` }}
              />
              <Link href={`/${locale}/login`} className={`relative z-10 flex min-h-[40px] items-center justify-center rounded-full ${mode === "login" ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{t("loginTitle")}</Link>
              <Link href={`/${locale}/signup`} className={`relative z-10 flex min-h-[40px] items-center justify-center rounded-full ${mode === "signup" ? "text-foreground" : "text-muted-foreground hover:text-foreground"}`}>{t("signupTitle")}</Link>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[32px] font-extrabold leading-tight">{mode === "signup" ? t("signupTitle") : t("loginTitle")}</h1>
              {mode === "signup" && selectedPlan && (
                <span className="inline-flex items-center rounded-full border border-border bg-muted px-3 py-1 text-xs font-bold text-foreground">
                  {ar ? `الباقة: ${selectedPlan}` : `Plan: ${selectedPlan}`}
                </span>
              )}
            </div>
            <p className="-mt-2 text-sm text-muted-foreground">{mode === "signup" ? (ar ? "ابدأ في دقيقة، من غير بطاقة." : "Get started in a minute.") : (ar ? "أهلاً بيك تاني، كمّل من حيث وقفت." : "Welcome back. Pick up where you left off.")}</p>
          </div>

          <form key={shake} onSubmit={onSubmit} className={`panel-shadow flex w-full flex-col gap-4 rounded-2xl border border-border bg-card p-6 sm:p-7 ${shake ? "shake" : ""}`}>
            {mode === "signup" && (
              <label className={labelCls}>
                <span>{t("name")}</span>
                <input data-testid="auth-name" autoComplete="name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required />
              </label>
            )}
            <label className={labelCls}>
              <span>{t("email")}</span>
              <input data-testid="auth-email" autoComplete="email" className={inputCls} type="email" placeholder="name@example.com" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <label className={labelCls}>
              <span>{t("password")}</span>
              <div className="relative block" dir="ltr">
                <input
                  data-testid="auth-password"
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
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
                  className={cn(buttonVariants({ variant: "ghost", size: "iconSm" }), "absolute top-1/2 size-8 -translate-y-1/2 text-muted-foreground hover:bg-accent hover:text-foreground")}
                >
                  {showPass ? <EyeSlash size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
                </button>
              </div>
              {mode === "signup" && password && (
                <div aria-live="polite" className="flex items-center gap-2 text-xs text-muted-foreground">
                  <div className="flex flex-1 gap-1" aria-hidden>
                    {[0, 1, 2, 3].map((i) => <span key={i} className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${i < strength ? (strength < 2 ? "bg-status-overdue-fg" : strength < 3 ? "bg-status-due-fg" : "bg-status-paid-fg") : "bg-muted"}`} />)}
                  </div>
                  <span>{strengthLabel}</span>
                </div>
              )}
            </label>
            {error && <p role="alert" className="ai-rise rounded-xl bg-danger-bg px-3.5 py-2.5 text-sm font-semibold text-destructive">{error}</p>}
            <button data-testid="auth-submit" type="submit" disabled={busy} className={`${btnPrimary} w-full rounded-full`}>
              {busy ? <SpinnerGap size={18} className="animate-spin" aria-hidden /> : <LockKey size={18} aria-hidden />}
              {mode === "signup" ? t("signupCta") : t("loginCta")}
            </button>
          </form>

          <SecurityNotice compact body={ar ? "بيانات حسابك ومعاملاتك المالية مشفّرة ومحمية بالكامل." : "Your account and financial data are encrypted and protected."} />

          <a className="text-center text-sm font-bold text-foreground underline-offset-4 hover:underline" href={`/${locale}/${mode === "signup" ? "login" : "signup"}`}>
            {mode === "signup" ? t("haveAccount") : t("noAccount")}
          </a>
        </div>
      </div>
    </main>
  );
}
