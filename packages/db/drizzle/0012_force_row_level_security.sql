-- 0012_force_row_level_security
-- The table owner bypasses RLS by design, so any connection that ever runs
-- as the owner (a misconfigured APP_DATABASE_URL, a migration-time query,
-- an ad-hoc psql session) could read/write across tenants. FORCE ROW LEVEL
-- SECURITY closes that hole: RLS applies even to the table owner.
-- The app-role assertion (assertAppRole, called from /readyz) is the
-- runtime guard; this migration is the database-level backstop.
--> statement-breakpoint
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "usage_ledger" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "debtors" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payment_allocations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "import_jobs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "import_rows" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "reminders" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "opt_outs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "payment_links" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "statement_links" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "disputes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "files" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "message_intents" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "cheques" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "cheque_alerts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "subscription_invoices" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ai_conversations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ai_messages" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "promises_to_pay" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "collection_tasks" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ai_action_approvals" FORCE ROW LEVEL SECURITY;
