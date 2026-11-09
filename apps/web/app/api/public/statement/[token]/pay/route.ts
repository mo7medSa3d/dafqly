import { z } from "zod";
import { AppError, toApiErrorBody } from "@tahseel/core";
import { ownerDb } from "@/server/db";
import { env } from "@/server/env";
import { rateLimit } from "@/server/rate-limit";
import { resolveStatement } from "@/server/statements";
import { createGatewayLink, gatewayDeps } from "@/server/gateway";

/**
 * The statement page's Pay button (F10 + F5): mints a gateway payment link
 * for the statement's debtor (one invoice, or the debtor total when no
 * invoice is named) priced server-side from the ledger, with the debtor
 * returning to this statement page afterwards. The checkout itself happens
 * on Paymob; fulfilment happens only through the verified webhook.
 */
const bodySchema = z.object({ invoiceId: z.string().uuid().optional() });

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const headers = { "X-Robots-Tag": "noindex, nofollow" };
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  const limit = rateLimit(`statement:pay:${ip}`, { limit: 10, windowSeconds: 60 });
  if (!limit.allowed) {
    return Response.json(toApiErrorBody(new AppError("RATE_LIMITED", "Too many requests", 429)), {
      status: 429, headers: { ...headers, "Retry-After": String(limit.retryAfterSeconds) },
    });
  }
  const raw = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(toApiErrorBody(new AppError("BAD_REQUEST", "invalid body", 400)), { status: 400, headers });
  }
  const { state, link } = await resolveStatement(ownerDb(), token, new Date());
  if (state !== "valid" || !link) {
    return Response.json(toApiErrorBody(new AppError("NOT_FOUND", "Not found", 404)), { status: 404, headers });
  }
  try {
    const created = await createGatewayLink(
      gatewayDeps(), link.tenantId, "statement-page",
      { debtorId: link.debtorId, invoiceId: parsed.data.invoiceId },
      { redirectionUrl: `${env().APP_URL.replace(/\/+$/, "")}/s/${token}` },
    );
    return Response.json({ checkoutUrl: created.checkoutUrl, expiresAt: created.expiresAt }, { headers });
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500;
    return Response.json(toApiErrorBody(err), { status, headers });
  }
}
