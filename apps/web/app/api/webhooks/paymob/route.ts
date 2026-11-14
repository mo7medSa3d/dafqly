import { AppError, toApiErrorBody } from "@tahseel/core";
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
export async function POST(req: Request): Promise<Response> {
  // H2/M3: per-IP flood throttle + a failure bucket that only fills on bad HMACs.
  const ip = clientIp(req.headers);
  const flood = rateLimit(`webhook:paymob:${ip}`, { limit: 120, windowSeconds: 60 });
  if (!flood.allowed) {
    return Response.json(toApiErrorBody(new AppError("RATE_LIMITED", "Too many requests", 429)), { status: 429, headers: { "Retry-After": String(flood.retryAfterSeconds) } });
  }
  const badHmac = rateLimitPeek(`webhook:paymob:bad-hmac:${ip}`, { limit: 10, windowSeconds: 60 });
  if (!badHmac.allowed) {
    return Response.json(toApiErrorBody(new AppError("RATE_LIMITED", "Too many requests", 429)), { status: 429, headers: { "Retry-After": String(badHmac.retryAfterSeconds) } });
  }
  const hmac = new URL(req.url).searchParams.get("hmac") ?? undefined;
  let payload: unknown;
  try {
    const rawBytes = await readRequestBodyLimited(req, 256_000);
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBytes));
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) {
      return Response.json(toApiErrorBody(new AppError("BODY_TOO_LARGE", "webhook body exceeds 256 KB", 413)), { status: 413 });
    }
    return Response.json(toApiErrorBody(new AppError("BAD_JSON", "body is not valid JSON", 400)), { status: 400 });
  }
  try {
    const outcome = await handlePaymobCallback(gatewayDeps(), payload, hmac, new Date());
    return Response.json({ received: true, ...outcome });
  } catch (err) {
    const body = toApiErrorBody(err);
    const status = err instanceof AppError ? err.status : 500;
    if (status === 401) rateLimit(`webhook:paymob:bad-hmac:${ip}`, { limit: 10, windowSeconds: 60 });
    return Response.json(body, { status });
  }
}

export async function GET(): Promise<Response> {
  // Redirection params are not authenticated; they change no state.
  return Response.json({ received: true, note: "redirect callbacks never fulfil payments; the verified POST webhook is the source of truth" });
}
