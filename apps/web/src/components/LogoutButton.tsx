"use client";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { useLocale, useTranslations } from "next-intl";
import { SignOut } from "@/components/ui/solid-icons";
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
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      title={t("logout")}
      aria-label={t("logout")}
      data-testid="logout-btn"
      className={cn(
        buttonVariants({ variant: "secondary", size: compact ? "icon" : "sm" }),
        "text-text-muted hover:bg-danger-bg hover:text-danger",
        compact ? "size-9" : "min-h-[40px] px-4 text-text",
        !compact && wide && "w-full min-h-[40px] text-sm",
      )}
      onClick={async () => {
        if (busy) return;
        setBusy(true);
        try {
          await signOut();
        } catch {
          /* ignore error to guarantee navigation */
        }
        window.location.assign(`/${locale}`);
      }}
    >
      <SignOut size={17} aria-hidden />
      {!compact && <span>{t("logout")}</span>}
    </button>
  );
}
