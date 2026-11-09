import { AppError, toApiErrorBody } from "@tahseel/core";
import { gatewayDeps, handlePaymobCallback } from "@/server/gateway";

/**
 * Paymob webhook (BUILD_PLAN F5, ADR-019): the HMAC-verified POST callback
 * is the ONLY fulfilment path. The `hmac` arrives as a query parameter and
 * is HMAC-SHA512 over the transaction's 20 documented fields — verification
 * happens inside the service before anything is stored or settled; a bad
 * HMAC is a 401 and stores nothing. The GET redirection callback is
 * unauthenticated by design and NEVER fulfils anything (UX only).
 */
export async function POST(req: Request): Promise<Response> {
  const hmac = new URL(req.url).searchParams.get("hmac") ?? undefined;
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return Response.json(toApiErrorBody(new AppError("BAD_JSON", "body is not JSON", 400)), { status: 400 });
  }
  try {
    const outcome = await handlePaymobCallback(gatewayDeps(), payload, hmac, new Date());
    return Response.json({ received: true, ...outcome });
  } catch (err) {
    const body = toApiErrorBody(err);
    const status = err instanceof AppError ? err.status : 500;
    return Response.json(body, { status });
  }
}

export async function GET(): Promise<Response> {
  // Redirection params are not authenticated; they change no state.
  return Response.json({ received: true, note: "redirect callbacks never fulfil payments; the verified POST webhook is the source of truth" });
}
