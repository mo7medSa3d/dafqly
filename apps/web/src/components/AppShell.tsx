"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Bank,
  CalendarCheck,
  ClipboardText,
  CaretDoubleRight,
  CaretUp,
  ChatCircleDots,
  CloudArrowUp,
  CreditCard,
  Lightning,
  List,
  MagnifyingGlass,
  Receipt,
  Robot,
  Scan,
  SlidersHorizontal,
  Sparkle,
  SquaresFour,
  UsersThree,
  WhatsappLogo,
  X,
} from "@phosphor-icons/react";
import { BrandLockup, BrandMark } from "./BrandMark";
import { ThemeToggle } from "./ThemeToggle";
import { LocaleToggle } from "./LocaleToggle";
import { LogoutButton } from "./LogoutButton";
import { InitialAvatar } from "./ui";
import { CommandPalette } from "./CommandPalette";
import { NotificationBell } from "./NotificationBell";
import {
  AiCopilotDrawer,
  type ComposerMode,
  type CopilotTab,
  type OpenCopilotDetail,
} from "./AiCopilotDrawer";
import type { NotificationTone } from "@tahseel/core";
import { trpc } from "@/lib/trpc-client";
import { CurrencyProvider, useCurrency } from "./CurrencyContext";

export { useCurrency };

const ITEMS = [
  { href: "dashboard", key: "dashboard", testid: "nav-dashboard", Icon: SquaresFour, group: "core" },
  { href: "debtors", key: "debtors", testid: "nav-debtors", Icon: UsersThree, group: "core" },
  { href: "invoices", key: "invoices", testid: "nav-invoices", Icon: Receipt, group: "core" },
  { href: "cheques", key: "cheques", testid: "nav-cheques", Icon: Bank, group: "core" },
  { href: "tasks", key: "tasks", testid: "nav-tasks", Icon: ClipboardText, group: "core" },
  { href: "ai-inbox", key: "aiInbox", testid: "nav-ai-inbox", Icon: Sparkle, group: "ai", badgeAr: "AI", badgeEn: "AI" },
  { href: "import", key: "import", testid: "nav-import", Icon: CloudArrowUp, group: "ai" },
  { href: "ledger-photo", key: "ledgerPhoto", testid: "nav-ledger-photo", Icon: Scan, group: "ai", badgeAr: "OCR", badgeEn: "OCR" },
  { href: "billing", key: "billing", testid: "nav-billing", Icon: CreditCard, group: "workspace" },
  { href: "settings", key: "settings", testid: "nav-settings", Icon: SlidersHorizontal, group: "workspace" },
] as const;

const NAV_GROUPS = [
  {
    id: "core" as const,
    labelAr: "العمليات الأساسية",
    labelEn: "Core Operations",
  },
  {
    id: "ai" as const,
    labelAr: "الذكاء والأتمتة",
    labelEn: "AI & Automation",
  },
  {
    id: "workspace" as const,
    labelAr: "الإدارة والحوكمة",
    labelEn: "Workspace & Governance",
  },
] as const;

export function AppShell({
  locale, businessName, currency = "EGP", testId, demoMode: _demoMode, digits = "latin", children,
}: {
  locale: string;
  businessName: string;
  currency?: string;
  testId?: string;
  digits?: "latin" | "eastern";
  /** Deployment simulation flags (server-computed from env). When any are
   * on, a non-dismissible banner says so — a demo/dry-run deployment must
   * never be mistaken for live messaging, live AI, or live payments. */
  demoMode?: import("@/server/env").RuntimeModeFlags;
  children: React.ReactNode;
}) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [aiMenuOpen, setAiMenuOpen] = useState(false);
  const [copilotConfig, setCopilotConfig] = useState<{
    tab: CopilotTab;
    debtorId?: string;
    tone?: NotificationTone;
    mode?: ComposerMode;
  }>({ tab: "briefing" });
  const isEn = locale === "en";

  const [intel, setIntel] = useState<{
    healthStatus: "strong" | "attention" | "urgent";
    topActions: Array<{ debtorId: string; displayName: string }>;
  } | null>(null);

  useEffect(() => {
    let mounted = true;
    trpc.intelligence.overview
      .query({ syncNotifications: false })
      .then((data) => {
        if (mounted && data) {
          setIntel({
            healthStatus: data.healthStatus,
            topActions: data.topActions.map((a) => ({ debtorId: a.debtorId, displayName: a.displayName })),
          });
        }
      })
      .catch(() => {
        // Safe silent fallback for shell
      });
    return () => {
      mounted = false;
    };
  }, []);

  const healthStatus = intel?.healthStatus ?? "strong";
  const priorityCount = intel?.topActions?.length ?? 0;

  // Global Ctrl+K / Cmd+K shortcut + custom event listener for AI Copilot pop-up window
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "j") {
        e.preventDefault();
        setAiMenuOpen((prev) => !prev);
      }
      if (e.key === "Escape") {
        setAiMenuOpen(false);
      }
    };
    const handleOpenCopilot = (e: Event) => {
      const detail = (e as CustomEvent<OpenCopilotDetail>).detail ?? {};
      setCopilotConfig({
        tab: detail.tab ?? "briefing",
        debtorId: detail.debtorId,
        tone: detail.tone,
        mode: detail.mode,
      });
      setCopilotOpen(true);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("tahseel:open-ai-copilot", handleOpenCopilot);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("tahseel:open-ai-copilot", handleOpenCopilot);
    };
  }, []);

  const isActive = (href: string) => pathname === `/${locale}/${href}` || pathname.startsWith(`/${locale}/${href}/`);
  const activeItem = ITEMS.find((i) => isActive(i.href)) ?? ITEMS[0];

  return (
    <CurrencyProvider currency={currency} locale={locale} digits={digits}>
      <div className="min-h-dvh glass-canvas text-text">
      {/* Mobile Backdrop Overlay */}
      <div
        className={`fixed inset-0 z-40 bg-navy-950/60 backdrop-blur-xs transition-opacity duration-300 lg:hidden ${
          mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />

      {/* 2026 Enterprise SaaS Sidebar Dock */}
      <aside
        className={`fixed inset-y-0 start-0 z-50 flex flex-col glass-dock transition-transform duration-300 ease-in-out lg:inset-y-4 lg:start-4 lg:z-40 lg:rounded-[32px] lg:transition-[width] ${
          collapsed ? "w-[280px] lg:w-[84px]" : "w-[280px] lg:w-[272px]"
        } ${
          mobileOpen
            ? "translate-x-0 pointer-events-auto"
            : "max-lg:-translate-x-full rtl:max-lg:translate-x-full max-lg:pointer-events-none lg:pointer-events-auto lg:translate-x-0"
        }`}
      >
        {/* Top Brand & Collapse Header */}
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-border/50 px-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {!collapsed ? (
              <BrandLockup size="md" showTagline locale={locale} />
            ) : (
              <button
                type="button"
                onClick={() => setCollapsed(false)}
                title={isEn ? "Expand navigation dock" : "توسيع القائمة الجانبية"}
                className="mx-auto flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[var(--brand-tile-bg)] shadow-xs transition-transform hover:scale-105"
              >
                <BrandMark variant="white" size={22} />
              </button>
            )}
          </div>

          {/* Desktop Collapse Button */}
          {!collapsed && (
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              title={isEn ? "Collapse sidebar" : "طي القائمة"}
              className="hidden lg:flex size-8 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-surface-muted/50 text-text-muted transition-all hover:bg-callout hover:text-primary active:scale-95"
            >
              <CaretDoubleRight size={14} weight="bold" aria-hidden className="ltr:rotate-180" />
            </button>
          )}

          {/* Mobile Close Button */}
          <button
            type="button"
            data-testid="mobile-menu-close"
            onClick={() => setMobileOpen(false)}
            aria-label={isEn ? "Close menu" : "إغلاق القائمة"}
            className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-surface-muted/60 text-text-muted transition-all hover:bg-danger-bg hover:text-danger active:scale-95 lg:hidden"
          >
            <X size={18} weight="bold" />
          </button>
        </div>

        {/* Categorized 2026 SaaS Navigation Sections */}
        <nav aria-label="primary" className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-4 no-scrollbar">
          {NAV_GROUPS.map((group) => {
            const groupItems = ITEMS.filter((item) => item.group === group.id);
            return (
              <div key={group.id} className="flex flex-col gap-1">
                <div
                  className={`px-3 pb-1 text-[11px] font-bold text-text-subtle ${
                    collapsed ? "lg:hidden" : "block"
                  }`}
                >
                  {isEn ? group.labelEn : group.labelAr}
                </div>
                {groupItems.map((item) => {
                  const { href, key, testid, Icon } = item;
                  const active = isActive(href);
                  const badge = "badgeAr" in item ? (isEn ? item.badgeEn : item.badgeAr) : null;
                  return (
                    <Link
                      key={href}
                      data-testid={testid}
                      href={`/${locale}/${href}`}
                      prefetch={false}
                      onClick={() => setMobileOpen(false)}
                      aria-current={active ? "page" : undefined}
                      title={t(key)}
                      className={`group relative flex min-h-[42px] items-center gap-3 rounded-2xl px-2.5 py-1.5 text-sm font-semibold transition-all duration-200 ${
                        collapsed ? "lg:justify-center lg:px-0" : ""
                      } ${
                        active
                          ? "bg-primary text-primary-fg shadow-xs"
                          : "text-text-muted hover:bg-callout/65 hover:text-text"
                      }`}
                    >
                      <span
                        className={`flex size-8 shrink-0 items-center justify-center rounded-xl transition-all duration-200 ${
                          active
                            ? "bg-white/20 text-white"
                            : "bg-surface-muted/70 text-text-muted group-hover:bg-primary/10 group-hover:text-primary"
                        }`}
                      >
                        <Icon size={18} weight={active ? "fill" : "duotone"} aria-hidden />
                      </span>

                      <span className={`flex-1 truncate ${collapsed ? "lg:hidden" : "inline"}`}>
                        {t(key)}
                      </span>

                      {badge && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${
                            collapsed ? "lg:hidden" : "inline-flex"
                          } ${
                            active
                              ? "bg-white/25 text-white"
                              : "bg-callout text-primary"
                          }`}
                        >
                          {badge}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {/* Clean Minimal Workspace Footer */}
        <div className="mt-auto flex shrink-0 flex-col gap-2.5 border-t border-border/50 p-3">
          <div className="glass-recessed flex items-center gap-2.5 rounded-2xl p-2">
            <InitialAvatar name={businessName} size={34} />
            <div className={`min-w-0 flex-1 ${collapsed ? "lg:hidden" : "block"}`}>
              <p className="truncate text-xs font-bold leading-tight text-text">{businessName}</p>
              <p className="truncate text-[11px] text-text-muted">
                {isEn ? "Active Workspace" : "مساحة العمل النشطة"}
              </p>
            </div>
          </div>

          <div className={`${collapsed ? "lg:hidden" : "block"}`}>
            <LogoutButton wide />
          </div>
          {collapsed && (
            <div className="hidden lg:block">
              <LogoutButton compact />
            </div>
          )}
        </div>
      </aside>

      {/* Main Floating Frosted Glass Workspace Frame */}
      <div
        className={`flex min-h-dvh min-w-0 max-w-full flex-col overflow-x-hidden p-0 transition-[padding] lg:py-4 lg:pe-4 ${
          collapsed ? "lg:ps-[116px]" : "lg:ps-[304px]"
        }`}
      >
        <div className="flex min-h-dvh flex-1 flex-col lg:min-h-[calc(100dvh-2rem)] lg:rounded-[32px] lg:glass-frame lg:overflow-x-clip">
        {/* Clean, Uncluttered 2026 Frosted Top Header Bar */}
        <header className="glass-bar sticky top-0 z-30 border-b border-border/50 lg:rounded-t-[32px]">
          <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              {/* Mobile Hamburger Button */}
              <button
                type="button"
                data-testid="mobile-menu-toggle"
                onClick={() => setMobileOpen((v) => !v)}
                aria-label={isEn ? "Open navigation menu" : "فتح القائمة الرئيسية"}
                className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-muted/60 text-text shadow-2xs transition-all hover:bg-callout hover:text-primary active:scale-95 lg:hidden"
              >
                <List size={22} weight="bold" />
              </button>

              {/* Mobile Brand Link */}
              <Link
                href={`/${locale}/dashboard`}
                className="flex items-center gap-2 lg:hidden"
                title={isEn ? "Dashboard" : "الرئيسية"}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[var(--brand-tile-bg)] shadow-xs">
                  <BrandMark variant="white" size={18} />
                </span>
                <span className="text-base font-extrabold text-text">{isEn ? "Dafqly" : "دفقلي"}</span>
              </Link>

              {/* Desktop Page Title & Workspace Pill */}
              <div className="hidden min-w-0 items-center gap-2.5 lg:flex">
                <span className="flex size-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <activeItem.Icon size={17} weight="fill" aria-hidden />
                </span>
                <span className="truncate text-base font-bold text-text">{t(activeItem.key)}</span>
                <span className="truncate rounded-full bg-surface-muted/70 px-2.5 py-0.5 text-xs font-semibold text-text-muted">
                  {businessName}
                </span>
              </div>
            </div>

            {/* Streamlined Header Controls (Search, Notifications, Theme, Locale) */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                data-testid="global-search-btn"
                onClick={() => setSearchOpen(true)}
                className="glass-pill flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium text-text-muted transition-all hover:border-primary/40 hover:text-text"
                title={isEn ? "Quick search & commands (Ctrl+K)" : "بحث سريع وأوامر (Ctrl+K)"}
              >
                <MagnifyingGlass size={15} weight="bold" className="text-primary" />
                <span className="hidden sm:inline">{isEn ? "Search or jump..." : "بحث سريع..."}</span>
                <kbd className="hidden rounded bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-text-subtle md:inline-block">
                  ⌘K
                </kbd>
              </button>

              <NotificationBell locale={locale} />
              <ThemeToggle />
              <LocaleToggle currentLocale={locale} compact />
            </div>
          </div>
        </header>

        {/* Page Content Body */}
        <main
          data-testid={testId}
          className="mx-auto flex w-full max-w-[1600px] min-w-0 flex-1 flex-col gap-6 px-4 pb-24 pt-6 sm:px-6 lg:gap-8 lg:px-8 lg:pt-8"
        >
          {children}
        </main>
        </div>
      </div>

      {/* Floating Modern AI Assistant Menu & Launcher */}
      <div className="fixed bottom-6 left-4 sm:left-6 z-40 flex flex-col items-start gap-2.5">
        {/* Modern 2026 Assistant Command Menu Popover */}
        {aiMenuOpen && !copilotOpen && (
          <div
            data-testid="ai-assistant-menu"
            className="flex w-[min(92vw,350px)] flex-col gap-2 rounded-3xl border border-primary/25 bg-surface/95 p-3.5 shadow-[0_20px_50px_rgba(0,0,0,0.28),0_0_20px_color-mix(in_srgb,var(--primary)_18%,transparent)] backdrop-blur-2xl animate-in fade-in slide-in-from-bottom-3 duration-200"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border/60 pb-3 px-1">
              <div className="flex items-center gap-2.5">
                <span className="flex size-7 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  <Sparkle size={16} weight="fill" />
                </span>
                <div className="flex flex-col">
                  <span className={`text-xs font-black text-text ${isEn ? "tracking-tight" : ""}`}>
                    {isEn ? "DAFQLY AI Copilot" : "مساعد دفقلي الذكي"}
                  </span>
                  <span className="text-[10px] text-text-muted">
                    {isEn ? "Autonomous Collections & Liquidity" : "التحصيل الذكي وإدارة السيولة"}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="flex items-center gap-1 rounded-full bg-callout px-2 py-0.5 text-[10px] font-bold text-primary">
                  <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span>{isEn ? "Gemini 3.1 Live" : "Gemini 3.1 Live · نشط"}</span>
                </span>
                <kbd className="hidden sm:inline-block rounded-md border border-border bg-surface px-1.5 py-0.5 text-[9px] font-bold text-text-muted">
                  Esc
                </kbd>
              </div>
            </div>

            {/* Menu Options */}
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                data-testid="ai-menu-briefing-btn"
                onClick={() => {
                  setAiMenuOpen(false);
                  setCopilotConfig({ tab: "briefing" });
                  setCopilotOpen(true);
                }}
                className="group flex items-center gap-3 rounded-2xl p-2.5 text-start text-xs font-semibold text-text transition-all duration-200 hover:bg-callout hover:text-primary hover:translate-x-1 active:scale-[0.98]"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-transform group-hover:scale-110">
                  <Lightning size={16} weight="fill" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold">{isEn ? "Executive Briefing" : "الملخص التنفيذي للمحفظة"}</span>
                    <span className="rounded-md bg-surface px-1.5 py-0.5 text-[9px] font-bold text-text-muted opacity-0 group-hover:opacity-100 transition-opacity">
                      {isEn ? "Overview" : "نظرة عامة"}
                    </span>
                  </div>
                  <span className="text-[11px] text-text-muted">{isEn ? "Liquidity health & priority collection plan" : "مؤشرات السيولة وخطة التحصيل ذات الأولوية"}</span>
                </div>
              </button>

              <button
                type="button"
                data-testid="ai-menu-assistant-btn"
                onClick={() => {
                  setAiMenuOpen(false);
                  setCopilotConfig({ tab: "assistant" });
                  setCopilotOpen(true);
                }}
                className="group flex items-center gap-3 rounded-2xl p-2.5 text-start text-xs font-semibold text-text transition-all duration-200 hover:bg-callout hover:text-primary hover:translate-x-1 active:scale-[0.98]"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition-transform group-hover:scale-110">
                  <Robot size={16} weight="fill" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold">{isEn ? "Ask AI Assistant" : "محادثة حية مع الذكاء الاصطناعي"}</span>

                  </div>
                  <span className="text-[11px] text-text-muted">{isEn ? "Instant answers & ledger deep-dive" : "استفسارات حية عن الدفاتر ومطابقة المعاملات"}</span>
                </div>
              </button>

              <button
                type="button"
                data-testid="ai-menu-reminder-btn"
                onClick={() => {
                  setAiMenuOpen(false);
                  setCopilotConfig({ tab: "composer", mode: "reminder" });
                  setCopilotOpen(true);
                }}
                className="group flex items-center gap-3 rounded-2xl p-2.5 text-start text-xs font-semibold text-text transition-all duration-200 hover:bg-callout hover:text-primary hover:translate-x-1 active:scale-[0.98]"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-teal-500/10 text-teal-600 dark:text-teal-400 transition-transform group-hover:scale-110">
                  <WhatsappLogo size={16} weight="fill" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold">{isEn ? "Smart Reminder Draft" : "صياغة تذكير ذكي للواتساب"}</span>
                    <span className="rounded-md bg-surface px-1.5 py-0.5 text-[9px] font-bold text-text-muted opacity-0 group-hover:opacity-100 transition-opacity">
                      WhatsApp
                    </span>
                  </div>
                  <span className="text-[11px] text-text-muted">{isEn ? "Context-aware payment reminders" : "رسائل ودية أو حازمة في أفضل وقت إرسال"}</span>
                </div>
              </button>

              <button
                type="button"
                data-testid="ai-menu-installment-btn"
                onClick={() => {
                  setAiMenuOpen(false);
                  setCopilotConfig({ tab: "composer", mode: "installment" });
                  setCopilotOpen(true);
                }}
                className="group flex items-center gap-3 rounded-2xl p-2.5 text-start text-xs font-semibold text-text transition-all duration-200 hover:bg-callout hover:text-primary hover:translate-x-1 active:scale-[0.98]"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400 transition-transform group-hover:scale-110">
                  <CalendarCheck size={16} weight="fill" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold">{isEn ? "Installment Settlement Plan" : "جدولة مديونية على أقساط"}</span>
                    <span className="rounded-md bg-surface px-1.5 py-0.5 text-[9px] font-bold text-text-muted opacity-0 group-hover:opacity-100 transition-opacity">
                      Plan
                    </span>
                  </div>
                  <span className="text-[11px] text-text-muted">{isEn ? "Structured tranches with down payment" : "تقسيط المبالغ المتأخرة وصياغة عرض التسوية"}</span>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* Trigger Button with Ambient Glow Ring */}
        <button
          type="button"
          data-testid="ai-copilot-trigger-btn"
          onClick={() => {
            if (copilotOpen) {
              setCopilotOpen(false);
            } else {
              setAiMenuOpen((v) => !v);
            }
          }}
          aria-label={isEn ? "AI Assistant Menu" : "قائمة المساعد الذكي"}
          title={
            isEn
              ? `AI Assistant (${priorityCount} actions, ${healthStatus})`
              : `المساعد الذكي (${priorityCount} إجراءات، حالة ${healthStatus === "urgent" ? "عاجلة" : healthStatus === "attention" ? "متابعة" : "مستقرة"})`
          }
          className={`group flex items-center gap-3 rounded-full border px-4 py-2.5 shadow-2xl transition-all duration-200 hover:scale-105 active:scale-95 ${
            copilotOpen || aiMenuOpen
              ? "border-primary bg-surface text-primary shadow-[0_10px_30px_rgba(0,0,0,0.15)] ring-2 ring-primary/20"
              : healthStatus === "urgent"
                ? "border-status-overdue-border bg-primary text-primary-fg hover:bg-primary-hover shadow-status-overdue-border/30 ring-2 ring-status-overdue-fg/30"
                : "border-primary/40 bg-primary text-primary-fg hover:bg-primary-hover shadow-[0_10px_30px_color-mix(in_srgb,var(--primary)_25%,transparent)] ring-2 ring-primary/20"
          }`}
        >
          <span
            className={`relative flex size-8 items-center justify-center rounded-full transition-colors ${
              copilotOpen || aiMenuOpen ? "bg-callout text-primary" : "bg-white/20 text-white"
            }`}
          >
            <ChatCircleDots size={20} weight="fill" aria-hidden />
            {healthStatus === "urgent" ? (
              <span className="absolute -end-0.5 -top-0.5 flex size-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-status-overdue-fg opacity-75" />
                <span className="relative inline-flex size-2.5 rounded-full border border-surface bg-status-overdue-fg" />
              </span>
            ) : healthStatus === "attention" ? (
              <span
                className="absolute -end-0.5 -top-0.5 size-2.5 rounded-full border border-surface bg-status-due-fg"
                aria-hidden
              />
            ) : (
              <span
                className="absolute -end-0.5 -top-0.5 size-2.5 rounded-full border border-surface bg-status-paid-fg"
                aria-hidden
              />
            )}
          </span>
          <span className="flex flex-col items-start text-start">
            <span className="flex items-center gap-1.5 text-xs font-black leading-tight">
              <Sparkle size={12} weight="fill" aria-hidden />
              <span>{isEn ? "DAFQLY Copilot" : "المساعد الذكي"}</span>
              {priorityCount > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] font-black ${
                    copilotOpen || aiMenuOpen
                      ? "bg-primary text-primary-fg"
                      : "bg-white/25 text-white"
                  }`}
                >
                  {priorityCount}
                </span>
              )}
            </span>
            <span className="hidden text-[10px] font-medium opacity-90 sm:inline">
              {copilotOpen
                ? isEn
                  ? "Close window"
                  : "إغلاق النافذة"
                : aiMenuOpen
                  ? isEn
                    ? "Choose action (Esc to close)"
                    : "اختر إجراءً سريعاً (Esc للإغلاق)"
                  : healthStatus === "urgent"
                    ? isEn
                      ? `${priorityCount} urgent action(s)`
                      : `${priorityCount} إجراءات عاجلة مقترحة`
                    : healthStatus === "attention"
                      ? isEn
                        ? "Follow-ups recommended"
                        : "متابعات مقترحة للسيولة"
                      : isEn
                        ? "Ledger healthy & up to date"
                        : "السيولة مستقرة ومحدثة"}
            </span>
          </span>
          <CaretUp size={13} weight="bold" className={`transition-transform duration-200 ${aiMenuOpen ? "rotate-180" : ""}`} />
        </button>
      </div>

      <CommandPalette isOpen={searchOpen} onClose={() => setSearchOpen(false)} locale={locale} />
      <AiCopilotDrawer
        isOpen={copilotOpen}
        onClose={() => setCopilotOpen(false)}
        locale={locale}
        initialTab={copilotConfig.tab}
        initialDebtorId={copilotConfig.debtorId}
        initialTone={copilotConfig.tone}
        initialMode={copilotConfig.mode}
      />
    </div>
    </CurrencyProvider>
  );
}
