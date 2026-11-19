"use client";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { useLocale, useTranslations } from "next-intl";
import { ArrowsClockwise, SquaresFour } from "@/components/ui/solid-icons";
import { ConnectionErrorIllustration } from "@/components/illustrations";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const locale = useLocale();
  const isEn = locale === "en";
  const tc = useTranslations("common");
  const tn = useTranslations("nav");
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto flex min-h-dvh w-full max-w-xl flex-col items-center justify-center p-6 focus:outline-none"
    >
      <div
        role="alert"
        className="flex w-full flex-col items-center gap-4 rounded-xl border border-border bg-surface px-6 py-10 text-center"
      >
        <ConnectionErrorIllustration size={150} />
        <h1 className="text-lg font-bold text-foreground">{tc("errorTitle")}</h1>
        <p className="max-w-sm text-sm leading-relaxed text-text-muted">
          {isEn
            ? "Something interrupted this view. Your ledger data is safe — try reloading or return to the dashboard."
            : "حدث خطأ غير متوقع في هذه الصفحة. بياناتك آمنة — يمكنك إعادة المحاولة أو العودة إلى لوحة التحكم."}
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2.5">
          <button
            type="button"
            onClick={() => reset()}
            className={cn(buttonVariants({ variant: "default", size: "default" }))}
          >
            <ArrowsClockwise size={18} aria-hidden />
            {tc("retry")}
          </button>
          <Link
            href={`/${locale}/dashboard`}
            className={cn(buttonVariants({ variant: "outline", size: "default" }))}
          >
            <SquaresFour size={18} aria-hidden />
            {tn("dashboard")}
          </Link>
        </div>
      </div>
    </main>
  );
}
