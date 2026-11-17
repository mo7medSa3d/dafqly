import type { Clock } from "@tahseel/providers";
import {
  dispatchDue, planAllTenants, planForInvoice, planForTenant,
  purgeOldWebhookPayloads, replayFailedWebhooks, type EngineDeps,
} from "@tahseel/reminders";

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

export async function processReplanInvoice(
  deps: TickDeps,
  data: { tenantId: string; invoiceId: string },
): Promise<{ planned: number; cancelled: number; at: string }> {
  if (!data?.tenantId || !data?.invoiceId) {
    throw new Error("replan-invoice requires tenantId and invoiceId");
  }
  const now = deps.clock.now();
  const result = await planForInvoice(deps.engine, data.tenantId, data.invoiceId, now);
  return { ...result, at: now.toISOString() };
}

export async function processReplanTenant(
  deps: TickDeps,
  data: { tenantId: string },
): Promise<{ planned: number; cancelled: number; at: string }> {
  if (!data?.tenantId) {
    throw new Error("replan-tenant requires tenantId");
  }
  const now = deps.clock.now();
  const result = await planForTenant(deps.engine, data.tenantId, now);
  return { ...result, at: now.toISOString() };
}

export async function processDispatchTick(deps: TickDeps): Promise<{
  sent: number; groups: number; rescheduled: number; failed: number; paused: boolean;
  skipped: Record<string, number>; dryRun: boolean; at: string;
}> {
  const now = deps.clock.now();
  const summary = await dispatchDue(deps.engine, now, { tenantId: deps.tenantId });
  return {
    sent: summary.remindersSent, groups: summary.groupsSent,
    rescheduled: summary.rescheduled, failed: summary.failed, paused: summary.paused,
    skipped: summary.skipped, dryRun: deps.dryRun, at: now.toISOString(),
  };
}

/**
 * M3/M6 maintenance tick (nightly): purge webhook/message raw payloads
 * older than 90 days (tombstoned, not deleted, so dedupe keys survive),
 * and replay a bounded batch of failed webhook_events rows.
 */
export async function processMaintenanceTick(deps: TickDeps): Promise<{
  webhookEvents: number; messages: number; replayedWebhooks: number; failedWebhooks: number; at: string;
}> {
  const now = deps.clock.now();
  const purged = await purgeOldWebhookPayloads(deps.engine.owner, 90, now);
  const replayed = await replayFailedWebhooks(deps.engine, now);
  return {
    ...purged,
    replayedWebhooks: replayed.replayed,
    failedWebhooks: replayed.failed,
    at: now.toISOString(),
  };
}
