"use client";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { SignOut } from "@phosphor-icons/react";
import { signOut } from "@/lib/auth-client";

export function LogoutButton({ wide = false }: { wide?: boolean }) {
  const t = useTranslations("auth");
  const locale = useLocale();
  const router = useRouter();
  return (
    <button
      className={`inline-flex min-h-touch items-center justify-center gap-2 rounded-md border border-border bg-surface px-3 font-bold text-text transition-colors hover:border-border-strong ${wide ? "w-full" : ""}`}
      onClick={async () => { await signOut(); router.push(`/${locale}/login`); router.refresh(); }}
    >
      <SignOut size={18} weight="fill" aria-hidden />
      {t("logout")}
    </button>
  );
}
