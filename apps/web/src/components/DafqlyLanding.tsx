"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { LazyMotion, MotionConfig, domAnimation, m } from "motion/react";
import { ThemeToggle } from "./ThemeToggle";
import { LocaleToggle } from "./LocaleToggle";
import { BrandMark } from "./BrandMark";
import { ArrowLeft, ArrowRight, CaretUp, Check, List, LockKey, ShieldCheck, Sparkle, X } from "@/components/ui/solid-icons";
import { AutomationEngineSvg, HeroCashflowSvg, LedgerScanSvg, PortalFlowSvg } from "./landing-art";

/* ------------------------------------------------------------------ copy */

interface StageItem {
  id: string;
  num: string;
  tab: string;
  title: string;
  body: string;
  points: string[];
}

interface PlanItem {
  key: "trial" | "starter" | "growth";
  name: string;
  price: string;
  period: string;
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
    lifecycle: string;
    calculator: string;
    pricing: string;
    faq: string;
    start: string;
    login: string;
    menu: string;
    primaryLabel: string;
    mobileLabel: string;
  };
  hero: {
    badge: string;
    title: string;
    sub: string;
    cta: string;
    secondary: string;
    note: string;
  };
  trustLabel: string;
  trust: string[];
  lifecycle: {
    eyebrow: string;
    title: string;
    stages: StageItem[];
  };
  calc: {
    eyebrow: string;
    title: string;
    sub: string;
    receivablesLabel: string;
    daysLabel: string;
    hoursLabel: string;
    currency: string;
    daysUnit: string;
    hoursUnit: string;
    outCashLabel: string;
    outHoursLabel: string;
    outNote: string;
    cta: string;
  };
  pricing: {
    eyebrow: string;
    title: string;
    sub: string;
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
    biz: string;
    bizPh: string;
    email: string;
    emailPh: string;
    button: string;
    errBiz: string;
    errEmail: string;
    perks: string[];
  };
  footer: string;
}

const COPY: Record<"ar" | "en", Copy> = {
  ar: {
    nav: {
      lifecycle: "دورة التحصيل",
      calculator: "حاسبة العائد",
      pricing: "الباقات",
      faq: "الأسئلة",
      start: "ابدأ مجاناً",
      login: "دخول",
      menu: "القائمة",
      primaryLabel: "التنقل الرئيسي",
      mobileLabel: "قائمة الجوال",
    },
    hero: {
      badge: "منصة تحصيل B2B وإدارة السيولة",
      title: "حصّل مستحقاتك في ميعادها، من غير مطاردة يدوية.",
      sub: "دفقلي يوحد استيراد الدفاتر، تذكيرات WhatsApp برقم منشأتك، مطابقة إيصالات التحويل بالذكاء الاصطناعي، ومتابعة الشيكات في نظام واحد.",
      cta: "ابدأ مجاناً",
      secondary: "احسب الوفر الشهري",
      note: "بدون بطاقة بنكية — كل إجراء ذكي ينتظر موافقتك.",
    },
    trustLabel: "ضمانات المنصة",
    trust: [
      "لا تذكير مكرر لنفس الفاتورة",
      "احترام ساعات الهدوء والإجازات",
      "عزل كامل لبيانات كل منشأة",
      "موافقتك قبل أي إرسال أو قيد",
    ],
    lifecycle: {
      eyebrow: "من الفاتورة إلى السيولة",
      title: "أربع مراحل مترابطة بلا تعقيد",
      stages: [
        {
          id: "import",
          num: "01",
          tab: "استيراد الدفتر",
          title: "ارفع Excel أو صوّر دفترك الورقي في ثوانٍ",
          body: "حوّل كشوف العملاء والفواتير المفتوحة إلى حسابات منظمة مع تطبيع تلقائي لأرقام الهواتف والعملات.",
          points: [
            "استيراد جماعي من CSV / Excel بدون إعادة تنسيق",
            "استخراج ذكي لبيانات الدفتر الورقي مع مراجعة الحقول غير المؤكدة",
            "دعم متعدد العملات لكل منشأة وعميل",
          ],
        },
        {
          id: "whatsapp",
          num: "02",
          tab: "تذكيرات WhatsApp",
          title: "تذكيرات منضبطة برقم واتساب منشأتك",
          body: "اربط رقمك عبر WhatsApp Cloud API لتصل التذكيرات باسمك وفي الأوقات المسموحة فقط.",
          points: [
            "إرسال عبر رقم منشأتك الرسمي من لوحة واحدة",
            "احترام ساعات الهدوء وقائمة العملاء الموقوفين تلقائياً",
            "حماية مدمجة تمنع تكرار التذكير لنفس الفاتورة",
          ],
        },
        {
          id: "receipt",
          num: "03",
          tab: "إيصالات ورابط العميل",
          title: "كشف حساب ذاتي ومطابقة إيصالات بالذكاء الاصطناعي",
          body: "يراجع العميل فواتيره وتعليمات التحويل البنكي أو InstaPay ويرفع الإيصال، ليقرأه AI ويجهزه لاعتمادك.",
          points: [
            "تعليمات سداد واضحة قابلة للنسخ بضغطة واحدة",
            "قراءة تلقائية لإيصالات WhatsApp وبوابة العميل وكشف التكرار",
            "تسجيل الاعتراضات ومواعيد السداد المقترحة دون مكالمات",
          ],
        },
        {
          id: "cheques",
          num: "04",
          tab: "الشيكات والسيولة",
          title: "رقابة كاملة على الشيكات الآجلة وتوقعات الكاش",
          body: "تابع الشيكات المستلمة والمدفوعة من الاستلام حتى التحصيل أو الارتداد مع رؤية لحظية للسيولة المتوقعة.",
          points: [
            "تنبيهات مبكرة قبل مواعيد إيداع الشيكات المستحقة",
            "ربط الشيكات المحصلة بالفواتير المفتوحة تلقائياً",
            "توقعات تدفق نقدي مبنية على الوعود والشيكات الفعلية",
          ],
        },
      ],
    },
    calc: {
      eyebrow: "حاسبة الأثر التشغيلي",
      title: "قدّر السيولة والوقت الموفّر شهرياً",
      sub: "حرّك المؤشرات حسب حجم مبيعاتك الآجلة لترى التقدير التقريبي.",
      receivablesLabel: "متوسط المستحقات الآجلة شهرياً",
      daysLabel: "متوسط تأخر التحصيل الحالي",
      hoursLabel: "ساعات المتابعة اليدوية أسبوعياً",
      currency: "ج.م",
      daysUnit: "يوم",
      hoursUnit: "ساعة",
      outCashLabel: "سيولة متاحة بشكل أسرع (تقدير 30% تحسن)",
      outHoursLabel: "ساعات عمل موفّرة شهرياً (تقدير 75%)",
      outNote: "أرقام تقديرية لأغراض التخطيط وتعتمد على التزام العملاء.",
      cta: "ابدأ تجربتك المجانية",
    },
    pricing: {
      eyebrow: "الباقات",
      title: "باقات واضحة تنمو مع حجم تحصيلك",
      sub: "ابدأ مجاناً ثم اختر الباقة المناسبة لحجم رسائلك الشهرية.",
      cta: "اختر الباقة",
      plans: [
        {
          key: "trial",
          name: "تجريبي",
          price: "0",
          period: "مجاناً",
          quota: "100 رسالة واتساب / شهر",
          features: ["حتى 50 عميل", "بوابة كشف حساب للعملاء", "مساعد AI ومطابقة الإيصالات"],
        },
        {
          key: "starter",
          name: "الأساسية",
          price: "49 ج.م",
          period: "/ شهر (سعر تجريبي)",
          quota: "500 رسالة واتساب / شهر",
          featured: true,
          features: ["ربط رقم WhatsApp Cloud API", "متابعة الشيكات وتنبيهات الإيداع", "استيراد Excel والدفاتر بالذكاء الاصطناعي"],
        },
        {
          key: "growth",
          name: "النمو",
          price: "149 ج.م",
          period: "/ شهر (سعر تجريبي)",
          quota: "2,000 رسالة واتساب / شهر",
          features: ["كامل مميزات الباقة الأساسية", "تقارير سيولة وتوقعات تدفق نقدي", "أولوية الدعم وتصدير البيانات الكامل"],
        },
      ],
    },
    faq: {
      title: "أسئلة شائعة",
      items: [
        {
          q: "كيف تعمل رسائل WhatsApp؟ هل تُرسل من رقمي؟",
          a: "نعم. تربط رقم منشأتك عبر WhatsApp Cloud API من Meta، وتُرسل التذكيرات وتُستقبل إيصالات العملاء مباشرة داخل حسابك مع عزل كامل.",
        },
        {
          q: "هل يسدد العميل أونلاين عبر بوابة دفع داخل كشف الحساب؟",
          a: "لا. كشف الحساب يعرض تعليمات التحويل الخاصة بك (IBAN أو InstaPay أو الشيكات) ويتيح للعميل رفع الإيصال أو طلب موعد سداد لتؤكده أنت.",
        },
        {
          q: "هل يتخذ الذكاء الاصطناعي قرارات مالية أو يرسل رسائل وحده؟",
          a: "لا. الذكاء الاصطناعي يفرغ الدفاتر والإيصالات ويقترح الإجراءات، بينما يبقى الإرسال واعتماد الدفعات بيدك.",
        },
        {
          q: "كيف تُحفظ بيانات عملائي وفواتيري؟",
          a: "كل منشأة معزولة تماماً على مستوى قاعدة البيانات (PostgreSQL RLS) مع تشفير بيانات الربط الحساسة.",
        },
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
      perks: ["بدء فوري بدون بطاقة بنكية", "روابط كشف حساب آمنة لعملائك", "رقابة كاملة على الفواتير والشيكات"],
    },
    footer: "دفقلي. كل الحقوق محفوظة.",
  },
  en: {
    nav: {
      lifecycle: "Lifecycle",
      calculator: "ROI Calculator",
      pricing: "Pricing",
      faq: "FAQ",
      start: "Start free",
      login: "Log in",
      menu: "Menu",
      primaryLabel: "Primary",
      mobileLabel: "Mobile",
    },
    hero: {
      badge: "B2B Collections & Cashflow Platform",
      title: "Get paid on time, without manual chasing.",
      sub: "Dafqly unifies ledger imports, WhatsApp reminders from your own number, AI receipt verification, and cheque tracking in one workspace.",
      cta: "Start free",
      secondary: "Estimate monthly savings",
      note: "No credit card required — AI acts only after your approval.",
    },
    trustLabel: "Platform guarantees",
    trust: [
      "Zero duplicate invoice reminders",
      "Quiet hours & holidays respected",
      "Strict per-tenant data isolation",
      "Human approval before every action",
    ],
    lifecycle: {
      eyebrow: "Invoice to cash",
      title: "Four connected stages, zero clutter",
      stages: [
        {
          id: "import",
          num: "01",
          tab: "Ledger Import",
          title: "Upload Excel or scan paper ledgers in seconds",
          body: "Turn open customer balances into structured invoices with automatic international phone and currency normalization.",
          points: [
            "Bulk CSV / Excel import with zero manual reformatting",
            "AI paper-ledger extraction routing uncertain fields to review",
            "Multi-currency support per tenant and invoice",
          ],
        },
        {
          id: "whatsapp",
          num: "02",
          tab: "WhatsApp Cloud",
          title: "Disciplined reminders from your business number",
          body: "Connect your own WhatsApp Cloud API number so reminders arrive under your brand during allowed business hours.",
          points: [
            "Send and receive on your own WhatsApp number from one inbox",
            "Quiet hours and customer opt-outs enforced automatically",
            "Built-in guard prevents duplicate reminders per invoice",
          ],
        },
        {
          id: "receipt",
          num: "03",
          tab: "Receipts & Portal",
          title: "Self-serve statements and AI receipt matching",
          body: "Customers copy your bank or InstaPay details, upload their transfer receipt, and submit promises or disputes without calls.",
          points: [
            "One-tap copyable transfer instructions on every statement",
            "AI receipt extraction and duplicate reference checks",
            "Pending claims stay unconfirmed until you approve",
          ],
        },
        {
          id: "cheques",
          num: "04",
          tab: "Cheques & Cashflow",
          title: "Full control over post-dated cheques and cash forecasts",
          body: "Track receivable and payable cheques from receipt to clearing or bounce with live cashflow visibility.",
          points: [
            "Early alerts before cheque deposit dates",
            "Automatic invoice linking for cleared receivable cheques",
            "Cashflow forecasts grounded in promises and cheque dates",
          ],
        },
      ],
    },
    calc: {
      eyebrow: "Operational ROI Estimator",
      title: "Estimate cash unlocked and hours saved",
      sub: "Adjust the sliders to match your monthly credit sales and follow-up workload.",
      receivablesLabel: "Monthly credit receivables",
      daysLabel: "Current average collection delay",
      hoursLabel: "Manual chasing hours per week",
      currency: "EGP",
      daysUnit: "days",
      hoursUnit: "hrs",
      outCashLabel: "Working capital unlocked faster (est. 30% DSO reduction)",
      outHoursLabel: "Team hours saved per month (est. 75%)",
      outNote: "Illustrative planning estimates based on your inputs.",
      cta: "Start your free trial",
    },
    pricing: {
      eyebrow: "Pricing",
      title: "Simple plans that scale with your collections",
      sub: "Start free and upgrade when your monthly reminder volume grows.",
      cta: "Choose plan",
      plans: [
        {
          key: "trial",
          name: "Trial",
          price: "0",
          period: "Free",
          quota: "100 WhatsApp messages / mo",
          features: ["Up to 50 debtors", "Public customer statement links", "AI copilot & receipt extraction"],
        },
        {
          key: "starter",
          name: "Starter",
          price: "49 EGP",
          period: "/ mo (placeholder)",
          quota: "500 WhatsApp messages / mo",
          featured: true,
          features: ["BYO WhatsApp Cloud API number", "Cheque tracking & deposit alerts", "Excel & AI paper-ledger import"],
        },
        {
          key: "growth",
          name: "Growth",
          price: "149 EGP",
          period: "/ mo (placeholder)",
          quota: "2,000 WhatsApp messages / mo",
          features: ["Everything in Starter", "Cashflow & aging analytics", "Priority support & full JSON export"],
        },
      ],
    },
    faq: {
      title: "Frequently asked questions",
      items: [
        {
          q: "Do WhatsApp reminders go out from our own number?",
          a: "Yes. Connect your Meta WhatsApp Cloud API number in settings so reminders and inbound receipt photos stay on your business number.",
        },
        {
          q: "Do customers pay through an online checkout on the statement?",
          a: "No. Your statement portal displays your direct transfer instructions (IBAN, InstaPay, or cheque) and lets customers upload receipts or request payment dates.",
        },
        {
          q: "Does AI send messages or confirm payments automatically?",
          a: "No. AI extracts ledgers and receipts and drafts proposals; every send and payment confirmation waits for your approval.",
        },
        {
          q: "How is our financial data isolated?",
          a: "Every workspace is strictly isolated with PostgreSQL Row-Level Security (FORCE RLS) and encrypted integration credentials.",
        },
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
      perks: ["Start free with no card", "Secure customer statement links", "Full invoice, cheque & cashflow control"],
    },
    footer: "Dafqly. All rights reserved.",
  },
};

const STAGE_ART = [LedgerScanSvg, AutomationEngineSvg, PortalFlowSvg, HeroCashflowSvg] as const;

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] as const } },
};

/* ------------------------------------------------------------------ page */

export function DafqlyLanding() {
  const locale = useLocale();
  const router = useRouter();
  const ar = locale === "ar";
  const c = COPY[ar ? "ar" : "en"];
  const Arrow = ar ? ArrowLeft : ArrowRight;

  const [menu, setMenu] = React.useState(false);
  const [stageIdx, setStageIdx] = React.useState(0);
  const [receivables, setReceivables] = React.useState(250000);
  const [daysLate, setDaysLate] = React.useState(35);
  const [hoursWeek, setHoursWeek] = React.useState(10);
  const [openFaq, setOpenFaq] = React.useState<number | null>(0);
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
    { href: "#lifecycle", label: c.nav.lifecycle },
    { href: "#calculator", label: c.nav.calculator },
    { href: "#pricing", label: c.nav.pricing },
    { href: "#faq", label: c.nav.faq },
  ];

  const unlockedCash = Math.round((receivables * (daysLate * 0.3)) / 30);
  const savedHours = Math.round(hoursWeek * 4 * 0.75);
  const numFmt = new Intl.NumberFormat("en-US");

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

  const container = "mx-auto w-full max-w-[1440px] px-4 sm:px-8 lg:px-12 xl:px-16";
  const btnSolid =
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary-hover";
  const btnLine =
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border-strong px-5 text-sm font-bold text-foreground transition-colors hover:bg-muted";
  const field =
    "min-h-11 w-full rounded-lg border border-border-strong bg-background px-3.5 text-sm text-foreground placeholder:text-text-subtle focus:border-primary focus:ring-4 focus:ring-primary/15 focus:outline-none aria-invalid:border-danger aria-invalid:ring-danger/15";

  const activeStage = c.lifecycle.stages[stageIdx] ?? c.lifecycle.stages[0]!;
  const ActiveStageSvg = STAGE_ART[stageIdx] ?? STAGE_ART[0];

  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        <div dir={ar ? "rtl" : "ltr"} className="min-h-screen w-full overflow-x-hidden bg-background text-foreground">
          {/* STICKY FULL-WIDTH NAVBAR */}
          <header className="glass sticky top-0 z-40 w-full border-b border-border">
            <div className={`${container} flex h-16 items-center gap-4`}>
              <a href="#top" className="flex shrink-0 items-center gap-2.5 font-extrabold tracking-tight">
                <BrandMark size={30} />
                <span>{ar ? "دفقلي" : "DAFQLY"}</span>
              </a>

              <nav className="ms-6 hidden items-center gap-1 md:flex" aria-label={c.nav.primaryLabel}>
                {links.map((l) => (
                  <a
                    key={l.href}
                    href={l.href}
                    className="rounded-md px-3 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    {l.label}
                  </a>
                ))}
              </nav>

              <div className="ms-auto flex items-center gap-2">
                <ThemeToggle size="sm" />
                <LocaleToggle currentLocale={locale} className="min-h-[36px] rounded-md px-3 text-xs" />
                <Link
                  data-testid="landing-cta-login"
                  href={`/${locale}/login`}
                  className="hidden px-2.5 text-sm font-bold text-muted-foreground transition-colors hover:text-foreground sm:inline-block"
                >
                  {c.nav.login}
                </Link>
                <Link data-testid="landing-cta-signup" href={`/${locale}/signup`} className={`${btnSolid} !min-h-9 hidden sm:inline-flex`}>
                  {c.nav.start}
                </Link>
                <button
                  type="button"
                  className="grid size-10 place-items-center rounded-md border border-border md:hidden"
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
              <nav id="mobile-nav" className="w-full border-t border-border bg-background px-4 py-3 md:hidden" aria-label={c.nav.mobileLabel}>
                {links.map((l) => (
                  <a
                    key={l.href}
                    href={l.href}
                    onClick={() => setMenu(false)}
                    className="block rounded-md px-3 py-3 text-sm font-semibold hover:bg-muted"
                  >
                    {l.label}
                  </a>
                ))}
                <Link href={`/${locale}/login`} onClick={() => setMenu(false)} className="block rounded-md px-3 py-3 text-sm font-semibold hover:bg-muted">
                  {c.nav.login}
                </Link>
                <Link href={`/${locale}/signup`} onClick={() => setMenu(false)} className={`${btnSolid} mt-2 w-full`}>
                  {c.nav.start}
                </Link>
              </nav>
            )}
          </header>

          <main id="top" className="w-full">
            {/* HERO */}
            <section className="relative w-full overflow-hidden border-b border-border">
              <div className="hero-glow pointer-events-none absolute inset-0" aria-hidden="true" />
              <div className={`${container} relative grid items-center gap-10 py-14 lg:grid-cols-12 lg:py-20`}>
                <m.div initial="hidden" animate="visible" variants={fadeUp} className="min-w-0 lg:col-span-6">
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
                    <a href="#calculator" className={btnLine}>
                      {c.hero.secondary}
                    </a>
                  </div>
                  <p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
                    <ShieldCheck size={16} className="shrink-0 text-primary" />
                    {c.hero.note}
                  </p>
                </m.div>

                <m.div
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                  className="min-w-0 lg:col-span-6"
                >
                  <HeroCashflowSvg />
                </m.div>
              </div>
            </section>

            {/* TRUST BAR */}
            <section aria-label={c.trustLabel} className="w-full border-b border-border bg-muted/60">
              <ul className={`${container} grid gap-4 py-5 sm:grid-cols-2 lg:grid-cols-4`}>
                {c.trust.map((item) => (
                  <li key={item} className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90">
                    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
                      <Check size={12} strokeWidth={3} />
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </section>

            {/* 4-STAGE LIFECYCLE SHOWCASE */}
            <section id="lifecycle" className="w-full scroll-mt-20 border-b border-border py-16 lg:py-24">
              <div className={container}>
                <div className="max-w-2xl">
                  <span className={`text-xs font-extrabold text-primary ${ar ? "" : "uppercase tracking-wider"}`}>
                    {c.lifecycle.eyebrow}
                  </span>
                  <h2 className="mt-2 text-2xl font-extrabold leading-snug sm:text-3xl">{c.lifecycle.title}</h2>
                </div>

                <div role="tablist" aria-label={c.lifecycle.title} className="mt-8 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                  {c.lifecycle.stages.map((st, idx) => {
                    const active = idx === stageIdx;
                    return (
                      <button
                        key={st.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => setStageIdx(idx)}
                        className={`flex min-h-12 items-center gap-3 rounded-xl border px-4 py-3 text-start transition-colors ${
                          active
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-card text-foreground hover:bg-muted"
                        }`}
                      >
                        <span className={`tnum font-mono text-xs font-extrabold ${active ? "opacity-85" : "text-primary"}`}>
                          {st.num}
                        </span>
                        <span className="text-sm font-bold">{st.tab}</span>
                      </button>
                    );
                  })}
                </div>

                <div role="tabpanel" className="mt-8 grid items-center gap-10 rounded-2xl border border-border bg-card p-6 sm:p-10 lg:grid-cols-12">
                  <div className="min-w-0 lg:col-span-6">
                    <h3 className="text-xl font-extrabold leading-snug sm:text-2xl">{activeStage.title}</h3>
                    <p className="mt-3 text-base leading-relaxed text-muted-foreground">{activeStage.body}</p>
                    <ul className="mt-6 space-y-3">
                      {activeStage.points.map((pt) => (
                        <li key={pt} className="flex items-start gap-2.5 text-sm font-medium text-foreground/90">
                          <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground">
                            <Check size={12} strokeWidth={3} />
                          </span>
                          <span>{pt}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="min-w-0 lg:col-span-6">
                    <ActiveStageSvg />
                  </div>
                </div>
              </div>
            </section>

            {/* INTERACTIVE ROI CALCULATOR */}
            <section id="calculator" className="w-full scroll-mt-20 border-b border-border bg-muted/40 py-16 lg:py-24">
              <div className={container}>
                <div className="grid items-center gap-10 lg:grid-cols-12">
                  <div className="min-w-0 space-y-6 lg:col-span-7">
                    <div>
                      <span className={`text-xs font-extrabold text-primary ${ar ? "" : "uppercase tracking-wider"}`}>
                        {c.calc.eyebrow}
                      </span>
                      <h2 className="mt-2 text-2xl font-extrabold sm:text-3xl">{c.calc.title}</h2>
                      <p className="mt-2 text-sm text-muted-foreground sm:text-base">{c.calc.sub}</p>
                    </div>

                    <div className="space-y-5 rounded-2xl border border-border bg-card p-5 sm:p-6">
                      <label className="block space-y-2">
                        <div className="flex items-center justify-between gap-2 text-sm font-bold">
                          <span>{c.calc.receivablesLabel}</span>
                          <span className="tnum shrink-0 text-primary" dir="ltr">
                            {numFmt.format(receivables)} {c.calc.currency}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={20000}
                          max={2000000}
                          step={20000}
                          value={receivables}
                          onChange={(e) => setReceivables(Number(e.target.value))}
                          className="w-full accent-primary"
                        />
                      </label>

                      <label className="block space-y-2">
                        <div className="flex items-center justify-between gap-2 text-sm font-bold">
                          <span>{c.calc.daysLabel}</span>
                          <span className="tnum shrink-0 text-primary">
                            {numFmt.format(daysLate)} {c.calc.daysUnit}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={10}
                          max={90}
                          step={5}
                          value={daysLate}
                          onChange={(e) => setDaysLate(Number(e.target.value))}
                          className="w-full accent-primary"
                        />
                      </label>

                      <label className="block space-y-2">
                        <div className="flex items-center justify-between gap-2 text-sm font-bold">
                          <span>{c.calc.hoursLabel}</span>
                          <span className="tnum shrink-0 text-primary">
                            {numFmt.format(hoursWeek)} {c.calc.hoursUnit}
                          </span>
                        </div>
                        <input
                          type="range"
                          min={2}
                          max={40}
                          step={1}
                          value={hoursWeek}
                          onChange={(e) => setHoursWeek(Number(e.target.value))}
                          className="w-full accent-primary"
                        />
                      </label>
                    </div>
                  </div>

                  <div className="min-w-0 space-y-4 rounded-2xl border border-border bg-card p-6 sm:p-8 lg:col-span-5">
                    <div className="rounded-xl bg-muted/60 p-4">
                      <p className="text-xs font-semibold text-muted-foreground">{c.calc.outCashLabel}</p>
                      <p className="tnum mt-1.5 text-2xl font-extrabold text-primary sm:text-3xl" dir="ltr">
                        {numFmt.format(unlockedCash)} {c.calc.currency}
                      </p>
                    </div>
                    <div className="rounded-xl bg-muted/60 p-4">
                      <p className="text-xs font-semibold text-muted-foreground">{c.calc.outHoursLabel}</p>
                      <p className="tnum mt-1.5 text-2xl font-extrabold text-foreground sm:text-3xl">
                        {numFmt.format(savedHours)} {c.calc.hoursUnit}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground">{c.calc.outNote}</p>
                    <Link href={`/${locale}/signup`} className={`${btnSolid} w-full`}>
                      {c.calc.cta}
                      <Arrow size={16} />
                    </Link>
                  </div>
                </div>
              </div>
            </section>

            {/* PRICING */}
            <section id="pricing" className="w-full scroll-mt-20 border-b border-border py-16 lg:py-24">
              <div className={container}>
                <div className="max-w-2xl">
                  <span className={`text-xs font-extrabold text-primary ${ar ? "" : "uppercase tracking-wider"}`}>
                    {c.pricing.eyebrow}
                  </span>
                  <h2 className="mt-2 text-2xl font-extrabold sm:text-3xl">{c.pricing.title}</h2>
                  <p className="mt-2 text-sm text-muted-foreground sm:text-base">{c.pricing.sub}</p>
                </div>

                <div className="mt-10 grid gap-6 md:grid-cols-3">
                  {c.pricing.plans.map((plan) => (
                    <div
                      key={plan.key}
                      className={`flex flex-col justify-between rounded-2xl border p-6 ${
                        plan.featured ? "border-primary bg-card ring-2 ring-primary/15" : "border-border bg-card"
                      }`}
                    >
                      <div>
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <h3 className="text-lg font-extrabold">{plan.name}</h3>
                          <span className="text-xs font-bold text-primary">{plan.quota}</span>
                        </div>
                        <div className="mt-4 flex items-baseline gap-1.5">
                          <span className="tnum text-3xl font-extrabold">{plan.price}</span>
                          <span className="text-xs text-muted-foreground">{plan.period}</span>
                        </div>
                        <ul className="mt-6 space-y-2.5">
                          {plan.features.map((feat) => (
                            <li key={feat} className="flex items-start gap-2 text-sm text-foreground/90">
                              <Check size={15} className="mt-0.5 shrink-0 text-primary" />
                              <span>{feat}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                      <Link
                        href={`/${locale}/signup?plan=${plan.key}`}
                        className={`${plan.featured ? btnSolid : btnLine} mt-6 w-full`}
                      >
                        {c.pricing.cta}
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* COMPACT FAQ */}
            <section id="faq" className="w-full scroll-mt-20 border-b border-border bg-muted/40 py-16 lg:py-20">
              <div className={container}>
                <h2 className="text-2xl font-extrabold sm:text-3xl">{c.faq.title}</h2>
                <div className="mt-8 grid gap-3 lg:grid-cols-2">
                  {c.faq.items.map((item, idx) => {
                    const open = openFaq === idx;
                    return (
                      <div key={item.q} className="rounded-xl border border-border bg-card">
                        <button
                          type="button"
                          aria-expanded={open}
                          onClick={() => setOpenFaq(open ? null : idx)}
                          className="flex min-h-12 w-full items-center justify-between gap-3 px-5 py-4 text-start text-sm font-bold sm:text-base"
                        >
                          <span>{item.q}</span>
                          <CaretUp size={16} className={`shrink-0 transition-transform ${open ? "" : "rotate-180"}`} />
                        </button>
                        {open && <p className="border-t border-border px-5 py-4 text-sm leading-relaxed text-muted-foreground">{item.a}</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            {/* CONVERSION CTA */}
            <section id="start" className="w-full scroll-mt-20 py-16 lg:py-24">
              <div className={container}>
                <div className="grid gap-8 rounded-2xl border border-border bg-card p-6 sm:p-10 lg:grid-cols-12">
                  <div className="min-w-0 lg:col-span-6">
                    <h2 className="text-2xl font-extrabold sm:text-3xl">{c.cta.title}</h2>
                    <p className="mt-3 text-muted-foreground">{c.cta.sub}</p>
                    <ul className="mt-6 space-y-3">
                      {c.cta.perks.map((perk) => (
                        <li key={perk} className="flex items-center gap-2.5 text-sm font-semibold">
                          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
                            <Check size={12} strokeWidth={3} />
                          </span>
                          <span>{perk}</span>
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
                        onChange={(e) => {
                          setBiz(e.target.value);
                          setError(null);
                        }}
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
                        onChange={(e) => {
                          setEmail(e.target.value);
                          setError(null);
                        }}
                        autoComplete="email"
                      />
                    </label>
                    <p id="cta-form-error" role="alert" className="min-h-5 text-sm font-semibold text-danger">
                      {error?.msg ?? ""}
                    </p>
                    <button type="submit" className={`${btnSolid} w-full`}>
                      {c.cta.button}
                      <Arrow size={16} />
                    </button>
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      <LockKey size={14} />
                      {c.hero.note}
                    </p>
                  </form>
                </div>
              </div>
            </section>
          </main>

          <footer className="w-full border-t border-border">
            <div className={`${container} flex flex-wrap items-center justify-between gap-3 py-6 text-sm text-muted-foreground`}>
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
