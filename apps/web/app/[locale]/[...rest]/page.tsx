import { notFound } from "next/navigation";

/** Unknown paths inside a locale (e.g. /ar/pricing) must reach the
 * [locale] 404 boundary. Without this catch-all Next renders its synthetic
 * /_not-found route, which has no root layout in this i18n tree and 500s. */
export default function CatchAllPage() {
  notFound();
}
