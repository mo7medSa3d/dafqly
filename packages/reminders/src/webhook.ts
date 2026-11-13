import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, isNotNull, lt } from "drizzle-orm";
import { debtors, messages, reminders, webhookEvents, withTenant, type Db } from "@tahseel/db";
import { canAdvanceMessageStatus, isOptOutText, type ProviderMessageStatus } from "@tahseel/core";
import { applyOptOut, type EngineDeps } from "./engine";

/**
 * WhatsApp webhook handling (BUILD_PLAN F3, ADR-015): signature verification
 * over the RAW body, payload parsing into typed events, an idempotent inbox
 * (webhook_events) and the processor that applies events to the DB.
 * Meta delivers at-least-once: every layer here is safe to replay.
 */

export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null, appSecret: string): boolean {
  if (!signatureHeader || !appSecret) return false;
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type WebhookEvent =
  | { kind: "inbound"; dedupeKey: string; waId: string; providerMessageId: string; at: Date; text: string | null; mediaId: string | null; mediaMime: string | null }
  | { kind: "status"; dedupeKey: string; providerMessageId: string; status: ProviderMessageStatus; errorCode: number | null; at: Date };

interface WaStatus { id?: string; status?: string; timestamp?: string; recipient_id?: string; errors?: { code?: number }[] }
interface WaMessage {
  from?: string; id?: string; timestamp?: string; type?: string;
  text?: { body?: string }; image?: { id?: string; mime_type?: string };
  video?: { id?: string; mime_type?: string }; audio?: { id?: string; mime_type?: string };
  document?: { id?: string; mime_type?: string };
}
interface WaValue { messages?: WaMessage[]; statuses?: WaStatus[]; contacts?: { wa_id?: string }[] }
interface WaPayload { entry?: { changes?: { value?: WaValue }[] }[] }

const STATUS_MAP: Record<string, ProviderMessageStatus> = {
  sent: "sent", delivered: "delivered", read: "read", failed: "failed",
};

/** Parse a Meta webhook payload into events. Unknown shapes yield no events (never throw on provider input). */
export function parseWebhookPayload(payload: unknown): WebhookEvent[] {
  const events: WebhookEvent[] = [];
  const p = payload as WaPayload;
  for (const entry of p.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      for (const m of value.messages ?? []) {
        if (!m.id || !m.from) continue;
        const media = m.image ?? m.video ?? m.audio ?? m.document;
        events.push({
          kind: "inbound",
          dedupeKey: `in:${m.id}`,
          waId: m.from,
          providerMessageId: m.id,
          at: m.timestamp ? new Date(Number(m.timestamp) * 1000) : new Date(),
          text: m.type === "text" ? (m.text?.body ?? null) : null,
          mediaId: media?.id ?? null,
          mediaMime: media?.mime_type ?? null,
        });
      }
      for (const s of value.statuses ?? []) {
        if (!s.id || !s.status || !STATUS_MAP[s.status]) continue;
        events.push({
          kind: "status",
          dedupeKey: `st:${s.id}:${s.status}`,
          providerMessageId: s.id,
          status: STATUS_MAP[s.status]!,
          errorCode: s.errors?.[0]?.code ?? null,
          at: s.timestamp ? new Date(Number(s.timestamp) * 1000) : new Date(),
        });
      }
    }
  }
  return events;
}

/**
 * M6: strip PII from a Meta webhook payload before it is stored. The typed
 * events (ids, statuses, error codes) are what processing and replay need;
 * the sender's phone number and the message body text are never persisted.
 * Returns a deep copy — the caller's payload is untouched.
 */
export function redactWebhookPayload(payload: unknown): unknown {
  let copy: unknown;
  try {
    copy = JSON.parse(JSON.stringify(payload ?? null)) as unknown;
  } catch {
    return { redacted: true };
  }
  const p = copy as WaPayload & Record<string, unknown>;
  for (const entry of p.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      for (const m of value.messages ?? []) {
        if (m.from !== undefined) m.from = "[redacted]";
        if (m.text?.body !== undefined) m.text.body = "[redacted]";
      }
      // The phone also appears as the contact's wa_id and the status
      // recipient_id — both are identifiers, not processing inputs.
      for (const c of value.contacts ?? []) {
        if (c.wa_id !== undefined) c.wa_id = "[redacted]";
      }
      for (const s of value.statuses ?? []) {
        if (s.recipient_id !== undefined) s.recipient_id = "[redacted]";
      }
    }
  }
  return copy;
}

/** Persist the payload's events in the inbox (owner connection). Returns how many were NEW. */
export async function persistWebhookEvents(owner: Db, payload: unknown): Promise<{ inserted: number; events: WebhookEvent[] }> {
  const events = parseWebhookPayload(payload);
  // M6: store the redacted payload — processing uses the parsed events.
  const stored = redactWebhookPayload(payload) as Record<string, unknown>;
  let inserted = 0;
  for (const event of events) {
    const rows = await owner.insert(webhookEvents)
      .values({ provider: "whatsapp", dedupeKey: event.dedupeKey, payload: stored })
      .onConflictDoNothing()
      .returning();
    inserted += rows.length;
  }
  return { inserted, events };
}

/**
 * M3/M6 retention purge (90 days by default, per the privacy draft): old
 * webhook payloads are replaced by a tombstone (the row + dedupeKey stay,
 * so at-least-once redelivery still dedupes) and old message raw payloads
 * are dropped. Run nightly from the worker maintenance tick.
 */
export async function purgeOldWebhookPayloads(owner: Db, olderThanDays = 90): Promise<{ webhookEvents: number; messages: number }> {
  const cutoff = new Date(Date.now() - olderThanDays * 86_400_000);
  const events = await owner.update(webhookEvents)
    .set({ payload: { redacted: true } })
    .where(lt(webhookEvents.receivedAt, cutoff))
    .returning({ id: webhookEvents.id });
  const msgs = await owner.update(messages)
    .set({ raw: null })
    .where(and(lt(messages.createdAt, cutoff), isNotNull(messages.raw)))
    .returning({ id: messages.id });
  return { webhookEvents: events.length, messages: msgs.length };
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
        const [current] = await tx.select().from(messages).where(eq(messages.id, msg.id));
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
    // Inbound message.
    const e164 = `+${event.waId}`;
    const candidates = await deps.owner.select().from(debtors).where(eq(debtors.phoneE164, e164));
    if (candidates.length === 0) { summary.unknown++; continue; }
    let debtor = candidates[0]!;
    if (candidates.length > 1) {
      const recent = await deps.owner.select().from(messages)
        .where(and(eq(messages.direction, "out"), eq(messages.providerMessageId, event.providerMessageId)));
      void recent;
      const outbound = await deps.owner.select().from(messages).where(eq(messages.direction, "out"));
      const byDebtor = outbound.filter((m) => candidates.some((c) => c.id === m.debtorId))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      if (byDebtor[0]?.debtorId) debtor = candidates.find((c) => c.id === byDebtor[0]!.debtorId) ?? debtor;
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
      const result = await applyOptOut(deps, debtor.tenantId, debtor.id, now, "keyword");
      if (result.applied) {
        summary.optOutsApplied++;
        // Polite confirmation inside the (just-opened) 24h window.
        try {
          await deps.providers.whatsapp.sendText({
            toE164: e164,
            body: "تم إيقاف رسائل التذكير من هذا الرقم. شكرًا لكم.",
            idempotencyKey: `optout-confirm:${event.providerMessageId}`,
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
