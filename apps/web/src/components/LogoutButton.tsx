"use client";
import { useLocale, useTranslations } from "next-intl";
import { SignOut } from "@phosphor-icons/react";
import { signOut } from "@/lib/auth-client";

export function LogoutButton({
  wide = false,
  compact = false,
}: {
  wide?: boolean;
  compact?: boolean;
}) {
  const t = useTranslations("auth");
  const locale = useLocale();
  return (
    <button
      type="button"
      title={t("logout")}
      aria-label={t("logout")}
      data-testid="logout-btn"
      className={
        compact
          ? "inline-flex size-9 items-center justify-center rounded-xl bg-surface-muted/60 text-text-muted transition-all hover:bg-danger-bg hover:text-danger active:scale-95"
          : `inline-flex min-h-[38px] items-center justify-center gap-2 rounded-xl bg-surface-muted/60 px-4 text-xs font-bold text-text-muted transition-all hover:bg-danger-bg hover:text-danger active:scale-95 ${
              wide ? "w-full min-h-[44px] text-sm" : ""
            }`
      }
      onClick={async () => {
        try {
          await signOut();
        } catch {
          /* ignore error to guarantee navigation */
        }
        window.location.assign(`/${locale}`);
      }}
    >
      <SignOut size={17} weight="fill" aria-hidden />
      {!compact && <span>{t("logout")}</span>}
    </button>
  );
}
