import type { Metadata, Viewport } from "next";
import tokens from "@tahseel/brand/tokens.json";
import "../globals.css";
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/700.css";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";

/**
 * Root layout for the public statement pages (/s/...): Arabic-first RTL,
 * noindex (F10). This segment has its own root layout because the app's
 * root layout lives under [locale] and statement URLs carry no locale.
 */
export const metadata: Metadata = {
  title: "كشف حساب — دفقلي",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: tokens.color.navy["700"] },
    { media: "(prefers-color-scheme: dark)", color: tokens.color.navy["800"] },
  ],
  colorScheme: "light dark",
};

export default function StatementLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <head>
        <style
          dangerouslySetInnerHTML={{
            __html: `html,body,*,*::before,*::after{scrollbar-width:none!important;-ms-overflow-style:none!important;}::-webkit-scrollbar,*::-webkit-scrollbar{display:none!important;width:0!important;height:0!important;background:transparent!important;}::-webkit-scrollbar-track,*::-webkit-scrollbar-track,::-webkit-scrollbar-thumb,*::-webkit-scrollbar-thumb,::-webkit-scrollbar-corner,*::-webkit-scrollbar-corner,::-webkit-scrollbar-button,*::-webkit-scrollbar-button{display:none!important;width:0!important;height:0!important;background:transparent!important;}`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
