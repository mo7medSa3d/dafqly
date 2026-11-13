import type { Clock } from "@tahseel/providers";
import { dispatchDue, planAllTenants, purgeOldWebhookPayloads, type EngineDeps } from "@tahseel/reminders";

/**
 * Worker processors (M2): the BullMQ ticks call the real reminder engine
 * (ADR-016). The clock is injected so the same code runs on the fake clock
 * in tests.
 */
export interface TickDeps {
  clock: Clock;
  engine: EngineDeps;
  /** True when providers are dry-run wrapped (wiring concern, reported for logs). */
  dryRun: boolean;
  /** Optional single-tenant scope (tests/backfills); default: all tenants. */
  tenantId?: string;
}

export async function processPlannerTick(deps: TickDeps): Promise<{ planned: number; cancelled: number; tenants: number; at: string }> {
  const now = deps.clock.now();
  const result = await planAllTenants(deps.engine, now, { tenantId: deps.tenantId });
  return { ...result, at: now.toISOString() };
}

export async function processDispatchTick(deps: TickDeps): Promise<{
  sent: number; groups: number; skipped: Record<string, number>; dryRun: boolean; at: string;
}> {
  const now = deps.clock.now();
  const summary = await dispatchDue(deps.engine, now, {});
  return {
    sent: summary.remindersSent, groups: summary.groupsSent, skipped: summary.skipped,
    dryRun: deps.dryRun,
    at: now.toISOString(),
  };
}

/**
 * M3/M6 maintenance tick (nightly): purge webhook/message raw payloads
 * older than 90 days (tombstoned, not deleted, so dedupe keys survive).
 */
export async function processMaintenanceTick(deps: TickDeps): Promise<{
  webhookEvents: number; messages: number; at: string;
}> {
  const now = deps.clock.now();
  const purged = await purgeOldWebhookPayloads(deps.engine.owner);
  return { ...purged, at: now.toISOString() };
}
