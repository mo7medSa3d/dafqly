"use client";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MotionProvider, PageTransition } from "./motion";
import { useTranslations } from "next-intl";
import { Bank, CalendarCheck, ClipboardText, CaretDoubleRight, CaretUp, CloudArrowUp, CreditCard, Lightning, List, MagnifyingGlass, Receipt, Robot, Scan, SlidersHorizontal, Sparkle, SquaresFour, UsersThree, X } from "@/components/ui/solid-icons";
import { WhatsappLogo } from "@/components/ui/icons";
import { BrandLockup, BrandMark } from "./BrandMark";
import { ThemeToggle } from "./ThemeToggle";
import { LocaleToggle } from "./LocaleToggle";
import { LogoutButton } from "./LogoutButton";
import { InitialAvatar } from "./ui";
import { CommandPalette } from "./CommandPalette";
import { DafqlyAiMascot } from "./DafqlyAiMascot";
import { NotificationBell } from "./NotificationBell";
import {
  AiCopilotDrawer,
  type ComposerMode,
  type CopilotTab,
  type OpenCopilotDetail,
} from "./AiCopilotDrawer";
import type { NotificationTone } from "@tahseel/core";
import { trpc } from "@/lib/trpc-client";
import { CurrencyProvider } from "./CurrencyContext";

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
  { id: "core" as const, labelAr: "العمليات", labelEn: "Operations" },
  { id: "ai" as const, labelAr: "الأتمتة والذكاء", labelEn: "Automation" },
  { id: "workspace" as const, labelAr: "الإعدادات", labelEn: "Workspace" },
] as const;

export function AppShell({
  locale,
  businessName,
  currency = "EGP",
  testId,
  demoMode,
  digits = "latin",
  children,
}: {
  locale: string;
  businessName: string;
  currency?: string;
  testId?: string;
  digits?: "latin" | "eastern";
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
  const [quickAsk, setQuickAsk] = useState("");
  const [copilotConfig, setCopilotConfig] = useState<{
    tab: CopilotTab;
    debtorId?: string;
    tone?: NotificationTone;
    mode?: ComposerMode;
    prompt?: string;
  }>({ tab: "assistant" });
  const isEn = locale === "en";

  const [intel, setIntel] = useState<{
    healthStatus: "strong" | "attention" | "urgent";
    topActions: Array<{ debtorId: string; displayName: string }>;
  } | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.sessionStorage.getItem("dafqly:intel-cache");
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { ts: number; data: { healthStatus: "strong" | "attention" | "urgent"; topActions: Array<{ debtorId: string; displayName: string }> } };
      return Date.now() - parsed.ts < 60_000 ? parsed.data : null;
    } catch { return null; }
  });

  useEffect(() => {
    if (intel) return;
    let mounted = true;
    trpc.intelligence.overview
      .query({ syncNotifications: false })
      .then((data) => {
        if (mounted && data) {
          const next = {
            healthStatus: data.healthStatus,
            topActions: data.topActions.map((a) => ({ debtorId: a.debtorId, displayName: a.displayName })),
          };
          setIntel(next);
          try { window.sessionStorage.setItem("dafqly:intel-cache", JSON.stringify({ ts: Date.now(), data: next })); } catch {}
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, [intel]);

  const healthStatus = intel?.healthStatus ?? "strong";
  const priorityCount = intel?.topActions?.length ?? 0;

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
        tab: detail.tab ?? "assistant",
        debtorId: detail.debtorId,
        tone: detail.tone,
        mode: detail.mode,
        prompt: detail.prompt,
      });
      setCopilotOpen(true);
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("dafqly:open-ai-copilot", handleOpenCopilot);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("dafqly:open-ai-copilot", handleOpenCopilot);
    };
  }, []);

  const isActive = (href: string) => pathname === `/${locale}/${href}` || pathname.startsWith(`/${locale}/${href}/`);
  const activeItem = ITEMS.find((i) => isActive(i.href)) ?? ITEMS[0];

  return (
    <MotionProvider>
      <CurrencyProvider currency={currency} locale={locale} digits={digits}>
        <div className="min-h-dvh bg-background text-foreground">
          {/* Mobile Backdrop */}
          <div
            className={`fixed inset-0 z-40 bg-foreground/35 backdrop-blur-xs transition-opacity duration-200 lg:hidden ${
              mobileOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
            }`}
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />

          {/* Vercel-Style Minimalist Sidebar */}
          <aside
            className={`fixed inset-y-0 start-0 z-50 flex flex-col border-e border-border bg-sidebar text-sidebar-foreground transition-transform duration-200 ease-out lg:z-40 lg:transition-[width] ${
              collapsed ? "w-[240px] lg:w-[60px]" : "w-[240px] lg:w-[240px]"
            } ${
              mobileOpen
                ? "pointer-events-auto translate-x-0"
                : "pointer-events-none max-lg:-translate-x-full rtl:max-lg:translate-x-full lg:pointer-events-auto lg:translate-x-0"
            }`}
          >
            {/* Sidebar Brand Header */}
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-3.5">
              <div className="flex min-w-0 flex-1 items-center gap-2.5">
                {!collapsed ? (
                  <BrandLockup size="sm" locale={locale} />
                ) : (
                  <button
                    type="button"
                    onClick={() => setCollapsed(false)}
                    title={isEn ? "Expand sidebar" : "توسيع القائمة"}
                    className="mx-auto flex size-8 items-center justify-center rounded-md border border-border bg-card transition-colors hover:bg-accent"
                  >
                    <BrandMark variant="color" size={18} />
                  </button>
                )}
              </div>

              {!collapsed && (
                <button
                  type="button"
                  onClick={() => setCollapsed(true)}
                  title={isEn ? "Collapse sidebar" : "طي القائمة"}
                  className="hidden size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:inline-flex"
                >
                  <CaretDoubleRight size={14} strokeWidth={2} aria-hidden className="ltr:rotate-180" />
                </button>
              )}

              <button
                type="button"
                data-testid="mobile-menu-close"
                onClick={() => setMobileOpen(false)}
                aria-label={isEn ? "Close menu" : "إغلاق القائمة"}
                className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground lg:hidden"
              >
                <X size={16} />
              </button>
            </div>

            {/* Vercel-Style Flat Navigation */}
            <nav aria-label="primary" className="no-scrollbar flex flex-1 flex-col gap-5 overflow-y-auto px-2.5 py-4">
              {NAV_GROUPS.map((group) => {
                const groupItems = ITEMS.filter((item) => item.group === group.id);
                return (
                  <div key={group.id} className="flex flex-col gap-0.5">
                    <div
                      className={`px-2.5 pb-1.5 text-[11px] font-medium text-muted-foreground ${
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
                                                    onClick={() => setMobileOpen(false)}
                          aria-current={active ? "page" : undefined}
                          title={t(key)}
                          className={cn(
                            "group relative flex h-9.5 items-center gap-2.5 rounded-lg px-2.5 text-[13px] transition-all",
                            collapsed ? "lg:justify-center lg:px-0" : "",
                            active
                              ? "bg-accent font-semibold text-foreground"
                              : "font-medium text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                          )}
                        >
                          <Icon
                            size={16}
                            strokeWidth={active ? 2.2 : 1.8}
                            className={cn("shrink-0", active ? "text-foreground" : "text-muted-foreground group-hover:text-foreground")}
                            aria-hidden
                          />
                          <span className={`flex-1 truncate ${collapsed ? "lg:hidden" : "inline"}`}>
                            {t(key)}
                          </span>
                          {badge && (
                            <span
                              className={cn(
                                "rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground",
                                collapsed ? "lg:hidden" : "inline-flex",
                              )}
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

            {/* Vercel-Style Workspace Footer */}
            <div className="mt-auto flex shrink-0 flex-col gap-2 border-t border-border p-2.5">
              <div className={cn("flex items-center gap-2.5 rounded-md px-2 py-1.5", collapsed && "lg:justify-center lg:px-0")}>
                <InitialAvatar name={businessName} size={30} />
                <div className={`min-w-0 flex-1 ${collapsed ? "lg:hidden" : "block"}`}>
                  <p className="truncate text-xs font-semibold leading-tight text-foreground">{businessName}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {isEn ? "Workspace" : "مساحة العمل"}
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

          {/* Main Content Area */}
          <div
            className={`flex min-h-dvh min-w-0 max-w-full flex-col overflow-x-hidden ps-0 transition-[padding] duration-200 ${
              collapsed ? "lg:ps-[60px]" : "lg:ps-[240px]"
            }`}
          >
            {/* Vercel-Style Top Header */}
            <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-xl">
              <div className="flex h-14 w-full items-center justify-between gap-3 px-4 sm:px-6 lg:px-8 2xl:px-10">
                <div className="flex min-w-0 items-center gap-3">
                  <button
                    type="button"
                    data-testid="mobile-menu-toggle"
                    onClick={() => setMobileOpen((v) => !v)}
                    aria-label={isEn ? "Open navigation menu" : "فتح القائمة الرئيسية"}
                    className={cn(buttonVariants({ variant: "outline", size: "icon" }), "size-9 shrink-0 lg:hidden")}
                  >
                    <List size={18} />
                  </button>

                  <Link href={`/${locale}/dashboard`} className="flex items-center gap-2 lg:hidden">
                    <BrandMark variant="color" size={20} />
                    <span className="text-sm font-extrabold text-foreground">{isEn ? "Dafqly" : "دفقلي"}</span>
                  </Link>

                  {/* Vercel Breadcrumb */}
                  <div className="hidden min-w-0 items-center gap-2 text-sm lg:flex">
                    <span className="font-semibold text-muted-foreground">{businessName}</span>
                    <span className="text-border">/</span>
                    <span className="flex items-center gap-1.5 font-semibold text-foreground">
                      <activeItem.Icon size={15} className="text-muted-foreground" aria-hidden />
                      {t(activeItem.key)}
                    </span>
                  </div>
                </div>

                {/* Right Controls */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    data-testid="global-search-btn"
                    onClick={() => setSearchOpen(true)}
                    className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-card px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
                    title={isEn ? "Quick search & commands (Ctrl+K)" : "بحث سريع وأوامر (Ctrl+K)"}
                  >
                    <MagnifyingGlass size={13} />
                    <span className="hidden sm:inline">{isEn ? "Search..." : "بحث..."}</span>
                    <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground md:inline-block">
                      ⌘K
                    </kbd>
                  </button>

                  <NotificationBell locale={locale} />
                  <ThemeToggle size="sm" />
                  <LocaleToggle currentLocale={locale} compact />
                </div>
              </div>
            </header>

            {demoMode && (demoMode.dryRunMessaging || demoMode.fakeAi || demoMode.fakePayments) && (
              <div
                data-testid="demo-mode-banner"
                role="status"
                className="border-b border-status-due-fg/30 bg-status-due-bg px-4 py-2 text-center text-xs font-bold text-status-due-fg sm:px-6"
              >
                {isEn ? "Demo mode — simulated: " : "وضع تجريبي — محاكاة: "}
                {[
                  demoMode.dryRunMessaging ? (isEn ? "messages are queued, not sent" : "الرسائل تُحفظ ولا تُرسل") : null,
                  demoMode.fakeAi ? (isEn ? "AI answers are simulated (no API key)" : "إجابات الذكاء الاصطناعي محاكاة (لا يوجد مفتاح API)") : null,
                  demoMode.fakePayments ? (isEn ? "payment links are simulated (Paymob not connected)" : "روابط الدفع محاكاة (Paymob غير متصل)") : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            )}

            <main
              data-testid={testId}
              className="flex w-full min-w-0 flex-1 flex-col gap-6 px-4 pb-24 pt-6 sm:px-6 lg:px-8 2xl:px-10"
            >
              <PageTransition>{children}</PageTransition>
            </main>
          </div>

          {/* Sleek Chat-First Floating AI Launcher & Menu */}
          <div className="fixed bottom-4 end-4 z-40 flex flex-col items-end gap-2.5 sm:bottom-5 sm:end-5">
            {aiMenuOpen && !copilotOpen && (
              <div
                data-testid="ai-assistant-menu"
                className="ai-menu flex w-[min(92vw,340px)] flex-col gap-1.5 rounded-2xl border border-border bg-card/95 p-2.5 shadow-2xl backdrop-blur-2xl"
              >
                <div className="flex items-center justify-between border-b border-border px-2 pb-2.5 pt-1">
                  <div className="flex items-center gap-2">
                    <DafqlyAiMascot size={36} mood="idle" followPointer />
                    <div className="flex flex-col">
                      <span className="text-xs font-bold text-foreground">
                        {isEn ? "DAFQLY AI Chat" : "محادثة دفقلي الذكية"}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {isEn ? "Ask anything about your ledger" : "اسأل عن أي عميل أو فاتورة"}
                      </span>
                    </div>
                  </div>
                  <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[9px] font-semibold text-muted-foreground">
                    Esc
                  </kbd>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!quickAsk.trim()) return;
                    const q = quickAsk.trim();
                    setQuickAsk("");
                    setAiMenuOpen(false);
                    setCopilotConfig({ tab: "assistant", prompt: q });
                    setCopilotOpen(true);
                  }}
                  className="flex items-center gap-1.5 rounded-xl border border-border bg-background p-1 focus-within:border-foreground/40"
                >
                  <input
                    type="text"
                    value={quickAsk}
                    onChange={(e) => setQuickAsk(e.target.value)}
                    placeholder={isEn ? "Ask AI anything..." : "اسأل المساعد مباشرة..."}
                    className="min-w-0 flex-1 bg-transparent px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground outline-none"
                  />
                  <button
                    type="submit"
                    disabled={!quickAsk.trim()}
                    className="rounded-lg bg-primary px-2.5 py-1 text-[11px] font-bold text-primary-foreground disabled:opacity-40"
                  >
                    {isEn ? "Ask" : "اسأل"}
                  </button>
                </form>

                <button
                  type="button"
                  data-testid="ai-menu-assistant-btn"
                  onClick={() => {
                    setAiMenuOpen(false);
                    setCopilotConfig({ tab: "assistant" });
                    setCopilotOpen(true);
                  }}
                  className="group flex w-full items-center gap-3 rounded-xl bg-primary px-3 py-2.5 text-start text-xs text-primary-foreground transition-opacity hover:opacity-90"
                >
                  <Robot size={16} className="shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">{isEn ? "Open AI Chat" : "فتح شات الذكاء الاصطناعي"}</p>
                    <p className="truncate text-[11px] opacity-80">
                      {isEn ? "Live answers on your real data" : "محادثة فورية على بياناتك الحقيقية"}
                    </p>
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
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-start text-xs text-foreground transition-colors hover:bg-accent"
                >
                  <WhatsappLogo size={16} className="shrink-0 text-status-paid-fg" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{isEn ? "Smart Reminder Draft" : "صياغة تذكير ذكي"}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {isEn ? "Context-aware payment reminders" : "رسائل ودية أو حازمة في الوقت المناسب"}
                    </p>
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
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-start text-xs text-foreground transition-colors hover:bg-accent"
                >
                  <CalendarCheck size={16} className="shrink-0 text-[var(--chart-2)]" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{isEn ? "Installment Settlement Plan" : "خطة تقسيط المديونية"}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {isEn ? "Structured tranches & proposal" : "جدولة الأقساط وصياغة العرض"}
                    </p>
                  </div>
                </button>

                <button
                  type="button"
                  data-testid="ai-menu-briefing-btn"
                  onClick={() => {
                    setAiMenuOpen(false);
                    setCopilotConfig({ tab: "briefing" });
                    setCopilotOpen(true);
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-start text-xs text-foreground transition-colors hover:bg-accent"
                >
                  <Lightning size={16} className="shrink-0 text-[var(--chart-1)]" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{isEn ? "Executive Briefing" : "الملخص التنفيذي"}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {isEn ? "Liquidity health & priorities" : "مؤشرات السيولة وأولويات التحصيل"}
                    </p>
                  </div>
                </button>
              </div>
            )}

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
              title={
                isEn
                  ? `AI Assistant (${priorityCount} actions, ${healthStatus})`
                  : `المساعد الذكي (${priorityCount} إجراءات)`
              }
              className={cn(
                "group inline-flex h-11 items-center gap-2.5 rounded-full border px-3.5 text-xs font-bold shadow-lg transition-all",
                copilotOpen || aiMenuOpen
                  ? "border-border bg-card text-foreground"
                  : "border-transparent bg-primary text-primary-foreground hover:bg-primary-hover",
              )}
            >
              <span className="relative flex size-6 items-center justify-center rounded-full">
                <DafqlyAiMascot size={28} mood={aiMenuOpen ? "happy" : healthStatus === "urgent" ? "thinking" : "idle"} />
                <span
                  className={cn(
                    "absolute -end-0.5 -top-0.5 size-2 rounded-full ring-2 ring-background",
                    healthStatus === "urgent"
                      ? "bg-destructive"
                      : healthStatus === "attention"
                        ? "bg-[var(--chart-1)]"
                        : "bg-status-paid-fg",
                  )}
                  aria-hidden
                />
              </span>
              <span>{isEn ? "DAFQLY AI" : "المساعد الذكي"}</span>
              {priorityCount > 0 && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 font-mono text-[10px] font-bold",
                    copilotOpen || aiMenuOpen
                      ? "bg-muted text-foreground"
                      : "bg-primary-foreground/15 text-primary-foreground",
                  )}
                >
                  {priorityCount}
                </span>
              )}
              <CaretUp size={13} aria-hidden className={cn("transition-transform duration-200", aiMenuOpen && "rotate-180")} />
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
            initialPrompt={copilotConfig.prompt}
          />
        </div>
      </CurrencyProvider>
    </MotionProvider>
  );
}
