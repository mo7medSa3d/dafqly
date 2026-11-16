"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { ThemeToggle } from "./ThemeToggle";
import { LocaleToggle } from "./LocaleToggle";
import { BrandMark } from "./BrandMark";
import {
  ArrowLeft, ArrowRight, Bank, Bell, Camera, Check, Handshake,
  List, LockKey, ShieldCheck, Sparkle, X, type LucideIcon,
} from "@/components/ui/solid-icons";
import { AiArt, ChequeArt, CtaArt, HeroBackdrop, OcrArt, PortalArt, RemindersArt, StepArt } from "./landing-art";

/* ------------------------------------------------------------------ copy */

type FeatureId = "reminders" | "ai" | "ocr" | "cheques" | "portal";
type Feature = { id: FeatureId; icon: LucideIcon; title: string; body: string };
type Copy = {
  nav: { features: string; how: string; start: string; login: string; menu: string };
  hero: { title: string; sub: string; cta: string; secondary: string; note: string };
  preview: { chipSent: string; chipPaid: string; title: string; sample: string; rows: { name: string; action: string; amount: string; tag: string; tone: "overdue" | "due" | "paid" }[]; total: string; totalLabel: string };
  trust: string[];
  featuresTitle: string;
  featuresSub: string;
  features: Feature[];
  howTitle: string;
  steps: { title: string; body: string }[];
  cta: { title: string; sub: string; biz: string; email: string; button: string; errBiz: string; errEmail: string; perks: string[] };
  footer: string;
};

const COPY: Record<"ar" | "en", Copy> = {
  ar: {
    nav: { features: "المميزات", how: "كيف يعمل", start: "ابدأ مجاناً", login: "دخول", menu: "القائمة" },
    hero: {
      title: "حصّل فلوسك في ميعادها، من غير إحراج ولا مطاردة.",
      sub: "دفقلي بيتابع المستحقات عنك: تذكيرات واتساب مهذبة، شيكات ومواعيد استحقاق، وكشف حساب يشوفه العميل بنفسه.",
      cta: "ابدأ مجاناً",
      secondary: "شوف المميزات",
      note: "من غير بطاقة بنكية. كل رسالة بتتبعت بعد موافقتك.",
    },
    preview: {
      chipSent: "تذكير أُرسل", chipPaid: "تم السداد",
      title: "قائمة التحصيل اليوم",
      sample: "بيانات توضيحية",
      rows: [
        { name: "مؤسسة النور للتجارة", action: "تذكير واتساب اليوم 10:00", amount: "48,500 ج.م", tag: "متأخر", tone: "overdue" },
        { name: "مخازن الدلتا", action: "شيك يستحق بعد يومين", amount: "120,000 ج.م", tag: "قريب", tone: "due" },
        { name: "شركة الأفق", action: "تحويل بانتظار التأكيد", amount: "17,250 ج.م", tag: "تعهد", tone: "paid" },
      ],
      totalLabel: "إجمالي المستحق",
      total: "185,750 ج.م",
    },
    trust: ["لا تذكير مكرر لنفس الفاتورة", "احترام ساعات الهدوء", "موافقتك قبل أي إجراء ذكي", "بيانات كل منشأة معزولة"],
    featuresTitle: "كل اللي تحتاجه للتحصيل، في مكان واحد",
    featuresSub: "أدوات عملية بتقلل المتابعة اليدوية وتحافظ على علاقتك بعملائك.",
    features: [
      { id: "reminders", icon: Bell, title: "تذكيرات واتساب مجدولة", body: "من الودّي للحازم، في الأوقات المسموحة فقط. لا تتكرر، ولا تُرسل لعميل أوقف الإشعارات، وكل رسالة ليها سجل بحالتها." },
      { id: "ai", icon: Sparkle, title: "مساعد ذكي", body: "اسأله بالعربي عن أي عميل أو فاتورة، ويقترح الخطوة التالية. لا ينفذ إلا بموافقتك." },
      { id: "ocr", icon: Camera, title: "تصوير الدفتر", body: "صوّر صفحة الدفتر الورقي وتتحول لفواتير. أي قراءة غير مؤكدة تروح للمراجعة." },
      { id: "cheques", icon: Bank, title: "متابعة الشيكات", body: "مواعيد الاستحقاق والشيكات المرتدة قدامك، مع تنبيه قبل الإيداع." },
      { id: "portal", icon: Handshake, title: "بوابة العميل", body: "رابط آمن يشوف فيه العميل كشف حسابه ويحدد ميعاد السداد. التحويل ادّعاء لحد ما تؤكده." },
    ],
    howTitle: "ابدأ في ٣ خطوات",
    steps: [
      { title: "ضيف عملاءك", body: "استورد من ملف أو صوّر دفترك الورقي." },
      { title: "حدد سياسة التذكير", body: "اختار الأسلوب وساعات الهدوء، والباقي أوتوماتيك." },
      { title: "تابع التحصيل", body: "راجع القائمة اليومية وأغلق الفواتير أول ما تتسدد." },
    ],
    cta: {
      title: "جاهز تبدأ؟",
      sub: "اعمل حسابك في دقيقة وجرّب بنفسك.",
      biz: "اسم المنشأة", email: "البريد الإلكتروني", button: "إنشاء حساب مجاني",
      errBiz: "اكتب اسم منشأتك.", errEmail: "أدخل بريداً إلكترونياً صحيحاً.",
      perks: ["حتى 50 عميل مجاناً", "كشف حساب للعميل", "متابعة الفواتير والشيكات"],
    },
    footer: "دفقلي. كل الحقوق محفوظة.",
  },
  en: {
    nav: { features: "Features", how: "How it works", start: "Start free", login: "Log in", menu: "Menu" },
    hero: {
      title: "Get paid on time, without the awkward chasing.",
      sub: "Dafqly follows up for you: polite WhatsApp reminders, cheque due dates, and a statement link your customers can open themselves.",
      cta: "Start free",
      secondary: "See features",
      note: "No credit card. Every message goes out only after your approval.",
    },
    preview: {
      chipSent: "Reminder sent", chipPaid: "Paid",
      title: "Today's collection queue",
      sample: "Sample data",
      rows: [
        { name: "Al-Nour Trading", action: "WhatsApp reminder today 10:00", amount: "EGP 48,500", tag: "Overdue", tone: "overdue" },
        { name: "Delta Warehouses", action: "Cheque due in 2 days", amount: "EGP 120,000", tag: "Due soon", tone: "due" },
        { name: "Horizon Co.", action: "Transfer awaiting confirmation", amount: "EGP 17,250", tag: "Promise", tone: "paid" },
      ],
      totalLabel: "Total outstanding",
      total: "EGP 185,750",
    },
    trust: ["Never a duplicate reminder", "Quiet hours respected", "AI acts only with your approval", "Tenant data fully isolated"],
    featuresTitle: "Everything collections needs, in one place",
    featuresSub: "Practical tools that cut manual follow-up and protect your customer relationships.",
    features: [
      { id: "reminders", icon: Bell, title: "Scheduled WhatsApp reminders", body: "Polite to firm, only at allowed times. Never repeated, never sent to opted-out customers, and every message has a logged status." },
      { id: "ai", icon: Sparkle, title: "AI copilot", body: "Ask about any customer or invoice and get a suggested next step. It acts only once you approve." },
      { id: "ocr", icon: Camera, title: "Ledger photo import", body: "Snap a paper ledger page and turn it into invoices. Uncertain readings go to review." },
      { id: "cheques", icon: Bank, title: "Cheque tracking", body: "Due dates and bounced cheques at a glance, with alerts before deposit day." },
      { id: "portal", icon: Handshake, title: "Customer portal", body: "A secure link where customers see their balance and promise a payment date. A transfer stays a claim until you confirm." },
    ],
    howTitle: "Start in 3 steps",
    steps: [
      { title: "Add your customers", body: "Import a file or photograph your paper ledger." },
      { title: "Set your reminder policy", body: "Pick the tone and quiet hours. The rest runs itself." },
      { title: "Track collections", body: "Review the daily queue and close invoices as they're paid." },
    ],
    cta: {
      title: "Ready to start?",
      sub: "Create your account in a minute and try it yourself.",
      biz: "Business name", email: "Email address", button: "Create free account",
      errBiz: "Enter your business name.", errEmail: "Enter a valid email address.",
      perks: ["Up to 50 debtors free", "Customer statement links", "Invoices & cheques"],
    },
    footer: "Dafqly. All rights reserved.",
  },
};

const ART: Record<FeatureId, () => React.JSX.Element> = { reminders: RemindersArt, ai: AiArt, ocr: OcrArt, cheques: ChequeArt, portal: PortalArt };
const SPAN: Record<FeatureId, string> = {
  reminders: "lg:col-span-4", ai: "lg:col-span-2", ocr: "lg:col-span-2", cheques: "lg:col-span-2", portal: "lg:col-span-2",
};
const TINT: Record<FeatureId, string> = {
  reminders: "bg-muted", ai: "bg-chart-2/10", ocr: "bg-muted", cheques: "bg-chart-1/10", portal: "bg-chart-2/10",
};

const TONE: Record<"overdue" | "due" | "paid", string> = {
  overdue: "bg-status-overdue-bg text-status-overdue-fg",
  due: "bg-status-due-bg text-status-due-fg",
  paid: "bg-status-paid-bg text-status-paid-fg",
};

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());

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
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  const links = [
    { href: "#features", label: c.nav.features },
    { href: "#how", label: c.nav.how },
  ];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!biz.trim()) return setError(c.cta.errBiz);
    if (!isEmail(email)) return setError(c.cta.errEmail);
    try { window.localStorage.setItem("dafqly:workspace-card", JSON.stringify({ businessName: biz.trim(), email: email.trim() })); } catch (err) { console.warn("[DafqlyLanding] workspace card could not be saved, continuing to signup", err); }
    const q = new URLSearchParams({ business: biz.trim(), email: email.trim() });
    router.push(`/${locale}/signup?${q.toString()}`);
  };

  const btnSolid = "inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-bold text-primary-foreground hover:bg-primary-hover";
  const btnLine = "inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-border-strong px-5 text-sm font-bold text-foreground hover:bg-muted";
  const field = "min-h-11 w-full rounded-md border border-border-strong bg-background px-3 text-sm text-foreground placeholder:text-text-subtle";

  return (
    <div dir={ar ? "rtl" : "ltr"} className="min-h-screen bg-background text-foreground">
      {/* NAV */}
      <header className="glass sticky top-0 z-40 border-b border-border">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <a href="#top" className="flex items-center gap-2 font-extrabold">
            <BrandMark size={30} />
            <span>{ar ? "دفقلي" : "DAFQLY"}</span>
          </a>
          <nav className="ms-6 hidden items-center gap-1 md:flex" aria-label="Primary">
            {links.map((l) => (
              <a key={l.href} href={l.href} className="rounded-md px-3 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground">
                {l.label}
              </a>
            ))}
          </nav>
          <div className="ms-auto flex items-center gap-2">
            <ThemeToggle size="sm" />
            <LocaleToggle currentLocale={locale} className="min-h-[36px] rounded-md px-3 text-xs" />
            <Link data-testid="landing-cta-login" href={`/${locale}/login`} className="hidden px-2 text-sm font-bold text-muted-foreground hover:text-foreground sm:inline-block">
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
              onClick={() => setMenu((m) => !m)}
            >
              {menu ? <X size={18} /> : <List size={18} />}
            </button>
          </div>
        </div>
        {menu && (
          <nav id="mobile-nav" className="border-t border-border bg-background px-4 py-3 md:hidden" aria-label="Mobile">
            {[...links, { href: `/${locale}/login`, label: c.nav.login }].map((l) => (
              <a key={l.href} href={l.href} onClick={() => setMenu(false)} className="block rounded-md px-3 py-3 text-sm font-semibold hover:bg-muted">
                {l.label}
              </a>
            ))}
            <Link href={`/${locale}/signup`} className={`${btnSolid} mt-2 w-full`}>{c.nav.start}</Link>
          </nav>
        )}
      </header>

      <main id="top">
        {/* HERO */}
        <section className="relative overflow-hidden border-b border-border">
          <div className="hero-glow pointer-events-none absolute inset-0" aria-hidden="true" />
          <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-2 lg:py-24">
            <div>
              <h1 className="text-3xl font-extrabold leading-[1.25] sm:text-5xl">{c.hero.title}</h1>
              <p className="mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">{c.hero.sub}</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link data-testid="landing-hero-signup" href={`/${locale}/signup`} className={btnSolid}>
                  {c.hero.cta}
                  <Arrow size={16} />
                </Link>
                <a href="#features" className={btnLine}>{c.hero.secondary}</a>
              </div>
              <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                <ShieldCheck size={16} />
                {c.hero.note}
              </p>
            </div>

            {/* product preview */}
            <div className="relative">
            <HeroBackdrop />
            <div className="panel-shadow absolute -top-3 end-3 z-10 hidden items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-bold sm:flex" aria-hidden="true">
              <span className="grid size-5 place-items-center rounded-full bg-status-paid-bg text-status-paid-fg"><Check size={12} /></span>{c.preview.chipPaid}
            </div>
            <div className="panel-shadow absolute -bottom-4 start-3 z-10 hidden items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-bold sm:flex" aria-hidden="true">
              <span className="grid size-5 place-items-center rounded-full bg-chart-2 text-white"><Bell size={12} /></span>{c.preview.chipSent}
            </div>
            <div className="relative rounded-xl border border-border bg-card" role="img" aria-label={c.preview.title}>
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <span className="text-sm font-bold">{c.preview.title}</span>
                <span className="rounded bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">{c.preview.sample}</span>
              </div>
              <ul className="divide-y divide-border" aria-hidden="true">
                {c.preview.rows.map((r) => (
                  <li key={r.name} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">{r.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{r.action}</p>
                    </div>
                    <span className={`rounded px-2 py-0.5 text-xs font-bold ${TONE[r.tone]}`}>{r.tag}</span>
                    <span className="tnum w-28 text-end text-sm font-bold">{r.amount}</span>
                  </li>
                ))}
              </ul>
              <div className="flex items-baseline justify-between border-t border-border bg-muted px-4 py-3 rounded-b-xl">
                <span className="text-xs font-semibold uppercase text-muted-foreground">{c.preview.totalLabel}</span>
                <span className="tnum text-lg font-extrabold">{c.preview.total}</span>
              </div>
            </div>
            </div>
          </div>
        </section>

        {/* TRUST */}
        <section aria-label="Principles" className="border-b border-border bg-muted">
          <ul className="mx-auto grid max-w-6xl gap-3 px-4 py-5 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
            {c.trust.map((t) => (
              <li key={t} className="flex items-center gap-2 text-sm font-semibold">
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground"><Check size={12} /></span>
                {t}
              </li>
            ))}
          </ul>
        </section>

        {/* FEATURES */}
        <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 lg:py-24">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-extrabold sm:text-4xl">{c.featuresTitle}</h2>
            <p className="mt-3 text-muted-foreground">{c.featuresSub}</p>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
            {c.features.map((f) => {
              const Art = ART[f.id];
              return (
                <article key={f.id} className={`${SPAN[f.id]} group overflow-hidden rounded-xl border border-border bg-card hover:border-border-strong`}>
                  <div className={`h-44 border-b border-border px-4 pt-3 ${TINT[f.id]}`}><Art /></div>
                  <div className="p-5">
                    <h3 className="flex items-center gap-2 text-base font-bold">
                      <span className="grid size-8 place-items-center rounded-md bg-muted"><f.icon size={18} /></span>
                      {f.title}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {/* HOW */}
        <section id="how" className="scroll-mt-20 border-y border-border bg-muted">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
            <h2 className="text-2xl font-extrabold sm:text-4xl">{c.howTitle}</h2>
            <ol className="mt-10 grid gap-4 md:grid-cols-3">
              {c.steps.map((s, i) => (
                <li key={s.title} className="rounded-xl border border-border bg-card p-5">
                  <div className="h-24 rounded-lg border border-border bg-muted p-2"><StepArt step={(i + 1) as 1 | 2 | 3} /></div>
                  <span className="tnum mt-4 grid size-8 place-items-center rounded-full bg-primary text-sm font-extrabold text-primary-foreground">{i + 1}</span>
                  <h3 className="mt-3 font-bold">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* CTA */}
        <section id="start" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-16 sm:px-6 lg:py-24">
          <div className="grid gap-8 rounded-2xl border border-border bg-card p-6 sm:p-10 lg:grid-cols-2">
            <div>
              <h2 className="text-2xl font-extrabold sm:text-4xl">{c.cta.title}</h2>
              <p className="mt-3 text-muted-foreground">{c.cta.sub}</p>
              <div className="mt-4 hidden h-48 max-w-xs lg:block"><CtaArt /></div>
              <ul className="mt-4 space-y-3">
                {c.cta.perks.map((p) => (
                  <li key={p} className="flex items-center gap-2 text-sm font-semibold">
                    <Check size={16} /> {p}
                  </li>
                ))}
              </ul>
            </div>
            <form onSubmit={submit} noValidate className="space-y-3 self-center">
              <label className="block text-sm font-bold">
                {c.cta.biz}
                <input className={`${field} mt-1`} value={biz} onChange={(e) => { setBiz(e.target.value); setError(""); }} autoComplete="organization" />
              </label>
              <label className="block text-sm font-bold">
                {c.cta.email}
                <input className={`${field} mt-1`} type="email" dir="ltr" value={email} onChange={(e) => { setEmail(e.target.value); setError(""); }} autoComplete="email" />
              </label>
              <p role="alert" className="min-h-5 text-sm font-semibold text-danger">{error}</p>
              <button type="submit" className={`${btnSolid} w-full`}>
                {c.cta.button}
                <Arrow size={16} />
              </button>
              <p className="flex items-center gap-2 text-xs text-muted-foreground"><LockKey size={14} />{c.hero.note}</p>
            </form>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-muted-foreground sm:px-6">
          <span className="flex items-center gap-2"><BrandMark size={20} />© {new Date().getFullYear()} {c.footer}</span>
          <Link href={`/${locale}/login`} className="font-semibold hover:text-foreground">{c.nav.login}</Link>
        </div>
      </footer>
    </div>
  );
}
