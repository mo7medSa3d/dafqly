import { AppError, toApiErrorBody } from "@tahseel/core";
import { z } from "zod";
import { appDb, ownerDb } from "@/server/db";
import { clientIp, rateLimit, tokenBucketKey } from "@/server/rate-limit";
import { readRequestBodyLimited, RequestBodyTooLargeError } from "@/server/request-body";
import { createPublicPromiseRequest } from "@/server/statements";

const bodySchema = z.object({
  invoiceId: z.string().uuid().optional(),
  amountMinor: z.string().regex(/^[1-9]\d{0,17}$/),
  promisedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(500).optional(),
});

const HEADERS = { "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" };
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const ip = clientIp(req.headers);
  const limit = rateLimit(`statement:promise:${ip}`, { limit: 6, windowSeconds: 3600 });
  // M9: per-token bucket too (3/hour per link), on top of the per-debtor cap.
  const tokenLimit = rateLimit(`statement:promise:token:${tokenBucketKey(token)}`, { limit: 3, windowSeconds: 3600 });
  if (!limit.allowed || !tokenLimit.allowed) {
    const retryAfter = Math.max(limit.retryAfterSeconds, tokenLimit.retryAfterSeconds);
    return Response.json(toApiErrorBody(new AppError("RATE_LIMITED", "Too many requests", 429)), { status: 429, headers: { ...HEADERS, "Retry-After": String(retryAfter) } });
  }
  let raw: unknown;
  try {
    const rawBytes = await readRequestBodyLimited(req, 16_384);
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBytes));
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) {
      return Response.json(toApiErrorBody(new AppError("BODY_TOO_LARGE", "Request body too large", 413)), { status: 413, headers: HEADERS });
    }
    return Response.json(toApiErrorBody(new AppError("BAD_JSON", "body is not JSON", 400)), { status: 400, headers: HEADERS });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return Response.json(toApiErrorBody(new AppError("BAD_REQUEST", "Invalid promise request", 400)), { status: 400, headers: HEADERS });
  if (!TOKEN_RE.test(token)) return Response.json(toApiErrorBody(new AppError("NOT_FOUND", "Not found", 404)), { status: 404, headers: HEADERS });
  try {
    const result = await createPublicPromiseRequest(appDb(), ownerDb(), token, parsed.data, new Date());
    return Response.json(result, { status: 201, headers: HEADERS });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    return Response.json(toApiErrorBody(error), { status, headers: HEADERS });
  }
}
