CREATE TYPE "public"."import_job_kind" AS ENUM('excel', 'ledger_photo');--> statement-breakpoint
CREATE TYPE "public"."import_job_status" AS ENUM('pending_review', 'committed', 'undone', 'failed');--> statement-breakpoint
CREATE TYPE "public"."import_row_status" AS ENUM('pending_review', 'accepted', 'rejected', 'duplicate');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'instapay', 'bank', 'wallet', 'cheque', 'gateway', 'other');--> statement-breakpoint
CREATE TYPE "public"."payment_source" AS ENUM('manual', 'gateway_webhook', 'receipt_ai');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('claimed', 'confirmed', 'rejected');--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "import_job_kind" DEFAULT 'excel' NOT NULL,
	"status" "import_job_status" DEFAULT 'pending_review' NOT NULL,
	"file_name" text NOT NULL,
	"file_id" uuid,
	"mapping" jsonb,
	"header_row" bigint,
	"stats" jsonb,
	"committed_at" timestamp with time zone,
	"undone_at" timestamp with time zone,
	"undo_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_rows" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"row_number" bigint NOT NULL,
	"parsed" jsonb,
	"row_status" "import_row_status" DEFAULT 'pending_review' NOT NULL,
	"errors" jsonb,
	"confidence" text,
	"debtor_id" uuid,
	"invoice_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid,
	"debtor_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"method" "payment_method" DEFAULT 'cash' NOT NULL,
	"received_on" date NOT NULL,
	"reference_no" text,
	"status" "payment_status" DEFAULT 'confirmed' NOT NULL,
	"source" "payment_source" DEFAULT 'manual' NOT NULL,
	"evidence_file_id" uuid,
	"confirmed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "debtors" ADD COLUMN "import_job_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "import_job_id" uuid;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_job_id_import_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_debtor_id_debtors_id_fk" FOREIGN KEY ("debtor_id") REFERENCES "public"."debtors"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_debtor_id_debtors_id_fk" FOREIGN KEY ("debtor_id") REFERENCES "public"."debtors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_jobs_tenant_created_idx" ON "import_jobs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "import_rows_job_idx" ON "import_rows" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_allocations_payment_invoice_unique" ON "payment_allocations" USING btree ("payment_id","invoice_id");--> statement-breakpoint
CREATE INDEX "payment_allocations_invoice_idx" ON "payment_allocations" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "payments_tenant_debtor_idx" ON "payments" USING btree ("tenant_id","debtor_id");--> statement-breakpoint
CREATE INDEX "payments_tenant_received_idx" ON "payments" USING btree ("tenant_id","received_on");--> statement-breakpoint
-- ============================================================
-- RLS for the M1 tables (hand-written, appended to the generated
-- migration, same pattern as 0000): grants + tenant-isolation
-- policies for payments, payment_allocations, import_jobs,
-- import_rows. The runtime connects ONLY as tahseel_app.
-- ============================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON payments, payment_allocations, import_jobs, import_rows TO tahseel_app;
--> statement-breakpoint
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payments USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE payment_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payment_allocations USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE import_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON import_jobs USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE import_rows ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON import_rows USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
