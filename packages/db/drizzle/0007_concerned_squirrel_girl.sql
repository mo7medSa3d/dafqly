CREATE TYPE "public"."cheque_direction" AS ENUM('receivable', 'payable');--> statement-breakpoint
CREATE TYPE "public"."cheque_status" AS ENUM('held', 'deposited', 'cleared', 'bounced', 'returned', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."subscription_invoice_status" AS ENUM('issued', 'paid', 'void');--> statement-breakpoint
CREATE TABLE "cheque_alerts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cheque_id" uuid NOT NULL,
	"alert_kind" varchar(20) NOT NULL,
	"alert_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cheques" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"debtor_id" uuid NOT NULL,
	"direction" "cheque_direction" NOT NULL,
	"invoice_id" uuid,
	"number" varchar(40) NOT NULL,
	"bank" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"status" "cheque_status" DEFAULT 'held' NOT NULL,
	"image_file_id" uuid,
	"payment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"key" varchar(32) PRIMARY KEY NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"monthly_message_quota" integer,
	"price_minor" bigint DEFAULT 0 NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_key" varchar(32) NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"amount_minor" bigint NOT NULL,
	"status" "subscription_invoice_status" DEFAULT 'issued' NOT NULL,
	"provider_ref" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cheque_alerts" ADD CONSTRAINT "cheque_alerts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cheque_alerts" ADD CONSTRAINT "cheque_alerts_cheque_id_cheques_id_fk" FOREIGN KEY ("cheque_id") REFERENCES "public"."cheques"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_debtor_id_debtors_id_fk" FOREIGN KEY ("debtor_id") REFERENCES "public"."debtors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_image_file_id_files_id_fk" FOREIGN KEY ("image_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cheque_alerts_cheque_kind_uniq" ON "cheque_alerts" USING btree ("cheque_id","alert_kind");--> statement-breakpoint
CREATE INDEX "cheque_alerts_tenant_idx" ON "cheque_alerts" USING btree ("tenant_id","alert_date");--> statement-breakpoint
CREATE INDEX "cheques_tenant_due_idx" ON "cheques" USING btree ("tenant_id","due_date","status");--> statement-breakpoint
CREATE INDEX "cheques_tenant_debtor_idx" ON "cheques" USING btree ("tenant_id","debtor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_invoices_tenant_period_uniq" ON "subscription_invoices" USING btree ("tenant_id","period_start");--> statement-breakpoint
CREATE INDEX "subscription_invoices_tenant_idx" ON "subscription_invoices" USING btree ("tenant_id","created_at");--> statement-breakpoint
-- ============================================================
-- HAND-WRITTEN (not generated): row level security for the M5
-- tenant tables (cheques, cheque_alerts, subscription_invoices).
-- `plans` is platform CONFIG, not tenant-owned: no RLS; the app
-- role gets read access only (writes happen via migrations/seed).
-- ============================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON cheques, cheque_alerts, subscription_invoices TO tahseel_app;
--> statement-breakpoint
GRANT SELECT ON plans TO tahseel_app;
--> statement-breakpoint
ALTER TABLE cheques ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cheques USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE cheque_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cheque_alerts USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE subscription_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON subscription_invoices USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
-- F13 plan catalogue seed (mirrors @tahseel/core PLANS_SEED).
-- price_minor values are PLACEHOLDERS pending HUMAN_INPUTS #10.
INSERT INTO plans (key, name_ar, name_en, monthly_message_quota, price_minor, features) VALUES
  ('trial', 'تجريبي', 'Trial', 100, 0, '{}'),
  ('starter', 'الأساسية', 'Starter', 500, 4900, '{}'),
  ('growth', 'النمو', 'Growth', 2000, 14900, '{}')
ON CONFLICT (key) DO NOTHING;
