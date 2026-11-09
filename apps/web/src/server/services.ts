import { createHmac } from "node:crypto";
import { and, asc, count, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { AppError, parseLimit, type Cursor } from "@tahseel/core";
import { tenants, memberships, auditLog, debtors, invoices, payments, type TenantSettings } from "@tahseel/db/schema";
import { withTenant, type Db } from "@tahseel/db";
import { env } from "./env";

/** HMAC-SHA256 phone hash for F14 groundwork only (ADR-006). Never log the phone itself. */
export function hashPhone(e164: string): string {
  return createHmac("sha256", env().PHONE_HASH_PEPPER).update(e164).digest("hex");
}

export const createTenantInput = z.object({
  businessNameAr: z.string().trim().min(2).max(120),
  businessNameEn: z.string().trim().max(120).optional(),
  timezone: z.string().min(3).max(64).default("Africa/Cairo"),
  quietStart: z.string().regex(/^\d{2}:\d{2}$/).default("21:00"),
  quietEnd: z.string().regex(/^\d{2}:\d{2}$/).default("09:00"),
  fridayMorningSkip: z.boolean().default(false),
  defaultTermsDays: z.number().int().min(0).max(120).default(14),
  tone: z.enum(["polite", "firm"]).default("polite"),
  // BUILD_PLAN §8: onboarding requires confirming a legitimate relationship
  // with the debtors who will be contacted.
  consent: z.literal(true, { errorMap: () => ({ message: "CONSENT_REQUIRED" }) }),
});
export type CreateTenantInput = z.infer<typeof createTenantInput>;

/**
 * Membership directory lookup runs on the owner connection (ADR-008): RLS
 * cannot answer "which tenants does this user belong to" before a tenant
 * context exists. The query is filtered strictly by the verified session's
 * user id and returns ids/roles only — no tenant business data.
 */
export async function listTenantsForUser(owner: Db, userId: string) {
  return owner
    .select({ tenantId: memberships.tenantId, role: memberships.role, businessNameAr: tenants.businessNameAr, timezone: tenants.timezone })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(eq(memberships.userId, userId));
}

export async function createTenantForUser(app: Db, userId: string, input: CreateTenantInput): Promise<{ tenantId: string }> {
  const tenantId = uuidv7();
  const settings: TenantSettings = {
    quietStart: input.quietStart, quietEnd: input.quietEnd,
    fridayMorningSkip: input.fridayMorningSkip, autoCloseEnabled: false,
    defaultChannel: "whatsapp", tone: input.tone,
    defaultTermsDays: input.defaultTermsDays, easternDigits: false,
  };
  await withTenant(app, tenantId, async (tx) => {
    await tx.insert(tenants).values({
      id: tenantId,
      name: input.businessNameEn ?? input.businessNameAr,
      businessNameAr: input.businessNameAr,
      timezone: input.timezone,
      plan: "trial",
      trialEndsAt: new Date(Date.now() + 14 * 86_400_000),
      settings,
    });
    await tx.insert(memberships).values({ tenantId, userId, role: "owner" });
    await tx.insert(auditLog).values({
      tenantId, actorUserId: userId, action: "tenant.created", entity: "tenant", entityId: tenantId,
      after: { businessNameAr: input.businessNameAr, timezone: input.timezone, consent: true },
    });
  });
  return { tenantId };
}

export interface DashboardSummary {
  totalOutstandingMinor: string; // bigint serialized as string (JSON-safe, no floats)
  overdueMinor: string;
  openInvoices: number;
  debtors: number;
  collectedThisMonthMinor: string;
}

export async function getDashboardSummary(app: Db, tenantId: string, todayIso: string): Promise<DashboardSummary> {
  return withTenant(app, tenantId, async (tx) => {
    const openStatuses = ["open", "partially_paid"] as const;
    const [agg] = await tx
      .select({
        outstanding: sql<string>`coalesce(sum(${invoices.amountMinor} - ${invoices.paidMinor}), 0)`,
        overdue: sql<string>`coalesce(sum(case when ${invoices.dueOn} < ${todayIso} then ${invoices.amountMinor} - ${invoices.paidMinor} else 0 end), 0)`,
        openCount: count(),
      })
      .from(invoices)
      .where(inArray(invoices.status, [...openStatuses]));
    const [d] = await tx.select({ c: count() }).from(debtors).where(isNull(debtors.deletedAt));
    // M1: the payments ledger exists now — collected this month is the sum of
    // CONFIRMED payments received in the tenant-local current month.
    const monthPrefix = todayIso.slice(0, 7);
    const [collected] = await tx
      .select({ total: sql<string>`coalesce(sum(${payments.amountMinor}), 0)` })
      .from(payments)
      .where(and(eq(payments.status, "confirmed"), sql`to_char(${payments.receivedOn}, 'YYYY-MM') = ${monthPrefix}`));
    return {
      totalOutstandingMinor: BigInt(agg?.outstanding ?? "0").toString(),
      overdueMinor: BigInt(agg?.overdue ?? "0").toString(),
      openInvoices: agg?.openCount ?? 0,
      debtors: d?.c ?? 0,
      collectedThisMonthMinor: BigInt(collected?.total ?? "0").toString(),
    };
  });
}

export async function listDebtorsPage(app: Db, tenantId: string, opts: { cursor?: Cursor; limit?: number }) {
  const limit = parseLimit(opts.limit);
  return withTenant(app, tenantId, async (tx) => {
    const where = opts.cursor
      ? and(isNull(debtors.deletedAt), gt(debtors.id, opts.cursor.id))
      : isNull(debtors.deletedAt);
    const rows = await tx.select().from(debtors).where(where).orderBy(asc(debtors.id)).limit(limit + 1);
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: items.map((r) => ({ id: r.id, displayName: r.displayName, phoneE164: r.phoneE164, whatsappStatus: r.whatsappStatus, optedOut: r.optedOutAt !== null })),
      nextCursor: hasMore ? { id: items[items.length - 1]!.id } : null,
    };
  });
}

/** Tenant-local "today" (YYYY-MM-DD) in the tenant's timezone. */
export function todayInTimezone(timezone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export { lt, AppError };
