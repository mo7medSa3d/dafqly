import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BRAND } from "@tahseel/brand/brand";
import { auth } from "@/server/auth";
import { ownerDb } from "@/server/db";
import { listTenantsForUser } from "@/server/services";
import { BrandMark } from "@/components/BrandMark";
import { HeroBandArt, HeroDashboardIllustration } from "@/components/illustrations";
import { Reveal } from "@/components/motion";

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
    <main className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-12 px-4 pb-10 pt-6 sm:px-6 lg:px-8">
      <header className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-navy-700">
            <BrandMark variant="white" size={24} />
          </span>
          <span className="text-xl font-extrabold">{ta("name")}</span>
        </div>
        <nav className="flex gap-2">
          <Link data-testid="landing-cta-login" href={`/${locale}/login`} className="inline-flex min-h-touch items-center rounded-md border border-border bg-surface px-4 py-2 font-bold transition-colors hover:border-border-strong">{t("ctaLogin")}</Link>
          <Link data-testid="landing-cta-signup" href={`/${locale}/signup`} className="inline-flex min-h-touch items-center rounded-md bg-primary px-4 py-2 font-bold text-primary-fg transition-colors hover:bg-primary-hover">{t("ctaSignup")}</Link>
        </nav>
      </header>

      {/* Hero: navy band with pattern depth, lockup copy and product motif */}
      <Reveal>
        <section className="hero-band panel-shadow relative overflow-hidden rounded-3xl text-white">
          <div className="brand-pattern absolute inset-0" aria-hidden />
          <div className="relative grid items-center gap-8 p-7 sm:p-10 lg:grid-cols-2 lg:p-12">
            <div className="flex flex-col items-start gap-5">
              <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm font-bold text-teal-200">
                <BrandMark variant="white" size={16} />
                {ta("name")}
              </span>
              <h1 className="text-4xl font-extrabold leading-tight sm:text-5xl">{t("heroTagline")}</h1>
              <p className="max-w-md text-lg text-navy-100">{t("heroSupporting")}</p>
              <div className="flex flex-wrap gap-3">
                <Link data-testid="landing-hero-signup" href={`/${locale}/signup`} className="inline-flex min-h-touch items-center rounded-md bg-accent px-5 py-3 font-bold text-accent-fg transition-opacity hover:opacity-90">{t("ctaSignup")}</Link>
                <Link href={`/${locale}/login`} className="inline-flex min-h-touch items-center rounded-md border border-white/40 px-5 py-3 font-bold text-white transition-colors hover:bg-white/10">{t("ctaLogin")}</Link>
              </div>
            </div>
            <div className="relative hidden justify-center sm:flex" aria-hidden>
              <HeroBandArt size={380} />
            </div>
          </div>
        </section>
      </Reveal>

      {/* Product preview on a light patterned stage */}
      <Reveal>
        <section className="brand-pattern-light relative flex justify-center overflow-hidden rounded-3xl border border-border bg-surface px-6 py-10">
          <HeroDashboardIllustration size={420} />
        </section>
      </Reveal>

      <Reveal>
        <section className="grid gap-4 sm:grid-cols-3">
          {steps.map((s, i) => (
            <article key={s.title} className="panel-shadow rounded-2xl border border-border bg-surface p-6">
              <p className="flex size-10 items-center justify-center rounded-full bg-teal-50 font-extrabold text-teal-700 dark:bg-surface-muted dark:text-teal-300">
                <span className="tnum" dir="ltr">{i + 1}</span>
              </p>
              <h2 className="mt-4 text-lg font-extrabold">{s.title}</h2>
              <p className="mt-1.5 text-text-muted">{s.body}</p>
            </article>
          ))}
        </section>
      </Reveal>

      <footer className="mt-auto flex flex-col items-center gap-2 pt-2 text-center text-sm text-text-muted">
        <BrandMark variant="mono" size={28} />
        <p>{BRAND.name} — {t("heroTagline")}</p>
      </footer>
    </main>
  );
}
