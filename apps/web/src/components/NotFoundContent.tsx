import Link from "next/link";
import { getTranslations } from "next-intl/server";
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
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col items-center justify-center p-6">
      <div className="flex w-full flex-col items-center gap-4 rounded-xl border border-border bg-surface px-6 py-10 text-center">
        <ConnectionErrorIllustration size={150} />
        <p className="text-lg font-bold">{tc("notFoundTitle")}</p>
        <p className="text-sm text-text-muted">{tc("notFoundBody")}</p>
        <Link
          href={`/${locale}/dashboard`}
          className="inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-fg transition-colors hover:bg-primary-hover"
        >
          {tn("dashboard")}
        </Link>
      </div>
    </main>
  );
}
