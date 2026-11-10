import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { auth } from "@/server/auth";
import { ownerDb } from "@/server/db";
import { listTenantsForUser } from "@/server/services";
import { BrandLockup, BrandMark } from "@/components/BrandMark";
import { ThemeToggle } from "@/components/ThemeToggle";
import { LocaleToggle } from "@/components/LocaleToggle";
import {
  HeroBandArt, HeroDashboardIllustration, ReceivablesIllustration,
  SecurityLockBadge, SecuritySignInIllustration,
} from "@/components/illustrations";
import { Reveal } from "@/components/motion";
import { SecurityNotice } from "@/components/ui";

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (session?.user) {
    const mine = await listTenantsForUser(ownerDb(), session.user.id);
    redirect(mine.length > 0 ? `/${locale}/dashboard` : `/${locale}/onboarding`);
  }
  const t = await getTranslations("landing");
  const ta = await getTranslations("app");
  const steps = [
    { title: t("step1Title"), body: t("step1Body") },
    { title: t("step2Title"), body: t("step2Body") },
    { title: t("step3Title"), body: t("step3Body") },
  ];
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[1600px] flex-col gap-10 sm:gap-14 px-4 pb-12 pt-6 sm:px-6 lg:px-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <BrandLockup size="lg" showTagline locale={locale} />
        <nav className="flex flex-wrap items-center gap-2.5">
          <ThemeToggle className="size-11" />
          <LocaleToggle currentLocale={locale} className="min-h-[44px] px-4 text-xs" />
          <Link
            data-testid="landing-cta-login"
            href={`/${locale}/login`}
            className="inline-flex min-h-[44px] items-center rounded-full border border-border-strong/70 bg-surface px-6 py-2.5 text-sm font-medium transition-colors hover:border-primary hover:bg-callout"
          >
            {t("ctaLogin")}
          </Link>
          <Link
            data-testid="landing-cta-signup"
            href={`/${locale}/signup`}
            className="inline-flex min-h-[44px] items-center rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-fg transition-colors hover:bg-primary-hover"
          >
            {t("ctaSignup")}
          </Link>
        </nav>
      </header>

      {/* Hero: Yaseir Ink & UI Blue gradient band with pill CTAs */}
      <Reveal>
        <section className="hero-band panel-shadow relative overflow-hidden rounded-3xl text-white">
          <div className="brand-pattern absolute inset-0" aria-hidden />
          <div className="relative grid items-center gap-8 p-7 sm:p-10 lg:grid-cols-2 lg:p-12">
            <div className="flex flex-col items-start gap-5">
              <span className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3.5 py-1 text-xs font-bold text-teal-200">
                <BrandMark variant="white" size={16} />
                {ta("name")} 
              </span>
              <h1 className="text-[36px] font-bold leading-tight sm:text-[44px]">{t("heroTagline")}</h1>
              <p className="max-w-md text-base text-navy-100 sm:text-lg">{t("heroSupporting")}</p>
              <div className="flex flex-wrap gap-3">
                <Link
                  data-testid="landing-hero-signup"
                  href={`/${locale}/signup`}
                  className="inline-flex min-h-[48px] items-center rounded-full bg-accent px-7 py-3 text-sm font-bold text-accent-fg transition-opacity hover:opacity-90"
                >
                  {t("ctaSignup")}
                </Link>
                <Link
                  href={`/${locale}/login`}
                  className="inline-flex min-h-[48px] items-center rounded-full border border-white/45 px-7 py-3 text-sm font-medium text-white transition-colors hover:bg-white/10"
                >
                  {t("ctaLogin")}
                </Link>
              </div>
            </div>
            <div className="relative hidden justify-center sm:flex" aria-hidden>
              <HeroBandArt size={380} />
            </div>
          </div>
        </section>
      </Reveal>

      {/* Yaseir Purposeful Imagery Stage: Workspace, Receivables & Security Illustrations */}
      <Reveal>
        <section className="grid gap-6 lg:grid-cols-3">
          <div className="panel-shadow flex flex-col items-center gap-4 rounded-2xl border border-border bg-surface p-5 text-center">
            <HeroDashboardIllustration size={320} />
            <h2 className="text-[18px] font-bold">{steps[0]!.title}</h2>
            <p className="text-sm text-text-muted">{steps[0]!.body}</p>
          </div>
          <div className="panel-shadow flex flex-col items-center gap-4 rounded-2xl border border-border bg-surface p-5 text-center">
            <ReceivablesIllustration size={320} />
            <h2 className="text-[18px] font-bold">{steps[1]!.title}</h2>
            <p className="text-sm text-text-muted">{steps[1]!.body}</p>
          </div>
          <div className="panel-shadow flex flex-col items-center gap-4 rounded-2xl border border-border bg-surface p-5 text-center">
            <SecuritySignInIllustration size={320} />
            <h2 className="text-[18px] font-bold">{steps[2]!.title}</h2>
            <p className="text-sm text-text-muted">{steps[2]!.body}</p>
          </div>
        </section>
      </Reveal>

      <Reveal>
        <SecurityNotice
          title={locale === "ar" ? "أمان المؤسسات وحماية البيانات القياسية" : "Enterprise-Grade Security & Data Isolation"}
          body={
            locale === "ar"
              ? "حماية متكاملة لبيانات منشأتك وفواتيرك ومدفوعاتك على مدار الساعة."
              : "Complete protection and isolation for your business invoices and payments."
          }
        />
      </Reveal>

      <footer className="mt-auto flex flex-col items-center gap-2 pt-2 text-center text-xs text-text-muted">
        <div className="flex items-center gap-2">
          <BrandMark variant="mono" size={24} />
          <SecurityLockBadge size={24} />
        </div>
        <p>{locale === "en" ? "Dafqly" : "دفقلي"} — {t("heroTagline")}</p>
      </footer>
    </main>
  );
}
