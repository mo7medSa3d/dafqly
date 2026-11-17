import { AppError, toApiErrorBody } from "@tahseel/core";
import { appDb, ownerDb } from "@/server/db";
import { clientIp, rateLimit, tokenBucketKey } from "@/server/rate-limit";
import { readRequestBodyLimited, RequestBodyTooLargeError } from "@/server/request-body";
import { raiseDisputeInput, raiseStatementDispute } from "@/server/statements";

/**
 * The statement page's dispute button (F10): creates a dispute and pauses
 * the invoice's reminders. Rate-limited per IP; invalid tokens get the
 * same generic 404 as the data route.
 */
const HEADERS = { "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" };
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const ip = clientIp(req.headers);
  const limit = rateLimit(`statement:dispute:${ip}`, { limit: 10, windowSeconds: 60 });
  // M9: per-token bucket too, so one link cannot be hammered from many IPs.
  const tokenLimit = rateLimit(`statement:dispute:token:${tokenBucketKey(token)}`, { limit: 5, windowSeconds: 60 });
  if (!limit.allowed || !tokenLimit.allowed) {
    const retryAfter = Math.max(limit.retryAfterSeconds, tokenLimit.retryAfterSeconds);
    return Response.json(toApiErrorBody(new AppError("RATE_LIMITED", "Too many requests", 429)), {
      status: 429, headers: { ...HEADERS, "Retry-After": String(retryAfter) },
    });
  }
  let body: unknown;
  try {
    const rawBytes = await readRequestBodyLimited(req, 16_384);
    body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBytes));
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) {
      return Response.json(toApiErrorBody(new AppError("BODY_TOO_LARGE", "Request body too large", 413)), { status: 413, headers: HEADERS });
    }
    return Response.json(toApiErrorBody(new AppError("BAD_JSON", "body is not JSON", 400)), { status: 400, headers: HEADERS });
  }
  const parsed = raiseDisputeInput.safeParse(body);
  if (!parsed.success) {
    return Response.json(toApiErrorBody(new AppError("BAD_REQUEST", "invoiceId and a reason are required", 400)), { status: 400, headers: HEADERS });
  }
  if (!TOKEN_RE.test(token)) {
    return Response.json(toApiErrorBody(new AppError("NOT_FOUND", "Not found", 404)), { status: 404, headers: HEADERS });
  }
  try {
    const out = await raiseStatementDispute(appDb(), ownerDb(), token, parsed.data, new Date());
    return Response.json(out, { status: 201, headers: HEADERS });
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500;
    return Response.json(toApiErrorBody(err), { status, headers: HEADERS });
  }
}
