import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { withTenant } from "@tahseel/db";
import { tenants, webhookEvents } from "@tahseel/db/schema";
import { WhatsAppCloudProvider } from "@tahseel/providers";
import {
  persistWebhookEvents, processWebhookEvents, resolveTenantWhatsappOverride, verifyWebhookSignature, type WebhookEvent,
} from "@tahseel/reminders";
import { aiDeps, engineDeps } from "@/server/engine";
import { env } from "@/server/env";
import { clientIp, rateLimit, rateLimitPeek } from "@/server/rate-limit";
import { appDb, ownerDb } from "@/server/db";
import { processReceiptImage } from "@/server/receipts";
import { processInboundReply, recordPendingReceiptIntent } from "@/server/replies";
import { withAiTenantContext } from "@/server/ai-budget";
import { readRequestBodyLimited, RequestBodyTooLargeError } from "@/server/request-body";

export const dynamic = "force-dynamic";

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

const NO_STORE = { "Cache-Control": "no-store" };

/** H2/M4: webhook floods are throttled per client IP (never the spoofable leftmost XFF entry). */
function webhook429(retryAfterSeconds: number): Response {
  return Response.json({ error: { code: "RATE_LIMITED", message: "Too many requests" } }, { status: 429, headers: { ...NO_STORE, "Retry-After": String(retryAfterSeconds) } });
}

export async function GET(req: Request): Promise<Response> {
  const verifyLimit = rateLimit(`webhook:whatsapp:verify:${clientIp(req.headers)}`, { limit: 30, windowSeconds: 60 });
  if (!verifyLimit.allowed) return webhook429(verifyLimit.retryAfterSeconds);
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected = env().WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  // M4: constant-time comparison (hash both sides first so lengths match).
  const matches = Boolean(expected && token) && timingSafeEqual(
    createHash("sha256").update(token ?? "").digest(),
    createHash("sha256").update(expected ?? "").digest(),
  );
  if (mode === "subscribe" && matches && challenge && challenge.length <= 256) {
    return new Response(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff", ...NO_STORE },
    });
  }
  return new Response("forbidden", {
    status: 403,
    headers: { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff", ...NO_STORE },
  });
}

export async function POST(req: Request): Promise<Response> {
  const ip = clientIp(req.headers);
  const flood = rateLimit(`webhook:whatsapp:${ip}`, { limit: 120, windowSeconds: 60 });
  if (!flood.allowed) return webhook429(flood.retryAfterSeconds);
  // The bad-signature bucket only fills on failures (peek: no consumption).
  const badSig = rateLimitPeek(`webhook:whatsapp:bad-sig:${ip}`, { limit: 10, windowSeconds: 60 });
  if (!badSig.allowed) return webhook429(badSig.retryAfterSeconds);
  const e = env();
  const secret = e.WHATSAPP_APP_SECRET;
  if (!secret) {
    return Response.json({ error: { code: "WEBHOOK_NOT_CONFIGURED", message: "Webhook not configured" } }, { status: 503, headers: NO_STORE });
  }
  // Enforce a byte limit while streaming, before allocating the full body.
  let rawBytes: Uint8Array;
  try {
    rawBytes = await readRequestBodyLimited(req, 1_000_000);
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) {
      return Response.json({ error: { code: "BODY_TOO_LARGE", message: "webhook body exceeds 1 MB" } }, { status: 413, headers: NO_STORE });
    }
    return Response.json({ error: { code: "BAD_BODY", message: "could not read webhook body" } }, { status: 400, headers: NO_STORE });
  }
  const signature = req.headers.get("x-hub-signature-256");
  if (!verifyWebhookSignature(rawBytes, signature, secret)) {
    // Consume one token from the bad-signature bucket on every failure.
    rateLimit(`webhook:whatsapp:bad-sig:${ip}`, { limit: 10, windowSeconds: 60 });
    return Response.json({ error: { code: "BAD_SIGNATURE", message: "signature verification failed" } }, { status: 401, headers: NO_STORE });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBytes));
  } catch {
    return Response.json({ error: { code: "BAD_JSON", message: "body is not JSON" } }, { status: 400, headers: NO_STORE });
  }
  const owner = ownerDb();
  const deps = engineDeps();
  deps.sessionSecret = e.SESSION_SECRET;
  // F8/F7 hooks: non-opt-out texts go to reply understanding; inbound images
  // download media via Meta Graph API (falling back to pending receipt intent
  // on failure or when WhatsApp is in dry-run/unconfigured mode).
  deps.onInboundReply = async (info) => {
    await withAiTenantContext(info.tenantId, () => processInboundReply(appDb(), info.tenantId, { llm: aiDeps().llm, engine: deps }, info));
  };
  deps.onInboundImage = async (info) => {
    if (!info.mediaId || e.DRY_RUN_MESSAGING) {
      await recordPendingReceiptIntent(appDb(), info.tenantId, info);
      return;
    }
    try {
      const tenantRow = await withTenant(appDb(), info.tenantId, async (tx) => {
        const [row] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, info.tenantId));
        return row ?? null;
      });
      const override = resolveTenantWhatsappOverride(tenantRow?.settings, e.SESSION_SECRET);
      const accessToken = override?.accessToken || e.WHATSAPP_ACCESS_TOKEN;
      const apiVersion = e.WHATSAPP_API_VERSION || "v27.0";
      if (!accessToken) {
        await recordPendingReceiptIntent(appDb(), info.tenantId, info);
        return;
      }
      const wa = new WhatsAppCloudProvider({
        apiVersion,
        phoneNumberId: override?.phoneNumberId || e.WHATSAPP_PHONE_NUMBER_ID || "",
        accessToken,
      });
      const { bytes, mime } = await wa.downloadMedia(info.mediaId, { apiVersion, accessToken });
      await withAiTenantContext(info.tenantId, () =>
        processReceiptImage(appDb(), info.tenantId, null, { llm: aiDeps().llm, storage: aiDeps().storage }, {
          debtorId: info.debtorId,
          bytes,
          mime,
        }),
      );
    } catch {
      await recordPendingReceiptIntent(appDb(), info.tenantId, info);
    }
  };
  let events: WebhookEvent[];
  try {
    const persisted = await persistWebhookEvents(owner, payload);
    events = persisted.events;
  } catch {
    // Persistence failed before inbox capture: return 500 so Meta retries.
    return Response.json({ error: { code: "PERSIST_FAILED", message: "could not persist webhook" } }, { status: 500, headers: NO_STORE });
  }
  if (events.length === 0) {
    return Response.json({ received: true, events: 0, deduplicated: true }, { headers: NO_STORE });
  }
  try {
    const summary = await processWebhookEvents(deps, events, new Date());
    await owner.update(webhookEvents).set({ processedAt: new Date(), processError: null })
      .where(inArray(webhookEvents.dedupeKey, events.map((ev) => ev.dedupeKey)));
    return Response.json({ received: true, events: events.length, ...summary }, { headers: NO_STORE });
  } catch (err) {
    // Persisted but not processed: record the failure for operator recovery,
    // still 200 so Meta does not hammer us; inbox payloads are PII-redacted.
    const processError = (err instanceof Error ? err.message : "processing failed").slice(0, 1000);
    await owner.update(webhookEvents).set({ processError })
      .where(and(inArray(webhookEvents.dedupeKey, events.map((ev) => ev.dedupeKey)), isNull(webhookEvents.processedAt)))
      .catch(() => {});
    return Response.json({ received: true, events: events.length, processing: "failed-recorded" }, { headers: NO_STORE });
  }
}
