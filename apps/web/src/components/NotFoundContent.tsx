import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { buttonVariants } from "@/components/ui/button";
import { ConnectionErrorIllustration } from "@/components/illustrations";

/** Shared 404 panel in the Quiet Ledger system: same panel + illustration
 * as the error page, rectangular primary action back to the dashboard.
 *
 * Rendered by app/[locale]/not-found.tsx (the segment boundary — CSS is
 * loaded there, so Tailwind token classes apply). The root
 * app/not-found.tsx cannot use this component: the synthetic /_not-found
 * route renders without the [locale] layout, so no stylesheet loads and
 * these classes would be unstyled; it renders the same panel with inline
 * token styles instead. */
export async function NotFoundContent({ locale }: { locale: string }) {
  // Explicit locale: the /_not-found render path has no setRequestLocale.
  const tc = await getTranslations({ locale, namespace: "common" });
  const tn = await getTranslations({ locale, namespace: "nav" });
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto flex min-h-dvh w-full max-w-xl flex-col items-center justify-center p-6 focus:outline-none"
    >
      <div className="flex w-full flex-col items-center gap-4 rounded-xl border border-border bg-surface px-6 py-10 text-center">
        <ConnectionErrorIllustration size={150} />
        <h1 className="text-lg font-bold text-foreground">{tc("notFoundTitle")}</h1>
        <p className="max-w-sm text-sm leading-relaxed text-text-muted">{tc("notFoundBody")}</p>
        <Link
          href={`/${locale}/dashboard`}
          className={buttonVariants({ variant: "default", size: "default" })}
        >
          {tn("dashboard")}
        </Link>
      </div>
    </main>
  );
}
