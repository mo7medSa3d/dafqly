CREATE TYPE "public"."channel" AS ENUM('whatsapp', 'sms');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('out', 'in');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('queued', 'sent', 'delivered', 'read', 'failed', 'received');--> statement-breakpoint
CREATE TYPE "public"."reminder_status" AS ENUM('scheduled', 'queued', 'sent', 'skipped', 'cancelled', 'failed');--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"debtor_id" uuid,
	"invoice_id" uuid,
	"direction" "message_direction" NOT NULL,
	"channel" "channel" NOT NULL,
	"provider" varchar(32) DEFAULT 'whatsapp' NOT NULL,
	"provider_message_id" varchar(128),
	"template_key" varchar(64),
	"body_text" text,
	"media_id" varchar(128),
	"media_mime" varchar(64),
	"status" "message_status" DEFAULT 'queued' NOT NULL,
	"status_error_code" integer,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opt_outs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"debtor_id" uuid,
	"phone_e164" varchar(32) NOT NULL,
	"phone_hash" varchar(128) NOT NULL,
	"source" varchar(32) DEFAULT 'keyword' NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"debtor_id" uuid NOT NULL,
	"step_key" varchar(32) NOT NULL,
	"channel" "channel" NOT NULL,
	"template_key" varchar(64) NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" "reminder_status" DEFAULT 'scheduled' NOT NULL,
	"skip_reason" varchar(64),
	"provider_message_id" varchar(128),
	"idempotency_key" varchar(160) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error_code" integer,
	"group_key" varchar(160),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" varchar(32) DEFAULT 'whatsapp' NOT NULL,
	"dedupe_key" varchar(200) NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"process_error" text
);
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_debtor_id_debtors_id_fk" FOREIGN KEY ("debtor_id") REFERENCES "public"."debtors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opt_outs" ADD CONSTRAINT "opt_outs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opt_outs" ADD CONSTRAINT "opt_outs_debtor_id_debtors_id_fk" FOREIGN KEY ("debtor_id") REFERENCES "public"."debtors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_debtor_id_debtors_id_fk" FOREIGN KEY ("debtor_id") REFERENCES "public"."debtors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_provider_msg_uniq" ON "messages" USING btree ("provider","provider_message_id");--> statement-breakpoint
CREATE INDEX "messages_tenant_debtor_idx" ON "messages" USING btree ("tenant_id","debtor_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "opt_outs_tenant_phone_uniq" ON "opt_outs" USING btree ("tenant_id","phone_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "reminders_invoice_step_channel_uniq" ON "reminders" USING btree ("invoice_id","step_key","channel");--> statement-breakpoint
CREATE UNIQUE INDEX "reminders_tenant_idem_uniq" ON "reminders" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "reminders_tenant_due_idx" ON "reminders" USING btree ("tenant_id","status","due_at");--> statement-breakpoint
CREATE INDEX "reminders_debtor_idx" ON "reminders" USING btree ("tenant_id","debtor_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_dedupe_uniq" ON "webhook_events" USING btree ("dedupe_key");--> statement-breakpoint
-- ============================================================
-- HAND-WRITTEN (not generated): row level security for the M2
-- tables reminders, messages, opt_outs. webhook_events is a
-- platform-level inbox (no tenant_id) and is intentionally
-- not granted to tahseel_app; only the owner connection and
-- the webhook route (owner in dev) touch it.
-- ============================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON reminders, messages, opt_outs TO tahseel_app;
--> statement-breakpoint
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON reminders USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON messages USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE opt_outs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON opt_outs USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
