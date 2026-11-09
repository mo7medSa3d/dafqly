import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["ar", "en"],
  defaultLocale: "ar",
});
export type Locale = (typeof routing.locales)[number];

/** dir for a locale: Arabic is RTL (the product is Arabic-first). */
export function localeDir(locale: string): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}
