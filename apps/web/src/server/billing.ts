import { and, eq, inArray } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  AppError, PLANS_SEED, PLAN_PRICES_ARE_PLACEHOLDERS, localDateOf, planByKey, quotaStatus,
  type PlanDef, type QuotaStatus,
} from "@tahseel/core";
import { auditLog, plans as plansTable, subscriptionInvoices, tenants, usageLedger } from "@tahseel/db/schema";
import { withTenant, type Db } from "@tahseel/db";
import type { PaymentProvider } from "@tahseel/providers";

/**
 * F13 plans, quotas and billing. Plan limits come from the `plans` CONFIG
 * TABLE at runtime (seeded by migration 0007 from core PLANS_SEED; the core
 * seed is only the fallback if the table is somehow empty). Prices in the
 * table are PLACEHOLDERS pending HUMAN_INPUTS #10 — never present them as
 * decided. Metering is usage_ledger units of kind whatsapp_utility in the
 * tenant-local calendar month (F-09: the "sms" kind is metered by the same
 * code path only if an SMS adapter ever ships — none is shipped, the
 * NotConfiguredSmsProvider fails closed, and no user-facing copy promises
 * SMS sending).
 */

async function audit(tx: Db, tenantId: string, actor: string | null, action: string, entity: string, entityId: string, after: unknown) {
  await tx.insert(auditLog).values({
    tenantId, actorUserId: actor, action, entity, entityId,
    before: null, after: (after ?? null) as never,
  });
}

/** The plan catalogue from the config table (platform-level, no RLS). Falls back to the core seed if unseeded. */
export async function getPlanCatalogue(db: Db): Promise<PlanDef[]> {
  const rows = await db.select().from(plansTable);
  if (rows.length === 0) return PLANS_SEED;
  return rows.map((r) => ({
    key: r.key, nameAr: r.nameAr, nameEn: r.nameEn,
    monthlyMessageQuota: r.monthlyMessageQuota, priceMinor: Number(r.priceMinor),
    features: r.features ?? {},
  }));
}

export interface TenantQuota extends QuotaStatus {
  planKey: string;
  month: string; // YYYY-MM in the tenant timezone
}

/** Current-month message quota status for a tenant. */
export async function getQuotaStatus(app: Db, tenantId: string, now: Date = new Date()): Promise<TenantQuota> {
  const catalogue = await getPlanCatalogue(app);
  return withTenant(app, tenantId, async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant) throw new AppError("NOT_FOUND", "Tenant not found", 404);
    const tz = tenant.timezone ?? "Africa/Cairo";
    const month = localDateOf(now, tz).slice(0, 7);
    const rows = await tx.select().from(usageLedger)
      .where(and(eq(usageLedger.tenantId, tenantId), inArray(usageLedger.kind, ["whatsapp_utility", "sms"])));
    let used = 0;
    for (const r of rows) {
      if (localDateOf(r.at, tz).slice(0, 7) === month) used += r.units;
    }
    const plan = planByKey(tenant.plan, catalogue) ?? planByKey("trial", catalogue)!;
    const qs = quotaStatus({ usedUnits: used, quota: plan.monthlyMessageQuota });
    return { ...qs, planKey: tenant.plan, month };
  });
}

/** Dispatcher hook (F13): true when sends must be blocked for quota. Fail-open on lookup errors is the ENGINE's choice (it catches). */
export async function isQuotaExceeded(app: Db, tenantId: string, now: Date = new Date()): Promise<boolean> {
  const qs = await getQuotaStatus(app, tenantId, now);
  return qs.state === "exceeded";
}

// ------------------------------------------------------- subscription flow
export const changePlanInput = z.object({ planKey: z.string().trim().min(1).max(32) });
export type ChangePlanInput = z.infer<typeof changePlanInput>;

export interface SubscriptionInvoiceView {
  id: string; planKey: string; periodStart: string; periodEnd: string;
  amountMinor: string; status: string; providerRef: string | null;
}

const toInvoiceView = (r: typeof subscriptionInvoices.$inferSelect): SubscriptionInvoiceView => ({
  id: r.id, planKey: r.planKey, periodStart: r.periodStart, periodEnd: r.periodEnd,
  amountMinor: r.amountMinor.toString(), status: r.status, providerRef: r.providerRef,
});

function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1 + months, d));
  return dt.toISOString().slice(0, 10);
}

export interface BillingDeps { app: Db; provider: PaymentProvider; providerIsFake: boolean }

/**
 * Change plan (F13): a subscription invoice is generated for the new
 * period and pushed through the payment-provider seam.
 * - FAKE provider (dev/tests): the charge "succeeds" instantly, the
 *   invoice is marked paid and the plan upgrade takes effect immediately.
 * - REAL provider: a payment link is created and the invoice stays
 *   `issued` with the intention as providerRef — the plan does NOT change
 *   until payment is confirmed (no real charge runs from here; the live
 *   Paymob subscription flow is the M3 account blocker).
 */
export async function changePlan(
  deps: BillingDeps, tenantId: string, actor: string, input: ChangePlanInput, now: Date = new Date(),
): Promise<{ invoice: SubscriptionInvoiceView; effectiveImmediately: boolean }> {
  const catalogue = await getPlanCatalogue(deps.app);
  const plan = planByKey(input.planKey, catalogue);
  if (!plan) throw new AppError("UNKNOWN_PLAN", `Unknown plan ${input.planKey}`, 400);
  // Prices are placeholders (HUMAN_INPUTS #10, undecided). A paid plan
  // change must never be sold at a placeholder price — not even through
  // the dev fake provider, which used to mark the invoice paid and flip
  // the plan immediately. Free plans (trial, price 0) still apply.
  if (PLAN_PRICES_ARE_PLACEHOLDERS && plan.priceMinor > 0) {
    throw new AppError("PRICING_NOT_FINAL", "Plan prices are not final yet — paid plan changes are disabled until pricing is decided", 409);
  }

  const created = await withTenant(deps.app, tenantId, async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant) throw new AppError("NOT_FOUND", "Tenant not found", 404);
    const periodStart = localDateOf(now, tenant.timezone ?? "Africa/Cairo");
    const periodEnd = addMonthsIso(periodStart, 1);
    const id = uuidv7();
    const [row] = await tx.insert(subscriptionInvoices).values({
      id, tenantId, planKey: plan.key, periodStart, periodEnd,
      amountMinor: BigInt(plan.priceMinor), status: "issued",
    }).onConflictDoUpdate({
      target: [subscriptionInvoices.tenantId, subscriptionInvoices.periodStart],
      set: {
        planKey: plan.key,
        amountMinor: BigInt(plan.priceMinor),
        periodEnd,
        status: "issued",
        updatedAt: new Date(),
      },
    }).returning();
    await audit(tx, tenantId, actor, "subscription.invoice_generated", "subscription_invoice", id, {
      planKey: plan.key, amountMinor: plan.priceMinor, priceIsPlaceholder: true,
    });
    return row!;
  });

  // Free plans (trial, price 0) need no payment: effective immediately.
  if (plan.priceMinor > 0) {
    const link = await deps.provider.createPaymentLink({
      amountMinor: BigInt(plan.priceMinor), currency: "EGP",
      reference: `sub_${created.id}`,
      debtorName: "DAFQLY tenant", debtorEmail: "billing@tahseel.test", debtorPhone: "+201000000000",
    }).catch(() => null);
    if (!deps.providerIsFake) {
      // Real provider: pending payment — record the intention, plan unchanged.
      const updated = await withTenant(deps.app, tenantId, async (tx) => {
        const [row] = await tx.update(subscriptionInvoices)
          .set({ providerRef: link?.transactionId ?? null, updatedAt: new Date() })
          .where(eq(subscriptionInvoices.id, created.id)).returning();
        return row!;
      });
      return { invoice: toInvoiceView(updated), effectiveImmediately: false };
    }
    if (!link) throw new AppError("PAYMENT_FAILED", "The payment provider rejected the subscription charge", 502);
    const paid = await withTenant(deps.app, tenantId, async (tx) => {
      const [row] = await tx.update(subscriptionInvoices)
        .set({ status: "paid", providerRef: link.transactionId, updatedAt: new Date() })
        .where(eq(subscriptionInvoices.id, created.id)).returning();
      await tx.update(tenants).set({ plan: plan.key, updatedAt: new Date() }).where(eq(tenants.id, tenantId));
      await audit(tx, tenantId, actor, "tenant.plan_changed", "tenant", tenantId, { planKey: plan.key, via: "fake_provider" });
      return row!;
    });
    return { invoice: toInvoiceView(paid), effectiveImmediately: true };
  }

  const applied = await withTenant(deps.app, tenantId, async (tx) => {
    const [row] = await tx.update(subscriptionInvoices)
      .set({ status: "paid", providerRef: "free-plan", updatedAt: new Date() })
      .where(eq(subscriptionInvoices.id, created.id)).returning();
    await tx.update(tenants).set({ plan: plan.key, updatedAt: new Date() }).where(eq(tenants.id, tenantId));
    await audit(tx, tenantId, actor, "tenant.plan_changed", "tenant", tenantId, { planKey: plan.key, via: "free" });
    return row!;
  });
  return { invoice: toInvoiceView(applied), effectiveImmediately: true };
}

export async function listSubscriptionInvoices(app: Db, tenantId: string): Promise<SubscriptionInvoiceView[]> {
  return withTenant(app, tenantId, async (tx) => {
    const rows = await tx.select().from(subscriptionInvoices);
    return rows.map(toInvoiceView).sort((a, b) => (a.periodStart < b.periodStart ? 1 : -1));
  });
}

/**
 * Billing job (F13): generate the current period's subscription invoice for
 * every non-trial tenant that lacks one. Idempotent per (tenant,
 * periodStart) via the unique index + onConflictDoNothing. Runs on the
 * OWNER connection to enumerate tenants; each invoice is written inside
 * withTenant. Invoices are generated `issued` — charging them is the
 * provider flow in changePlan / a future webhook, never this job.
 */
export async function generateSubscriptionInvoices(owner: Db, app: Db, now: Date = new Date()): Promise<{ generated: number }> {
  const catalogue = await getPlanCatalogue(owner);
  const allTenants = await owner.select().from(tenants);
  let generated = 0;
  for (const tenant of allTenants) {
    if (tenant.plan === "trial") continue;
    const plan = planByKey(tenant.plan, catalogue);
    if (!plan) continue;
    const todayIso = localDateOf(now, tenant.timezone ?? "Africa/Cairo");
    const periodStart = todayIso.slice(0, 8) + "01";
    const periodEnd = addMonthsIso(periodStart, 1);
    const inserted = await withTenant(app, tenant.id, async (tx) => {
      // A plan change mid-month creates an invoice whose period STARTS on
      // the change date; the job must not bill the same period twice just
      // because its own period starts on the 1st.
      const existing = await tx.select().from(subscriptionInvoices);
      if (existing.some((i) => i.periodStart <= todayIso && i.periodEnd > todayIso)) return 0;
      const rows = await tx.insert(subscriptionInvoices).values({
        tenantId: tenant.id, planKey: plan.key, periodStart, periodEnd,
        amountMinor: BigInt(plan.priceMinor), status: "issued",
      }).onConflictDoNothing().returning();
      if (rows.length > 0) {
        await audit(tx, tenant.id, null, "subscription.invoice_generated", "subscription_invoice", rows[0]!.id, {
          planKey: plan.key, amountMinor: plan.priceMinor, priceIsPlaceholder: true, job: true,
        });
      }
      return rows.length;
    });
    generated += inserted;
  }
  return { generated };
}
