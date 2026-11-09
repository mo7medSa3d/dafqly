"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations, useLocale } from "next-intl";
import { signIn, signUp } from "@/lib/auth-client";
import { BrandMark } from "./BrandMark";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const t = useTranslations("auth");
  const locale = useLocale();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = mode === "signup"
      ? await signUp.email({ name, email, password })
      : await signIn.email({ email, password });
    setBusy(false);
    if (result.error) {
      setError(t("failed"));
      return;
    }
    router.push(`/${locale}`);
    router.refresh();
  }

  const inputCls = "w-full rounded-md border border-border bg-surface px-3 min-h-touch text-text";
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-6 p-6">
      <BrandMark variant="color" size={56} />
      <h1 className="text-2xl font-bold">{mode === "signup" ? t("signupTitle") : t("loginTitle")}</h1>
      <form onSubmit={onSubmit} className="flex w-full flex-col gap-4">
        {mode === "signup" && (
          <label className="flex flex-col gap-1">
            <span>{t("name")}</span>
            <input data-testid="auth-name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span>{t("email")}</span>
          <input data-testid="auth-email" className={inputCls} type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1">
          <span>{t("password")}</span>
          <input data-testid="auth-password" className={inputCls} type="password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </label>
        {error && <p role="alert" className="text-sm">{error}</p>}
        <button data-testid="auth-submit" type="submit" disabled={busy} className="min-h-touch rounded-md bg-primary px-4 font-bold text-primary-fg hover:bg-primary-hover disabled:opacity-60">
          {mode === "signup" ? t("signupCta") : t("loginCta")}
        </button>
      </form>
      <a className="text-link underline" href={`/${locale}/${mode === "signup" ? "login" : "signup"}`}>
        {mode === "signup" ? t("haveAccount") : t("noAccount")}
      </a>
    </main>
  );
}
