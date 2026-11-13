import { createDb, createAppDb, assertAppRole, type Db } from "@tahseel/db";
import { appDatabaseUrl, env } from "./env";

/**
 * Two connections (ADR-008):
 * - ownerDb: migrations-grade connection, used ONLY by the Better Auth
 *   adapter (login lookup is cross-tenant by nature).
 * - appDb: the RLS-bound tahseel_app role; every tenant query goes through
 *   withTenant() on this connection. On first creation the connection's
 *   role is asserted (assertAppRole): if the URL connects as the owner,
 *   RLS is bypassed, so the cached connection is dropped and the failure
 *   is reported by assertAppDbReady() / /readyz instead of serving
 *   requests with void tenant isolation.
 */
const globalForDb = globalThis as unknown as {
  owner?: { db: Db };
  app?: { db: Db; client: ReturnType<typeof import("@tahseel/db")["createAppDb"]>["client"] };
  appRoleCheck?: Promise<void>;
};

export function ownerDb(): Db {
  globalForDb.owner ??= createDb(env().DATABASE_URL);
  return globalForDb.owner.db;
}
export function appDb(): Db {
  if (!globalForDb.app) {
    globalForDb.app = createAppDb(appDatabaseUrl());
    globalForDb.appRoleCheck = assertAppRole(globalForDb.app.client).catch((err: unknown) => {
      // Fail closed: drop the mis-roled connection so the next call retries
      // (and fails again) instead of serving tenant traffic as the owner.
      globalForDb.app = undefined;
      globalForDb.appRoleCheck = undefined;
      console.error("[db] APP_DATABASE_URL role check failed:", err instanceof Error ? err.message : err);
      throw err;
    });
  }
  return globalForDb.app.db;
}
/** Await the cached app-role assertion (starts it via appDb() if needed). */
export function assertAppDbReady(): Promise<void> {
  appDb();
  return globalForDb.appRoleCheck ?? Promise.resolve();
}
