"use client";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { signOut } from "@/lib/auth-client";

export function LogoutButton() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const router = useRouter();
  return (
    <button
      className="min-h-touch rounded-md border border-border px-3"
      onClick={async () => { await signOut(); router.push(`/${locale}/login`); router.refresh(); }}
    >
      {t("logout")}
    </button>
  );
}
