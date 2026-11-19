import { auth } from "@/server/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { clientIp, rateLimit } from "@/server/rate-limit";
import { readRequestBodyLimited, RequestBodyTooLargeError } from "@/server/request-body";
import { toApiErrorBody, AppError } from "@tahseel/core";

export const dynamic = "force-dynamic";

let cachedHandlers: ReturnType<typeof toNextJsHandler> | undefined;
function getHandlers() {
  cachedHandlers ??= toNextJsHandler(auth.handler);
  return cachedHandlers;
}
const NO_STORE = { "Cache-Control": "no-store" };
const MAX_AUTH_BODY_BYTES = 65_536;

function withNoStore(res: Response): Response {
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export async function GET(req: Request): Promise<Response> {
  const ip = clientIp(req.headers);
  const result = rateLimit(`auth:get:${ip}`, { limit: 120, windowSeconds: 60 });
  if (!result.allowed) {
    return Response.json(
      toApiErrorBody(new AppError("RATE_LIMITED", "Too many requests", 429)),
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(result.retryAfterSeconds) } },
    );
  }
  try {
    return withNoStore(await getHandlers().GET(req));
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500;
    return Response.json(toApiErrorBody(err), { status, headers: NO_STORE });
  }
}

/** Auth POSTs are rate-limited (BUILD_PLAN §8): 10 attempts / minute / IP+route. */
export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const ip = clientIp(req.headers);
  const normalizedPath = url.pathname.replace(/\/+$/, "") || "/";
  const result = rateLimit(`${ip}:${normalizedPath}`, { limit: 10, windowSeconds: 60 });
  if (!result.allowed) {
    return Response.json(
      toApiErrorBody(new AppError("RATE_LIMITED", "Too many attempts, please wait and try again", 429)),
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(result.retryAfterSeconds) } },
    );
  }
  let forwardedReq = req;
  try {
    const rawBytes = await readRequestBodyLimited(req, MAX_AUTH_BODY_BYTES);
    forwardedReq = new Request(req.url, {
      method: req.method,
      headers: req.headers,
      body: Buffer.from(rawBytes),
    });
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) {
      return Response.json(
        toApiErrorBody(new AppError("BODY_TOO_LARGE", "Request body too large", 413)),
        { status: 413, headers: NO_STORE },
      );
    }
    return Response.json(
      toApiErrorBody(new AppError("BAD_BODY", "Could not read request body", 400)),
      { status: 400, headers: NO_STORE },
    );
  }
  try {
    return withNoStore(await getHandlers().POST(forwardedReq));
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500;
    return Response.json(toApiErrorBody(err), { status, headers: NO_STORE });
  }
}
