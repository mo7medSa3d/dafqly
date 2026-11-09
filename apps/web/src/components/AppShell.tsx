"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Checks, FileArrowUp, Notebook, Receipt, Robot, SquaresFour, Users,
} from "@phosphor-icons/react";
import { BRAND } from "@tahseel/brand/brand";
import { BrandMark } from "./BrandMark";
import { LogoutButton } from "./LogoutButton";
import { InitialAvatar } from "./ui";

/**
 * App shell for the v0.9.0 premium redesign. ONE navigation instance that
 * morphs with CSS only: a full sidebar on desktop (brand lockup, filled-icon
 * nav with an active pill, tenant footer) and a bottom navigation bar on
 * mobile under a slim top bar — so every nav testid exists exactly once in
 * the DOM at every viewport.
 */
const ITEMS = [
  { href: "dashboard", key: "dashboard", testid: "nav-dashboard", Icon: SquaresFour },
  { href: "debtors", key: "debtors", testid: "nav-debtors", Icon: Users },
  { href: "invoices", key: "invoices", testid: "nav-invoices", Icon: Receipt },
  { href: "import", key: "import", testid: "nav-import", Icon: FileArrowUp },
  { href: "ledger-photo", key: "ledgerPhoto", testid: "nav-ledger-photo", Icon: Notebook },
  { href: "ai-inbox", key: "aiInbox", testid: "nav-ai-inbox", Icon: Robot },
  { href: "cheques", key: "cheques", testid: "nav-cheques", Icon: Checks },
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
  const isActive = (href: string) => pathname === `/${locale}/${href}` || pathname.startsWith(`/${locale}/${href}/`);

  return (
    <div className="min-h-dvh">
      {/* Mobile top bar */}
      <header className="sticky top-0 z-40 flex items-center gap-3 border-b border-border bg-surface px-4 py-2.5 lg:hidden">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-navy-700">
          <BrandMark variant="white" size={21} />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="font-extrabold">{BRAND.name}</p>
          <p className="truncate text-xs text-text-muted">{businessName}</p>
        </div>
        <LogoutButton />
      </header>

      {/* Rail: sidebar (desktop) / bottom bar (mobile) — single DOM instance */}
      <aside className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface lg:inset-x-auto lg:inset-y-0 lg:start-0 lg:flex lg:w-[268px] lg:flex-col lg:border-e lg:border-t-0">
        <div className="hidden items-center gap-3 px-5 pb-2 pt-6 lg:flex">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-navy-700">
            <BrandMark variant="white" size={26} />
          </span>
          <div className="leading-tight">
            <p className="text-lg font-extrabold">{BRAND.name}</p>
            <p className="text-[11px] font-semibold text-text-subtle">{BRAND.tagline}</p>
          </div>
        </div>

        <nav aria-label="primary" className="flex px-1 pb-[env(safe-area-inset-bottom)] lg:flex-col lg:gap-1 lg:px-3 lg:py-5">
          {ITEMS.map(({ href, key, testid, Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                data-testid={testid}
                href={`/${locale}/${href}`}
                aria-current={active ? "page" : undefined}
                className={`relative flex flex-1 flex-col items-center gap-1 px-1 py-2 text-[11px] font-semibold transition-colors lg:flex-none lg:flex-row lg:gap-3 lg:rounded-lg lg:px-3 lg:py-2.5 lg:text-[15px] ${
                  active
                    ? "text-primary lg:bg-primary lg:text-primary-fg"
                    : "text-text-muted hover:text-text lg:hover:bg-surface-muted"
                }`}
              >
                <span className={`flex items-center justify-center rounded-full px-2.5 py-0.5 lg:p-0 ${active ? "bg-teal-100 dark:bg-surface-muted lg:bg-transparent" : ""}`}>
                  <Icon size={21} weight="fill" aria-hidden />
                </span>
                <span className="max-w-full truncate">{t(key)}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto hidden flex-col gap-3 border-t border-border p-4 lg:flex">
          <div className="flex items-center gap-3 px-1">
            <InitialAvatar name={businessName} size={38} />
            <p className="min-w-0 flex-1 truncate font-bold leading-tight">{businessName}</p>
          </div>
          <LogoutButton wide />
        </div>
      </aside>

      {/* Content */}
      <div className="lg:ps-[268px]">
        <main
          data-testid={testId}
          className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 pb-28 pt-6 sm:px-6 lg:gap-8 lg:px-10 lg:pb-12 lg:pt-10"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
