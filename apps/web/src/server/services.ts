import { createHmac } from "node:crypto";
import { and, asc, count, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { AppError, parseLimit, isValidTimezone, safeTimezone, currencyMinorExponent, type Cursor } from "@tahseel/core";
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
  timezone: z.string().min(3).max(64).refine(isValidTimezone, { message: "timezone must be a valid IANA timezone (e.g. Africa/Cairo)" }).default("Africa/Cairo"),
  quietStart: z.string().regex(/^\d{2}:\d{2}$/).default("21:00"),
  quietEnd: z.string().regex(/^\d{2}:\d{2}$/).default("09:00"),
  fridayMorningSkip: z.boolean().default(false),
  defaultTermsDays: z.number().int().min(0).max(120).default(14),
  tone: z.enum(["polite", "firm"]).default("polite"),
  // BUILD_PLAN §8: onboarding requires confirming a legitimate relationship
  // with the debtors who will be contacted.
  consent: z.literal(true, { error: "CONSENT_REQUIRED" }),
});
export type CreateTenantInput = z.infer<typeof createTenantInput>;

/**
 * Membership directory lookup runs on the owner connection (ADR-008): RLS
 * cannot answer "which tenants does this user belong to" before a tenant
 * context exists. The query is filtered strictly by the verified session's
 * user id and returns ids/roles only — no tenant business data.
 */
export async function listTenantsForUser(owner: Db, userId: string) {
  // M1: deterministic order — every caller takes mine[0], so the oldest
  // membership must always resolve first, not an arbitrary row.
  return owner
    .select({
      tenantId: memberships.tenantId,
      role: memberships.role,
      businessNameAr: tenants.businessNameAr,
      timezone: tenants.timezone,
      settings: tenants.settings,
    })
    .from(memberships)
    .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(tenants.createdAt), asc(tenants.id));
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
  /** M03: gross refunds (reversals) received this month, as a positive
   * magnitude — separate from collected so a cross-month refund is visible
   * instead of silently netting against another month's number. */
  refundedThisMonthMinor: string;
  /** Tenant default currency: the three money fields above are in this
   * currency only (F02 — never summed across currencies). */
  currency: string;
  /** Per-currency outstanding so other-currency money stays visible. */
  byCurrency: { currency: string; outstandingMinor: string; overdueMinor: string; collectedInMonthMinor: string; refundedInMonthMinor: string }[];
}

export async function getDashboardSummary(app: Db, tenantId: string, todayIso: string): Promise<DashboardSummary> {
  return withTenant(app, tenantId, async (tx) => {
    const [tenant] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
    const currency = tenant?.settings.currency ?? "EGP";
    const openStatuses = ["open", "partially_paid"] as const;
    const [agg] = await tx
      .select({
        outstanding: sql<string>`coalesce(sum(${invoices.amountMinor} - ${invoices.paidMinor}), 0)`,
        overdue: sql<string>`coalesce(sum(case when ${invoices.dueOn} < ${todayIso} then ${invoices.amountMinor} - ${invoices.paidMinor} else 0 end), 0)`,
        openCount: count(),
      })
      .from(invoices)
      .where(and(inArray(invoices.status, [...openStatuses]), eq(invoices.currency, currency)));
    const [d] = await tx.select({ c: count() }).from(debtors).where(isNull(debtors.deletedAt));
    // M1: the payments ledger exists now — collected this month is the sum of
    // CONFIRMED payments received in the tenant-local current month.
    // M03: collected (positive rows) and refunded (negative rows) are
    // separate lines — a reversal never nets against another month.
    const monthPrefix = todayIso.slice(0, 7);
    const monthFilter = sql`to_char(${payments.receivedOn}, 'YYYY-MM') = ${monthPrefix}`;
    const [collected] = await tx
      .select({ total: sql<string>`coalesce(sum(${payments.amountMinor}), 0)` })
      .from(payments)
      .where(and(eq(payments.status, "confirmed"), eq(payments.currency, currency), monthFilter, gt(payments.amountMinor, 0n)));
    const [refunded] = await tx
      .select({ total: sql<string>`coalesce(-sum(${payments.amountMinor}), 0)` })
      .from(payments)
      .where(and(eq(payments.status, "confirmed"), eq(payments.currency, currency), monthFilter, lt(payments.amountMinor, 0n)));
    const byCurrencyRows = await tx.execute(sql`
      select currency,
        coalesce(sum(amount_minor - paid_minor) filter (where status in ('open','partially_paid') and amount_minor > paid_minor), 0)::bigint as outstanding,
        coalesce(sum(amount_minor - paid_minor) filter (where status in ('open','partially_paid') and amount_minor > paid_minor and due_on < ${todayIso}::date), 0)::bigint as overdue
      from invoices group by currency order by currency`) as unknown as { currency: string; outstanding: string; overdue: string }[];
    const collectedRows = await tx.execute(sql`
      select currency,
        coalesce(sum(amount_minor) filter (where amount_minor > 0), 0)::bigint as collected,
        coalesce(-sum(amount_minor) filter (where amount_minor < 0), 0)::bigint as refunded
      from payments
      where status = 'confirmed' and to_char(received_on, 'YYYY-MM') = ${monthPrefix}
      group by currency order by currency`) as unknown as { currency: string; collected: string; refunded: string }[];
    const collectedMap = new Map(collectedRows.map((c) => [c.currency, c.collected]));
    const refundedMap = new Map(collectedRows.map((c) => [c.currency, c.refunded]));
    const byCurrency = byCurrencyRows.map((b) => ({
      currency: b.currency, outstandingMinor: b.outstanding, overdueMinor: b.overdue,
      collectedInMonthMinor: collectedMap.get(b.currency) ?? "0",
      refundedInMonthMinor: refundedMap.get(b.currency) ?? "0",
    }));
    for (const c of collectedRows) {
      if (!byCurrency.some((b) => b.currency === c.currency)) {
        byCurrency.push({ currency: c.currency, outstandingMinor: "0", overdueMinor: "0", collectedInMonthMinor: c.collected, refundedInMonthMinor: c.refunded });
      }
    }
    return {
      totalOutstandingMinor: BigInt(agg?.outstanding ?? "0").toString(),
      overdueMinor: BigInt(agg?.overdue ?? "0").toString(),
      openInvoices: agg?.openCount ?? 0,
      debtors: d?.c ?? 0,
      collectedThisMonthMinor: BigInt(collected?.total ?? "0").toString(),
      refundedThisMonthMinor: BigInt(refunded?.total ?? "0").toString(),
      currency,
      byCurrency,
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
      items: items.map((r) => ({ id: r.id, displayName: r.displayName, phoneE164: r.phoneE164, phoneValid: r.phoneValid, whatsappStatus: r.whatsappStatus, optedOut: r.optedOutAt !== null, notes: r.notes, riskFlag: r.riskFlag })),
      nextCursor: hasMore ? { id: items[items.length - 1]!.id } : null,
    };
  });
}

/**
 * Tenant-local "today" (YYYY-MM-DD) in the tenant's timezone. A stored
 * timezone that is no longer valid (legacy row, bad import) falls back to
 * Africa/Cairo instead of throwing a 500 on every request.
 */
export function todayInTimezone(timezone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: safeTimezone(timezone), year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export const updateTenantSettingsInput = z.object({
  businessNameAr: z.string().trim().min(1).max(160).optional(),
  businessNameEn: z.string().trim().max(160).optional(),
  taxId: z.string().trim().max(80).optional(),
  currency: z.enum(["EGP", "SAR", "USD", "AED", "EUR", "KWD", "JPY"]).optional(),
  exportLanguage: z.enum(["ar", "en"]).optional(),
  timezone: z.string().min(3).max(64).refine(isValidTimezone, { message: "timezone must be a valid IANA timezone (e.g. Africa/Cairo)" }).optional(),
  gatewayEnabled: z.boolean().optional(),
  statementLinksEnabled: z.boolean().optional(),
  includePayLinkInReminders: z.boolean().optional(),
  autoCloseEnabled: z.boolean().optional(),
  fridayMorningSkip: z.boolean().optional(),
  tone: z.enum(["polite", "firm"]).optional(),
  defaultTermsDays: z.number().int().min(0).max(120).optional(),
  easternDigits: z.boolean().optional(),
  quietStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  quietEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});
export type UpdateTenantSettingsInput = z.infer<typeof updateTenantSettingsInput>;

export async function getTenantSettingsAndIntegrations(app: Db, tenantId: string) {
  const e = env();
  return withTenant(app, tenantId, async (tx) => {
    const [t] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!t) throw new AppError("NOT_FOUND", "Tenant not found", 404);
    return {
      businessNameAr: t.businessNameAr,
      timezone: t.timezone,
      settings: t.settings,
      integrations: {
        aiConfigured: Boolean(
          (e.GEMINI_API_KEY && e.GEMINI_API_KEY.trim().length > 0) ||
          (e.AI_API_KEY && e.AI_API_KEY.trim().length > 0) ||
          (e.ANTHROPIC_API_KEY && e.ANTHROPIC_API_KEY.trim().length > 0)
        ),
        aiProvider: (e.GEMINI_API_KEY || e.AI_MODEL.includes("gemini")) ? "gemini" : "anthropic",
        llmModelFast: e.AI_MODEL || e.LLM_MODEL_FAST,
        llmModelVision: e.AI_MODEL || e.LLM_MODEL_VISION,
        paymobConfigured: Boolean(e.PAYMOB_SECRET_KEY && e.PAYMOB_PUBLIC_KEY && e.PAYMOB_INTEGRATION_ID && e.PAYMOB_HMAC_SECRET),
        whatsappConfigured: Boolean(e.WHATSAPP_PHONE_NUMBER_ID && e.WHATSAPP_ACCESS_TOKEN),
        smsConfigured: Boolean(e.SMS_API_KEY && e.SMS_PROVIDER),
        dryRunMessaging: e.DRY_RUN_MESSAGING,
        webhooks: {
          paymob: `${e.APP_URL}/api/webhooks/paymob`,
          whatsapp: `${e.APP_URL}/api/webhooks/whatsapp`,
        },
      },
    };
  });
}

export async function updateTenantSettings(app: Db, tenantId: string, actorUserId: string, patch: UpdateTenantSettingsInput) {
  return withTenant(app, tenantId, async (tx) => {
    const [t] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!t) throw new AppError("NOT_FOUND", "Tenant not found", 404);
    const nextSettings: TenantSettings = {
      ...t.settings,
      ...(patch.businessNameEn !== undefined ? { businessNameEn: patch.businessNameEn } : {}),
      ...(patch.taxId !== undefined ? { taxId: patch.taxId } : {}),
      ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
      ...(patch.exportLanguage !== undefined ? { exportLanguage: patch.exportLanguage } : {}),
      ...(patch.gatewayEnabled !== undefined ? { gatewayEnabled: patch.gatewayEnabled } : {}),
      ...(patch.statementLinksEnabled !== undefined ? { statementLinksEnabled: patch.statementLinksEnabled } : {}),
      ...(patch.includePayLinkInReminders !== undefined ? { includePayLinkInReminders: patch.includePayLinkInReminders } : {}),
      ...(patch.autoCloseEnabled !== undefined ? { autoCloseEnabled: patch.autoCloseEnabled } : {}),
      ...(patch.fridayMorningSkip !== undefined ? { fridayMorningSkip: patch.fridayMorningSkip } : {}),
      ...(patch.tone !== undefined ? { tone: patch.tone } : {}),
      ...(patch.defaultTermsDays !== undefined ? { defaultTermsDays: patch.defaultTermsDays } : {}),
      ...(patch.easternDigits !== undefined ? { easternDigits: patch.easternDigits } : {}),
      ...(patch.quietStart !== undefined ? { quietStart: patch.quietStart } : {}),
      ...(patch.quietEnd !== undefined ? { quietEnd: patch.quietEnd } : {}),
    };
    await tx.update(tenants).set({
      settings: nextSettings,
      ...(patch.businessNameAr ? { businessNameAr: patch.businessNameAr } : {}),
      ...(patch.timezone ? { timezone: patch.timezone } : {}),
      updatedAt: new Date(),
    }).where(eq(tenants.id, tenantId));

    if (patch.currency && patch.currency !== t.settings?.currency) {
      const oldCurrency = t.settings?.currency ?? "EGP";
      const newCurrency = patch.currency;
      const oldExp = currencyMinorExponent(oldCurrency);
      const newExp = currencyMinorExponent(newCurrency);

      if (oldExp === newExp) {
        await tx.execute(sql`
          UPDATE invoices SET currency = ${newCurrency}
          WHERE tenant_id = ${tenantId} AND currency = ${oldCurrency}
        `);
        await tx.execute(sql`
          UPDATE payments SET currency = ${newCurrency}
          WHERE tenant_id = ${tenantId} AND currency = ${oldCurrency}
        `);
        await tx.execute(sql`
          UPDATE cheques SET currency = ${newCurrency}
          WHERE tenant_id = ${tenantId} AND currency = ${oldCurrency}
        `);
        await tx.execute(sql`
          UPDATE debtors SET credit_currency = ${newCurrency}
          WHERE tenant_id = ${tenantId} AND credit_currency = ${oldCurrency}
        `);
      } else {
        const factor = 10n ** BigInt(Math.abs(newExp - oldExp));
        if (newExp > oldExp) {
          await tx.execute(sql`
            UPDATE invoices SET currency = ${newCurrency},
              amount_minor = amount_minor * ${factor},
              paid_minor = paid_minor * ${factor}
            WHERE tenant_id = ${tenantId} AND currency = ${oldCurrency}
          `);
          await tx.execute(sql`
            UPDATE payments SET currency = ${newCurrency},
              amount_minor = amount_minor * ${factor}
            WHERE tenant_id = ${tenantId} AND currency = ${oldCurrency}
          `);
          await tx.execute(sql`
            UPDATE cheques SET currency = ${newCurrency},
              amount_minor = amount_minor * ${factor}
            WHERE tenant_id = ${tenantId} AND currency = ${oldCurrency}
          `);
          await tx.execute(sql`
            UPDATE debtors SET credit_currency = ${newCurrency},
              credit_balance_minor = credit_balance_minor * ${factor}
            WHERE tenant_id = ${tenantId} AND credit_currency = ${oldCurrency}
          `);
        } else {
          await tx.execute(sql`
            UPDATE invoices SET currency = ${newCurrency},
              amount_minor = amount_minor / ${factor},
              paid_minor = paid_minor / ${factor}
            WHERE tenant_id = ${tenantId} AND currency = ${oldCurrency}
          `);
          await tx.execute(sql`
            UPDATE payments SET currency = ${newCurrency},
              amount_minor = amount_minor / ${factor}
            WHERE tenant_id = ${tenantId} AND currency = ${oldCurrency}
          `);
          await tx.execute(sql`
            UPDATE cheques SET currency = ${newCurrency},
              amount_minor = amount_minor / ${factor}
            WHERE tenant_id = ${tenantId} AND currency = ${oldCurrency}
          `);
          await tx.execute(sql`
            UPDATE debtors SET credit_currency = ${newCurrency},
              credit_balance_minor = credit_balance_minor / ${factor}
            WHERE tenant_id = ${tenantId} AND credit_currency = ${oldCurrency}
          `);
        }
      }
    }
    await tx.insert(auditLog).values({
      tenantId, actorUserId, action: "tenant.settings_updated", entity: "tenant", entityId: tenantId,
      before: t.settings as never, after: nextSettings as never,
    });
    return { settings: nextSettings };
  });
}

export { lt, AppError };
