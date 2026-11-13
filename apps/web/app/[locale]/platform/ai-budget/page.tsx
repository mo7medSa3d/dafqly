import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { eq, gte, sql } from "drizzle-orm";
import { aiGlobalBudget, aiGlobalUsage } from "@tahseel/db";
import { auth } from "@/server/auth";
import { ownerDb } from "@/server/db";
import { env } from "@/server/env";

export const dynamic = "force-dynamic";

const usd = (micros: bigint | string | number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 }).format(Number(micros) / 1_000_000);

export default async function PlatformAiBudgetPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) redirect(`/${locale}/login`);
  const admins = env().PLATFORM_ADMIN_USER_IDS.split(",").map((v) => v.trim()).filter(Boolean);
  if (!admins.includes(session.user.id)) notFound();

  const db = ownerDb();
  const [budget] = await db.select().from(aiGlobalBudget).where(eq(aiGlobalBudget.singletonId, 1)).limit(1);
  if (!budget) notFound();
  const now = new Date();
  const currentPeriod = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const isCurrentPeriod = budget.periodStart === currentPeriod;
  const periodStart = new Date(`${currentPeriod}T00:00:00.000Z`);
  const [usage] = await db.select({
    calls: sql<number>`count(*)::int`,
    actual: sql<string>`coalesce(sum(${aiGlobalUsage.actualUsdMicros}), 0)::text`,
    reserved: sql<string>`coalesce(sum(${aiGlobalUsage.reservedUsdMicros}) filter (where ${aiGlobalUsage.status} = 'reserved'), 0)::text`,
    inputTokens: sql<number>`coalesce(sum(${aiGlobalUsage.inputTokens}), 0)::int`,
    outputTokens: sql<number>`coalesce(sum(${aiGlobalUsage.outputTokens}), 0)::int`,
  }).from(aiGlobalUsage).where(gte(aiGlobalUsage.createdAt, periodStart));
  const [models] = await db.select({ count: sql<number>`count(distinct ${aiGlobalUsage.model})::int` })
    .from(aiGlobalUsage).where(gte(aiGlobalUsage.createdAt, periodStart));
  const cap = BigInt(Math.round(env().AI_GLOBAL_MONTHLY_USD_CAP * 1_000_000));
  const spent = isCurrentPeriod ? budget.spentUsdMicros : 0n;
  const reserved = isCurrentPeriod ? budget.reservedUsdMicros : 0n;
  const remaining = cap > spent + reserved ? cap - spent - reserved : 0n;
  const committed = spent + reserved;
  const usedPct = cap > 0n ? Math.min(100, Number((committed * 10000n) / cap) / 100) : 0;
  const isAr = locale === "ar";

  return <main dir={isAr ? "rtl" : "ltr"} className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-6 bg-bg px-4 py-8 sm:px-6">
    <header><p className="text-xs font-bold uppercase tracking-wider text-primary">DAFQLY PLATFORM OPERATIONS</p><h1 className="mt-2 text-2xl font-extrabold">{isAr ? "مراقبة إنفاق الذكاء الاصطناعي" : "Platform AI spend control"}</h1><p className="mt-1 text-sm text-text-muted">{isAr ? "بيانات على مستوى المنصة بالكامل، لا تخص منشأة واحدة. تغيير السقف يتم من إعدادات بيئة التشغيل." : "Platform-wide telemetry across all tenants. Change the cap through deployment environment configuration."}</p></header>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label={isAr ? "سقف الشهر" : "Monthly cap"} value={usd(cap)}/>
      <Metric label={isAr ? "الإنفاق المسجل" : "Recorded spend"} value={usd(spent)}/>
      <Metric label={isAr ? "محجوز لطلبات جارية" : "Reserved for in-flight calls"} value={usd(reserved)}/>
      <Metric label={isAr ? "متاح قبل الحجز" : "Available before reservations"} value={usd(remaining)}/>
    </section>
    <section className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-center justify-between gap-3"><h2 className="font-extrabold">{isAr ? "استهلاك السقف" : "Cap utilization"}</h2><strong className="tnum" dir="ltr">{usedPct.toFixed(1)}%</strong></div>
      <div className="mt-3 h-3 overflow-hidden rounded-full bg-surface-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${usedPct}%` }}/></div>
      <p className="mt-2 text-xs text-text-muted">{isAr ? `الفترة من ${currentPeriod}. يشمل الإنفاق المحسوب بعد اكتمال استدعاءات المزود.` : `Period started ${currentPeriod}. Spend reflects usage reconciled after provider calls complete.`}</p>
    </section>
    <section className="grid gap-3 sm:grid-cols-3"><Metric label={isAr ? "عدد استدعاءات المزود" : "Provider calls"} value={String(usage?.calls ?? 0)}/><Metric label={isAr ? "Input Tokens" : "Input tokens"} value={Number(usage?.inputTokens ?? 0).toLocaleString("en-US")}/><Metric label={isAr ? "Output Tokens" : "Output tokens"} value={Number(usage?.outputTokens ?? 0).toLocaleString("en-US")}/></section>
    <section className="rounded-2xl border border-amber-500/25 bg-amber-500/5 p-4 text-sm leading-6"><strong>{isAr ? "ملاحظة محاسبية مهمة" : "Metering note"}</strong><p className="mt-1 text-text-muted">{isAr ? "السقف يعمل كـ admission control ذري: يحجز مبلغاً قبل كل استدعاء ويمنع استدعاءات جديدة عند استنفاد المتاح. التكلفة الفعلية تُسوّى بعد وصول Usage من المزود؛ لذلك قد يتجاوز الاستدعاء الجاري السقف بمقدار الفرق بين الحجز والتكلفة الفعلية. استخدم حجزاً محافظاً وراجع فواتير المزود." : "The cap is an atomic admission-control guard: it reserves funds before each provider call and blocks new calls when capacity is exhausted. Actual usage is settled after provider token counts arrive, so an in-flight call can exceed its reservation. Use a conservative per-call reserve and reconcile provider invoices."}</p></section>
    <p className="text-xs text-text-muted">{isAr ? `عدد النماذج المستخدمة في الفترة: ${models?.count ?? 0}.` : `Distinct models used this period: ${models?.count ?? 0}.`} {isAr ? "هذه الشاشة متاحة فقط للمستخدمين المدرجين في PLATFORM_ADMIN_USER_IDS." : "This view is restricted to PLATFORM_ADMIN_USER_IDS."}</p>
  </main>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <article className="rounded-2xl border border-border bg-surface p-4"><p className="text-xs font-semibold text-text-muted">{label}</p><p className="mt-2 break-words text-2xl font-extrabold tracking-tight" dir="ltr">{value}</p></article>;
}
