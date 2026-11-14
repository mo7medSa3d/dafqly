"use client";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { ArrowsClockwise } from "@/components/ui/solid-icons";
import { ConnectionErrorIllustration } from "@/components/illustrations";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const tc = useTranslations("common");
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col items-center justify-center p-6">
      <div className="flex w-full flex-col items-center gap-4 rounded-xl border border-border bg-surface px-6 py-10 text-center">
        <ConnectionErrorIllustration size={150} />
        <p className="text-lg font-bold">{tc("errorTitle")}</p>
        <button type="button" onClick={() => reset()} className={cn(buttonVariants({ variant: "default", size: "default" }))}>
          <ArrowsClockwise size={18} aria-hidden />
          {tc("retry")}
        </button>
      </div>
    </main>
  );
}
