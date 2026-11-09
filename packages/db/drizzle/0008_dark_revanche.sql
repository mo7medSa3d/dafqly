CREATE TABLE "tenant_deletions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_name" text NOT NULL,
	"business_name_ar" text,
	"deleted_by_user_id" text NOT NULL,
	"row_counts" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "invoices_tenant_issued_idx" ON "invoices" USING btree ("tenant_id","issued_on");--> statement-breakpoint
CREATE INDEX "messages_tenant_direction_idx" ON "messages" USING btree ("tenant_id","direction","status");--> statement-breakpoint
-- ============================================================
-- HAND-WRITTEN (not generated): tenant_deletions is a platform
-- tombstone (ADR-024). NO RLS (it has no tenant_id and must
-- survive tenant deletion); only the owner connection writes
-- it, via the tenant-data service. The app role gets NO grant.
-- ============================================================
REVOKE ALL ON tenant_deletions FROM PUBLIC;
