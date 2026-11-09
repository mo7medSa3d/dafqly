"use client";
import Link from "next/link";
import { useTranslations } from "next-intl";

/** Primary navigation across the M1 sections (dashboard, debtors, invoices, import). */
export function AppNav({ locale }: { locale: string }) {
  const t = useTranslations("nav");
  const items = [
    { href: "dashboard", label: t("dashboard"), testid: "nav-dashboard" },
    { href: "debtors", label: t("debtors"), testid: "nav-debtors" },
    { href: "invoices", label: t("invoices"), testid: "nav-invoices" },
    { href: "import", label: t("import"), testid: "nav-import" },
    { href: "ledger-photo", label: t("ledgerPhoto"), testid: "nav-ledger-photo" },
    { href: "ai-inbox", label: t("aiInbox"), testid: "nav-ai-inbox" },
    { href: "cheques", label: t("cheques"), testid: "nav-cheques" },
  ];
  return (
    <nav aria-label="primary" className="flex flex-wrap gap-2">
      {items.map((i) => (
        <Link key={i.href} data-testid={i.testid} href={`/${locale}/${i.href}`}
          className="min-h-touch rounded-md border border-border bg-surface px-4 py-2 font-bold text-text hover:border-primary">
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
