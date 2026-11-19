import { AppError, toApiErrorBody } from "@tahseel/core";
import { clientIp, rateLimit } from "@/server/rate-limit";

const HEADERS = { "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" };

/**
 * Online debtor checkout is disabled: Paymob is reserved strictly for
 * platform SaaS subscriptions in billing.ts. Debtors pay using the merchant's
 * offline paymentInstructions and upload a receipt on the statement portal.
 */
export async function POST(req: Request): Promise<Response> {
  const ip = clientIp(req.headers);
  const limit = rateLimit(`statement:pay:${ip}`, { limit: 30, windowSeconds: 60 });
  if (!limit.allowed) {
    return Response.json(toApiErrorBody(new AppError("RATE_LIMITED", "Too many requests", 429)), {
      status: 429,
      headers: { ...HEADERS, "Retry-After": String(limit.retryAfterSeconds) },
    });
  }
  return Response.json(
    {
      error: {
        code: "GATEWAY_DISABLED",
        message: "Online debtor checkout is disabled; please use the merchant's payment instructions and upload a receipt.",
      },
    },
    { status: 410, headers: HEADERS },
  );
}
