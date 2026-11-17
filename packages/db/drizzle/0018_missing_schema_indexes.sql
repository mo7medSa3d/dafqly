-- 0018_missing_schema_indexes
-- Syncs the 5 indexes declared in packages/db/src/schema.ts that were
-- missing from prior SQL migrations.
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "invoices_tenant_debtor_status_idx" ON "invoices" ("tenant_id", "debtor_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_tenant_status_received_idx" ON "payments" ("tenant_id", "status", "received_on");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payments_tenant_ref_idx" ON "payments" ("tenant_id", "reference_no");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "disputes_tenant_status_idx" ON "disputes" ("tenant_id", "status", "debtor_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_intents_tenant_triage_idx" ON "message_intents" ("tenant_id", "resolved_by", "action_taken");
