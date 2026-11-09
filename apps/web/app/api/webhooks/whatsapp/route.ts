import { eq, inArray } from "drizzle-orm";
import { webhookEvents } from "@tahseel/db/schema";
import { persistWebhookEvents, processWebhookEvents, verifyWebhookSignature } from "@tahseel/reminders";
import { aiDeps, engineDeps } from "@/server/engine";
import { env } from "@/server/env";
import { appDb, ownerDb } from "@/server/db";
import { processInboundReply, recordPendingReceiptIntent } from "@/server/replies";

/**
 * WhatsApp webhook (BUILD_PLAN F3, ADR-015):
 * - GET: Meta's verification handshake — echo hub.challenge as plain text
 *   when hub.mode=subscribe and the verify token matches.
 * - POST: verify X-Hub-Signature-256 over the RAW body BEFORE parsing; a
 *   bad signature returns 401 and stores nothing. Valid payloads are
 *   persisted to the webhook inbox first (dedupe by provider message id),
 *   then processed; the response is 200 either way after persistence so
 *   Meta does not retry storms — processing failures are recorded on the
 *   inbox rows for replay.
 */

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected = env().WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && token === expected && challenge) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("forbidden", { status: 403 });
}

export async function POST(req: Request): Promise<Response> {
  const secret = env().WHATSAPP_APP_SECRET;
  if (!secret) {
    return Response.json({ error: { code: "WEBHOOK_NOT_CONFIGURED", message: "WHATSAPP_APP_SECRET is not set" } }, { status: 503 });
  }
  const raw = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  if (!verifyWebhookSignature(raw, signature, secret)) {
    return Response.json({ error: { code: "BAD_SIGNATURE", message: "signature verification failed" } }, { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return Response.json({ error: { code: "BAD_JSON", message: "body is not JSON" } }, { status: 400 });
  }
  const owner = ownerDb();
  const { events } = await persistWebhookEvents(owner, payload);
  const deps = engineDeps();
  // F8/F7 hooks: non-opt-out texts go to reply understanding; inbound images
  // record a pending receipt intent (media bytes are media_pending — the
  // download itself needs the Meta token, see RUNBOOK M4).
  deps.onInboundReply = async (info) => {
    await processInboundReply(appDb(), info.tenantId, { llm: aiDeps().llm, engine: deps }, info);
  };
  deps.onInboundImage = async (info) => {
    await recordPendingReceiptIntent(appDb(), info.tenantId, info);
  };
  try {
    const summary = await processWebhookEvents(deps, events, new Date());
    if (events.length > 0) {
      await owner.update(webhookEvents).set({ processedAt: new Date() })
        .where(inArray(webhookEvents.dedupeKey, events.map((e) => e.dedupeKey)));
    }
    return Response.json({ received: true, events: events.length, ...summary });
  } catch (err) {
    // Persisted but not processed: record the failure for replay, still 200
    // so Meta does not hammer us; the inbox row keeps the raw payload.
    if (events.length > 0) {
      await owner.update(webhookEvents).set({ processError: err instanceof Error ? err.message : "processing failed" })
        .where(inArray(webhookEvents.dedupeKey, events.map((e) => e.dedupeKey)));
    }
    void eq; // (kept import surface minimal)
    return Response.json({ received: true, events: events.length, processing: "failed-recorded" });
  }
}
