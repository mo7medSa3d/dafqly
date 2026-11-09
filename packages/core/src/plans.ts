/**
 * Plans, quotas and trial guard (BUILD_PLAN F13, ADR-023). Plan limits live
 * in the `plans` CONFIG TABLE at runtime (seeded from PLANS_SEED below);
 * this module holds the seed + the pure quota/trial decisions.
 *
 * PRICES ARE PLACEHOLDERS. Final plan prices and quotas are a human
 * decision (HUMAN_INPUTS #10, still outstanding); priceMinor values below
 * exist so invoices can be generated and MUST be replaced before launch.
 * Nothing in the UI or docs may present them as decided prices.
 */

export interface PlanDef {
  key: string;
  nameAr: string;
  nameEn: string;
  /** Monthly message quota in usage_ledger units (whatsapp_utility + sms); null = unlimited. */
  monthlyMessageQuota: number | null;
  /** PLACEHOLDER price in integer minor units — see the header comment. */
  priceMinor: number;
  features: Record<string, unknown>;
}

export const PLAN_PRICES_ARE_PLACEHOLDERS = true;

export const PLANS_SEED: PlanDef[] = [
  { key: "trial", nameAr: "تجريبي", nameEn: "Trial", monthlyMessageQuota: 100, priceMinor: 0, features: {} },
  { key: "starter", nameAr: "الأساسية", nameEn: "Starter", monthlyMessageQuota: 500, priceMinor: 4900, features: {} },
  { key: "growth", nameAr: "النمو", nameEn: "Growth", monthlyMessageQuota: 2000, priceMinor: 14900, features: {} },
];

export function planByKey(key: string, plans: readonly PlanDef[] = PLANS_SEED): PlanDef | null {
  return plans.find((p) => p.key === key) ?? null;
}

// -------------------------------------------------------------------- quota
export type QuotaState = "ok" | "warn" | "exceeded";
export interface QuotaStatus {
  used: number;
  quota: number | null;
  ratio: number;
  state: QuotaState;
}

/**
 * F13 soft enforcement: warn at 80% of the monthly quota, block sends at
 * 100%. An unlimited plan (quota null) never warns or blocks.
 */
export function quotaStatus(input: { usedUnits: number; quota: number | null }): QuotaStatus {
  const used = Math.max(0, Math.floor(input.usedUnits));
  if (input.quota === null) return { used, quota: null, ratio: 0, state: "ok" };
  const ratio = input.quota > 0 ? used / input.quota : used > 0 ? Infinity : 0;
  const state: QuotaState = ratio >= 1 ? "exceeded" : ratio >= 0.8 ? "warn" : "ok";
  return { used, quota: input.quota, ratio, state };
}

// --------------------------------------------------------------- trial guard
/**
 * Plan-status send guard, MATCHING the reminder engine's existing trial
 * behaviour (packages/reminders prepareTenant): only a tenant still ON the
 * trial plan whose trial_ends_at has passed is blocked. A tenant who moved
 * to a paid plan is never blocked by an old trial date.
 */
export function planAllowsSending(input: { plan: string; trialEndsAt: Date | null }, now: Date): boolean {
  if (input.plan !== "trial") return true;
  if (input.trialEndsAt === null) return true;
  return input.trialEndsAt.getTime() >= now.getTime();
}
