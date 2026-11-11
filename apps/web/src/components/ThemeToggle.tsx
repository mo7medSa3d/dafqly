"use client";
import { useEffect, useState } from "react";
import { Moon, Sun } from "@phosphor-icons/react";
import { useLocale } from "next-intl";

export function ThemeToggle({
  className = "",
  size = "md",
}: {
  className?: string;
  size?: "sm" | "md";
}) {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [mounted, setMounted] = useState(false);
  const locale = useLocale();
  const isEn = locale === "en";

  useEffect(() => {
    setMounted(true);
    const syncTheme = () => {
      try {
        const saved = window.localStorage.getItem("dafqly-theme") as "light" | "dark" | null;
        const cookieMatch = document.cookie.match(/(?:^|; )dafqly-theme=([^;]*)/);
        const fromCookie = cookieMatch?.[1] as "light" | "dark" | undefined;
        const fromDoc = document.documentElement.dataset.theme as "light" | "dark" | undefined;
        const resolved = saved ?? fromCookie ?? fromDoc ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
        setTheme(resolved);
        if (document.documentElement.dataset.theme !== resolved) {
          document.documentElement.dataset.theme = resolved;
        }
        document.cookie = `dafqly-theme=${resolved}; path=/; max-age=31536000; SameSite=Lax`;
      } catch { /* ignore */ }
    };

    syncTheme();

    const observer = new MutationObserver(() => {
      const current = document.documentElement.dataset.theme as "light" | "dark" | undefined;
      if (current === "light" || current === "dark") {
        setTheme(current);
      }
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    window.addEventListener("storage", syncTheme);
    return () => {
      observer.disconnect();
      window.removeEventListener("storage", syncTheme);
    };

  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      window.localStorage.setItem("dafqly-theme", next);
      document.cookie = `dafqly-theme=${next}; path=/; max-age=31536000; SameSite=Lax`;
    } catch { /* ignore */ }
  }

  const label = theme === "dark"
    ? (isEn ? "Switch to light mode" : "تفعيل الوضع النهاري")
    : (isEn ? "Switch to dark mode" : "تفعيل الوضع الليلي");

  const sizeCls = size === "sm" ? "size-8" : "size-9";
  const iconSize = size === "sm" ? 15 : 17;

  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      data-testid="theme-toggle"
      className={`inline-flex ${sizeCls} shrink-0 items-center justify-center rounded-xl bg-surface-muted/60 text-text-muted transition-all hover:bg-callout hover:text-primary active:scale-95 shadow-2xs hover:shadow-xs ${className}`}
    >
      {mounted && theme === "dark" ? (
        <Sun size={iconSize} weight="fill" aria-hidden />
      ) : (
        <Moon size={iconSize} weight="fill" aria-hidden />
      )}
    </button>
  );
}
