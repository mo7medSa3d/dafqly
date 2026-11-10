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
        const current = document.documentElement.dataset.theme as "light" | "dark" | undefined;
        if (current) {
          setTheme(current);
        } else {
          const saved = window.localStorage.getItem("dafqly-theme") as "light" | "dark" | null;
          const initial = saved ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
          setTheme(initial);
          document.documentElement.dataset.theme = initial;
        }
      } catch { /* ignore */ }
    };

    syncTheme();

    const observer = new MutationObserver(() => syncTheme());
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
      className={`inline-flex ${sizeCls} shrink-0 items-center justify-center rounded-full border border-border-strong/60 bg-surface text-text transition-colors hover:border-primary hover:bg-callout hover:text-primary ${className}`}
    >
      {mounted && theme === "dark" ? (
        <Sun size={iconSize} weight="fill" aria-hidden />
      ) : (
        <Moon size={iconSize} weight="fill" aria-hidden />
      )}
    </button>
  );
}
