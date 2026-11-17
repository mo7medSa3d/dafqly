import { z } from "zod";
import { AppError, toApiErrorBody } from "@tahseel/core";
import { ownerDb } from "@/server/db";
import { env } from "@/server/env";
import { clientIp, rateLimit, tokenBucketKey } from "@/server/rate-limit";
import { readRequestBodyLimited, RequestBodyTooLargeError } from "@/server/request-body";
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
const HEADERS = { "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" };
const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const ip = clientIp(req.headers);
  const limit = rateLimit(`statement:pay:${ip}`, { limit: 10, windowSeconds: 60 });
  // M9: per-token bucket too, so one link cannot be hammered from many IPs.
  const tokenLimit = rateLimit(`statement:pay:token:${tokenBucketKey(token)}`, { limit: 5, windowSeconds: 60 });
  if (!limit.allowed || !tokenLimit.allowed) {
    const retryAfter = Math.max(limit.retryAfterSeconds, tokenLimit.retryAfterSeconds);
    return Response.json(toApiErrorBody(new AppError("RATE_LIMITED", "Too many requests", 429)), {
      status: 429, headers: { ...HEADERS, "Retry-After": String(retryAfter) },
    });
  }
  let raw: unknown = {};
  try {
    const rawBytes = await readRequestBodyLimited(req, 16_384);
    if (rawBytes.byteLength > 0) {
      raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBytes));
    }
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) {
      return Response.json(toApiErrorBody(new AppError("BODY_TOO_LARGE", "Request body too large", 413)), { status: 413, headers: HEADERS });
    }
    return Response.json(toApiErrorBody(new AppError("BAD_JSON", "body is not JSON", 400)), { status: 400, headers: HEADERS });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(toApiErrorBody(new AppError("BAD_REQUEST", "invalid body", 400)), { status: 400, headers: HEADERS });
  }
  if (!TOKEN_RE.test(token)) {
    return Response.json(toApiErrorBody(new AppError("NOT_FOUND", "Not found", 404)), { status: 404, headers: HEADERS });
  }
  const { state, link } = await resolveStatement(ownerDb(), token, new Date());
  if (state !== "valid" || !link) {
    return Response.json(toApiErrorBody(new AppError("NOT_FOUND", "Not found", 404)), { status: 404, headers: HEADERS });
  }
  try {
    const created = await createGatewayLink(
      gatewayDeps(), link.tenantId, `statement:${link.id}`,
      { debtorId: link.debtorId, invoiceId: parsed.data.invoiceId },
      { redirectionUrl: `${env().APP_URL.replace(/\/+$/, "")}/s/${token}` },
    );
    return Response.json({ checkoutUrl: created.checkoutUrl, expiresAt: created.expiresAt }, { headers: HEADERS });
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500;
    return Response.json(toApiErrorBody(err), { status, headers: HEADERS });
  }
}
