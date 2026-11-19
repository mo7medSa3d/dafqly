import { AppError, toApiErrorBody } from "@tahseel/core";
import { appDb, ownerDb } from "@/server/db";
import { clientIp, rateLimit } from "@/server/rate-limit";
import { getStatementData } from "@/server/statements";

export const dynamic = "force-dynamic";

/**
 * Public statement data (F10): token-authorized, rate-limited per IP,
 * noindex, no-store. Unknown, expired and revoked tokens all return the
 * SAME generic 404 — the endpoint is not an oracle for token state.
 */
const HEADERS = { "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" };
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;

const GENERIC_404 = () =>
  Response.json(toApiErrorBody(new AppError("NOT_FOUND", "Not found", 404)), { status: 404, headers: HEADERS });

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const ip = clientIp(req.headers);
  // L8: the page and the API share one read bucket (statement:read:<ip>).
  const limit = rateLimit(`statement:read:${ip}`, { limit: 60, windowSeconds: 60 });
  if (!limit.allowed) {
    return Response.json(toApiErrorBody(new AppError("RATE_LIMITED", "Too many requests", 429)), {
      status: 429, headers: { ...HEADERS, "Retry-After": String(limit.retryAfterSeconds) },
    });
  }
  if (!TOKEN_RE.test(token)) return GENERIC_404();
  try {
    const data = await getStatementData(appDb(), ownerDb(), token, new Date());
    if (!data) return GENERIC_404();
    return Response.json(data, { headers: HEADERS });
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500;
    return Response.json(toApiErrorBody(err), { status, headers: HEADERS });
  }
}
