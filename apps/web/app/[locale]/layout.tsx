import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import tokens from "@tahseel/brand/tokens.json";
import { routing, localeDir } from "@/i18n/routing";
import { brandFontEnabled } from "@/lib/brand";
import "../globals.css";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// Theme color from the brand tokens (BRAND §9): petrol-700, with a dark variant.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: tokens.color.petrol["700"] },
    { media: "(prefers-color-scheme: dark)", color: tokens.color.petrol["800"] },
  ],
  colorScheme: "light dark",
};

export const metadata: Metadata = {
  title: "تحصيل",
  description: "متابعة المستحقات وتحصيلها",
};

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as "ar" | "en")) notFound();
  setRequestLocale(locale);
  const messages = await getMessages();
  return (
    <html lang={locale} dir={localeDir(locale)} data-brand-font={brandFontEnabled ? "on" : "off"} suppressHydrationWarning>
      <body>
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
