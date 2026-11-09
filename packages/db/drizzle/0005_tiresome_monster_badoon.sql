CREATE TYPE "public"."dispute_raised_by" AS ENUM('debtor', 'merchant');--> statement-breakpoint
CREATE TYPE "public"."dispute_status" AS ENUM('open', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."payment_link_status" AS ENUM('pending', 'paid', 'expired', 'failed', 'amount_mismatch');--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"debtor_id" uuid NOT NULL,
	"raised_by" "dispute_raised_by" NOT NULL,
	"reason" text NOT NULL,
	"status" "dispute_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"debtor_id" uuid NOT NULL,
	"invoice_id" uuid,
	"amount_minor" bigint NOT NULL,
	"currency" text DEFAULT 'EGP' NOT NULL,
	"provider" varchar(32) DEFAULT 'paymob' NOT NULL,
	"special_reference" varchar(80) NOT NULL,
	"provider_intention_id" varchar(128),
	"checkout_url" text NOT NULL,
	"status" "payment_link_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"paid_payment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statement_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"debtor_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "gateway_transaction_id" varchar(64);--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "gateway_order_id" varchar(64);--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "reversal_of" uuid;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_debtor_id_debtors_id_fk" FOREIGN KEY ("debtor_id") REFERENCES "public"."debtors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_debtor_id_debtors_id_fk" FOREIGN KEY ("debtor_id") REFERENCES "public"."debtors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_paid_payment_id_payments_id_fk" FOREIGN KEY ("paid_payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_links" ADD CONSTRAINT "statement_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_links" ADD CONSTRAINT "statement_links_debtor_id_debtors_id_fk" FOREIGN KEY ("debtor_id") REFERENCES "public"."debtors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "disputes_tenant_invoice_idx" ON "disputes" USING btree ("tenant_id","invoice_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_links_reference_uniq" ON "payment_links" USING btree ("special_reference");--> statement-breakpoint
CREATE INDEX "payment_links_tenant_debtor_idx" ON "payment_links" USING btree ("tenant_id","debtor_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "statement_links_token_hash_uniq" ON "statement_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "statement_links_tenant_debtor_idx" ON "statement_links" USING btree ("tenant_id","debtor_id");--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_reversal_of_payments_id_fk" FOREIGN KEY ("reversal_of") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_gateway_txn_uniq" ON "payments" USING btree ("gateway_transaction_id");--> statement-breakpoint
-- ============================================================
-- HAND-WRITTEN (not generated): row level security for the M3
-- tables payment_links, statement_links, disputes. All three are
-- tenant-owned; the public statement page and the Paymob webhook
-- resolve their tenant through the owner connection (by token
-- hash / special reference) and then work inside withTenant.
-- ============================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON payment_links, statement_links, disputes TO tahseel_app;
--> statement-breakpoint
ALTER TABLE payment_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payment_links USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE statement_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON statement_links USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON disputes USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
