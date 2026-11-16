import { cookies, headers } from "next/headers";
import { NotFoundContent } from "@/components/NotFoundContent";

/** 404 boundary for routes inside the [locale] segment: rendered when
 * notFound() is called from within the segment (e.g. the layout's
 * invalid-locale guard).
 *
 * NOTE: Next invokes this file with `params` undefined on some render
 * paths (observed 2026-11-13: every [locale] page load logged
 * "Cannot destructure property 'locale' of undefined" from here), so the
 * locale cannot come from params alone — defaulting to "ar" made the EN
 * 404 render Arabic (e2e/quiet-ledger-en.spec.ts). Resolve it the same
 * way the root 404 does: the `x-next-intl-locale` request header the
 * next-intl middleware sets (correct on the first visit), then the
 * NEXT_LOCALE cookie, then "ar".
 *
 * Unmatched URLs (e.g. /ar/no-such-page) do NOT reach this file — Next
 * renders the root app/not-found.tsx for those. */
export default async function NotFoundPage({ params }: { params?: Promise<{ locale: string }> }) {
  const fromParams = (await params)?.locale;
  const headerList = await headers();
  const cookieStore = await cookies();
  const headerLocale = headerList.get("x-next-intl-locale");
  const cookieLocale = cookieStore.get("NEXT_LOCALE")?.value;
  const locale =
    fromParams === "en" || fromParams === "ar"
      ? fromParams
      : headerLocale === "en" || headerLocale === "ar"
        ? headerLocale
        : cookieLocale === "en" || cookieLocale === "ar"
          ? cookieLocale
          : "ar";
  return <NotFoundContent locale={locale} />;
}
