import { auth } from "@/server/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { clientIp, rateLimit } from "@/server/rate-limit";
import { readRequestBodyLimited, RequestBodyTooLargeError } from "@/server/request-body";
import { toApiErrorBody, AppError } from "@tahseel/core";

const handlers = toNextJsHandler(auth.handler);
const NO_STORE = { "Cache-Control": "no-store" };
const MAX_AUTH_BODY_BYTES = 65_536;

export async function GET(req: Request): Promise<Response> {
  try {
    return await handlers.GET(req);
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500;
    return Response.json(toApiErrorBody(err), { status, headers: NO_STORE });
  }
}

/** Auth POSTs are rate-limited (BUILD_PLAN §8): 10 attempts / minute / IP+route. */
export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const ip = clientIp(req.headers);
  const result = rateLimit(`${ip}:${url.pathname}`, { limit: 10, windowSeconds: 60 });
  if (!result.allowed) {
    return Response.json(
      toApiErrorBody(new AppError("RATE_LIMITED", "Too many attempts, please wait and try again", 429)),
      { status: 429, headers: { ...NO_STORE, "retry-after": String(result.retryAfterSeconds) } },
    );
  }
  let forwardedReq = req;
  try {
    const rawBytes = await readRequestBodyLimited(req, MAX_AUTH_BODY_BYTES);
    forwardedReq = new Request(req.url, {
      method: req.method,
      headers: req.headers,
      body: rawBytes as never,
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
    return await handlers.POST(forwardedReq);
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500;
    return Response.json(toApiErrorBody(err), { status, headers: NO_STORE });
  }
}
