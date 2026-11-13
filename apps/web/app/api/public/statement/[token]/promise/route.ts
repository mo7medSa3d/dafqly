import { AppError, toApiErrorBody } from "@tahseel/core";
import { z } from "zod";
import { appDb, ownerDb } from "@/server/db";
import { clientIp, rateLimit, tokenBucketKey } from "@/server/rate-limit";
import { createPublicPromiseRequest } from "@/server/statements";

const bodySchema = z.object({
  invoiceId: z.string().uuid().optional(),
  amountMinor: z.string().regex(/^[1-9]\d{0,17}$/),
  promisedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(500).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const headers = { "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" };
  const ip = clientIp(req.headers);
  const limit = rateLimit(`statement:promise:${ip}`, { limit: 6, windowSeconds: 3600 });
  // M9: per-token bucket too (3/hour per link), on top of the per-debtor cap.
  const tokenLimit = rateLimit(`statement:promise:token:${tokenBucketKey(token)}`, { limit: 3, windowSeconds: 3600 });
  if (!limit.allowed || !tokenLimit.allowed) {
    const retryAfter = Math.max(limit.retryAfterSeconds, tokenLimit.retryAfterSeconds);
    return Response.json(toApiErrorBody(new AppError("RATE_LIMITED", "Too many requests", 429)), { status: 429, headers: { ...headers, "Retry-After": String(retryAfter) } });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json(toApiErrorBody(new AppError("BAD_REQUEST", "Invalid promise request", 400)), { status: 400, headers });
  try {
    const result = await createPublicPromiseRequest(appDb(), ownerDb(), token, parsed.data, new Date());
    return Response.json(result, { status: 201, headers });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    return Response.json(toApiErrorBody(error), { status, headers });
  }
}
