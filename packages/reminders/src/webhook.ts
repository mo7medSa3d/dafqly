import { createHmac, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, ne, sql } from "drizzle-orm";
import { debtors, messages, reminders, tenants, webhookEvents, withTenant, type Db } from "@tahseel/db";
import { canAdvanceMessageStatus, isOptOutText, type ProviderMessageStatus } from "@tahseel/core";
import { applyOptOut, resolveTenantWhatsappOverride, type EngineDeps } from "./engine";

/**
 * WhatsApp webhook handling (BUILD_PLAN F3, ADR-015): signature verification
 * over the RAW body, payload parsing into typed events, an idempotent inbox
 * (webhook_events) and the processor that applies events to the DB.
 * Meta delivers at-least-once: every layer here is safe to replay.
 */

export function verifyWebhookSignature(rawBody: string | Uint8Array, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader || !appSecret) return false;
  // HMAC the original request bytes; decoding and re-encoding can alter
  // invalid UTF-8 sequences and must not change the signed message.
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type WebhookEvent =
  | { kind: "inbound"; dedupeKey: string; waId: string; providerMessageId: string; at: Date; text: string | null; mediaId: string | null; mediaMime: string | null; phoneNumberId?: string | null }
  | { kind: "status"; dedupeKey: string; providerMessageId: string; status: ProviderMessageStatus; errorCode: number | null; at: Date };

interface WaStatus { id?: string; status?: string; timestamp?: string; recipient_id?: string; errors?: { code?: number }[] }
interface WaMedia { id?: string; mime_type?: string; caption?: string; filename?: string }
interface WaMessage {
  from?: string; id?: string; timestamp?: string; type?: string;
  text?: { body?: string }; image?: WaMedia;
  video?: WaMedia; audio?: WaMedia;
  document?: WaMedia;
}
interface WaValue { metadata?: { display_phone_number?: string; phone_number_id?: string }; messages?: WaMessage[]; statuses?: WaStatus[]; contacts?: { wa_id?: string; profile?: { name?: string } }[] }
interface WaPayload { entry?: { changes?: { value?: WaValue }[] }[] }

const STATUS_MAP: Record<string, ProviderMessageStatus> = {
  sent: "sent", delivered: "delivered", read: "read", failed: "failed",
};

const MIN_UNIX_SEC = 1_000_000_000; // 2001-09-09
const MAX_UNIX_SEC = 4_102_444_800; // 2100-01-01

function parseMetaTimestamp(raw?: string): Date {
  if (!raw) return new Date();
  const sec = Number(raw);
  if (!Number.isFinite(sec) || sec < MIN_UNIX_SEC || sec > MAX_UNIX_SEC) return new Date();
  return new Date(sec * 1000);
}

/** Parse a Meta webhook payload into events. Unknown shapes yield no events (never throw on provider input). */
export function parseWebhookPayload(payload: unknown): WebhookEvent[] {
  if (!payload || typeof payload !== "object") return [];
  const events: WebhookEvent[] = [];
  const p = payload as WaPayload;
  if (!Array.isArray(p.entry)) return [];
  for (const entry of p.entry) {
    if (!entry || typeof entry !== "object" || !Array.isArray(entry.changes)) continue;
    for (const change of entry.changes) {
      if (!change || typeof change !== "object") continue;
      const value = change.value && typeof change.value === "object" ? change.value : {};
      const phoneNumberId = typeof value.metadata?.phone_number_id === "string" ? value.metadata.phone_number_id : null;
      for (const m of Array.isArray(value.messages) ? value.messages : []) {
        if (!m || typeof m !== "object" || typeof m.id !== "string" || typeof m.from !== "string" || !m.id || !m.from) continue;
        const media = m.image ?? m.video ?? m.audio ?? m.document;
        events.push({
          kind: "inbound",
          dedupeKey: `in:${m.id}`,
          waId: m.from,
          providerMessageId: m.id,
          at: parseMetaTimestamp(m.timestamp),
          text: m.type === "text" ? (m.text?.body ?? null) : null,
          mediaId: media?.id ?? null,
          mediaMime: media?.mime_type ?? null,
          phoneNumberId,
        });
      }
      for (const s of Array.isArray(value.statuses) ? value.statuses : []) {
        if (!s || typeof s !== "object" || typeof s.id !== "string" || typeof s.status !== "string" || !s.id || !STATUS_MAP[s.status]) continue;
        events.push({
          kind: "status",
          dedupeKey: `st:${s.id}:${s.status}`,
          providerMessageId: s.id,
          status: STATUS_MAP[s.status]!,
          errorCode: s.errors?.[0]?.code ?? null,
          at: parseMetaTimestamp(s.timestamp),
        });
      }
    }
  }
  return events;
}

/**
 * M6: strip PII from the generic Meta webhook inbox payload before it is
 * stored. The tenant-scoped `messages` table separately retains message text
 * for conversation history; the generic inbox never retains the raw phone
 * number or text. Returns a deep copy — the caller's payload is untouched.
 */
export function redactWebhookPayload(payload: unknown): unknown {
  let copy: unknown;
  try {
    copy = JSON.parse(JSON.stringify(payload ?? null)) as unknown;
  } catch {
    return { redacted: true };
  }
  if (!copy || typeof copy !== "object") return copy;
  const p = copy as WaPayload & Record<string, unknown>;
  for (const entry of Array.isArray(p.entry) ? p.entry : []) {
    if (!entry || typeof entry !== "object") continue;
    for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
      if (!change || typeof change !== "object") continue;
      const value = change.value && typeof change.value === "object" ? change.value : {};
      for (const m of Array.isArray(value.messages) ? value.messages : []) {
        if (!m || typeof m !== "object") continue;
        if (m.from !== undefined) m.from = "[redacted]";
        if (m.text?.body !== undefined) m.text.body = "[redacted]";
        for (const media of [m.image, m.video, m.audio, m.document]) {
          if (!media || typeof media !== "object") continue;
          if (media.caption !== undefined) media.caption = "[redacted]";
          if (media.filename !== undefined) media.filename = "[redacted]";
        }
      }
      // The phone and display name also appear on contacts and statuses — both are PII, not processing inputs.
      for (const c of Array.isArray(value.contacts) ? value.contacts : []) {
        if (!c || typeof c !== "object") continue;
        if (c.wa_id !== undefined) c.wa_id = "[redacted]";
        if (c.profile?.name !== undefined) c.profile.name = "[redacted]";
      }
      for (const s of Array.isArray(value.statuses) ? value.statuses : []) {
        if (!s || typeof s !== "object") continue;
        if (s.recipient_id !== undefined) s.recipient_id = "[redacted]";
      }
    }
  }
  return copy;
}

/**
 * Persist the payload's events in the inbox (owner connection).
 * Returns how many were NEW and only newly inserted or still-unprocessed events
 * so duplicate redeliveries do not re-run processing or overwrite processedAt.
 */
export async function persistWebhookEvents(owner: Db, payload: unknown): Promise<{ inserted: number; events: WebhookEvent[] }> {
  const events = parseWebhookPayload(payload);
  // M6: store the redacted payload — processing uses the parsed events.
  const stored = redactWebhookPayload(payload) as Record<string, unknown>;
  let inserted = 0;
  const pending: WebhookEvent[] = [];
  for (const event of events) {
    const rows = await owner.insert(webhookEvents)
      .values({ provider: "whatsapp", dedupeKey: event.dedupeKey, payload: stored })
      .onConflictDoNothing()
      .returning();
    if (rows.length > 0) {
      inserted += rows.length;
      pending.push(event);
    } else {
      const [existing] = await owner.select({ processedAt: webhookEvents.processedAt })
        .from(webhookEvents)
        .where(eq(webhookEvents.dedupeKey, event.dedupeKey));
      if (existing && existing.processedAt === null) {
        pending.push(event);
      }
    }
  }
  return { inserted, events: pending };
}

/**
 * M3/M6 retention purge (90 days by default, per the privacy draft): old
 * webhook payloads are replaced by a tombstone (the row + dedupeKey stay,
 * so at-least-once redelivery still dedupes) and old message raw payloads
 * are dropped. Run nightly from the worker maintenance tick.
 */
export async function purgeOldWebhookPayloads(owner: Db, olderThanDays = 90, now: Date = new Date()): Promise<{ webhookEvents: number; messages: number }> {
  const safeDays = Number.isFinite(olderThanDays) && olderThanDays > 0 ? olderThanDays : 90;
  const cutoff = new Date(now.getTime() - safeDays * 86_400_000);
  const events = await owner.update(webhookEvents)
    .set({ payload: { redacted: true } })
    .where(and(lt(webhookEvents.receivedAt, cutoff), sql`${webhookEvents.payload} IS DISTINCT FROM '{"redacted":true}'::jsonb`))
    .returning({ id: webhookEvents.id });
  const msgs = await owner.update(messages)
    .set({ raw: null })
    .where(and(lt(messages.createdAt, cutoff), isNotNull(messages.raw)))
    .returning({ id: messages.id });
  return { webhookEvents: events.length, messages: msgs.length };
}

/**
 * Retry bounded batch of previously failed webhook_events rows
 * (processedAt IS NULL AND processError IS NOT NULL).
 */
export async function replayFailedWebhooks(
  deps: EngineDeps,
  now: Date,
  limit = 50,
): Promise<{ replayed: number; failed: number }> {
  const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit) || 50));
  const rows = await deps.owner
    .select()
    .from(webhookEvents)
    .where(and(
      eq(webhookEvents.provider, "whatsapp"),
      isNull(webhookEvents.processedAt),
      isNotNull(webhookEvents.processError),
      ne(webhookEvents.processError, "cannot replay redacted inbound payload"),
    ))
    .orderBy(asc(webhookEvents.receivedAt))
    .limit(safeLimit);

  let replayed = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      // Scope replay strictly to this row's dedupeKey so mixed batches don't block or duplicate sibling events.
      const parsed = parseWebhookPayload(row.payload);
      const matched = parsed.filter((ev) => ev.dedupeKey === row.dedupeKey);
      const events = matched.length > 0 ? matched : parsed;
      const hasRedactedInbound = events.some((ev) => ev.kind === "inbound" && ev.waId === "[redacted]");
      if (hasRedactedInbound) {
        await deps.owner
          .update(webhookEvents)
          .set({ processError: "cannot replay redacted inbound payload" })
          .where(eq(webhookEvents.id, row.id));
        failed++;
        continue;
      }
      if (events.length > 0) {
        await processWebhookEvents(deps, events, now);
      }
      await deps.owner
        .update(webhookEvents)
        .set({ processedAt: now, processError: null })
        .where(eq(webhookEvents.id, row.id));
      replayed++;
    } catch (err) {
      await deps.owner
        .update(webhookEvents)
        .set({ processError: (err instanceof Error ? err.message : "replay failed").slice(0, 500) })
        .where(eq(webhookEvents.id, row.id));
      failed++;
    }
  }
  return { replayed, failed };
}

export interface ProcessSummary { inboundStored: number; optOutsApplied: number; statusesApplied: number; statusesIgnored: number; unknown: number }

/**
 * Apply parsed events. Tenant resolution: statuses correlate by provider
 * message id; inbound messages resolve the debtor by wa_id across tenants
 * (platform number, ADR-001) preferring the tenant with the most recent
 * outbound message to that phone, then the earliest-created debtor.
 */
export async function processWebhookEvents(deps: EngineDeps, events: WebhookEvent[], now: Date): Promise<ProcessSummary> {
  const summary: ProcessSummary = { inboundStored: 0, optOutsApplied: 0, statusesApplied: 0, statusesIgnored: 0, unknown: 0 };
  for (const event of events) {
    if (event.kind === "status") {
      const found = await deps.owner.select().from(messages)
        .where(and(eq(messages.provider, "whatsapp"), eq(messages.providerMessageId, event.providerMessageId)));
      const msg = found[0];
      if (!msg) { summary.unknown++; continue; }
      await withTenant(deps.app, msg.tenantId, async (tx) => {
        const [current] = await tx.select().from(messages).where(eq(messages.id, msg.id)).for("update");
        if (!current) return;
        if (current.status === "received" || !canAdvanceMessageStatus(current.status, event.status)) { summary.statusesIgnored++; return; }
        await tx.update(messages).set({
          status: event.status,
          statusErrorCode: event.status === "failed" ? event.errorCode : current.statusErrorCode,
          updatedAt: now,
        }).where(eq(messages.id, msg.id));
        if (event.status === "failed") {
          await tx.update(reminders).set({ status: "failed", lastErrorCode: event.errorCode, updatedAt: now })
            .where(and(eq(reminders.providerMessageId, event.providerMessageId), eq(reminders.status, "sent")));
        }
        summary.statusesApplied++;
      });
      continue;
    }
    // Inbound message: route by metadata.phone_number_id when matched, else fall back to single-tenant resolution.
    const e164 = event.waId.startsWith("+") ? event.waId : `+${event.waId}`;
    const [matchedTenant] = event.phoneNumberId
      ? await deps.owner
          .select({ id: tenants.id, settings: tenants.settings })
          .from(tenants)
          .where(sql`${tenants.settings}->'whatsapp'->>'phoneNumberId' = ${event.phoneNumberId}`)
          .limit(1)
      : [];
    const candidates = matchedTenant
      ? await deps.owner.select().from(debtors).where(and(eq(debtors.tenantId, matchedTenant.id), eq(debtors.phoneE164, e164))).orderBy(asc(debtors.createdAt), asc(debtors.id))
      : await deps.owner.select().from(debtors).where(eq(debtors.phoneE164, e164)).orderBy(asc(debtors.createdAt), asc(debtors.id));
    if (candidates.length === 0) { summary.unknown++; continue; }
    let debtor = candidates[0]!;
    if (!matchedTenant && candidates.length > 1) {
      const [latest] = await deps.owner.select({ debtorId: messages.debtorId })
        .from(messages)
        .where(and(
          eq(messages.direction, "out"),
          inArray(messages.debtorId, candidates.map((c) => c.id)),
        ))
        .orderBy(desc(messages.createdAt))
        .limit(1);
      if (latest?.debtorId) {
        debtor = candidates.find((c) => c.id === latest.debtorId) ?? debtor;
      }
    }
    const insertedRow = await withTenant(deps.app, debtor.tenantId, async (tx) => {
      const rows = await tx.insert(messages).values({
        tenantId: debtor.tenantId, debtorId: debtor.id, direction: "in", channel: "whatsapp",
        provider: "whatsapp", providerMessageId: event.providerMessageId,
        bodyText: event.text, mediaId: event.mediaId, mediaMime: event.mediaMime,
        status: "received", raw: event.mediaId ? { media_pending: true } : null,
        createdAt: event.at, updatedAt: now,
      }).onConflictDoNothing().returning();
      return rows[0] ?? null;
    });
    if (!insertedRow) continue; // replay: dedupe by provider message id
    summary.inboundStored++;
    if (event.mediaId && deps.onInboundImage) {
      // F7 hook: media bytes are NOT downloaded here (media_pending since
      // M2 — the download needs the Meta token); the hook records a pending
      // receipt intent so the merchant sees the image arrived.
      await deps.onInboundImage({
        tenantId: debtor.tenantId, debtorId: debtor.id, messageId: insertedRow.id,
        mediaId: event.mediaId, mediaMime: event.mediaMime,
      }).catch((err) => console.error("[webhook] onInboundImage hook failed", err));
    }
    if (event.text && isOptOutText(event.text)) {
      let anyApplied = false;
      for (const candidate of candidates) {
        const result = await applyOptOut(deps, candidate.tenantId, candidate.id, now, "keyword");
        if (result.applied) anyApplied = true;
      }
      if (anyApplied) {
        summary.optOutsApplied++;
        // Polite confirmation inside the (just-opened) 24h window.
        try {
          const tenantSettings = matchedTenant?.settings ?? (
            await deps.owner.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, debtor.tenantId)).limit(1)
          )[0]?.settings;
          const override = resolveTenantWhatsappOverride(tenantSettings, deps.sessionSecret);
          await deps.providers.whatsapp.sendText({
            toE164: e164,
            body: "تم إيقاف رسائل التذكير من هذا الرقم. شكرًا لكم.",
            idempotencyKey: `optout-confirm:${event.providerMessageId}`,
            ...(override ? { override } : {}),
          });
        } catch { /* confirmation is best-effort; the opt-out itself is already recorded */ }
      }
    } else if (event.text && deps.onInboundReply) {
      // F8 hook: non-opt-out text goes to reply understanding. Keyword
      // opt-out above ALWAYS runs first and independently of the LLM (F8
      // safety rule) — this branch is unreachable for opt-out texts.
      await deps.onInboundReply({
        tenantId: debtor.tenantId, debtorId: debtor.id, messageId: insertedRow.id, text: event.text,
      }).catch((err) => console.error("[webhook] onInboundReply hook failed", err));
    }
  }
  return summary;
}
