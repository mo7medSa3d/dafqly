import { AppError, toApiErrorBody } from "@tahseel/core";
import { appDb, ownerDb } from "@/server/db";
import { clientIp, rateLimit } from "@/server/rate-limit";
import { getStatementData } from "@/server/statements";

/**
 * Public statement data (F10): token-authorized, rate-limited per IP,
 * noindex, no-store. Unknown, expired and revoked tokens all return the
 * SAME generic 404 — the endpoint is not an oracle for token state.
 */
const GENERIC_404 = () =>
  Response.json(toApiErrorBody(new AppError("NOT_FOUND", "Not found", 404)), {
    status: 404,
    headers: { "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" },
  });

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const ip = clientIp(req.headers);
  // L8: the page and the API share one read bucket (statement:read:<ip>).
  const limit = rateLimit(`statement:read:${ip}`, { limit: 60, windowSeconds: 60 });
  if (!limit.allowed) {
    return Response.json(toApiErrorBody(new AppError("RATE_LIMITED", "Too many requests", 429)), {
      status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds), "X-Robots-Tag": "noindex, nofollow" },
    });
  }
  const data = await getStatementData(appDb(), ownerDb(), token, new Date());
  if (!data) return GENERIC_404();
  return Response.json(data, {
    headers: { "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" },
  });
}
