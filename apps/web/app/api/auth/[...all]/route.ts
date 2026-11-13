import { auth } from "@/server/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { clientIp, rateLimit } from "@/server/rate-limit";
import { toApiErrorBody, AppError } from "@tahseel/core";

const handlers = toNextJsHandler(auth.handler);

export const GET = handlers.GET;

/** Auth POSTs are rate-limited (BUILD_PLAN §8): 10 attempts / minute / IP+route. */
export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const ip = clientIp(req.headers);
  const result = rateLimit(`${ip}:${url.pathname}`, { limit: 10, windowSeconds: 60 });
  if (!result.allowed) {
    return Response.json(
      toApiErrorBody(new AppError("RATE_LIMITED", "Too many attempts, please wait and try again", 429)),
      { status: 429, headers: { "retry-after": String(result.retryAfterSeconds) } },
    );
  }
  return handlers.POST(req);
}
