CREATE TABLE "files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_intents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"intent" text NOT NULL,
	"extracted" jsonb,
	"confidence" double precision DEFAULT 0 NOT NULL,
	"resolved_by" text DEFAULT 'human' NOT NULL,
	"action_taken" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "evidence_file_id" uuid;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_intents" ADD CONSTRAINT "message_intents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_intents" ADD CONSTRAINT "message_intents_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_tenant_sha_idx" ON "files" USING btree ("tenant_id","sha256");--> statement-breakpoint
CREATE INDEX "files_tenant_kind_idx" ON "files" USING btree ("tenant_id","kind");--> statement-breakpoint
CREATE INDEX "message_intents_tenant_created_idx" ON "message_intents" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "message_intents_message_uniq" ON "message_intents" USING btree ("message_id");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_evidence_file_id_files_id_fk" FOREIGN KEY ("evidence_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- ============================================================
-- HAND-WRITTEN (not generated): row level security for the M4
-- tables files and message_intents, plus the invoices evidence
-- column's table (invoices already has RLS from 0000).
-- ============================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON files, message_intents TO tahseel_app;
--> statement-breakpoint
ALTER TABLE files ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON files USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE message_intents ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON message_intents USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
