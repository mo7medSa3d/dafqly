"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { LazyMotion, MotionConfig, domAnimation, m } from "motion/react";
import { ThemeToggle } from "./ThemeToggle";
import { LocaleToggle } from "./LocaleToggle";
import { BrandMark } from "./BrandMark";
import { ArrowLeft, ArrowRight, Check, List, LockKey, ShieldCheck, Sparkle, X } from "@/components/ui/solid-icons";
import { AutomationEngineSvg, HeroCashflowSvg, LedgerScanSvg, PortalFlowSvg } from "./landing-art";

/* ------------------------------------------------------------------ copy */

interface SpotlightItem {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
}

interface Copy {
  nav: { capabilities: string; workflow: string; start: string; login: string; menu: string; primaryLabel: string; mobileLabel: string };
  hero: { badge: string; title: string; sub: string; cta: string; secondary: string; note: string };
  trustLabel: string;
  trust: string[];
  spotlights: SpotlightItem[];
  workflow: { title: string; steps: { num: string; title: string; body: string }[] };
  cta: { title: string; sub: string; biz: string; bizPh: string; email: string; emailPh: string; button: string; errBiz: string; errEmail: string; perks: string[] };
  footer: string;
}

const COPY: Record<"ar" | "en", Copy> = {
  ar: {
    nav: { capabilities: "القدرات", workflow: "كيف يعمل", start: "ابدأ مجاناً", login: "دخول", menu: "القائمة", primaryLabel: "التنقل الرئيسي", mobileLabel: "قائمة الجوال" },
    hero: {
      badge: "منصة التحصيل والسيولة الذكية",
      title: "حصّل مستحقاتك في ميعادها، من غير مطاردة يدوية.",
      sub: "دفقلي يربط تذكيرات الواتساب، متابعة الشيكات، وكشوف الحساب الإلكترونية مع مساعد ذكي يرتب أولوياتك اليومية.",
      cta: "ابدأ مجاناً",
      secondary: "استكشف المنصة",
      note: "بدون بطاقة بنكية — كل إجراء ذكي ينتظر موافقتك.",
    },
    trustLabel: "ضمانات المنصة",
    trust: [
      "لا تذكير مكرر لنفس الفاتورة",
      "احترام ساعات الهدوء وأيام الإجازة",
      "عزل كامل لبيانات كل منشأة",
      "موافقتك قبل أي إرسال أو مهمة",
    ],
    spotlights: [
      {
        id: "automation",
        eyebrow: "الأتمتة والمساعد الذكي",
        title: "تذكيرات منضبطة ومساعد يقرأ دفترك لحظياً",
        body: "نظام متابعة يرسل رسائل واتساب مهذبة في الأوقات المسموحة، مع AI Copilot يحلل المخاطر ويقترح خطط تقسيط ويرسل تنبيهات لفريقك.",
        points: [
          "جدولة تلقائية تحترم ساعات الهدوء والعملاء الموقوفين",
          "إجابات فورية عن المتأخرات وتوقعات السيولة والاعتراضات",
          "صلاحيات واضحة: الذكاء يقترح وأنت تعتمد بضغطة",
        ],
      },
      {
        id: "ledger",
        eyebrow: "رقمنة الدفاتر والشيكات",
        title: "من الدفتر الورقي وإيصالات التحويل إلى قيود دقيقة",
        body: "صوّر صفحة الدفتر أو إيصال التحويل البنكي ليتم تفريغها ومراجعتها مع متابعة كاملة لمواعيد استحقاق الشيكات.",
        points: [
          "قراءة ذكية للدفاتر والشيكات مع إحالة أي شك للمراجعة البشرية",
          "منع تكرار الإيصالات وكشف التلاعب في المراجع البنكية",
          "تنبيهات مبكرة قبل موعد إيداع الشيك أو عند ارتداده",
        ],
      },
      {
        id: "portal",
        eyebrow: "بوابة العميل والدفع الفوري",
        title: "رابط كشف حساب يسرّع السداد ويحفظ علاقتك بالعميل",
        body: "امنح كل عميل رابطاً آمناً يراجع منه فواتيره المفتوحة، يحدد موعد السداد، أو يسدد عبر الدفع الإلكتروني فوراً.",
        points: [
          "سجل شفاف للفواتير والمدفوعات المتبقية بدون مكالمات",
          "مطابقة آمنة: تحويلات العميل تبقى ادّعاءً حتى تؤكدها",
          "إدارة الاعتراضات والتعهدات داخل نفس مساحة العمل",
        ],
      },
    ],
    workflow: {
      title: "ابدأ التشغيل في ٣ خطوات",
      steps: [
        { num: "01", title: "اربط بياناتك", body: "استورد عملاءك من ملف Excel أو صوّر دفترك الورقي." },
        { num: "02", title: "اضبط سياسة المتابعة", body: "حدد نبرة الرسائل وساعات الهدوء والعملة الافتراضية." },
        { num: "03", title: "راقب التدفق النقدي", body: "اعتمد التذكيرات والدفعات وأغلق الفواتير أولاً بأول." },
      ],
    },
    cta: {
      title: "جاهز لتسريع تحصيل منشأتك؟",
      sub: "أنشئ مساحة عملك في دقيقة واحدة وجرّب النظام مجاناً.",
      biz: "اسم المنشأة",
      bizPh: "مثال: شركة النور للتجارة",
      email: "البريد الإلكتروني",
      emailPh: "name@company.com",
      button: "إنشاء حساب مجاني",
      errBiz: "اكتب اسم منشأتك.",
      errEmail: "أدخل بريداً إلكترونياً صحيحاً.",
      perks: ["حتى 50 عميل مجاناً", "روابط كشف حساب آمنة", "متابعة فواتير وشيكات وتقارير سيولة"],
    },
    footer: "دفقلي. كل الحقوق محفوظة.",
  },
  en: {
    nav: { capabilities: "Capabilities", workflow: "How it works", start: "Start free", login: "Log in", menu: "Menu", primaryLabel: "Primary", mobileLabel: "Mobile" },
    hero: {
      badge: "B2B Collections & Cashflow Platform",
      title: "Get paid on time, without manual chasing.",
      sub: "Dafqly connects WhatsApp reminders, cheque tracking, and customer statement portals with an AI copilot built for your ledger.",
      cta: "Start free",
      secondary: "Explore platform",
      note: "No credit card required — AI acts only after your approval.",
    },
    trustLabel: "Guarantees",
    trust: [
      "Zero duplicate invoice reminders",
      "Quiet hours & holidays respected",
      "Strict per-tenant data isolation",
      "Human approval before every action",
    ],
    spotlights: [
      {
        id: "automation",
        eyebrow: "Automation & AI Copilot",
        title: "Disciplined follow-ups backed by live ledger intelligence",
        body: "Send polite WhatsApp reminders only during allowed business windows, while your AI copilot scores risks, builds installment plans, and alerts your team.",
        points: [
          "Automated cadence that honors quiet hours and opt-outs",
          "Instant answers on overdue accounts, forecasts, and disputes",
          "Safe by design: AI proposes actions, owners approve with one click",
        ],
      },
      {
        id: "ledger",
        eyebrow: "Ledger OCR & Cheques",
        title: "Turn paper ledgers and bank receipts into clean records",
        body: "Snap paper ledger pages or transfer receipts for structured extraction, while tracking post-dated cheques from receipt to clearing.",
        points: [
          "AI extraction routes low-confidence fields straight to review",
          "Duplicate receipt and reference-number fraud checks",
          "Early alerts before cheque deposit dates or bounced items",
        ],
      },
      {
        id: "portal",
        eyebrow: "Customer Portal & Checkout",
        title: "Self-serve statements that speed up settlement",
        body: "Share a secure link where customers view open balances, promise a payment date, or settle immediately via electronic payment.",
        points: [
          "Clear invoice and payment history without back-and-forth calls",
          "Verified reconciliation: customer claims stay pending until confirmed",
          "Disputes and payment promises tracked in one workspace",
        ],
      },
    ],
    workflow: {
      title: "Up and running in 3 steps",
      steps: [
        { num: "01", title: "Import your ledger", body: "Upload an Excel/CSV sheet or scan a paper ledger page." },
        { num: "02", title: "Set your policy", body: "Choose reminder tone, quiet hours, and workspace currency." },
        { num: "03", title: "Track & collect", body: "Approve suggested actions and close invoices as cash arrives." },
      ],
    },
    cta: {
      title: "Ready to accelerate your collections?",
      sub: "Create your workspace in under a minute and try it free.",
      biz: "Business name",
      bizPh: "e.g. Al-Noor Trading",
      email: "Email address",
      emailPh: "name@company.com",
      button: "Create free account",
      errBiz: "Enter your business name.",
      errEmail: "Enter a valid email address.",
      perks: ["Up to 50 debtors free", "Secure customer statement links", "Invoices, cheques & cashflow forecast"],
    },
    footer: "Dafqly. All rights reserved.",
  },
};

const SPOTLIGHT_ART = [AutomationEngineSvg, LedgerScanSvg, PortalFlowSvg] as const;

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());

const fadeUp = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const } },
};

/* ------------------------------------------------------------------ page */

export function DafqlyLanding() {
  const locale = useLocale();
  const router = useRouter();
  const ar = locale === "ar";
  const c = COPY[ar ? "ar" : "en"];
  const Arrow = ar ? ArrowLeft : ArrowRight;

  const [menu, setMenu] = React.useState(false);
  const [biz, setBiz] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [error, setError] = React.useState<{ field: "biz" | "email"; msg: string } | null>(null);

  React.useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  const links = [
    { href: "#capabilities", label: c.nav.capabilities },
    { href: "#workflow", label: c.nav.workflow },
  ];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!biz.trim()) return setError({ field: "biz", msg: c.cta.errBiz });
    if (!isEmail(email)) return setError({ field: "email", msg: c.cta.errEmail });
    try {
      window.localStorage.setItem("dafqly:workspace-card", JSON.stringify({ businessName: biz.trim(), email: email.trim() }));
    } catch {
      // Non-fatal in private browsing
    }
    const q = new URLSearchParams({ business: biz.trim(), email: email.trim() });
    router.push(`/${locale}/signup?${q.toString()}`);
  };

  const btnSolid = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover";
  const btnLine = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border-strong px-5 text-sm font-bold text-foreground transition-colors hover:bg-muted";
  const field = "min-h-11 w-full rounded-lg border border-border-strong bg-background px-3.5 text-sm text-foreground placeholder:text-text-subtle focus:border-primary focus:ring-4 focus:ring-primary/15 focus:outline-none aria-invalid:border-danger aria-invalid:ring-danger/15";

  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        <div dir={ar ? "rtl" : "ltr"} className="min-h-screen bg-background text-foreground">
          {/* HEADER */}
          <header className="glass sticky top-0 z-40 border-b border-border">
            <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
              <a href="#top" className="flex items-center gap-2.5 font-extrabold tracking-tight">
                <BrandMark size={30} />
                <span>{ar ? "دفقلي" : "DAFQLY"}</span>
              </a>
              <nav className="ms-6 hidden items-center gap-1 md:flex" aria-label={c.nav.primaryLabel}>
                {links.map((l) => (
                  <a key={l.href} href={l.href} className="rounded-md px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                    {l.label}
                  </a>
                ))}
              </nav>
              <div className="ms-auto flex items-center gap-2">
                <ThemeToggle size="sm" />
                <LocaleToggle currentLocale={locale} className="min-h-[36px] rounded-md px-3 text-xs" />
                <Link data-testid="landing-cta-login" href={`/${locale}/login`} className="hidden px-2.5 text-sm font-bold text-muted-foreground transition-colors hover:text-foreground sm:inline-block">
                  {c.nav.login}
                </Link>
                <Link data-testid="landing-cta-signup" href={`/${locale}/signup`} className={`${btnSolid} !min-h-9 hidden sm:inline-flex`}>
                  {c.nav.start}
                </Link>
                <button
                  type="button"
                  className="grid size-9 place-items-center rounded-md border border-border md:hidden"
                  aria-expanded={menu}
                  aria-controls="mobile-nav"
                  aria-label={c.nav.menu}
                  onClick={() => setMenu((prev) => !prev)}
                >
                  {menu ? <X size={18} /> : <List size={18} />}
                </button>
              </div>
            </div>
            {menu && (
              <nav id="mobile-nav" className="border-t border-border bg-background px-4 py-3 md:hidden" aria-label={c.nav.mobileLabel}>
                {links.map((l) => (
                  <a key={l.href} href={l.href} onClick={() => setMenu(false)} className="block rounded-md px-3 py-3 text-sm font-semibold hover:bg-muted">
                    {l.label}
                  </a>
                ))}
                <Link href={`/${locale}/login`} onClick={() => setMenu(false)} className="block rounded-md px-3 py-3 text-sm font-semibold hover:bg-muted">
                  {c.nav.login}
                </Link>
                <Link href={`/${locale}/signup`} onClick={() => setMenu(false)} className={`${btnSolid} mt-2 w-full`}>{c.nav.start}</Link>
              </nav>
            )}
          </header>

          <main id="top">
            {/* HERO */}
            <section className="relative overflow-hidden border-b border-border">
              <div className="hero-glow pointer-events-none absolute inset-0" aria-hidden="true" />
              <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-14 sm:px-6 lg:grid-cols-12 lg:py-24">
                <m.div
                  initial="hidden"
                  animate="visible"
                  variants={fadeUp}
                  className="lg:col-span-6"
                >
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted px-3 py-1 text-xs font-bold text-primary">
                    <Sparkle size={14} />
                    {c.hero.badge}
                  </span>
                  <h1 className="mt-5 text-3xl font-extrabold leading-[1.2] tracking-tight sm:text-5xl">
                    {c.hero.title}
                  </h1>
                  <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
                    {c.hero.sub}
                  </p>
                  <div className="mt-8 flex flex-wrap gap-3">
                    <Link data-testid="landing-hero-signup" href={`/${locale}/signup`} className={btnSolid}>
                      {c.hero.cta}
                      <Arrow size={16} />
                    </Link>
                    <a href="#capabilities" className={btnLine}>{c.hero.secondary}</a>
                  </div>
                  <p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
                    <ShieldCheck size={16} className="shrink-0 text-primary" />
                    {c.hero.note}
                  </p>
                </m.div>

                <m.div
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                  className="lg:col-span-6"
                >
                  <HeroCashflowSvg />
                </m.div>
              </div>
            </section>

            {/* TRUST BAR */}
            <section aria-label={c.trustLabel} className="border-b border-border bg-muted/60">
              <ul className="mx-auto grid max-w-6xl gap-4 px-4 py-5 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
                {c.trust.map((item) => (
                  <li key={item} className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90">
                    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
                      <Check size={12} strokeWidth={3} />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </section>

            {/* ALTERNATING CAPABILITY SPOTLIGHTS */}
            <section id="capabilities" className="mx-auto max-w-6xl scroll-mt-20 divide-y divide-border px-4 sm:px-6">
              {c.spotlights.map((item, idx) => {
                const SvgArt = SPOTLIGHT_ART[idx]!;
                const reversed = idx % 2 === 1;
                return (
                  <m.div
                    key={item.id}
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true, amount: 0.2 }}
                    variants={fadeUp}
                    className="grid items-center gap-10 py-16 lg:grid-cols-12 lg:gap-14 lg:py-24"
                  >
                    <div className={reversed ? "lg:order-2 lg:col-span-6" : "lg:col-span-6"}>
                      <span className={`text-xs font-extrabold text-primary ${ar ? "" : "uppercase tracking-wider"}`}>
                        {item.eyebrow}
                      </span>
                      <h2 className="mt-3 text-2xl font-extrabold leading-snug sm:text-3xl">
                        {item.title}
                      </h2>
                      <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                        {item.body}
                      </p>
                      <ul className="mt-6 space-y-3">
                        {item.points.map((pt) => (
                          <li key={pt} className="flex items-start gap-2.5 text-sm font-medium text-foreground/90">
                            <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                              <Check size={12} strokeWidth={3} />
                            </span>
                            <span>{pt}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className={reversed ? "lg:order-1 lg:col-span-6" : "lg:col-span-6"}>
                      <SvgArt />
                    </div>
                  </m.div>
                );
              })}
            </section>

            {/* WORKFLOW */}
            <section id="workflow" className="scroll-mt-20 border-y border-border bg-muted/40">
              <m.div
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, amount: 0.2 }}
                variants={fadeUp}
                className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20"
              >
                <h2 className="text-2xl font-extrabold sm:text-3xl">{c.workflow.title}</h2>
                <ol className="mt-10 grid gap-8 md:grid-cols-3">
                  {c.workflow.steps.map((step) => (
                    <li key={step.num} className="relative border-s-2 border-primary/30 ps-5">
                      <span className="tnum font-mono text-xs font-extrabold tracking-widest text-primary">
                        {step.num}
                      </span>
                      <h3 className="mt-2 text-lg font-bold">{step.title}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
                    </li>
                  ))}
                </ol>
              </m.div>
            </section>

            {/* CONVERSION CTA */}
            <section id="start" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 lg:py-24">
              <m.div
                initial="hidden"
                whileInView="visible"
                viewport={{ once: true, amount: 0.2 }}
                variants={fadeUp}
                className="grid gap-8 rounded-2xl border border-border bg-card p-6 sm:p-10 lg:grid-cols-12"
              >
                <div className="lg:col-span-6">
                  <h2 className="text-2xl font-extrabold sm:text-3xl">{c.cta.title}</h2>
                  <p className="mt-3 text-muted-foreground">{c.cta.sub}</p>
                  <ul className="mt-6 space-y-3">
                    {c.cta.perks.map((perk) => (
                      <li key={perk} className="flex items-center gap-2.5 text-sm font-semibold">
                        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
                          <Check size={12} strokeWidth={3} />
                        </span>
                        {perk}
                      </li>
                    ))}
                  </ul>
                </div>

                <form onSubmit={submit} noValidate className="space-y-3 self-center lg:col-span-6">
                  <label className="block text-sm font-bold">
                    {c.cta.biz}
                    <input
                      className={`${field} mt-1.5`}
                      value={biz}
                      placeholder={c.cta.bizPh}
                      aria-invalid={error?.field === "biz" || undefined}
                      aria-describedby={error?.field === "biz" ? "cta-form-error" : undefined}
                      onChange={(e) => { setBiz(e.target.value); setError(null); }}
                      autoComplete="organization"
                    />
                  </label>
                  <label className="block text-sm font-bold">
                    {c.cta.email}
                    <input
                      className={`${field} mt-1.5`}
                      type="email"
                      dir="ltr"
                      value={email}
                      placeholder={c.cta.emailPh}
                      aria-invalid={error?.field === "email" || undefined}
                      aria-describedby={error?.field === "email" ? "cta-form-error" : undefined}
                      onChange={(e) => { setEmail(e.target.value); setError(null); }}
                      autoComplete="email"
                    />
                  </label>
                  <p id="cta-form-error" role="alert" className="min-h-5 text-sm font-semibold text-danger">{error?.msg ?? ""}</p>
                  <button type="submit" className={`${btnSolid} w-full`}>
                    {c.cta.button}
                    <Arrow size={16} />
                  </button>
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <LockKey size={14} />
                    {c.hero.note}
                  </p>
                </form>
              </m.div>
            </section>
          </main>

          <footer className="border-t border-border">
            <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-muted-foreground sm:px-6">
              <span className="flex items-center gap-2">
                <BrandMark size={20} />
                © {new Date().getFullYear()} {c.footer}
              </span>
              <Link href={`/${locale}/login`} className="font-semibold transition-colors hover:text-foreground">
                {c.nav.login}
              </Link>
            </div>
          </footer>
        </div>
      </MotionConfig>
    </LazyMotion>
  );
}
