import { sql } from "drizzle-orm";
import { ownerDb } from "@/server/db";
import { toApiErrorBody, AppError } from "@tahseel/core";

/** Readiness: the process can reach Postgres. Liveness is /healthz. */
export async function GET(): Promise<Response> {
  try {
    await ownerDb().execute(sql`select 1`);
    return Response.json({ status: "ready" });
  } catch {
    return Response.json(toApiErrorBody(new AppError("NOT_READY", "Database is not reachable", 503)), { status: 503 });
  }
}
