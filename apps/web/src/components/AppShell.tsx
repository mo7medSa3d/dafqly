"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Bank,
  CaretDoubleRight,
  CloudArrowUp,
  CreditCard,
  List,
  Receipt,
  Scan,
  ShieldCheck,
  SlidersHorizontal,
  Sparkle,
  SquaresFour,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import { BrandLockup, BrandMark } from "./BrandMark";
import { ThemeToggle } from "./ThemeToggle";
import { LocaleToggle } from "./LocaleToggle";
import { LogoutButton } from "./LogoutButton";
import { InitialAvatar } from "./ui";

const ITEMS = [
  { href: "dashboard", key: "dashboard", testid: "nav-dashboard", Icon: SquaresFour },
  { href: "debtors", key: "debtors", testid: "nav-debtors", Icon: UsersThree },
  { href: "invoices", key: "invoices", testid: "nav-invoices", Icon: Receipt },
  { href: "import", key: "import", testid: "nav-import", Icon: CloudArrowUp },
  { href: "ledger-photo", key: "ledgerPhoto", testid: "nav-ledger-photo", Icon: Scan },
  { href: "ai-inbox", key: "aiInbox", testid: "nav-ai-inbox", Icon: Sparkle },
  { href: "cheques", key: "cheques", testid: "nav-cheques", Icon: Bank },
  { href: "billing", key: "billing", testid: "nav-billing", Icon: CreditCard },
  { href: "settings", key: "settings", testid: "nav-settings", Icon: SlidersHorizontal },
] as const;

export function AppShell({
  locale, businessName, testId, children,
}: {
  locale: string;
  businessName: string;
  testId?: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const isEn = locale === "en";

  const isActive = (href: string) => pathname === `/${locale}/${href}` || pathname.startsWith(`/${locale}/${href}/`);
  const activeItem = ITEMS.find((i) => isActive(i.href)) ?? ITEMS[0];

  return (
    <div className="min-h-dvh bg-bg text-text">
      {/* Mobile Backdrop Overlay */}
      <div
        className={`fixed inset-0 z-40 bg-navy-950/60 backdrop-blur-xs transition-opacity duration-300 lg:hidden ${
          mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />

      {/* Sidebar / Mobile Drawer Navigation */}
      <aside
        className={`fixed inset-y-0 start-0 z-50 flex flex-col border-e border-border bg-surface shadow-2xl transition-transform duration-300 ease-in-out lg:z-40 lg:shadow-none lg:transition-all ${
          collapsed ? "w-[280px] lg:w-[80px]" : "w-[280px] lg:w-[272px]"
        } ${
          mobileOpen ? "translate-x-0" : "max-lg:-translate-x-full rtl:max-lg:translate-x-full lg:translate-x-0"
        }`}
      >
        {/* Drawer / Sidebar Top Header */}
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-border/60 px-4">
          <div className="flex items-center gap-3 overflow-hidden">
            {!collapsed ? (
              <BrandLockup size="md" showTagline locale={locale} />
            ) : (
              <button
                type="button"
                onClick={() => setCollapsed(false)}
                title={isEn ? "Expand sidebar" : "توسيع القائمة"}
                className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-[var(--brand-tile-border)] bg-[var(--brand-tile-bg)] transition-transform hover:scale-105"
              >
                <BrandMark variant="white" size={24} />
              </button>
            )}
          </div>

          {/* Desktop Collapse / Expand Toggle */}
          {!collapsed && (
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              title={isEn ? "Collapse sidebar" : "طي القائمة"}
              className="hidden lg:flex size-8 shrink-0 items-center justify-center rounded-full border border-border text-text-muted transition-colors hover:border-primary hover:bg-callout hover:text-primary"
            >
              <CaretDoubleRight size={15} weight="bold" aria-hidden className="ltr:rotate-180" />
            </button>
          )}

          {/* Mobile Close Button */}
          <button
            type="button"
            data-testid="mobile-menu-close"
            onClick={() => setMobileOpen(false)}
            aria-label={isEn ? "Close menu" : "إغلاق القائمة"}
            className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-border text-text-muted transition-colors hover:border-danger hover:bg-danger-bg hover:text-danger active:scale-95 lg:hidden"
          >
            <X size={18} weight="bold" />
          </button>
        </div>

        {/* Navigation Items (Modern 2026 Luxury Style with Squircle Badges) */}
        <nav aria-label="primary" className="flex flex-1 flex-col gap-1.5 overflow-y-auto px-3 py-4 no-scrollbar lg:py-5">
          {ITEMS.map(({ href, key, testid, Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                data-testid={testid}
                href={`/${locale}/${href}`}
                onClick={() => setMobileOpen(false)}
                aria-current={active ? "page" : undefined}
                title={t(key)}
                className={`group relative flex min-h-[44px] items-center gap-3 rounded-2xl px-3 py-2 text-sm font-semibold transition-all duration-200 ${
                  collapsed ? "lg:justify-center lg:px-0" : ""
                } ${
                  active
                    ? "bg-primary text-primary-fg shadow-sm shadow-primary/25"
                    : "text-text-muted hover:bg-callout hover:text-text hover:translate-x-[-2px] rtl:hover:translate-x-[2px]"
                }`}
              >
                {/* 2026 Modern Squircle Icon Badge */}
                <span
                  className={`flex size-9 shrink-0 items-center justify-center rounded-xl transition-all duration-200 ${
                    active
                      ? "bg-white/20 text-white shadow-xs"
                      : "bg-surface-muted/60 text-text-muted group-hover:bg-primary/10 group-hover:text-primary group-hover:scale-105"
                  }`}
                >
                  <Icon size={20} weight={active ? "fill" : "duotone"} aria-hidden />
                </span>

                <span className={`truncate ${collapsed ? "lg:hidden" : "inline"}`}>{t(key)}</span>

                {/* Active Indicator Dot */}
                {active && !collapsed && (
                  <span className="ms-auto hidden h-2 w-2 rounded-full bg-white lg:inline-block" aria-hidden />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Sidebar Footer with Tenant Profile & Logout */}
        <div className="mt-auto flex shrink-0 flex-col gap-3 border-t border-border p-3.5 lg:p-4">
          <div className="flex items-center gap-3">
            <InitialAvatar name={businessName} size={36} />
            <div className={`min-w-0 flex-1 ${collapsed ? "lg:hidden" : "block"}`}>
              <p className="truncate text-sm font-bold leading-tight">{businessName}</p>
              <p className="truncate text-xs text-text-muted">{isEn ? "Workspace" : "مساحة العمل"}</p>
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

      {/* Main Content Area: Zero offset on mobile (full width), offset on desktop */}
      <div className={`flex min-h-dvh flex-col min-w-0 max-w-full overflow-x-hidden transition-all ps-0 ${
        collapsed ? "lg:ps-[80px]" : "lg:ps-[272px]"
      }`}>
        {/* Top Header Bar */}
        <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-center gap-3">
              {/* Mobile Hamburger Button */}
              <button
                type="button"
                data-testid="mobile-menu-toggle"
                onClick={() => setMobileOpen((v) => !v)}
                aria-label={isEn ? "Open navigation menu" : "فتح القائمة الرئيسية"}
                className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-surface text-text shadow-xs transition-colors hover:border-primary hover:bg-callout hover:text-primary active:scale-95 lg:hidden"
              >
                <List size={22} weight="bold" />
              </button>

              {/* Mobile Brand Link */}
              <Link
                href={`/${locale}/dashboard`}
                className="flex items-center gap-2 lg:hidden"
                title={isEn ? "Dashboard" : "الرئيسية"}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-[var(--brand-tile-border)] bg-[var(--brand-tile-bg)] shadow-xs">
                  <BrandMark variant="white" size={18} />
                </span>
                <span className="text-base font-extrabold text-text">دافقلي</span>
              </Link>

              {/* Desktop Breadcrumb/Page Indicator */}
              <div className="hidden lg:flex min-w-0 items-center gap-2.5">
                <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <activeItem.Icon size={16} weight="fill" aria-hidden />
                </span>
                <span className="truncate text-base font-bold text-text">{t(activeItem.key)}</span>
                <span className="truncate rounded-full border border-border bg-surface-muted px-2.5 py-0.5 text-xs font-medium text-text-muted">
                  {businessName}
                </span>
              </div>
            </div>

            {/* Header Right Controls */}
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="hidden items-center gap-1.5 rounded-full border border-[var(--icon-box-border)] bg-[var(--icon-box-bg)] px-3 py-1 text-xs font-bold text-[var(--icon-box-fg)] md:inline-flex">
                <ShieldCheck size={15} weight="fill" aria-hidden />
                <span>{isEn ? "Encrypted & Secure" : "اتصال آمن ومشفّر"}</span>
              </span>
              <ThemeToggle />
              <LocaleToggle currentLocale={locale} compact />
            </div>
          </div>
        </header>

        {/* Page Content Body */}
        <main
          data-testid={testId}
          className="mx-auto flex w-full max-w-[1600px] min-w-0 flex-1 flex-col gap-6 px-4 pb-12 pt-6 sm:px-6 lg:gap-8 lg:px-8 lg:pt-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
