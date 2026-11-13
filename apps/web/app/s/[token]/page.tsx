import { headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { appDb, ownerDb } from "@/server/db";
import { clientIp, rateLimit } from "@/server/rate-limit";
import { getStatementData } from "@/server/statements";
import { StatementClient } from "@/components/StatementClient";
import arMessages from "@/messages/ar.json";
import enMessages from "@/messages/en.json";

/**
 * Public statement page (F10): /s/{token}. Every invalid state — unknown,
 * expired, revoked — renders the SAME generic not-found, and lookups are
 * rate-limited per IP (brute-force defense in depth behind a 256-bit token).
 *
 * F-08: the portal renders in the tenant's language (settings.exportLanguage,
 * default ar) unless ?lang=ar|en overrides it. The /s segment has its own
 * root layout (lang="ar" dir="rtl" shell); the page sets lang/dir on its
 * own wrapper so the English portal still renders LTR inside it.
 */
export default async function StatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ lang?: string }>;
}) {
  const { token } = await params;
  const { lang } = await searchParams;
  const langParam = lang === "ar" || lang === "en" ? lang : null;
  const ip = clientIp(await headers());
  // L8: the page and the API share one read bucket (statement:read:<ip>).
  const limit = rateLimit(`statement:read:${ip}`, { limit: 60, windowSeconds: 60 });
  // The error states render before the tenant is known, so they use the
  // ?lang= override (or Arabic, the app default).
  const errorLocale = langParam ?? "ar";
  const errorMessages = errorLocale === "en" ? enMessages.statementPortal : arMessages.statementPortal;
  if (!limit.allowed) {
    return (
      <main data-testid="statement-rate-limited" className="mx-auto flex min-h-dvh w-full max-w-xl flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-xl font-bold">{errorMessages.rateLimitedTitle}</h1>
        <p className="text-text-muted">{errorMessages.rateLimitedBody}</p>
      </main>
    );
  }
  const data = await getStatementData(appDb(), ownerDb(), token, new Date());
  if (!data) {
    return (
      <main data-testid="statement-not-found" className="mx-auto flex min-h-dvh w-full max-w-xl flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-xl font-bold">{errorMessages.notFoundTitle}</h1>
        <p className="text-text-muted">{errorMessages.notFoundBody}</p>
      </main>
    );
  }
  const locale = langParam ?? (data.language === "en" ? "en" : "ar");
  const messages = locale === "en" ? enMessages : arMessages;
  return (
    <div lang={locale} dir={locale === "ar" ? "rtl" : "ltr"}>
      <NextIntlClientProvider locale={locale} messages={messages}>
        <StatementClient token={token} initial={data} />
      </NextIntlClientProvider>
    </div>
  );
}
