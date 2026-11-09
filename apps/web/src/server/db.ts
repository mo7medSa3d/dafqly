import { createDb, createAppDb, type Db } from "@tahseel/db";
import { appDatabaseUrl, env } from "./env";

/**
 * Two connections (ADR-008):
 * - ownerDb: migrations-grade connection, used ONLY by the Better Auth
 *   adapter (login lookup is cross-tenant by nature).
 * - appDb: the RLS-bound tahseel_app role; every tenant query goes through
 *   withTenant() on this connection.
 */
let owner: { db: Db } | undefined;
let app: { db: Db } | undefined;

export function ownerDb(): Db {
  owner ??= createDb(env().DATABASE_URL);
  return owner.db;
}
export function appDb(): Db {
  app ??= createAppDb(appDatabaseUrl());
  return app.db;
}
