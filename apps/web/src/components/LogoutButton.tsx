"use client";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  return (
    <button
      type="button"
      title={t("logout")}
      aria-label={t("logout")}
      data-testid="logout-btn"
      className={
        compact
          ? "inline-flex size-9 items-center justify-center rounded-full border border-border-strong/60 bg-surface text-text transition-colors hover:border-primary hover:bg-callout hover:text-primary"
          : `inline-flex min-h-[36px] items-center justify-center gap-2 rounded-full border border-border-strong/60 bg-surface px-4 text-xs font-bold text-text transition-colors hover:border-primary hover:bg-callout ${
              wide ? "w-full min-h-[44px] text-sm" : ""
            }`
      }
      onClick={async () => {
        await signOut();
        router.push(`/${locale}/login`);
        router.refresh();
      }}
    >
      <SignOut size={17} weight="fill" aria-hidden />
      {!compact && <span>{t("logout")}</span>}
    </button>
  );
}
