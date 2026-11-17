import { sql } from "drizzle-orm";
import { ownerDb, assertAppDbReady } from "@/server/db";
import { toApiErrorBody, AppError } from "@tahseel/core";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Readiness: the process can reach Postgres AND the app connection is the
 * limited tahseel_app role. A wrong app role would bypass RLS, so the
 * process reports not-ready instead of serving tenant traffic. Liveness
 * is /healthz.
 */
export async function GET(): Promise<Response> {
  try {
    await ownerDb().execute(sql`select 1`);
    await assertAppDbReady();
    return Response.json({ status: "ready" }, { headers: NO_STORE });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Database is not reachable";
    return Response.json(toApiErrorBody(new AppError("NOT_READY", detail, 503)), { status: 503, headers: NO_STORE });
  }
}
