-- M10: platform tables must never be reachable from the app (tahseel_app)
-- role. The app connection legitimately touches exactly one auth-table
-- column set — user.id/name (migration 0013, staff-name joins in
-- workflows.ts). Every other platform table is owner-only by design:
-- the Better Auth adapter runs on the owner connection, the webhook
-- inboxes are written by owner-connection code, the AI budget tables are
-- touched only through ownerDb(), and tenant tombstones are written by
-- deleteTenantData(owner, ...).
-- Tenant tables are NOT listed here: they stay RLS-governed (migration
-- 0012) and the app role needs them.
REVOKE ALL ON webhook_events FROM tahseel_app;
REVOKE ALL ON ai_global_budget FROM tahseel_app;
REVOKE ALL ON ai_global_usage FROM tahseel_app;
REVOKE ALL ON tenant_deletions FROM tahseel_app;
REVOKE ALL ON "session" FROM tahseel_app;
REVOKE ALL ON account FROM tahseel_app;
REVOKE ALL ON verification FROM tahseel_app;
-- REVOKE ALL on the table does not remove the column grants from 0013 in
-- every Postgres version, but re-granting here makes the final state
-- explicit and independent of that subtlety.
REVOKE ALL ON "user" FROM tahseel_app;
GRANT SELECT (id, name) ON "user" TO tahseel_app;
-- tenants_insert_any (migration 0000) intentionally stays
-- WITH CHECK (true): no claim exists when a tenant is created, so the
-- policy cannot name one. The compensating control is that creation is
-- server-side only (tenantProcedure auth) and binds the creator as owner
-- in the same transaction (services.createTenantForUser).
