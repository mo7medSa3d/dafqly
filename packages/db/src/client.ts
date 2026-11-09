import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>["db"];

/** Owner/migration connection (DATABASE_URL). Bypasses RLS by design; never use for tenant request handling. */
export function createDb(url: string) {
  const client = postgres(url, { max: 5 });
  return { db: drizzle(client, { schema }), client };
}

/** Runtime app connection (APP_DATABASE_URL): the RLS-bound `tahseel_app` role. */
export function createAppDb(url: string) {
  const client = postgres(url, { max: 5 });
  return { db: drizzle(client, { schema }), client };
}

/**
 * Run `fn` inside a transaction with `SET LOCAL app.tenant_id`, which is what
 * every RLS policy reads (BUILD_PLAN §3). This is the ONLY way request code
 * may touch tenant tables.
 */
export async function withTenant<T>(db: Db, tenantId: string, fn: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx as unknown as Db);
  });
}
