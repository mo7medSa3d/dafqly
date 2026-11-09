import { headers } from "next/headers";
import { appDb, ownerDb } from "@/server/db";
import { rateLimit } from "@/server/rate-limit";
import { getStatementData } from "@/server/statements";
import { StatementClient } from "@/components/StatementClient";

/**
 * Public statement page (F10): /s/{token}. Every invalid state — unknown,
 * expired, revoked — renders the SAME generic not-found, and lookups are
 * rate-limited per IP (brute-force defense in depth behind a 256-bit token).
 */
export default async function StatementPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const limit = rateLimit(`statement:page:${ip}`, { limit: 60, windowSeconds: 60 });
  if (!limit.allowed) {
    return (
      <main data-testid="statement-rate-limited" className="mx-auto flex min-h-dvh w-full max-w-xl flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-xl font-bold">طلبات كثيرة</h1>
        <p className="text-text-muted">حاول مرة أخرى بعد قليل.</p>
      </main>
    );
  }
  const data = await getStatementData(appDb(), ownerDb(), token, new Date());
  if (!data) {
    return (
      <main data-testid="statement-not-found" className="mx-auto flex min-h-dvh w-full max-w-xl flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-xl font-bold">الرابط غير صالح</h1>
        <p className="text-text-muted">هذا الرابط غير صالح أو انتهت صلاحيته. تواصل مع النشاط التجاري للحصول على رابط جديد.</p>
      </main>
    );
  }
  return <StatementClient token={token} initial={data} />;
}
