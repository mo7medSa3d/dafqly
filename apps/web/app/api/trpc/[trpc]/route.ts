import { createHash } from "node:crypto";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { AppError } from "@tahseel/core";
import { appRouter } from "@/server/routers";
import { createTrpcContext } from "@/server/trpc";
import { clientIp, rateLimit } from "@/server/rate-limit";

/**
 * M7: the tRPC handler is rate-limited per caller — 120 req/min overall,
 * plus a stricter 20/min bucket for the AI/file procedures (ledger
 * extraction, receipt vision, copilot, cheque OCR), which are the
 * expensive ones. Identity is the hashed session cookie when present
 * (one-way hash — no session material in the key, no DB hit), else the
 * client IP. The monthly global AI budget cap still bounds LLM spend;
 * this bounds DB/CPU/storage burn per caller.
 */
const AI_PROCEDURE_PREFIXES = ["ai", "ledgerAi", "receipts", "cheques", "intelligence"];

function callerKey(req: Request): string {
  const cookie = req.headers.get("cookie") ?? "";
  const match = /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=([^;]+)/.exec(cookie);
  if (match?.[1]) {
    const hash = createHash("sha256").update(match[1]).digest("hex").slice(0, 16);
    return `session:${hash}`;
  }
  return `ip:${clientIp(req.headers)}`;
}

function isAiProcedure(req: Request): boolean {
  const path = new URL(req.url).pathname.replace(/^\/api\/trpc\/?/, "");
  if (!path) return false;
  return path.split(",").some((proc) => {
    const head = proc.split(".")[0] ?? "";
    return AI_PROCEDURE_PREFIXES.some((prefix) => head === prefix || head.startsWith(prefix));
  });
}

function limited(status: number, retryAfterSeconds: number): Response {
  return Response.json(
    { error: { code: "RATE_LIMITED", message: "Too many requests" } },
    { status, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}

const handler = (req: Request) => {
  const key = callerKey(req);
  const general = rateLimit(`trpc:${key}`, { limit: 120, windowSeconds: 60 });
  if (!general.allowed) return limited(429, general.retryAfterSeconds);
  if (isAiProcedure(req)) {
    const ai = rateLimit(`trpc:ai:${key}`, { limit: 20, windowSeconds: 60 });
    if (!ai.allowed) return limited(429, ai.retryAfterSeconds);
  }
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req,
    router: appRouter,
    createContext: () => createTrpcContext(req.headers),
    responseMeta(opts) {
      const appErr = opts.errors.map((e) => e.cause).find((c) => c instanceof AppError) as AppError | undefined;
      if (appErr) {
        return { status: appErr.status };
      }
      return {};
    },
  });
};
export { handler as GET, handler as POST };
