import { createDb, createAppDb, type Db } from "@tahseel/db";
import { appDatabaseUrl, env } from "./env";

/**
 * Two connections (ADR-008):
 * - ownerDb: migrations-grade connection, used ONLY by the Better Auth
 *   adapter (login lookup is cross-tenant by nature).
 * - appDb: the RLS-bound tahseel_app role; every tenant query goes through
 *   withTenant() on this connection.
 */
const globalForDb = globalThis as unknown as {
  owner?: { db: Db };
  app?: { db: Db };
};

export function ownerDb(): Db {
  globalForDb.owner ??= createDb(env().DATABASE_URL);
  return globalForDb.owner.db;
}
export function appDb(): Db {
  globalForDb.app ??= createAppDb(appDatabaseUrl());
  return globalForDb.app.db;
}
