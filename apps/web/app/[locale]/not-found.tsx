import { NotFoundContent } from "@/components/NotFoundContent";

/** 404 boundary for routes inside the [locale] segment: rendered when
 * notFound() is called from within the segment (e.g. the layout's
 * invalid-locale guard).
 *
 * NOTE: Next invokes this file with `params` undefined on some render
 * paths (observed 2026-11-13: every [locale] page load logged
 * "Cannot destructure property 'locale' of undefined" from here). `params`
 * is therefore optional and defaults to the default locale "ar".
 * Unmatched URLs (e.g. /ar/no-such-page) do NOT reach this file — Next
 * renders the root app/not-found.tsx for those. */
export default async function NotFoundPage({ params }: { params?: Promise<{ locale: string }> }) {
  const { locale } = (await params) ?? { locale: "ar" };
  return <NotFoundContent locale={locale} />;
}
