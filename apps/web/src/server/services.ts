import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { asc, count, eq, isNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { AppError, isValidTimezone, safeTimezone } from "@tahseel/core";
import { tenants, memberships, auditLog, debtors, invoices, payments, cheques, promisesToPay, type TenantSettings } from "@tahseel/db/schema";
import { withTenant, type Db } from "@tahseel/db";
import { primaryModelFor, resolveLlmProviderConfigs, hasUsableLlmConfig, type LlmProviderConfig } from "@tahseel/providers";
import { env } from "./env";

type AiEnv = ReturnType<typeof env>;
/** Never throws: the settings page must render even when AI_* env is misconfigured. */
function safeLlmConfigs(e: AiEnv): LlmProviderConfig[] {
  try { return resolveLlmProviderConfigs(e); } catch { return []; }
}

/** HMAC-SHA256 phone hash for F14 groundwork only (ADR-006). Never log the phone itself. */
export function hashPhone(e164: string): string {
  return createHmac("sha256", env().PHONE_HASH_PEPPER).update(e164).digest("hex");
}

function whatsappSecretKey(): Buffer {
  return createHash("sha256").update(env().SESSION_SECRET).digest();
}

export function encryptWhatsappToken(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", whatsappSecretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptWhatsappToken(payload: string): string {
  const [version, ivB64, tagB64, dataB64] = payload.split(".");
  if (version !== "v1" || !ivB64 || !tagB64 || !dataB64) {
    throw new AppError("INVALID_SECRET", "Malformed encrypted WhatsApp token", 500);
  }
  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  if (iv.length !== 12 || tag.length !== 16) {
    throw new AppError("INVALID_SECRET", "Malformed encrypted WhatsApp token", 500);
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", whatsappSecretKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new AppError("INVALID_SECRET", "Malformed encrypted WhatsApp token", 500);
  }
}

function sanitizeTenantSettings(s: TenantSettings) {
  const { whatsapp: _wa, ...rest } = s;
  return {
    ...rest,
    gatewayEnabled: s.gatewayEnabled ?? false,
    paymentInstructions: s.paymentInstructions ?? "",
  };
}

function redactSettingsForAudit(s: TenantSettings) {
  const { whatsapp, ...rest } = s;
  return {
    ...rest,
    ...(whatsapp ? { whatsapp: { phoneNumberId: whatsapp.phoneNumberId, wabaId: whatsapp.wabaId ?? null, connected: true } } : {}),
  };
}

export const createTenantInput = z.object({
  businessNameAr: z.string().trim().min(2).max(120),
  businessNameEn: z.string().trim().max(120).optional(),
  timezone: z.string().min(3).max(64).refine(isValidTimezone, { message: "timezone must be a valid IANA timezone (e.g. Africa/Cairo)" }).default("Africa/Cairo"),
  quietStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("21:00"),
  quietEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default("09:00"),
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
  const rows = await owner
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
  return rows.map((r) => ({ ...r, settings: sanitizeTenantSettings(r.settings) }));
}

export async function createTenantForUser(app: Db, userId: string, input: CreateTenantInput): Promise<{ tenantId: string }> {
  const tenantId = uuidv7();
  const settings: TenantSettings = {
    quietStart: input.quietStart, quietEnd: input.quietEnd,
    fridayMorningSkip: input.fridayMorningSkip, autoCloseEnabled: false,
    defaultChannel: "whatsapp", tone: input.tone,
    defaultTermsDays: input.defaultTermsDays, easternDigits: false,
    gatewayEnabled: false,
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
  const monthPrefix = todayIso.slice(0, 7);
  return withTenant(app, tenantId, async (tx) => {
    const [[tenant], [d], byCurrencyRows, collectedRows] = await Promise.all([
      tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)),
      tx.select({ c: count() }).from(debtors).where(isNull(debtors.deletedAt)),
      tx.execute(sql`
        select currency,
          coalesce(sum(amount_minor - paid_minor) filter (where status in ('open','partially_paid') and amount_minor > paid_minor), 0)::bigint as outstanding,
          coalesce(sum(amount_minor - paid_minor) filter (where status in ('open','partially_paid') and amount_minor > paid_minor and due_on < ${todayIso}::date), 0)::bigint as overdue,
          coalesce(count(*) filter (where status in ('open','partially_paid')), 0)::int as open_count
        from invoices
        where tenant_id = ${tenantId}
        group by currency order by currency`) as unknown as Promise<{ currency: string; outstanding: string; overdue: string; open_count: number }[]>,
      tx.execute(sql`
        select currency,
          coalesce(sum(amount_minor) filter (where amount_minor > 0), 0)::bigint as collected,
          coalesce(-sum(amount_minor) filter (where amount_minor < 0), 0)::bigint as refunded
        from payments
        where tenant_id = ${tenantId} and status = 'confirmed' and to_char(received_on, 'YYYY-MM') = ${monthPrefix}
        group by currency order by currency`) as unknown as Promise<{ currency: string; collected: string; refunded: string }[]>,
    ]);

    const currency = tenant?.settings.currency ?? "EGP";
    const collectedMap = new Map(collectedRows.map((c) => [c.currency, c]));
    const byCurrency = byCurrencyRows.map((b) => {
      const c = collectedMap.get(b.currency);
      return {
        currency: b.currency,
        outstandingMinor: b.outstanding,
        overdueMinor: b.overdue,
        collectedInMonthMinor: c?.collected ?? "0",
        refundedInMonthMinor: c?.refunded ?? "0",
      };
    });
    for (const c of collectedRows) {
      if (!byCurrency.some((b) => b.currency === c.currency)) {
        byCurrency.push({ currency: c.currency, outstandingMinor: "0", overdueMinor: "0", collectedInMonthMinor: c.collected, refundedInMonthMinor: c.refunded });
      }
    }

    const defaultInv = byCurrencyRows.find((b) => b.currency === currency);
    const defaultPay = collectedMap.get(currency);
    return {
      totalOutstandingMinor: BigInt(defaultInv?.outstanding ?? "0").toString(),
      overdueMinor: BigInt(defaultInv?.overdue ?? "0").toString(),
      openInvoices: Number(defaultInv?.open_count ?? 0),
      debtors: d?.c ?? 0,
      collectedThisMonthMinor: BigInt(defaultPay?.collected ?? "0").toString(),
      refundedThisMonthMinor: BigInt(defaultPay?.refunded ?? "0").toString(),
      currency,
      byCurrency,
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
  paymentInstructions: z.string().trim().max(1000).optional(),
  whatsapp: z.object({
    phoneNumberId: z.string().trim().min(1).max(64),
    wabaId: z.string().trim().max(64).optional(),
    accessToken: z.string().trim().min(10).max(512).optional(),
  }).nullable().optional(),
  statementLinksEnabled: z.boolean().optional(),
  includePayLinkInReminders: z.boolean().optional(),
  autoCloseEnabled: z.boolean().optional(),
  fridayMorningSkip: z.boolean().optional(),
  tone: z.enum(["polite", "firm"]).optional(),
  defaultTermsDays: z.number().int().min(0).max(120).optional(),
  easternDigits: z.boolean().optional(),
  quietStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  quietEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
});
export type UpdateTenantSettingsInput = z.infer<typeof updateTenantSettingsInput>;

export async function getTenantSettingsAndIntegrations(app: Db, tenantId: string) {
  const e = env();
  const llmConfigs = safeLlmConfigs(e);
  const llmNames = llmConfigs.map((c) => c.name ?? c.kind);
  return withTenant(app, tenantId, async (tx) => {
    const [t] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!t) throw new AppError("NOT_FOUND", "Tenant not found", 404);
    const wa = t.settings.whatsapp;
    const whatsappConnected = Boolean(wa?.phoneNumberId && wa?.encryptedAccessToken);
    return {
      businessNameAr: t.businessNameAr,
      timezone: t.timezone,
      settings: sanitizeTenantSettings(t.settings),
      integrations: {
        aiConfigured: hasUsableLlmConfig(e),
        aiProvider: llmNames.length ? llmNames.join(" → ") : e.AI_PROVIDER,
        llmModelFast: primaryModelFor(llmConfigs, "fast") ?? "",
        llmModelVision: primaryModelFor(llmConfigs, "vision") ?? "",
        paymobConfigured: Boolean(e.PAYMOB_SECRET_KEY && e.PAYMOB_PUBLIC_KEY && e.PAYMOB_INTEGRATION_ID && e.PAYMOB_HMAC_SECRET),
        whatsappConfigured: Boolean(whatsappConnected || (e.WHATSAPP_PHONE_NUMBER_ID && e.WHATSAPP_ACCESS_TOKEN)),
        whatsappConnected,
        whatsappPhoneNumberId: wa?.phoneNumberId ?? null,
        whatsappWabaId: wa?.wabaId ?? null,
        smsConfigured: false,
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
    const currentCurrency = t.settings.currency ?? "EGP";
    if (patch.currency !== undefined && patch.currency !== currentCurrency) {
      // Cheques and promises do not persist a currency column in the current
      // schema; unlinked records derive their meaning from the tenant default.
      // Include them in the lock or a default-currency edit would rewrite the
      // interpretation of already-entered financial records.
      const [inv, pay, chq, prom] = await Promise.all([
        tx.select({ id: invoices.id }).from(invoices).limit(1),
        tx.select({ id: payments.id }).from(payments).limit(1),
        tx.select({ id: cheques.id }).from(cheques).limit(1),
        tx.select({ id: promisesToPay.id }).from(promisesToPay).limit(1),
      ]);
      if (inv.length > 0 || pay.length > 0 || chq.length > 0 || prom.length > 0) {
        throw new AppError("CURRENCY_LOCKED", "Default currency cannot be changed after financial activity exists. Use an explicit ledger migration instead.", 409);
      }
    }
    const nextSettings: TenantSettings = {
      ...t.settings,
      ...(patch.businessNameEn !== undefined ? { businessNameEn: patch.businessNameEn } : {}),
      ...(patch.taxId !== undefined ? { taxId: patch.taxId } : {}),
      ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
      ...(patch.exportLanguage !== undefined ? { exportLanguage: patch.exportLanguage } : {}),
      ...(patch.gatewayEnabled !== undefined ? { gatewayEnabled: patch.gatewayEnabled } : {}),
      ...(patch.paymentInstructions !== undefined ? { paymentInstructions: patch.paymentInstructions } : {}),
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
    if (patch.whatsapp === null) {
      delete nextSettings.whatsapp;
    } else if (patch.whatsapp !== undefined) {
      const encryptedAccessToken = patch.whatsapp.accessToken
        ? encryptWhatsappToken(patch.whatsapp.accessToken)
        : t.settings.whatsapp?.encryptedAccessToken;
      if (!encryptedAccessToken) {
        throw new AppError("BAD_REQUEST", "WhatsApp access token is required", 400);
      }
      nextSettings.whatsapp = {
        phoneNumberId: patch.whatsapp.phoneNumberId,
        ...(patch.whatsapp.wabaId ? { wabaId: patch.whatsapp.wabaId } : {}),
        encryptedAccessToken,
      };
    }
    await tx.update(tenants).set({
      settings: nextSettings,
      ...(patch.businessNameAr ? { businessNameAr: patch.businessNameAr } : {}),
      ...(patch.timezone ? { timezone: patch.timezone } : {}),
      updatedAt: new Date(),
    }).where(eq(tenants.id, tenantId));
    await tx.insert(auditLog).values({
      tenantId, actorUserId, action: "tenant.settings_updated", entity: "tenant", entityId: tenantId,
      before: redactSettingsForAudit(t.settings) as never, after: redactSettingsForAudit(nextSettings) as never,
    });
    return { settings: sanitizeTenantSettings(nextSettings) };
  });
}
