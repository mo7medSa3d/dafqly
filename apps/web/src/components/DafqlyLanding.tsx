"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import {
  LazyMotion,
  MotionConfig,
  domAnimation,
  m,
  AnimatePresence,
  useReducedMotion,
} from "motion/react";
import { ThemeToggle } from "./ThemeToggle";
import { LocaleToggle } from "./LocaleToggle";
import { BrandMark } from "./BrandMark";
import {
  ArrowLeft,
  ArrowRight,
  CaretDown,
  Check,
  List,
  LockKey,
  X,
  ShieldCheck,
  ChatCircleDots,
  Camera,
  CalendarCheck,
  CheckCircle,
} from "@/components/ui/solid-icons";

/* ------------------------------------------------------------------ */
/*  TYPES                                                              */
/* ------------------------------------------------------------------ */

interface CapabilityItem {
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  title: string;
  desc: string;
}

interface PlanItem {
  key: "trial" | "starter" | "growth";
  name: string;
  monthlyPrice: string;
  annualPrice: string;
  periodMonthly: string;
  periodAnnual: string;
  quota: string;
  featured?: boolean;
  features: string[];
}

interface FaqItem {
  q: string;
  a: string;
}

interface Copy {
  nav: {
    features: string;
    pricing: string;
    faq: string;
    login: string;
    start: string;
    menu: string;
    primaryLabel: string;
    mobileLabel: string;
  };
  hero: {
    title: string;
    sub: string;
    cta: string;
    secondary: string;
    trust: string[];
  };
  social: {
    headline: string;
    stats: { value: string; label: string }[];
  };
  capabilities: {
    title: string;
    sub: string;
    items: CapabilityItem[];
  };
  workflow: {
    title: string;
    steps: { title: string; desc: string }[];
  };
  pricing: {
    title: string;
    sub: string;
    monthly: string;
    annual: string;
    saveBadge: string;
    featured: string;
    cta: string;
    plans: PlanItem[];
  };
  faq: {
    title: string;
    items: FaqItem[];
  };
  cta: {
    title: string;
    sub: string;
    placeholder: string;
    button: string;
    invalidEmail: string;
    guarantee: string;
  };
  footer: string;
}

/* ------------------------------------------------------------------ */
/*  COPY — bilingual, global-first language                            */
/* ------------------------------------------------------------------ */

const COPY: Record<"ar" | "en", Copy> = {
  ar: {
    nav: {
      features: "المميزات",
      pricing: "الباقات",
      faq: "الأسئلة",
      login: "دخول",
      start: "ابدأ مجاناً",
      menu: "القائمة",
      primaryLabel: "التنقل الرئيسي",
      mobileLabel: "قائمة الجوال",
    },
    hero: {
      title: "حصّل مستحقاتك\nفي موعدها.",
      sub: "منصة واحدة ترسل تذكيرات واتساب برقم شركتك، تطابق إيصالات الدفع تلقائياً، وتتابع الشيكات المؤجلة — لتحصل على سيولة أسرع دون مكالمات ولا ملاحقة.",
      cta: "ابدأ تجربتك المجانية",
      secondary: "اكتشف كيف يعمل",
      trust: [
        "لا يتطلب بطاقة بنكية",
        "جاهز في دقيقتين",
        "عزل بيانات 100%",
      ],
    },
    social: {
      headline: "أرقام حقيقية من شركات تستخدم دفقلي",
      stats: [
        { value: "32%", label: "تسريع دورة التحصيل" },
        { value: "24", label: "يوم متوسط تحصيل (DSO)" },
        { value: "99.4%", label: "دقة مطابقة الإيصالات" },
        { value: "40+", label: "ساعة توفير شهرية" },
      ],
    },
    capabilities: {
      title: "كل ما تحتاجه لتحصيل أسرع",
      sub: "أربع قدرات أساسية في منصة واحدة، بدون تعقيد.",
      items: [
        {
          icon: ChatCircleDots,
          title: "تذكيرات واتساب ذكية",
          desc: "ربط مباشر مع WhatsApp Cloud API برقم شركتك. التذكيرات تُرسل في ساعات العمل، والذكاء الاصطناعي يفهم الردود ويؤجل تلقائياً عند الوعد بالسداد.",
        },
        {
          icon: Camera,
          title: "مطابقة الإيصالات بالذكاء الاصطناعي",
          desc: "ارفع إيصال تحويل أو صورة دفتر ورقي — النظام يقرأ البيانات ويطابقها مع الفواتير المفتوحة، مع كشف التكرار والتلاعب.",
        },
        {
          icon: CalendarCheck,
          title: "إدارة الشيكات المؤجلة",
          desc: "تنبيه قبل الاستحقاق بـ 72 ساعة، مع قراءة بيانات الشيك بالكاميرا. في حالة الارتداد، تُعاد الفاتورة مفتوحة ويرتفع مؤشر مخاطر العميل تلقائياً.",
        },
        {
          icon: ShieldCheck,
          title: "عزل كامل وأمان مصرفي",
          desc: "كل شركة معزولة بقواعد PostgreSQL Row-Level Security الإلزامية. قيود محاسبية غير قابلة للتعديل بدقة القروش والهللات.",
        },
      ],
    },
    workflow: {
      title: "كيف يعمل دفقلي",
      steps: [
        {
          title: "استورد فواتيرك",
          desc: "ارفع ملف Excel أو صوّر دفتر مديونيات ورقي. النظام يقرأ البيانات ويعرضها كمسودة للمراجعة.",
        },
        {
          title: "أرسل التذكيرات",
          desc: "يرسل النظام رسائل واتساب رسمية بقوالب معتمدة، ويفهم ردود العملاء لتأجيل أو إيقاف التذكير تلقائياً.",
        },
        {
          title: "طابق المدفوعات",
          desc: "العميل يرفع إيصال التحويل من بوابة كشف الحساب. الذكاء الاصطناعي يطابقه مع الفاتورة فوراً.",
        },
        {
          title: "تابع السيولة",
          desc: "لوحة تحكم موحدة بمؤشرات التحصيل والشيكات المؤجلة وتقارير التدفق النقدي.",
        },
      ],
    },
    pricing: {
      title: "باقات واضحة بدون مفاجآت",
      sub: "ابدأ مجاناً وتوسّع حسب حجم رسائلك ومعاملاتك.",
      monthly: "شهري",
      annual: "سنوي",
      saveBadge: "وفّر 20%",
      featured: "الأكثر اختياراً",
      cta: "اختر الباقة",
      plans: [
        {
          key: "trial",
          name: "تجريبية",
          monthlyPrice: "0",
          annualPrice: "0",
          periodMonthly: "/ 14 يوماً",
          periodAnnual: "/ 14 يوماً",
          quota: "100 رسالة واتساب",
          features: [
            "عملاء وفواتير غير محدودة",
            "بوابة كشف حساب إلكترونية",
            "مطابقة إيصالات بالذكاء الاصطناعي",
            "استيراد من Excel و CSV",
          ],
        },
        {
          key: "starter",
          name: "الأساسية",
          monthlyPrice: "49",
          annualPrice: "39",
          periodMonthly: "/ شهرياً",
          periodAnnual: "/ شهرياً",
          quota: "500 رسالة واتساب / شهر",
          featured: true,
          features: [
            "كل مزايا التجريبية",
            "ربط رقم WhatsApp الخاص بشركتك",
            "قراءة الدفاتر الورقية بالكاميرا",
            "إدارة الشيكات والتنبيهات",
            "دعم فني مخصص",
          ],
        },
        {
          key: "growth",
          name: "النمو",
          monthlyPrice: "149",
          annualPrice: "119",
          periodMonthly: "/ شهرياً",
          periodAnnual: "/ شهرياً",
          quota: "2,000 رسالة واتساب / شهر",
          features: [
            "كل مزايا الأساسية",
            "أولوية معالجة الذكاء الاصطناعي",
            "صلاحيات متعددة وسجل تدقيق",
            "تصدير بيانات كامل",
            "تقارير تدفقات نقدية متقدمة",
          ],
        },
      ],
    },
    faq: {
      title: "أسئلة شائعة",
      items: [
        {
          q: "هل تمر أموال العملاء عبر دفقلي؟",
          a: "لا. العملاء يحوّلون مباشرة إلى حسابك البنكي. دفقلي منصة متابعة وتحصيل فقط، بدون أي وساطة مالية.",
        },
        {
          q: "هل أستطيع استخدام رقم واتساب الخاص بشركتي؟",
          a: "نعم. المنصة تتكامل مع WhatsApp Cloud API المعتمد من Meta. كل شركة تربط رقمها الخاص وترسل باسمها وهويتها التجارية.",
        },
        {
          q: "هل الذكاء الاصطناعي يعتمد الإيصالات تلقائياً؟",
          a: "لا. كل الاستخراجات تنزل كمسودات تتطلب مراجعة بشرية. إيصالات العملاء تُسجل كادعاء بانتظار تأكيدك.",
        },
        {
          q: "كيف تضمنون خصوصية بيانات شركتي؟",
          a: "نستخدم PostgreSQL Row-Level Security الإلزامية. لا يمكن لأي مستأجر استعلام أو تعديل أي صف يخص مستأجراً آخر.",
        },
        {
          q: "ماذا يحدث عند ارتداد شيك بنكي؟",
          a: "يُعيد النظام فتح رصيد الفاتورة المرتبطة، ويرفع مؤشر مخاطر المدين، ويولّد مهمة عاجلة لفريق التحصيل.",
        },
      ],
    },
    cta: {
      title: "جاهز لتنظيم تحصيلاتك؟",
      sub: "أنشئ مساحة عملك في أقل من دقيقتين.",
      placeholder: "بريدك الإلكتروني",
      button: "ابدأ مجاناً",
      invalidEmail: "يرجى إدخال بريد إلكتروني صحيح.",
      guarantee: "بدون بطاقة بنكية · تجربة مجانية 14 يوماً",
    },
    footer: "دفقلي — منصة تحصيل B2B ذكية",
  },
  en: {
    nav: {
      features: "Features",
      pricing: "Pricing",
      faq: "FAQ",
      login: "Sign in",
      start: "Start free",
      menu: "Menu",
      primaryLabel: "Primary navigation",
      mobileLabel: "Mobile navigation",
    },
    hero: {
      title: "Get paid\non time.",
      sub: "One platform to send WhatsApp reminders from your business number, auto-match payment receipts, and track post-dated cheques — so you get paid faster without chasing.",
      cta: "Start free trial",
      secondary: "See how it works",
      trust: [
        "No credit card required",
        "Ready in 2 minutes",
        "100% data isolation",
      ],
    },
    social: {
      headline: "Real numbers from teams using Dafqly",
      stats: [
        { value: "32%", label: "Faster collection cycle" },
        { value: "24", label: "Day average DSO" },
        { value: "99.4%", label: "Receipt match accuracy" },
        { value: "40+", label: "Hours saved per month" },
      ],
    },
    capabilities: {
      title: "Everything you need to collect faster",
      sub: "Four core capabilities in one platform, no complexity.",
      items: [
        {
          icon: ChatCircleDots,
          title: "Smart WhatsApp reminders",
          desc: "Direct WhatsApp Cloud API integration with your business number. Reminders go out during safe hours, and AI classifies replies to auto-defer on payment promises.",
        },
        {
          icon: Camera,
          title: "AI receipt matching",
          desc: "Upload a transfer receipt or snap a paper ledger — the system reads it, matches it to open invoices, and flags duplicates or tampering.",
        },
        {
          icon: CalendarCheck,
          title: "Post-dated cheque tracking",
          desc: "72-hour advance maturity alerts with camera OCR pre-fill. Bounced cheques instantly reopen the invoice and escalate the debtor's risk rating.",
        },
        {
          icon: ShieldCheck,
          title: "Bank-grade isolation",
          desc: "Every tenant is enforced by PostgreSQL Row-Level Security. Immutable journal entries with integer minor-unit precision.",
        },
      ],
    },
    workflow: {
      title: "How Dafqly works",
      steps: [
        {
          title: "Import your invoices",
          desc: "Upload an Excel file or snap a paper ledger. The system reads it and shows a draft for your review.",
        },
        {
          title: "Send reminders",
          desc: "Official WhatsApp templates go out on schedule. AI understands customer replies to defer or stop automatically.",
        },
        {
          title: "Match payments",
          desc: "Customers upload receipts via a branded portal. AI matches them to open invoices instantly.",
        },
        {
          title: "Track cashflow",
          desc: "A unified dashboard with collection KPIs, cheque maturity, and cashflow forecasts.",
        },
      ],
    },
    pricing: {
      title: "Simple pricing, no surprises",
      sub: "Start free and scale with your volume.",
      monthly: "Monthly",
      annual: "Annual",
      saveBadge: "Save 20%",
      featured: "Most popular",
      cta: "Select plan",
      plans: [
        {
          key: "trial",
          name: "Trial",
          monthlyPrice: "0",
          annualPrice: "0",
          periodMonthly: "/ 14 days",
          periodAnnual: "/ 14 days",
          quota: "100 WhatsApp messages",
          features: [
            "Unlimited debtors and invoices",
            "Customer statement portal",
            "AI receipt verification",
            "Excel and CSV import",
          ],
        },
        {
          key: "starter",
          name: "Starter",
          monthlyPrice: "49",
          annualPrice: "39",
          periodMonthly: "/ month",
          periodAnnual: "/ month",
          quota: "500 messages / month",
          featured: true,
          features: [
            "Everything in Trial",
            "Your own WhatsApp Cloud API number",
            "Paper ledger OCR with camera",
            "Cheque tracking and alerts",
            "Dedicated support",
          ],
        },
        {
          key: "growth",
          name: "Growth",
          monthlyPrice: "149",
          annualPrice: "119",
          periodMonthly: "/ month",
          periodAnnual: "/ month",
          quota: "2,000 messages / month",
          features: [
            "Everything in Starter",
            "Priority AI processing",
            "Multi-user permissions and audit trail",
            "Full data export",
            "Advanced cashflow analytics",
          ],
        },
      ],
    },
    faq: {
      title: "Questions and answers",
      items: [
        {
          q: "Do customer payments pass through Dafqly?",
          a: "No. Customers transfer directly to your bank account. Dafqly is a collection and tracking platform only — no financial intermediary.",
        },
        {
          q: "Can I use my own WhatsApp business number?",
          a: "Yes. Dafqly connects directly to Meta's WhatsApp Cloud API. Each tenant connects their own number and sends under their brand.",
        },
        {
          q: "Does AI approve receipts automatically?",
          a: "No. All extractions land as drafts requiring human review. Customer receipts are recorded as claims awaiting your approval.",
        },
        {
          q: "How do you guarantee data privacy?",
          a: "Every query runs inside PostgreSQL transactions enforced by mandatory Row-Level Security. Tenants cannot access each other's data.",
        },
        {
          q: "What happens when a cheque bounces?",
          a: "The system reopens the associated invoice, escalates the debtor's risk rating, and creates an urgent task for your team.",
        },
      ],
    },
    cta: {
      title: "Ready to get paid on time?",
      sub: "Create your workspace in under two minutes.",
      placeholder: "Your work email",
      button: "Start free",
      invalidEmail: "Please enter a valid email.",
      guarantee: "No credit card · 14-day free trial",
    },
    footer: "Dafqly — Smart B2B Receivables Platform",
  },
};

/* ------------------------------------------------------------------ */
/*  COMPONENT                                                          */
/* ------------------------------------------------------------------ */

export function DafqlyLanding({ locale: propLocale }: { locale?: string }) {
  const router = useRouter();
  const intlLocale = useLocale();
  const locale =
    propLocale === "en" || propLocale === "ar"
      ? propLocale
      : intlLocale === "en"
        ? "en"
        : "ar";
  const isAr = locale === "ar";
  const c = COPY[locale];
  const Arrow = isAr ? ArrowLeft : ArrowRight;

  const shouldReduceMotion = useReducedMotion();

  const [menuOpen, setMenuOpen] = React.useState(false);
  const [billingPeriod, setBillingPeriod] = React.useState<"monthly" | "annual">("annual");
  const [openFaq, setOpenFaq] = React.useState<number | null>(null);
  const [email, setEmail] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const easeOut: [number, number, number, number] = [0.23, 1, 0.32, 1];

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError(c.cta.invalidEmail);
      return;
    }
    setError(null);
    router.push(`/${locale}/signup?email=${encodeURIComponent(trimmed)}`);
  }

  /* ---- shared styles ---- */
  const pill =
    "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full px-6 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const btnPrimary = `${pill} bg-foreground text-background hover:bg-foreground/90`;
  const btnSecondary = `${pill} border border-border bg-card text-foreground hover:bg-accent`;
  const wrap = "mx-auto w-full max-w-[1200px] px-5 sm:px-8 lg:px-12";

  return (
    <LazyMotion features={domAnimation}>
      <MotionConfig reducedMotion="user">
        <div className="relative min-h-screen w-full bg-background text-foreground antialiased">
          {/* ───── Navbar ───── */}
          <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/80 backdrop-blur-xl">
            <div className={`${wrap} flex h-14 items-center justify-between gap-4`}>
              <Link
                href={`/${locale}`}
                className="flex shrink-0 items-center gap-2 text-base font-bold tracking-tight"
              >
                <BrandMark size={24} />
                <span className="text-[15px] font-black tracking-wide">DAFQLY</span>
              </Link>

              <nav aria-label={c.nav.primaryLabel} className="hidden items-center gap-7 text-[13px] font-medium text-muted-foreground md:flex">
                <a href="#features" className="transition-colors hover:text-foreground">{c.nav.features}</a>
                <a href="#pricing" className="transition-colors hover:text-foreground">{c.nav.pricing}</a>
                <a href="#faq" className="transition-colors hover:text-foreground">{c.nav.faq}</a>
              </nav>

              <div className="flex items-center gap-2">
                <ThemeToggle />
                <LocaleToggle currentLocale={locale} />
                <Link
                  data-testid="landing-cta-login"
                  href={`/${locale}/login`}
                  className="hidden text-[13px] font-semibold text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
                >
                  {c.nav.login}
                </Link>
                <Link
                  data-testid="landing-cta-signup"
                  href={`/${locale}/signup`}
                  className="inline-flex min-h-8 items-center rounded-full bg-foreground px-4 text-xs font-semibold text-background transition-colors hover:bg-foreground/90"
                >
                  {c.nav.start}
                </Link>
                <button
                  type="button"
                  aria-label={c.nav.menu}
                  aria-expanded={menuOpen}
                  aria-controls="mobile-nav"
                  onClick={() => setMenuOpen((v) => !v)}
                  className="inline-flex size-10 items-center justify-center rounded-full border border-border text-foreground md:hidden"
                >
                  {menuOpen ? <X size={16} /> : <List size={16} />}
                </button>
              </div>
            </div>

            {/* Mobile nav */}
            <AnimatePresence>
              {menuOpen && (
                <m.nav
                  id="mobile-nav"
                  aria-label={c.nav.mobileLabel}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2, ease: easeOut }}
                  className="overflow-hidden border-t border-border bg-background px-5 py-4 md:hidden"
                >
                  <div className="flex flex-col gap-3 text-sm font-medium">
                    <a href="#features" onClick={() => setMenuOpen(false)} className="py-2 text-muted-foreground">{c.nav.features}</a>
                    <a href="#pricing" onClick={() => setMenuOpen(false)} className="py-2 text-muted-foreground">{c.nav.pricing}</a>
                    <a href="#faq" onClick={() => setMenuOpen(false)} className="py-2 text-muted-foreground">{c.nav.faq}</a>
                    <div className="mt-2 flex gap-3 border-t border-border pt-4">
                      <Link href={`/${locale}/login`} onClick={() => setMenuOpen(false)} className={`${btnSecondary} flex-1 text-center`}>{c.nav.login}</Link>
                      <Link href={`/${locale}/signup`} onClick={() => setMenuOpen(false)} className={`${btnPrimary} flex-1 text-center`}>{c.nav.start}</Link>
                    </div>
                  </div>
                </m.nav>
              )}
            </AnimatePresence>
          </header>

          <main className="w-full">
            {/* ───── 1. HERO ───── */}
            <section className="w-full pb-20 pt-20 sm:pt-28 lg:pt-36">
              <div className={`${wrap} flex flex-col items-center text-center`}>
                <m.h1
                  initial={shouldReduceMotion ? false : { opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, ease: easeOut }}
                  className="max-w-3xl whitespace-pre-line text-[clamp(2.5rem,6vw,5rem)] font-black leading-[1.05] tracking-[-0.04em]"
                >
                  {c.hero.title}
                </m.h1>

                <m.p
                  initial={shouldReduceMotion ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.06, ease: easeOut }}
                  className="mt-6 max-w-xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg"
                >
                  {c.hero.sub}
                </m.p>

                <m.div
                  initial={shouldReduceMotion ? false : { opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.12, ease: easeOut }}
                  className="mt-8 flex w-full max-w-sm flex-col items-center gap-3 sm:max-w-none sm:flex-row sm:justify-center"
                >
                  <Link href={`/${locale}/signup`} className={btnPrimary}>
                    <span>{c.hero.cta}</span>
                    <Arrow size={15} />
                  </Link>
                  <a href="#features" className={btnSecondary}>
                    {c.hero.secondary}
                  </a>
                </m.div>

                {/* Trust signals — simple inline text, no decoration */}
                <m.div
                  initial={shouldReduceMotion ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.6, delay: 0.2, ease: easeOut }}
                  className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-xs text-muted-foreground"
                >
                  {c.hero.trust.map((t) => (
                    <span key={t} className="flex items-center gap-1.5">
                      <CheckCircle size={13} className="text-foreground/40" aria-hidden />
                      {t}
                    </span>
                  ))}
                </m.div>
              </div>
            </section>

            {/* ───── 2. SOCIAL PROOF STATS ───── */}
            <section className="w-full border-y border-border/60">
              <div className={`${wrap} py-14 sm:py-16`}>
                <p className="text-center text-sm font-medium text-muted-foreground">
                  {c.social.headline}
                </p>
                <div className="mt-8 grid grid-cols-2 gap-6 sm:grid-cols-4">
                  {c.social.stats.map((s) => (
                    <div key={s.label} className="flex flex-col items-center gap-1 text-center">
                      <span className="tabular-nums text-3xl font-black tracking-tight text-foreground sm:text-4xl" dir="ltr">
                        {s.value}
                      </span>
                      <span className="text-xs font-medium text-muted-foreground">
                        {s.label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* ───── 3. CAPABILITIES GRID ───── */}
            <section id="features" className="w-full py-20 sm:py-28">
              <div className={wrap}>
                <div className="max-w-lg">
                  <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl lg:text-4xl">
                    {c.capabilities.title}
                  </h2>
                  <p className="mt-3 text-base text-muted-foreground">
                    {c.capabilities.sub}
                  </p>
                </div>

                <div className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-2">
                  {c.capabilities.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <div
                        key={item.title}
                        className="flex flex-col gap-3 bg-card p-7 sm:p-9"
                      >
                        <span className="inline-flex size-10 items-center justify-center rounded-xl bg-muted text-foreground">
                          <Icon size={20} />
                        </span>
                        <h3 className="text-lg font-bold">{item.title}</h3>
                        <p className="text-sm leading-relaxed text-muted-foreground">
                          {item.desc}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* ───── 4. HOW IT WORKS ───── */}
            <section className="w-full border-y border-border/60 bg-muted/40 py-20 sm:py-28">
              <div className={wrap}>
                <h2 className="text-center text-2xl font-extrabold tracking-tight sm:text-3xl">
                  {c.workflow.title}
                </h2>

                <div className="mx-auto mt-12 grid max-w-3xl grid-cols-1 gap-8 sm:grid-cols-2">
                  {c.workflow.steps.map((step, i) => (
                    <div key={step.title} className="flex gap-4">
                      <span
                        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-bold text-background"
                        aria-hidden
                      >
                        {i + 1}
                      </span>
                      <div>
                        <h3 className="text-sm font-bold">{step.title}</h3>
                        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                          {step.desc}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* ───── 5. PRICING ───── */}
            <section id="pricing" className="w-full py-20 sm:py-28">
              <div className={wrap}>
                <div className="flex flex-col items-center text-center">
                  <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl lg:text-4xl">
                    {c.pricing.title}
                  </h2>
                  <p className="mt-3 max-w-md text-base text-muted-foreground">
                    {c.pricing.sub}
                  </p>

                  {/* Billing toggle */}
                  <div className="mt-7 inline-flex items-center rounded-full border border-border bg-card p-1 text-sm">
                    <button
                      type="button"
                      aria-pressed={billingPeriod === "monthly"}
                      onClick={() => setBillingPeriod("monthly")}
                      className={`relative min-h-10 rounded-full px-4 py-1.5 font-semibold transition-colors ${
                        billingPeriod === "monthly" ? "text-background" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {billingPeriod === "monthly" && (
                        <m.span
                          layoutId="billing-pill"
                          transition={{ type: "spring", stiffness: 450, damping: 32 }}
                          className="absolute inset-0 rounded-full bg-foreground"
                          style={{ zIndex: 0 }}
                        />
                      )}
                      <span className="relative z-10">{c.pricing.monthly}</span>
                    </button>
                    <button
                      type="button"
                      aria-pressed={billingPeriod === "annual"}
                      onClick={() => setBillingPeriod("annual")}
                      className={`relative flex min-h-10 items-center gap-1.5 rounded-full px-4 py-1.5 font-semibold transition-colors ${
                        billingPeriod === "annual" ? "text-background" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {billingPeriod === "annual" && (
                        <m.span
                          layoutId="billing-pill"
                          transition={{ type: "spring", stiffness: 450, damping: 32 }}
                          className="absolute inset-0 rounded-full bg-foreground"
                          style={{ zIndex: 0 }}
                        />
                      )}
                      <span className="relative z-10">{c.pricing.annual}</span>
                      <span className="relative z-10 rounded-full bg-status-paid-bg px-2 py-0.5 text-[10px] font-bold text-status-paid-fg">
                        {c.pricing.saveBadge}
                      </span>
                    </button>
                  </div>
                </div>

                {/* Price cards */}
                <div className="mt-10 grid grid-cols-1 gap-5 lg:grid-cols-3">
                  {c.pricing.plans.map((p) => {
                    const price = billingPeriod === "annual" ? p.annualPrice : p.monthlyPrice;
                    const period = billingPeriod === "annual" ? p.periodAnnual : p.periodMonthly;
                    return (
                      <div
                        key={p.key}
                        className={`flex flex-col justify-between rounded-2xl border p-6 transition-colors sm:p-8 ${
                          p.featured
                            ? "border-foreground bg-foreground text-background"
                            : "border-border bg-card text-foreground hover:border-border-strong"
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="text-lg font-bold">{p.name}</h3>
                            {p.featured && (
                              <span className="rounded-full bg-background/15 px-3 py-0.5 text-xs font-semibold">
                                {c.pricing.featured}
                              </span>
                            )}
                          </div>

                          <div className="mt-5 flex items-baseline gap-1" dir="ltr">
                            <span className="tabular-nums text-3xl font-black tracking-tight sm:text-4xl">
                              {price === "0" ? (isAr ? "مجاناً" : "Free") : price}
                            </span>
                            {price !== "0" && (
                              <span className={`text-xs font-medium ${p.featured ? "text-background/60" : "text-muted-foreground"}`}>
                                {period}
                              </span>
                            )}
                          </div>

                          <p className={`mt-2 text-xs font-semibold ${p.featured ? "text-background/70" : "text-muted-foreground"}`}>
                            {p.quota}
                          </p>

                          <ul className={`mt-6 flex flex-col gap-3 border-t pt-6 text-sm ${p.featured ? "border-background/15" : "border-border"}`}>
                            {p.features.map((f) => (
                              <li key={f} className="flex items-start gap-2.5">
                                <Check
                                  size={15}
                                  className={`mt-0.5 shrink-0 ${p.featured ? "text-background/50" : "text-muted-foreground"}`}
                                  aria-hidden
                                />
                                <span>{f}</span>
                              </li>
                            ))}
                          </ul>
                        </div>

                        <Link
                          href={`/${locale}/signup?plan=${p.key}`}
                          className={`mt-8 inline-flex min-h-11 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                            p.featured
                              ? "bg-background text-foreground hover:bg-background/90"
                              : "border border-border bg-background text-foreground hover:bg-accent"
                          }`}
                        >
                          {c.pricing.cta}
                        </Link>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* ───── 6. FAQ ───── */}
            <section id="faq" className="w-full border-t border-border/60 py-20 sm:py-28">
              <div className={wrap}>
                <h2 className="text-center text-2xl font-extrabold tracking-tight sm:text-3xl">
                  {c.faq.title}
                </h2>

                <div className="mx-auto mt-10 max-w-2xl divide-y divide-border rounded-2xl border border-border">
                  {c.faq.items.map((item, idx) => {
                    const open = openFaq === idx;
                    return (
                      <div key={item.q} className="overflow-hidden">
                        <button
                          type="button"
                          aria-expanded={open}
                          aria-controls={`faq-panel-${idx}`}
                          onClick={() => setOpenFaq(open ? null : idx)}
                          className="flex min-h-11 w-full items-center justify-between gap-4 px-5 py-4 text-sm font-semibold transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:text-base"
                        >
                          <span className="text-start">{item.q}</span>
                          <CaretDown
                            size={16}
                            className={`shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
                            aria-hidden
                          />
                        </button>
                        <AnimatePresence initial={false}>
                          {open && (
                            <m.div
                              id={`faq-panel-${idx}`}
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: "auto" }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.2, ease: easeOut }}
                            >
                              <p className="px-5 pb-5 text-sm leading-relaxed text-muted-foreground">
                                {item.a}
                              </p>
                            </m.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* ───── 7. FINAL CTA ───── */}
            <section className="w-full border-t border-border/60 bg-foreground py-20 text-background sm:py-28">
              <div className={`${wrap} flex flex-col items-center text-center`}>
                <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
                  {c.cta.title}
                </h2>
                <p className="mt-3 max-w-md text-sm text-background/60">
                  {c.cta.sub}
                </p>

                <form
                  onSubmit={onSubmit}
                  className="mt-8 flex w-full max-w-md flex-col gap-3 sm:flex-row"
                  noValidate
                >
                  <input
                    type="email"
                    dir="ltr"
                    autoComplete="email"
                    aria-invalid={error ? true : undefined}
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setError(null); }}
                    placeholder={c.cta.placeholder}
                    aria-label={c.cta.placeholder}
                    className="min-h-11 flex-1 rounded-full border border-background/20 bg-background/10 px-5 text-start text-sm text-background placeholder:text-background/40 outline-none transition focus:border-background/40 focus:ring-2 focus:ring-background/20"
                  />
                  <button
                    type="submit"
                    className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-background px-6 text-sm font-semibold text-foreground transition-colors hover:bg-background/90"
                  >
                    <span>{c.cta.button}</span>
                    <Arrow size={15} />
                  </button>
                </form>
                {error && (
                  <p role="alert" className="mt-2 text-xs font-semibold text-status-overdue-bg">
                    {error}
                  </p>
                )}
                <p className="mt-4 flex items-center gap-1.5 text-xs text-background/50">
                  <LockKey size={12} aria-hidden />
                  {c.cta.guarantee}
                </p>
              </div>
            </section>
          </main>

          {/* ───── Footer ───── */}
          <footer className="w-full border-t border-border/60">
            <div className={`${wrap} flex flex-wrap items-center justify-between gap-4 py-6 text-xs text-muted-foreground`}>
              <span className="flex items-center gap-2">
                <BrandMark size={18} />
                <span>© {new Date().getFullYear()} {c.footer}</span>
              </span>
              <div className="flex items-center gap-5">
                <Link href={`/${locale}/login`} className="font-medium transition-colors hover:text-foreground">{c.nav.login}</Link>
                <Link href={`/${locale}/signup`} className="font-medium transition-colors hover:text-foreground">{c.nav.start}</Link>
              </div>
            </div>
          </footer>
        </div>
      </MotionConfig>
    </LazyMotion>
  );
}
