import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import {
  auditLog, debtors, invoices, messages, optOuts, plans, reminders, statementLinks, tenants, usageLedger,
  withTenant, type Db, type TenantSettings,
} from "@tahseel/db";
import { createHash } from "node:crypto";
import {
  planReminders, groupDueReminders, classifyProviderError, backoffDelayMs, isOptOutText, evaluateQualityGuard,
  normalizeEgPhone, formatEgp, isInQuietHours, nextAllowedSlot, localDateOf, zonedTimeToUtc, quotaStatus,
  STATEMENT_DEFAULT_EXPIRY_DAYS,
  DEFAULT_WEEKLY_CAP, MAX_SEND_ATTEMPTS, type PlanPolicy,
} from "@tahseel/core";
import { generateStatementToken } from "@tahseel/core/payments-crypto";
import { ProviderError, type TextCapableProvider } from "@tahseel/providers";
import { TEMPLATES, renderTemplate, type TemplateKey } from "@tahseel/templates";

/**
 * Reminder engine (BUILD_PLAN F4, ADR-016): planner persistence, dispatcher
 * guards/grouping/caps, sender with retries and SMS fallback. Every function
 * takes an injected `now` and providers, so the acceptance suite runs it on
 * the fake clock against the fake provider with zero network.
 *
 * Data access: `app` is the RLS-bound connection (all tenant work happens
 * inside withTenant), `owner` is used only to enumerate tenants with due
 * reminders and to correlate platform-level webhooks.
 */

export interface EngineProviders {
  whatsapp: TextCapableProvider;
  sms: TextCapableProvider;
}
export interface EngineDeps {
  app: Db;
  owner: Db;
  providers: EngineProviders;
  /** Global kill switch (F4): when true a dispatch tick changes nothing. */
  globalPaused?: boolean;
  /** Provider health gate: when false due reminders are left untouched. */
  providerHealthy?: boolean;
  /** Public app origin, used to build statement URLs for F10 reminder inclusion. */
  appUrl?: string;
  /**
   * F8 hooks (optional, wired by the web webhook route): fired after an
   * inbound message is stored. Text (non-opt-out — keyword opt-out is
   * applied inside the processor first) goes to onInboundReply; media goes
   * to onInboundImage. The engine stays decoupled from the AI services:
   * it only reports what arrived.
   */
  /**
   * F13 quota hook (optional, wired by web/worker): when it resolves true
   * the tenant is at/over its monthly message quota and every due reminder
   * is skipped with `quota_exceeded` at the plan-status position of the
   * guard order. Absent = no quota block (engine unit tests stay pure).
   */
  quotaExceeded?: (tenantId: string) => Promise<boolean>;
  onInboundReply?: (info: { tenantId: string; debtorId: string; messageId: string; text: string }) => Promise<void>;
  onInboundImage?: (info: { tenantId: string; debtorId: string; messageId: string; mediaId: string | null; mediaMime: string | null }) => Promise<void>;
}

/**
 * F13 quota lookup shared by the web and worker wirings: sums this
 * tenant-local month's whatsapp_utility + sms units from usage_ledger and
 * compares with the plan's quota from the `plans` config table (core
 * PLANS_SEED quotas are the fallback if the table row is missing). The
 * decision itself is core's quotaStatus — the same function the billing
 * API uses, so the banner and the block can never disagree.
 */
export async function quotaExceededFromDb(app: Db, tenantId: string, now: Date): Promise<boolean> {
  const planRows = await app.select().from(plans);
  return withTenant(app, tenantId, async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant) return false;
    const tz = tenant.timezone ?? "Africa/Cairo";
    const month = localDateOf(now, tz).slice(0, 7);
    const rows = await tx.select().from(usageLedger).where(eq(usageLedger.tenantId, tenantId));
    let used = 0;
    for (const r of rows) {
      if ((r.kind === "whatsapp_utility" || r.kind === "sms") && localDateOf(r.at, tz).slice(0, 7) === month) used += r.units;
    }
    const planRow = planRows.find((p) => p.key === tenant.plan);
    const quota = planRow ? planRow.monthlyMessageQuota : tenant.plan === "trial" ? 100 : null;
    return quotaStatus({ usedUnits: used, quota }).state === "exceeded";
  });
}

export function policyFor(tenant: { timezone: string; settings: TenantSettings }): PlanPolicy {
  return {
    timezone: tenant.timezone,
    quietStart: tenant.settings.quietStart,
    quietEnd: tenant.settings.quietEnd,
    fridayMorningSkip: tenant.settings.fridayMorningSkip,
    weeklyCap: tenant.settings.weeklyCap ?? DEFAULT_WEEKLY_CAP,
    sendTimeLocal: tenant.settings.sendTimeLocal ?? "10:00",
  };
}

export function phoneHash(e164: string, pepper = ""): string {
  return createHash("sha256").update(`${pepper}:${e164}`).digest("hex");
}

async function audit(tx: Db, tenantId: string, action: string, entity: string, entityId: string, details?: unknown): Promise<void> {
  await tx.insert(auditLog).values({
    tenantId, action, entity, entityId,
    after: (details ?? null) as Record<string, unknown> | null,
  });
}

// ------------------------------------------------------------------ planner

export interface PlanResult { planned: number; cancelled: number }

/** Re-plan one invoice: upsert future steps, cancel obsolete ones, never touch sent/queued steps (§7-F4). `notBefore` is the F8 promise override: no step is planned before that instant. */
export async function planForInvoice(deps: EngineDeps, tenantId: string, invoiceId: string, now: Date, opts: { notBefore?: Date } = {}): Promise<PlanResult> {
  return withTenant(deps.app, tenantId, async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId));
    if (!tenant || !invoice) return { planned: 0, cancelled: 0 };
    const steps = planReminders(
      { id: invoice.id, status: invoice.status, dueOn: invoice.dueOn },
      policyFor(tenant),
      now,
      opts,
    );
    const existing = await tx.select().from(reminders).where(eq(reminders.invoiceId, invoiceId));
    const byKey = new Map(existing.map((r) => [`${r.stepKey}|${r.channel}`, r]));
    let planned = 0;
    let cancelled = 0;
    const wantedKeys = new Set<string>();
    for (const step of steps) {
      const key = `${step.stepKey}|${step.channel}`;
      wantedKeys.add(key);
      const row = byKey.get(key);
      if (!row) {
        await tx.insert(reminders).values({
          tenantId, invoiceId, debtorId: invoice.debtorId, stepKey: step.stepKey,
          channel: step.channel, templateKey: step.templateKey, dueAt: step.dueAt,
          idempotencyKey: `${invoiceId}:${step.stepKey}:${step.channel}`,
        });
        planned++;
      } else if (row.status === "scheduled" && row.dueAt.getTime() !== step.dueAt.getTime()) {
        await tx.update(reminders).set({ dueAt: step.dueAt, templateKey: step.templateKey, updatedAt: now })
          .where(eq(reminders.id, row.id));
        planned++;
      }
    }
    for (const row of existing) {
      if (row.status === "scheduled" && !wantedKeys.has(`${row.stepKey}|${row.channel}`)) {
        await tx.update(reminders).set({ status: "cancelled", skipReason: "superseded", updatedAt: now })
          .where(eq(reminders.id, row.id));
        await audit(tx, tenantId, "reminder.cancelled", "reminder", row.id, { reason: "superseded" });
        cancelled++;
      }
    }
    return { planned, cancelled };
  });
}

/** Nightly/full re-plan for a tenant: every open or partially paid invoice. */
export async function planForTenant(deps: EngineDeps, tenantId: string, now: Date): Promise<PlanResult> {
  const ids = await withTenant(deps.app, tenantId, async (tx) => {
    const rows = await tx.select({ id: invoices.id }).from(invoices)
      .where(inArray(invoices.status, ["open", "partially_paid"]));
    return rows.map((r) => r.id);
  });
  let planned = 0;
  let cancelled = 0;
  for (const id of ids) {
    const r = await planForInvoice(deps, tenantId, id, now);
    planned += r.planned;
    cancelled += r.cancelled;
  }
  return { planned, cancelled };
}

/** Nightly planner across tenants: every tenant holding an open/partially-paid invoice. */
export async function planAllTenants(deps: EngineDeps, now: Date, opts: { tenantId?: string } = {}): Promise<{ tenants: number; planned: number; cancelled: number }> {
  if (opts.tenantId) {
    const r = await planForTenant(deps, opts.tenantId, now);
    return { tenants: 1, ...r };
  }
  const rows = await deps.owner.execute(sql`
    select distinct tenant_id from invoices where status in ('open', 'partially_paid')
  `) as unknown as { tenant_id: string }[];
  let planned = 0;
  let cancelled = 0;
  for (const row of rows) {
    const r = await planForTenant(deps, row.tenant_id, now);
    planned += r.planned;
    cancelled += r.cancelled;
  }
  return { tenants: rows.length, planned, cancelled };
}

// --------------------------------------------------------------- dispatcher

export interface DispatchSummary {
  tenants: number;
  due: number;
  groupsSent: number;
  remindersSent: number;
  skipped: Record<string, number>;
  rescheduled: number;
  retried: number;
  failed: number;
  paused: boolean;
  note?: string;
}

interface DueRow {
  id: string; invoice_id: string; debtor_id: string; step_key: string;
  channel: "whatsapp" | "sms"; template_key: string; due_at: Date; attempts: number;
}

interface GroupWork {
  businessName: string;
  groupKey: string;
  channel: "whatsapp" | "sms";
  debtorId: string;
  debtorPhone: string;
  templateKey: string;
  reminderIds: string[];
  invoiceIds: string[];
  totalOutstandingMinor: bigint;
  earliestDueOn: string;
  /** F10: tenant opted in to including the statement/payment URL in reminders. */
  payLinkEnabled: boolean;
}

const bump = (rec: Record<string, number>, key: string) => { rec[key] = (rec[key] ?? 0) + 1; };

export async function dispatchDue(deps: EngineDeps, now: Date, opts: { tenantId?: string; limit?: number } = {}): Promise<DispatchSummary> {
  const summary: DispatchSummary = {
    tenants: 0, due: 0, groupsSent: 0, remindersSent: 0,
    skipped: {}, rescheduled: 0, retried: 0, failed: 0, paused: false,
  };
  if (deps.globalPaused) { summary.paused = true; summary.note = "global pause is on"; return summary; }
  if (deps.providerHealthy === false) { summary.note = "provider unhealthy; due reminders left untouched"; return summary; }
  const limit = opts.limit ?? 500;

  let tenantIds: string[] = [];
  if (opts.tenantId) {
    tenantIds = [opts.tenantId];
  } else {
    const rows = await deps.owner.execute(sql`
      select distinct tenant_id from reminders
      where (status = 'scheduled' and due_at <= ${now.toISOString()})
         or (status = 'queued' and next_attempt_at is not null and next_attempt_at <= ${now.toISOString()})
    `) as unknown as { tenant_id: string }[];
    tenantIds = rows.map((r) => r.tenant_id);
  }

  for (const tenantId of tenantIds) {
    const groups = await prepareTenant(deps, tenantId, now, limit, summary);
    summary.tenants++;
    for (const group of groups) {
      await sendGroup(deps, tenantId, group, now, summary);
    }
    if (groups.length > 0) {
      await applyQualityGuard(deps, tenantId, now).catch((e) => console.error("[reminders] quality guard failed", e));
    }
  }
  return summary;
}

/**
 * Quality guard (§7 F4): examine the tenant's last 100 outbound messages;
 * when the core verdict says pause (failure rate >20% or block rate >5%
 * over >=20 settled sends), set settings.sendingPaused with the reason and
 * audit it. A human re-enables sending after review. Idempotent: an
 * already-paused tenant is left alone.
 */
async function applyQualityGuard(deps: EngineDeps, tenantId: string, now: Date): Promise<void> {
  const [tenant] = await deps.owner.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant || tenant.settings.sendingPaused) return;
  const recent = await deps.owner.select().from(messages)
    .where(and(eq(messages.tenantId, tenantId), eq(messages.direction, "out")))
    .orderBy(desc(messages.createdAt)).limit(100);
  const settled = recent.filter((m) => m.status === "delivered" || m.status === "read" || m.status === "failed");
  const failed = settled.filter((m) => m.status === "failed");
  const blocked = failed.filter((m) => m.statusErrorCode === 131030 || m.statusErrorCode === 131031);
  const verdict = evaluateQualityGuard({ sent: settled.length, failed: failed.length, blocked: blocked.length });
  if (!verdict.pause) return;
  await withTenant(deps.app, tenantId, async (tx) => {
    await tx.update(tenants).set({
      settings: { ...tenant.settings, sendingPaused: true, qualityPausedReason: verdict.reason ?? "quality guard" },
      updatedAt: now,
    }).where(eq(tenants.id, tenantId));
    await audit(tx, tenantId, "tenant.sending_auto_paused", "tenant", tenantId, { reason: verdict.reason, window: settled.length });
  });
}

/** Phase A (one transaction): claim due reminders with SKIP LOCKED, run the §7-F4 guards in order, group survivors and mark them queued. */
async function prepareTenant(deps: EngineDeps, tenantId: string, now: Date, limit: number, summary: DispatchSummary): Promise<GroupWork[]> {
  return withTenant(deps.app, tenantId, async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant) return [];
    if (tenant.settings.sendingPaused) { summary.paused = true; return []; }
    const policy = policyFor(tenant);
    const inQuiet = isInQuietHours(now, policy);

    // Sweep (F4 acceptance): an invoice that was paid or closed cancels ALL
    // its future reminders in this cycle — not only the ones already due.
    const swept = await tx.execute(sql`
      update reminders r set status = 'cancelled',
        skip_reason = case when i.status = 'paid' then 'invoice_paid' else 'invoice_closed' end,
        updated_at = ${now.toISOString()}
      from invoices i
      where r.invoice_id = i.id and r.tenant_id = ${tenantId}
        and r.status in ('scheduled', 'queued')
        and i.status in ('paid', 'cancelled', 'written_off', 'disputed')
      returning r.id, i.status as invoice_status
    `) as unknown as { invoice_status: string }[];
    for (const row of swept) bump(summary.skipped, row.invoice_status === "paid" ? "invoice_paid" : "invoice_closed");

    const claimed = await tx.execute(sql`
      select id, invoice_id, debtor_id, step_key, channel, template_key, due_at, attempts
      from reminders
      where tenant_id = ${tenantId}
        and (
          (status = 'scheduled' and due_at <= ${now.toISOString()} and (next_attempt_at is null or next_attempt_at <= ${now.toISOString()}))
          or (status = 'queued' and next_attempt_at is not null and next_attempt_at <= ${now.toISOString()})
        )
      order by due_at asc, debtor_id asc, id asc
      limit ${limit}
      for update skip locked
    `) as unknown as DueRow[];
    summary.due += claimed.length;
    if (claimed.length === 0) return [];

    const invoiceIds = [...new Set(claimed.map((r) => r.invoice_id))];
    const debtorIds = [...new Set(claimed.map((r) => r.debtor_id))];
    const invoiceRows = await tx.select().from(invoices).where(inArray(invoices.id, invoiceIds));
    const debtorRows = await tx.select().from(debtors).where(inArray(debtors.id, debtorIds));
    const invoiceById = new Map(invoiceRows.map((i) => [i.id, i]));
    const debtorById = new Map(debtorRows.map((d) => [d.id, d]));
    const optOutRows = await tx.select().from(optOuts).where(eq(optOuts.tenantId, tenantId));
    const optedOutHashes = new Set(optOutRows.map((o) => o.phoneHash));
    const trialExpired = tenant.plan === "trial" && tenant.trialEndsAt !== null && tenant.trialEndsAt.getTime() < now.getTime();
    // F13: quota is checked once per tenant per cycle, at the plan-status
    // position of the guard order (next to the trial check).
    const quotaBlocked = deps.quotaExceeded ? await deps.quotaExceeded(tenantId).catch(() => false) : false;

    const survivors: DueRow[] = [];
    for (const row of claimed) {
      const invoice = invoiceById.get(row.invoice_id);
      const debtor = debtorById.get(row.debtor_id);
      const set = (patch: Partial<typeof reminders.$inferInsert>) =>
        tx.update(reminders).set({ ...patch, updatedAt: now }).where(eq(reminders.id, row.id));
      // Guards, in the §7-F4 order.
      if (!invoice || !debtor) { await set({ status: "skipped", skipReason: "missing_record" }); bump(summary.skipped, "missing_record"); continue; }
      if (trialExpired) { await set({ status: "skipped", skipReason: "trial_expired" }); bump(summary.skipped, "trial_expired"); continue; }
      if (quotaBlocked) { await set({ status: "skipped", skipReason: "quota_exceeded" }); bump(summary.skipped, "quota_exceeded"); continue; }
      if (invoice.status === "paid") { await set({ status: "cancelled", skipReason: "invoice_paid" }); bump(summary.skipped, "invoice_paid"); continue; }
      if (invoice.status !== "open" && invoice.status !== "partially_paid") {
        await set({ status: "cancelled", skipReason: "invoice_closed" }); bump(summary.skipped, "invoice_closed"); continue;
      }
      if (debtor.optedOutAt !== null || optedOutHashes.has(debtor.phoneHash)) {
        await set({ status: "skipped", skipReason: "opted_out" }); bump(summary.skipped, "opted_out"); continue;
      }
      let normalized: ReturnType<typeof normalizeEgPhone> | null = null;
      try { normalized = normalizeEgPhone(debtor.phoneE164); } catch { normalized = null; }
      if (!normalized) { await set({ status: "skipped", skipReason: "phone_invalid" }); bump(summary.skipped, "phone_invalid"); continue; }
      if (row.channel === "whatsapp" && !normalized.whatsappCapable) {
        if (tenant.settings.smsFallbackEnabled) {
          // Convert: this WhatsApp step is replaced by an SMS step for the same invoice/step.
          await set({ status: "skipped", skipReason: "phone_not_whatsapp" });
          bump(summary.skipped, "phone_not_whatsapp");
          await tx.insert(reminders).values({
            tenantId, invoiceId: row.invoice_id, debtorId: row.debtor_id, stepKey: row.step_key,
            channel: "sms", templateKey: row.template_key, dueAt: now,
            idempotencyKey: `${row.invoice_id}:${row.step_key}:sms`,
          }).onConflictDoNothing();
          continue;
        }
        await set({ status: "skipped", skipReason: "phone_not_whatsapp" }); bump(summary.skipped, "phone_not_whatsapp"); continue;
      }
      if (inQuiet) {
        // Quiet hours RESCHEDULE (never silently skip): move to the next allowed slot.
        await set({ status: "scheduled", dueAt: nextAllowedSlot(now, policy), nextAttemptAt: null });
        summary.rescheduled++;
        continue;
      }
      survivors.push(row);
    }
    if (survivors.length === 0) return [];

    // §6 grouping + caps.
    // Consolidation day = the day of THIS dispatch run: stragglers from
    // earlier steps merge into today's single message per debtor+channel.
    const groups = groupDueReminders(
      survivors.map((r) => ({ id: r.id, debtorId: r.debtor_id, channel: r.channel, dueAt: now })),
      policy.timezone,
    );
    const dayStartUtc = zonedTimeToUtc(localDateOf(now, policy.timezone), "00:00", policy.timezone);
    // Monday of the tenant-local week containing `now` (date math on the
    // local calendar date, not on the UTC instant — they differ by a day).
    const localToday = localDateOf(now, policy.timezone);
    const dow = new Date(`${localToday}T00:00:00Z`).getUTCDay();
    const mondayLocal = new Date(new Date(`${localToday}T00:00:00Z`).getTime() - ((dow + 6) % 7) * 86_400_000)
      .toISOString().slice(0, 10);
    const weekStartUtc = zonedTimeToUtc(mondayLocal, "00:00", policy.timezone);
    const work: GroupWork[] = [];
    const acceptedToday = new Map<string, number>();
    const acceptedWeek = new Map<string, number>();
    for (const group of groups) {
      const sentTodayDb = await tx.select({ id: messages.id }).from(messages)
        .where(and(eq(messages.debtorId, group.debtorId), eq(messages.direction, "out"),
          eq(messages.channel, group.channel), gte(messages.createdAt, dayStartUtc)));
      const sentToday = [...sentTodayDb, ...Array.from({ length: acceptedToday.get(`${group.debtorId}|${group.channel}`) ?? 0 }, () => ({ id: "in-cycle" }))];
      const groupRows = survivors.filter((r) => group.reminderIds.includes(r.id));
      if (sentToday.length > 0) {
        // Daily cap: one message per debtor per channel per day — push the group to tomorrow's send slot.
        const tomorrow = zonedTimeToUtc(localDateOf(new Date(now.getTime() + 86_400_000), policy.timezone), policy.sendTimeLocal, policy.timezone);
        for (const r of groupRows) {
          await tx.update(reminders).set({ status: "scheduled", dueAt: nextAllowedSlot(tomorrow, policy), updatedAt: now })
            .where(eq(reminders.id, r.id));
        }
        summary.rescheduled += groupRows.length;
        continue;
      }
      const sentThisWeekDb = await tx.select({ id: messages.id }).from(messages)
        .where(and(eq(messages.debtorId, group.debtorId), eq(messages.direction, "out"), gte(messages.createdAt, weekStartUtc)));
      const sentThisWeekCount = sentThisWeekDb.length + (acceptedWeek.get(group.debtorId) ?? 0);
      if (sentThisWeekCount >= policy.weeklyCap) {
        for (const r of groupRows) {
          await tx.update(reminders).set({ status: "skipped", skipReason: "weekly_cap", updatedAt: now }).where(eq(reminders.id, r.id));
        }
        bump(summary.skipped, "weekly_cap");
        continue;
      }
      const groupInvoices = [...new Set(groupRows.map((r) => r.invoice_id))]
        .map((id) => invoiceById.get(id)).filter((i) => i !== undefined);
      const total = groupInvoices.reduce((acc, i) => acc + (i.amountMinor - i.paidMinor), 0n);
      const earliest = groupInvoices.map((i) => i.dueOn).sort()[0] ?? "";
      const first = [...groupRows].sort((a, b) => new Date(b.due_at).getTime() - new Date(a.due_at).getTime())[0]!; // most urgent step picks the template
      const groupKey = `grp:${tenantId}:${group.key}`;
      await tx.update(reminders).set({ status: "queued", groupKey, nextAttemptAt: new Date(now.getTime() + 5 * 60_000), updatedAt: now })
        .where(inArray(reminders.id, groupRows.map((r) => r.id)));
      acceptedToday.set(`${group.debtorId}|${group.channel}`, (acceptedToday.get(`${group.debtorId}|${group.channel}`) ?? 0) + 1);
      acceptedWeek.set(group.debtorId, (acceptedWeek.get(group.debtorId) ?? 0) + 1);
      work.push({
        businessName: tenant.businessNameAr ?? tenant.name,
        groupKey, channel: group.channel, debtorId: group.debtorId,
        debtorPhone: debtorById.get(group.debtorId)?.phoneE164 ?? "",
        templateKey: first.template_key, reminderIds: groupRows.map((r) => r.id),
        invoiceIds: groupInvoices.map((i) => i.id), totalOutstandingMinor: total, earliestDueOn: earliest,
        payLinkEnabled: tenant.settings.includePayLinkInReminders === true,
      });
    }
    return work;
  });
}

function orderedParameters(templateKey: string, variables: Record<string, string>): string[] {
  const def = TEMPLATES[templateKey as TemplateKey];
  const shape = (def.variables as { shape?: Record<string, unknown> }).shape;
  if (!shape) return Object.values(variables);
  return Object.keys(shape).map((k) => variables[k] ?? "");
}

/**
 * F10 reminder inclusion: mint a fresh statement link for the debtor and
 * return its public URL. A fresh link per dispatch is deliberate — only the
 * token HASH is ever stored (ADR-020), so an existing link's URL can never
 * be recovered; the new link simply lives alongside the old ones until it
 * expires or is revoked. Returns null when the tenant disabled statement
 * links or no app URL is wired.
 */
export async function ensureStatementLinkUrl(
  deps: EngineDeps, tenantId: string, debtorId: string, now: Date,
): Promise<string | null> {
  if (!deps.appUrl) return null;
  const { token, tokenHash } = generateStatementToken();
  const created = await withTenant(deps.app, tenantId, async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant || tenant.settings.statementLinksEnabled === false) return false;
    const days = tenant.settings.statementExpiryDays ?? STATEMENT_DEFAULT_EXPIRY_DAYS;
    await tx.insert(statementLinks).values({
      tenantId, debtorId, tokenHash,
      expiresAt: new Date(now.getTime() + days * 86_400_000),
      createdBy: "reminder-engine",
    });
    return true;
  });
  return created ? `${deps.appUrl.replace(/\/+$/, "")}/s/${token}` : null;
}

/** Phase B+C: send one consolidated group message, then persist the outcome. */
async function sendGroup(deps: EngineDeps, tenantId: string, group: GroupWork, now: Date, summary: DispatchSummary): Promise<void> {
  const business = group.businessName;
  const variables: Record<string, string> = {
    business,
    amount: formatEgp(group.totalOutstandingMinor),
    due_date: group.earliestDueOn,
    remaining: formatEgp(group.totalOutstandingMinor),
  };
  // F10/F5: when the tenant enabled it, the debtor's statement/payment URL
  // rides along as a URL variable. The registry's v1 templates declare no
  // URL parameter, so orderedParameters() never sends it positionally to
  // Meta (a URL-button template version is a RUNBOOK submission step); the
  // variable reaches the provider call and the rendered body below, which
  // is what SMS and the conversation record carry.
  let payLinkUrl: string | null = null;
  if (group.payLinkEnabled) {
    payLinkUrl = await ensureStatementLinkUrl(deps, tenantId, group.debtorId, now).catch(() => null);
    if (payLinkUrl) variables.pay_link = payLinkUrl;
  }
  const provider = group.channel === "sms" ? deps.providers.sms : deps.providers.whatsapp;
  let providerMessageId: string | null = null;
  let error: { code: number; message: string } | null = null;
  try {
    const result = await provider.sendTemplate({
      toE164: group.debtorPhone, templateKey: group.templateKey, variables,
      parameters: orderedParameters(group.templateKey, variables),
      idempotencyKey: group.groupKey, channel: group.channel,
    });
    providerMessageId = result.providerMessageId;
  } catch (err) {
    error = err instanceof ProviderError
      ? { code: err.providerCode, message: err.message }
      : { code: 0, message: err instanceof Error ? err.message : "unknown send error" };
  }

  await withTenant(deps.app, tenantId, async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    if (providerMessageId) {
      const [msg] = await tx.insert(messages).values({
        tenantId, debtorId: group.debtorId, invoiceId: group.invoiceIds[0] ?? null,
        direction: "out", channel: group.channel, provider: group.channel === "sms" ? "sms" : "whatsapp",
        providerMessageId, templateKey: group.templateKey,
        bodyText: renderTemplate(group.templateKey as TemplateKey, "ar", variables) + (payLinkUrl ? `\n${payLinkUrl}` : ""),
        status: "sent",
        // The engine clock is injected (fake clock in tests): message rows
        // carry engine time, not wall time, so caps and timelines agree.
        createdAt: now, updatedAt: now,
      }).returning();
      void msg;
      await tx.insert(usageLedger).values({
        tenantId, kind: group.channel === "sms" ? "sms" : "whatsapp_utility",
        units: 1, costEstimateMinor: 0n, // rates live in config (ADR-015), never constants
        at: now, createdAt: now, updatedAt: now,
      });
      await tx.update(reminders).set({
        status: "sent", providerMessageId, nextAttemptAt: null,
        attempts: sql`${reminders.attempts} + 1`, updatedAt: now,
      }).where(inArray(reminders.id, group.reminderIds));
      await audit(tx, tenantId, "reminder.sent", "reminder", group.reminderIds[0]!, {
        providerMessageId, groupKey: group.groupKey, reminderIds: group.reminderIds,
      });
      await tx.update(invoices).set({ lastRemindedAt: now, updatedAt: now })
        .where(inArray(invoices.id, group.invoiceIds));
      summary.groupsSent++;
      summary.remindersSent += group.reminderIds.length;
      return;
    }
    // Failure path.
    const classified = classifyProviderError(error!.code);
    const [firstReminder] = await tx.select().from(reminders).where(eq(reminders.id, group.reminderIds[0]!));
    const attempts = (firstReminder?.attempts ?? 0) + 1;
    if (classified.retryable && attempts < MAX_SEND_ATTEMPTS) {
      const nextAt = new Date(now.getTime() + backoffDelayMs(attempts - 1, () => 0));
      await tx.update(reminders).set({
        status: "scheduled", attempts, lastErrorCode: error!.code, nextAttemptAt: nextAt, updatedAt: now,
      }).where(inArray(reminders.id, group.reminderIds));
      summary.retried += group.reminderIds.length;
      return;
    }
    // Final failure.
    await tx.update(reminders).set({
      status: "failed", attempts, lastErrorCode: error!.code, nextAttemptAt: null, updatedAt: now,
    }).where(inArray(reminders.id, group.reminderIds));
    await audit(tx, tenantId, "reminder.failed", "reminder", group.reminderIds[0]!, {
      code: error!.code, kind: classified.kind, reminderIds: group.reminderIds,
    });
    summary.failed += group.reminderIds.length;
    if (classified.kind === "not_reachable") {
      await tx.update(debtors).set({ whatsappStatus: "unreachable", updatedAt: now }).where(eq(debtors.id, group.debtorId));
      if (group.channel === "whatsapp" && tenant?.settings.smsFallbackEnabled) {
        // SMS fallback (§7-F3): a sibling SMS step per invoice, due now.
        for (const rid of group.reminderIds) {
          const [r] = await tx.select().from(reminders).where(eq(reminders.id, rid));
          if (!r) continue;
          await tx.insert(reminders).values({
            tenantId, invoiceId: r.invoiceId, debtorId: r.debtorId, stepKey: r.stepKey,
            channel: "sms", templateKey: r.templateKey, dueAt: now,
            idempotencyKey: `${r.invoiceId}:${r.stepKey}:sms`,
          }).onConflictDoNothing();
        }
      }
    }
  });
}

// ------------------------------------------------------------------ opt-out

export interface OptOutResult { applied: boolean; cancelledReminders: number }

/** Apply an opt-out for a phone inside a tenant: record it, mark the debtor, cancel every future reminder. Idempotent. */
export async function applyOptOut(deps: EngineDeps, tenantId: string, debtorId: string, now: Date, source = "keyword"): Promise<OptOutResult> {
  return withTenant(deps.app, tenantId, async (tx) => {
    const [debtor] = await tx.select().from(debtors).where(eq(debtors.id, debtorId));
    if (!debtor) return { applied: false, cancelledReminders: 0 };
    await tx.insert(optOuts).values({
      tenantId, debtorId, phoneE164: debtor.phoneE164, phoneHash: debtor.phoneHash, source,
    }).onConflictDoNothing();
    if (!debtor.optedOutAt) {
      await tx.update(debtors).set({ optedOutAt: now, updatedAt: now }).where(eq(debtors.id, debtorId));
    }
    const future = await tx.select().from(reminders)
      .where(and(eq(reminders.debtorId, debtorId), inArray(reminders.status, ["scheduled", "queued"])));
    for (const r of future) {
      await tx.update(reminders).set({ status: "cancelled", skipReason: "opted_out", updatedAt: now }).where(eq(reminders.id, r.id));
    }
    if (future.length > 0) {
      await audit(tx, tenantId, "debtor.opted_out", "debtor", debtorId, { source, cancelledReminders: future.length });
    }
    return { applied: true, cancelledReminders: future.length };
  });
}

/** Re-enable automatic reminders for a debtor: clear opted_out_at, remove opt-out records, and re-plan future reminders. */
export async function resumeReminders(deps: EngineDeps, tenantId: string, debtorId: string, now: Date): Promise<{ resumed: boolean; plannedInvoices: number }> {
  return withTenant(deps.app, tenantId, async (tx) => {
    const [debtor] = await tx.select().from(debtors).where(eq(debtors.id, debtorId));
    if (!debtor) return { resumed: false, plannedInvoices: 0 };
    if (debtor.optedOutAt) {
      await tx.update(debtors).set({ optedOutAt: null, updatedAt: now }).where(eq(debtors.id, debtorId));
    }
    await tx.delete(optOuts).where(and(eq(optOuts.tenantId, tenantId), or(eq(optOuts.debtorId, debtorId), eq(optOuts.phoneHash, debtor.phoneHash))));
    await audit(tx, tenantId, "debtor.reminders_resumed", "debtor", debtorId, { action: "reminders_resumed" });
    const openInvs = await tx.select().from(invoices).where(and(
      eq(invoices.debtorId, debtorId),
      inArray(invoices.status, ["open", "partially_paid"])
    ));
    for (const inv of openInvs) {
      void planForInvoice(deps, tenantId, inv.id, now);
    }
    return { resumed: true, plannedInvoices: openInvs.length };
  });
}

export { isOptOutText };
