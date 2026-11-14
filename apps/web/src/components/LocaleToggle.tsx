"use client";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Globe, SpinnerGap } from "@/components/ui/solid-icons";

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
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isSwitching, setIsSwitching] = useState(false);
  const targetLocale = currentLocale === "ar" ? "en" : "ar";
  const switchedPath = pathname
    ? pathname.replace(new RegExp(`^/${currentLocale}(/|$)`), `/${targetLocale}$1`)
    : `/${targetLocale}`;

  function handleSwitch(e: React.MouseEvent) {
    e.preventDefault();
    if (isPending || isSwitching) return;
    setIsSwitching(true);

    try {
      // 1. Temporarily freeze transitions so the RTL <-> LTR layout flip occurs cleanly without color or shape judder
      document.documentElement.classList.add("switching-locale");

      // 2. Persist theme and locale in cookies & storage for instantaneous server rendering
      const savedTheme = window.localStorage.getItem("dafqly-theme") || document.documentElement.dataset.theme || "light";
      document.cookie = `dafqly-theme=${savedTheme}; path=/; max-age=31536000; SameSite=Lax`;
      document.cookie = `NEXT_LOCALE=${targetLocale}; path=/; max-age=31536000; SameSite=Lax`;
      document.documentElement.dataset.theme = savedTheme;

      // 3. Immediately mirror direction and language attributes on root
      document.documentElement.dir = targetLocale === "ar" ? "rtl" : "ltr";
      document.documentElement.lang = targetLocale;
    } catch { /* ignore */ }

    // 4. Client-side transition (SPA style, like international websites - no full page unload)
    startTransition(() => {
      try {
        router.replace(switchedPath);
        router.refresh();
      } catch {
        window.location.assign(switchedPath);
      } finally {
        setTimeout(() => {
          document.documentElement.classList.remove("switching-locale");
          setIsSwitching(false);
        }, 300);
      }
    });
  }

  const label = currentLocale === "ar" ? "English" : "العربية";
  const shortLabel = currentLocale === "ar" ? "EN" : "ع";
  const title = currentLocale === "ar" ? "Switch to English" : "التحويل إلى العربية";
  // WCAG 2.5.3: in compact mode only the short label ("EN"/"ع") is
  // visible, so the accessible name must start with it — otherwise axe
  // flags label-content-name-mismatch on the dashboard header.
  const accessibleLabel = compact ? `${shortLabel} — ${title}` : title;

  return (
    <button
      type="button"
      onClick={handleSwitch}
      data-testid="locale-toggle"
      title={accessibleLabel}
      aria-label={accessibleLabel}
      disabled={isPending || isSwitching}
      className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "min-h-[36px]", className)}
    >
      {isPending || isSwitching ? (
        <SpinnerGap size={15} strokeWidth={2.5} className="animate-spin text-primary" aria-hidden />
      ) : (
        <Globe size={15} aria-hidden className="shrink-0 text-primary" />
      )}
      <span className={compact ? "hidden sm:inline" : ""}>{label}</span>
      {compact && <span className="sm:hidden">{shortLabel}</span>}
    </button>
  );
}
