import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>["db"];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const POOL_DEFAULTS = {
  idle_timeout: 20,
  connect_timeout: 10,
  max_lifetime: 60 * 30,
} as const;

/** Owner/migration connection (DATABASE_URL). Bypasses RLS by design; never use for tenant request handling. */
export function createDb(url: string) {
  const client = postgres(url, { ...POOL_DEFAULTS, max: 5 });
  return { db: drizzle(client, { schema }), client };
}

/** Runtime app connection (APP_DATABASE_URL): the RLS-bound `tahseel_app` role. */
export function createAppDb(url: string) {
  const client = postgres(url, { ...POOL_DEFAULTS, max: 10 });
  return { db: drizzle(client, { schema }), client };
}

/**
 * Fail-closed role assertion for the app connection: the URL must connect
 * as the limited `tahseel_app` role without SUPERUSER or BYPASSRLS. Any
 * privileged role bypasses RLS, so every tenant-isolation guarantee would be
 * void. Call once at startup / readiness; the check is cheap (one query).
 */
export async function assertAppRole(client: ReturnType<typeof postgres>): Promise<void> {
  const rows = await client`
    select current_user as "user", rolsuper, rolbypassrls
    from pg_roles
    where rolname = current_user
  `;
  const row = rows[0] as { user?: string; rolsuper?: boolean; rolbypassrls?: boolean } | undefined;
  if (row?.user !== "tahseel_app") {
    throw new Error(
      `APP_DATABASE_URL must connect as tahseel_app, got ${row?.user ?? "unknown"} — the owner role bypasses RLS and tenant isolation would be void`,
    );
  }
  if (row.rolsuper || row.rolbypassrls) {
    throw new Error(
      "APP_DATABASE_URL role tahseel_app must not have SUPERUSER or BYPASSRLS — tenant isolation would be void",
    );
  }
}

/**
 * Run `fn` inside a transaction with `SET LOCAL app.tenant_id`, which is what
 * every RLS policy reads (BUILD_PLAN §3). This is the ONLY way request code
 * may touch tenant tables.
 */
export async function withTenant<T>(db: Db, tenantId: string, fn: (tx: Db) => Promise<T>): Promise<T> {
  if (!UUID_RE.test(tenantId)) {
    throw new Error("withTenant requires a valid UUID tenantId");
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx as unknown as Db);
  });
}

export type AdvisoryLockResult<T> = { acquired: true; value: T } | { acquired: false };

/**
 * Run `fn` while holding a non-blocking PostgreSQL transaction-scoped advisory
 * lock (`pg_try_advisory_xact_lock`). Returns `{ acquired: false }` immediately
 * when another replica holds `lockKey`; PostgreSQL releases the lock
 * automatically when the transaction commits or rolls back.
 */
export async function withAdvisoryLock<T>(
  db: Db,
  lockKey: number,
  fn: () => Promise<T>,
): Promise<AdvisoryLockResult<T>> {
  if (!Number.isSafeInteger(lockKey)) {
    throw new Error("withAdvisoryLock requires a safe integer lockKey");
  }
  return db.transaction<AdvisoryLockResult<T>>(async (tx) => {
    const rows = (await tx.execute(
      sql`select pg_try_advisory_xact_lock(${lockKey}::bigint) as locked`,
    )) as unknown as { locked?: boolean }[];
    if (!rows[0]?.locked) {
      return { acquired: false };
    }
    return { acquired: true, value: await fn() };
  });
}
