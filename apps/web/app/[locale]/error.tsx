"use client";
import { useTranslations } from "next-intl";
import { ArrowsClockwise } from "@phosphor-icons/react";
import { ConnectionErrorIllustration } from "@/components/illustrations";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const tc = useTranslations("common");
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col items-center justify-center p-6">
      <div className="panel-shadow flex w-full flex-col items-center gap-4 rounded-2xl border border-border bg-surface px-6 py-10 text-center">
        <ConnectionErrorIllustration size={150} />
        <p className="text-lg font-bold">{tc("errorTitle")}</p>
        <button type="button" onClick={() => reset()} className="inline-flex min-h-touch items-center gap-2 rounded-md bg-primary px-4 py-2 font-bold text-primary-fg transition-colors hover:bg-primary-hover">
          <ArrowsClockwise size={18} weight="fill" aria-hidden />
          {tc("retry")}
        </button>
      </div>
    </main>
  );
}
