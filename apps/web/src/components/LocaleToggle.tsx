"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Globe } from "@phosphor-icons/react";

export function LocaleToggle({
  currentLocale,
  compact = false,
  className = "",
}: {
  currentLocale: string;
  compact?: boolean;
  className?: string;
}) {
  const pathname = usePathname();
  const targetLocale = currentLocale === "ar" ? "en" : "ar";
  const switchedPath = pathname
    ? pathname.replace(new RegExp(`^/${currentLocale}(/|$)`), `/${targetLocale}$1`)
    : `/${targetLocale}`;

  const label = currentLocale === "ar" ? "English" : "العربية";
  const shortLabel = currentLocale === "ar" ? "EN" : "ع";
  const title = currentLocale === "ar" ? "Switch to English" : "التحويل إلى العربية";

  return (
    <Link
      href={switchedPath}
      data-testid="locale-toggle"
      title={title}
      aria-label={title}
      className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-border-strong/60 bg-surface px-3 py-1 text-xs font-bold text-text transition-colors hover:border-primary hover:bg-callout ${className}`}
    >
      <Globe size={15} weight="fill" aria-hidden className="shrink-0 text-primary" />
      <span className={compact ? "hidden sm:inline" : ""}>{label}</span>
      {compact && <span className="sm:hidden">{shortLabel}</span>}
    </Link>
  );
}
