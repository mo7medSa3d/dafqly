import { AppError, toApiErrorBody } from "@tahseel/core";
import { env } from "@/server/env";
import { gatewayDeps, handlePaymobCallback } from "@/server/gateway";
import { clientIp, rateLimit, rateLimitPeek } from "@/server/rate-limit";
import { readRequestBodyLimited, RequestBodyTooLargeError } from "@/server/request-body";

/**
 * Paymob webhook (BUILD_PLAN F5, ADR-019): the HMAC-verified POST callback
 * is the ONLY fulfilment path. The `hmac` arrives as a query parameter and
 * is HMAC-SHA512 over the transaction's 20 documented fields — verification
 * happens inside the service before anything is stored or settled; a bad
 * HMAC is a 401 and stores nothing. The GET redirection callback is
 * unauthenticated by design and NEVER fulfils anything (UX only).
 */
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(req: Request): Promise<Response> {
  // H2/M3: per-IP flood throttle + a failure bucket that only fills on bad HMACs.
  const ip = clientIp(req.headers);
  const flood = rateLimit(`webhook:paymob:${ip}`, { limit: 120, windowSeconds: 60 });
  if (!flood.allowed) {
    return Response.json(toApiErrorBody(new AppError("RATE_LIMITED", "Too many requests", 429)), { status: 429, headers: { ...NO_STORE, "Retry-After": String(flood.retryAfterSeconds) } });
  }
  const badHmac = rateLimitPeek(`webhook:paymob:bad-hmac:${ip}`, { limit: 10, windowSeconds: 60 });
  if (!badHmac.allowed) {
    return Response.json(toApiErrorBody(new AppError("RATE_LIMITED", "Too many requests", 429)), { status: 429, headers: { ...NO_STORE, "Retry-After": String(badHmac.retryAfterSeconds) } });
  }
  if (!env().PAYMOB_HMAC_SECRET) {
    return Response.json(toApiErrorBody(new AppError("WEBHOOK_NOT_CONFIGURED", "PAYMOB_HMAC_SECRET is not set", 503)), { status: 503, headers: NO_STORE });
  }
  const hmac = new URL(req.url).searchParams.get("hmac")?.trim();
  if (!hmac) {
    rateLimit(`webhook:paymob:bad-hmac:${ip}`, { limit: 10, windowSeconds: 60 });
    return Response.json(toApiErrorBody(new AppError("BAD_HMAC", "HMAC verification failed", 401)), { status: 401, headers: NO_STORE });
  }
  let rawBytes: Uint8Array;
  try {
    rawBytes = await readRequestBodyLimited(req, 256_000);
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) {
      return Response.json(toApiErrorBody(new AppError("BODY_TOO_LARGE", "webhook body exceeds 256 KB", 413)), { status: 413, headers: NO_STORE });
    }
    return Response.json(toApiErrorBody(new AppError("BAD_BODY", "could not read webhook body", 400)), { status: 400, headers: NO_STORE });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBytes));
  } catch {
    return Response.json(toApiErrorBody(new AppError("BAD_JSON", "body is not valid JSON", 400)), { status: 400, headers: NO_STORE });
  }
  try {
    const outcome = await handlePaymobCallback(gatewayDeps(), payload, hmac, new Date());
    return Response.json({ received: true, ...outcome }, { headers: NO_STORE });
  } catch (err) {
    const body = toApiErrorBody(err);
    const status = err instanceof AppError ? err.status : 500;
    if (status === 401) rateLimit(`webhook:paymob:bad-hmac:${ip}`, { limit: 10, windowSeconds: 60 });
    return Response.json(body, { status, headers: NO_STORE });
  }
}

export async function GET(): Promise<Response> {
  // Redirection params are not authenticated; they change no state.
  return Response.json(
    { received: true, note: "redirect callbacks never fulfil payments; the verified POST webhook is the source of truth" },
    { headers: NO_STORE },
  );
}
