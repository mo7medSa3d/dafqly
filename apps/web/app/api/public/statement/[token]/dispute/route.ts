import { AppError, toApiErrorBody } from "@tahseel/core";
import { appDb, ownerDb } from "@/server/db";
import { clientIp, rateLimit, tokenBucketKey } from "@/server/rate-limit";
import { raiseDisputeInput, raiseStatementDispute } from "@/server/statements";

/**
 * The statement page's dispute button (F10): creates a dispute and pauses
 * the invoice's reminders. Rate-limited per IP; invalid tokens get the
 * same generic 404 as the data route.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const ip = clientIp(req.headers);
  const limit = rateLimit(`statement:dispute:${ip}`, { limit: 10, windowSeconds: 60 });
  // M9: per-token bucket too, so one link cannot be hammered from many IPs.
  const tokenLimit = rateLimit(`statement:dispute:token:${tokenBucketKey(token)}`, { limit: 5, windowSeconds: 60 });
  if (!limit.allowed || !tokenLimit.allowed) {
    const retryAfter = Math.max(limit.retryAfterSeconds, tokenLimit.retryAfterSeconds);
    return Response.json(toApiErrorBody(new AppError("RATE_LIMITED", "Too many requests", 429)), {
      status: 429, headers: { "Retry-After": String(retryAfter), "X-Robots-Tag": "noindex, nofollow" },
    });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(toApiErrorBody(new AppError("BAD_JSON", "body is not JSON", 400)), { status: 400 });
  }
  const parsed = raiseDisputeInput.safeParse(body);
  if (!parsed.success) {
    return Response.json(toApiErrorBody(new AppError("BAD_REQUEST", "invoiceId and a reason are required", 400)), { status: 400 });
  }
  try {
    const out = await raiseStatementDispute(appDb(), ownerDb(), token, parsed.data, new Date());
    return Response.json(out, { status: 201, headers: { "X-Robots-Tag": "noindex, nofollow" } });
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500;
    return Response.json(toApiErrorBody(err), { status, headers: { "X-Robots-Tag": "noindex, nofollow" } });
  }
}
