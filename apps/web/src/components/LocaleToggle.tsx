"use client";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Globe, SpinnerGap } from "@phosphor-icons/react";

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
  const [isPending, setIsPending] = useState(false);
  const targetLocale = currentLocale === "ar" ? "en" : "ar";
  const switchedPath = pathname
    ? pathname.replace(new RegExp(`^/${currentLocale}(/|$)`), `/${targetLocale}$1`)
    : `/${targetLocale}`;

  function handleSwitch(e: React.MouseEvent) {
    e.preventDefault();
    if (isPending) return;
    setIsPending(true);

    try {
      // 1. Temporarily freeze transitions so the RTL <-> LTR layout flip occurs cleanly without color or shape judder
      document.documentElement.classList.add("switching-locale");

      // 2. Persist theme and locale in cookies & storage for instantaneous server rendering
      const savedTheme = window.localStorage.getItem("dafqly-theme") || document.documentElement.dataset.theme || "light";
      document.cookie = `dafqly-theme=${savedTheme}; path=/; max-age=31536000; SameSite=Lax`;
      document.cookie = `NEXT_LOCALE=${targetLocale}; path=/; max-age=31536000; SameSite=Lax`;
      document.documentElement.dataset.theme = savedTheme;
    } catch { /* ignore */ }

    // Professional clean navigation: passes cookies to server so SSR returns exact matching theme and direction
    window.location.assign(switchedPath);
  }

  const label = currentLocale === "ar" ? "English" : "العربية";
  const shortLabel = currentLocale === "ar" ? "EN" : "ع";
  const title = currentLocale === "ar" ? "Switch to English" : "التحويل إلى العربية";

  return (
    <button
      type="button"
      onClick={handleSwitch}
      data-testid="locale-toggle"
      title={title}
      aria-label={title}
      disabled={isPending}
      className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-border-strong/60 bg-surface px-3 py-1 text-xs font-bold text-text transition-colors duration-150 hover:border-primary hover:bg-callout active:scale-95 disabled:opacity-70 ${className}`}
    >
      {isPending ? (
        <SpinnerGap size={15} weight="bold" className="animate-spin text-primary" aria-hidden />
      ) : (
        <Globe size={15} weight="fill" aria-hidden className="shrink-0 text-primary" />
      )}
      <span className={compact ? "hidden sm:inline" : ""}>{label}</span>
      {compact && <span className="sm:hidden">{shortLabel}</span>}
    </button>
  );
}
