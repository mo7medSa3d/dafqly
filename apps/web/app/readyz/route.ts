import { sql } from "drizzle-orm";
import { ownerDb, assertAppDbReady } from "@/server/db";
import { toApiErrorBody, AppError } from "@tahseel/core";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const READINESS_TIMEOUT_MS = 3_000;
const REQUEST_ID_RE = /^[a-zA-Z0-9._-]{1,64}$/;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new AppError("NOT_READY", "Readiness check timed out", 503)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Readiness: the process can reach Postgres AND the app connection is the
 * limited tahseel_app role. A wrong app role would bypass RLS, so the
 * process reports not-ready instead of serving tenant traffic. Liveness
 * is /healthz.
 */
export async function GET(req: Request): Promise<Response> {
  try {
    await withTimeout(
      (async () => {
        await ownerDb().execute(sql`select 1`);
        await assertAppDbReady();
      })(),
      READINESS_TIMEOUT_MS,
    );
    return Response.json({ status: "ready" }, { headers: NO_STORE });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    const rawReqId = req.headers.get("x-request-id")?.trim();
    const requestId = rawReqId && REQUEST_ID_RE.test(rawReqId) ? rawReqId : undefined;
    console.error(
      "[readyz] readiness check failed:",
      requestId ? { requestId, detail: detail.slice(0, 300) } : detail.slice(0, 300),
    );
    const publicMessage =
      err instanceof AppError && err.code === "NOT_READY"
        ? err.message
        : "Database is not reachable";
    return Response.json(
      toApiErrorBody(new AppError("NOT_READY", publicMessage, 503)),
      { status: 503, headers: NO_STORE },
    );
  }
}
