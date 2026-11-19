import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { AppError, toApiErrorBody } from "@tahseel/core";
import { appRouter } from "@/server/routers";
import { createTrpcContext } from "@/server/trpc";
import { env } from "@/server/env";
import { clientIp, rateLimit } from "@/server/rate-limit";
import { readRequestBodyLimited, RequestBodyTooLargeError } from "@/server/request-body";

export const dynamic = "force-dynamic";

/**
 * M7: the tRPC handler is rate-limited per caller — 120 req/min overall,
 * plus a stricter 20/min bucket for the AI/file procedures (ledger
 * extraction, receipt vision, copilot, cheque OCR), which are the
 * expensive ones. Identity is the hashed verified session token when a
 * valid Better Auth signed cookie is present (one-way hash — no session
 * material in the key, no DB hit), else the hashed client IP.
 */
const NO_STORE = { "Cache-Control": "no-store" };
const MAX_TRPC_BODY_BYTES = 16 * 1024 * 1024;
const AI_PROCEDURES = new Set([
  "ledgerAi.runExtraction",
  "receipts.uploadAndProcess",
  "cheques.extractPhoto",
  "intelligence.askCopilot",
]);
const AI_PROCEDURE_PREFIXES = ["aiWorkspace."];

function verifySignedSessionToken(rawCookieValue: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawCookieValue);
  } catch {
    return null;
  }
  const dot = decoded.lastIndexOf(".");
  if (dot <= 0) return null;
  const token = decoded.slice(0, dot);
  const sig = decoded.slice(dot + 1);
  if (!token || !sig) return null;
  let secret: string | undefined;
  try {
    secret = process.env.BETTER_AUTH_SECRET?.trim() || env().SESSION_SECRET;
  } catch {
    return null;
  }
  if (!secret) return null;
  const expectedB64 = createHmac("sha256", secret).update(token).digest("base64");
  const expectedB64Url = createHmac("sha256", secret).update(token).digest("base64url");
  const sigBuf = Buffer.from(sig);
  for (const candidate of [expectedB64, expectedB64Url]) {
    const expBuf = Buffer.from(candidate);
    if (sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf)) {
      return token;
    }
  }
  return null;
}

function callerKey(req: Request): string {
  const cookie = req.headers.get("cookie") ?? "";
  const match = /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=([^;]+)/.exec(cookie);
  const verifiedToken = match?.[1] ? verifySignedSessionToken(match[1]) : null;
  if (verifiedToken) {
    const hash = createHash("sha256").update(verifiedToken).digest("hex").slice(0, 16);
    return `session:${hash}`;
  }
  const ipHash = createHash("sha256").update(clientIp(req.headers)).digest("hex").slice(0, 16);
  return `ip:${ipHash}`;
}

function isAiProcedure(req: Request): boolean {
  const rawPath = new URL(req.url).pathname.replace(/^\/api\/trpc\/?/, "");
  if (!rawPath) return false;
  let path = rawPath;
  try {
    path = decodeURIComponent(rawPath);
  } catch {
    // Keep raw path if percent-encoding is malformed.
  }
  return path.split(",").some((proc) =>
    AI_PROCEDURES.has(proc) || AI_PROCEDURE_PREFIXES.some((prefix) => proc.startsWith(prefix)),
  );
}

function limited(status: number, retryAfterSeconds: number): Response {
  return Response.json(
    { error: { code: "RATE_LIMITED", message: "Too many requests" } },
    { status, headers: { ...NO_STORE, "Retry-After": String(retryAfterSeconds) } },
  );
}

const handler = async (req: Request): Promise<Response> => {
  const key = callerKey(req);
  const general = rateLimit(`trpc:${key}`, { limit: 120, windowSeconds: 60 });
  if (!general.allowed) return limited(429, general.retryAfterSeconds);
  if (isAiProcedure(req)) {
    const ai = rateLimit(`trpc:ai:${key}`, { limit: 20, windowSeconds: 60 });
    if (!ai.allowed) return limited(429, ai.retryAfterSeconds);
  }
  let forwardedReq = req;
  if (req.method !== "GET" && req.method !== "HEAD") {
    try {
      const rawBytes = await readRequestBodyLimited(req, MAX_TRPC_BODY_BYTES);
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
  }
  try {
    return await fetchRequestHandler({
      endpoint: "/api/trpc",
      req: forwardedReq,
      router: appRouter,
      createContext: () => createTrpcContext(req.headers),
      responseMeta(opts) {
        const appErr = opts.errors.map((e) => e.cause).find((c): c is AppError => c instanceof AppError);
        return appErr ? { status: appErr.status, headers: NO_STORE } : { headers: NO_STORE };
      },
    });
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500;
    return Response.json(toApiErrorBody(err), { status, headers: NO_STORE });
  }
};
export { handler as GET, handler as POST };
