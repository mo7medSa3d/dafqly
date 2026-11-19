CREATE TYPE "public"."ai_action_status" AS ENUM('pending', 'approved', 'rejected', 'executed', 'failed');
--> statement-breakpoint
CREATE TYPE "public"."ai_action_type" AS ENUM('create_collection_task', 'schedule_reminder');
--> statement-breakpoint
CREATE TYPE "public"."channel" AS ENUM('whatsapp', 'sms');
--> statement-breakpoint
CREATE TYPE "public"."cheque_direction" AS ENUM('receivable', 'payable');
--> statement-breakpoint
CREATE TYPE "public"."cheque_status" AS ENUM('held', 'deposited', 'cleared', 'bounced', 'returned', 'cancelled');
--> statement-breakpoint
CREATE TYPE "public"."collection_task_priority" AS ENUM('low', 'normal', 'high', 'urgent');
--> statement-breakpoint
CREATE TYPE "public"."collection_task_status" AS ENUM('open', 'in_progress', 'done', 'cancelled');
--> statement-breakpoint
CREATE TYPE "public"."dispute_raised_by" AS ENUM('debtor', 'merchant');
--> statement-breakpoint
CREATE TYPE "public"."dispute_status" AS ENUM('open', 'resolved');
--> statement-breakpoint
CREATE TYPE "public"."import_job_kind" AS ENUM('excel', 'ledger_photo');
--> statement-breakpoint
CREATE TYPE "public"."import_job_status" AS ENUM('pending_review', 'committed', 'undone', 'failed');
--> statement-breakpoint
CREATE TYPE "public"."import_row_status" AS ENUM('pending_review', 'accepted', 'rejected', 'duplicate');
--> statement-breakpoint
CREATE TYPE "public"."invoice_source" AS ENUM('manual', 'import', 'ledger_photo');
--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('open', 'partially_paid', 'paid', 'disputed', 'written_off', 'cancelled');
--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('out', 'in');
--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('queued', 'sent', 'delivered', 'read', 'failed', 'received');
--> statement-breakpoint
CREATE TYPE "public"."payment_link_status" AS ENUM('pending', 'paid', 'expired', 'failed', 'amount_mismatch');
--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'instapay', 'bank', 'wallet', 'cheque', 'gateway', 'other');
--> statement-breakpoint
CREATE TYPE "public"."payment_source" AS ENUM('manual', 'gateway_webhook', 'receipt_ai');
--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('claimed', 'confirmed', 'rejected');
--> statement-breakpoint
CREATE TYPE "public"."promise_source" AS ENUM('manual', 'customer_portal', 'ai');
--> statement-breakpoint
CREATE TYPE "public"."promise_status" AS ENUM('pending', 'accepted', 'kept', 'broken', 'rejected', 'cancelled');
--> statement-breakpoint
CREATE TYPE "public"."reminder_status" AS ENUM('scheduled', 'queued', 'sent', 'skipped', 'cancelled', 'failed');
--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('owner', 'staff');
--> statement-breakpoint
CREATE TYPE "public"."subscription_invoice_status" AS ENUM('issued', 'paid', 'void');
--> statement-breakpoint
CREATE TYPE "public"."usage_kind" AS ENUM('whatsapp_utility', 'sms', 'llm_vision', 'llm_text');
--> statement-breakpoint
CREATE TYPE "public"."whatsapp_status" AS ENUM('unknown', 'reachable', 'unreachable');
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"password" text,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_action_approvals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"requested_by" text NOT NULL,
	"action_type" "ai_action_type" NOT NULL,
	"status" "ai_action_status" DEFAULT 'pending' NOT NULL,
	"title" varchar(180) NOT NULL,
	"rationale" text NOT NULL,
	"payload" jsonb NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"executed_at" timestamp with time zone,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"title" varchar(180) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_global_budget" (
	"singleton_id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"period_start" date NOT NULL,
	"cap_usd_micros" bigint NOT NULL,
	"spent_usd_micros" bigint DEFAULT 0 NOT NULL,
	"reserved_usd_micros" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_global_budget_amounts_nonnegative" CHECK ("ai_global_budget"."cap_usd_micros" > 0 AND "ai_global_budget"."spent_usd_micros" >= 0 AND "ai_global_budget"."reserved_usd_micros" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ai_global_usage" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_key" varchar(96) NOT NULL,
	"tenant_id" uuid NOT NULL,
	"model" varchar(120) NOT NULL,
	"status" varchar(16) DEFAULT 'reserved' NOT NULL,
	"reserved_usd_micros" bigint NOT NULL,
	"actual_usd_micros" bigint DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_global_usage_request_key_unique" UNIQUE("request_key"),
	CONSTRAINT "ai_global_usage_amounts_nonnegative" CHECK ("ai_global_usage"."reserved_usd_micros" >= 0 AND "ai_global_usage"."actual_usd_micros" >= 0),
	CONSTRAINT "ai_global_usage_tokens_nonnegative" CHECK ("ai_global_usage"."input_tokens" >= 0 AND "ai_global_usage"."output_tokens" >= 0),
	CONSTRAINT "ai_global_usage_status_valid" CHECK ("ai_global_usage"."status" IN ('reserved','settled','released'))
);
--> statement-breakpoint
CREATE TABLE "ai_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" varchar(16) NOT NULL,
	"content" text NOT NULL,
	"model" varchar(120),
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cheques_amount_positive" CHECK ("cheques"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "collection_tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"debtor_id" uuid NOT NULL,
	"invoice_id" uuid,
	"title" varchar(180) NOT NULL,
	"description" text,
	"priority" "collection_task_priority" DEFAULT 'normal' NOT NULL,
	"status" "collection_task_status" DEFAULT 'open' NOT NULL,
	"assigned_to_user_id" text,
	"due_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_tasks_title_not_blank" CHECK (length(trim("collection_tasks"."title")) >= 3)
);
--> statement-breakpoint
CREATE TABLE "debtors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"phone_e164" text NOT NULL,
	"phone_valid" boolean DEFAULT true NOT NULL,
	"whatsapp_status" "whatsapp_status" DEFAULT 'unknown' NOT NULL,
	"opted_out_at" timestamp with time zone,
	"notes" text,
	"risk_flag" boolean DEFAULT false NOT NULL,
	"phone_hash" text NOT NULL,
	"credit_minor" bigint DEFAULT 0 NOT NULL,
	"credit_currency" text DEFAULT 'EGP' NOT NULL,
	"import_job_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"debtor_id" uuid NOT NULL,
	"raised_by" "dispute_raised_by" NOT NULL,
	"reason" text NOT NULL,
	"status" "dispute_status" DEFAULT 'open' NOT NULL,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "import_job_kind" DEFAULT 'excel' NOT NULL,
	"status" "import_job_status" DEFAULT 'pending_review' NOT NULL,
	"file_name" text NOT NULL,
	"file_id" uuid,
	"mapping" jsonb,
	"source_grid" jsonb,
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
CREATE TABLE "invoice_sequences" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"next_val" bigint DEFAULT 1001 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_sequences_next_val_positive" CHECK ("invoice_sequences"."next_val" > 0)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"debtor_id" uuid NOT NULL,
	"reference" text,
	"description" text,
	"amount_minor" bigint NOT NULL,
	"currency" text DEFAULT 'EGP' NOT NULL,
	"issued_on" date NOT NULL,
	"due_on" date NOT NULL,
	"status" "invoice_status" DEFAULT 'open' NOT NULL,
	"paid_minor" bigint DEFAULT 0 NOT NULL,
	"source" "invoice_source" DEFAULT 'manual' NOT NULL,
	"import_job_id" uuid,
	"evidence_file_id" uuid,
	"last_reminded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_currency_supported" CHECK ("invoices"."currency" IN ('EGP','SAR','USD','AED','EUR','KWD','JPY')),
	CONSTRAINT "invoices_amount_positive" CHECK ("invoices"."amount_minor" > 0),
	CONSTRAINT "invoices_paid_range" CHECK ("invoices"."paid_minor" >= 0 AND "invoices"."paid_minor" <= "invoices"."amount_minor")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" "membership_role" DEFAULT 'staff' NOT NULL,
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
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" varchar(40) NOT NULL,
	"severity" varchar(16) DEFAULT 'info' NOT NULL,
	"title_ar" text NOT NULL,
	"title_en" text NOT NULL,
	"body_ar" text NOT NULL,
	"body_en" text NOT NULL,
	"action_url" text,
	"entity_type" varchar(32),
	"entity_id" uuid,
	"dedupe_key" varchar(160) NOT NULL,
	"read_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
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
CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_allocations_amount_nonzero" CHECK ("payment_allocations"."amount_minor" <> 0)
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
	"idempotency_key" text,
	"provider_intention_id" varchar(128),
	"checkout_url" text NOT NULL,
	"status" "payment_link_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"paid_payment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_links_amount_positive" CHECK ("payment_links"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid,
	"debtor_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text DEFAULT 'EGP' NOT NULL,
	"idempotency_key" text,
	"method" "payment_method" DEFAULT 'cash' NOT NULL,
	"received_on" date NOT NULL,
	"reference_no" text,
	"status" "payment_status" DEFAULT 'confirmed' NOT NULL,
	"source" "payment_source" DEFAULT 'manual' NOT NULL,
	"evidence_file_id" uuid,
	"confirmed_by" text,
	"gateway_transaction_id" varchar(64),
	"gateway_order_id" varchar(64),
	"reversal_of" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_currency_supported" CHECK ("payments"."currency" IN ('EGP','SAR','USD','AED','EUR','KWD','JPY')),
	CONSTRAINT "payments_amount_nonzero" CHECK ("payments"."amount_minor" <> 0)
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
CREATE TABLE "promises_to_pay" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"debtor_id" uuid NOT NULL,
	"invoice_id" uuid,
	"amount_minor" bigint NOT NULL,
	"promised_on" date NOT NULL,
	"status" "promise_status" DEFAULT 'pending' NOT NULL,
	"source" "promise_source" DEFAULT 'manual' NOT NULL,
	"note" text,
	"requested_by" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"fulfilled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promises_amount_positive" CHECK ("promises_to_pay"."amount_minor" > 0),
	CONSTRAINT "promises_kept_requires_fulfilled_at" CHECK ("promises_to_pay"."status" <> 'kept' OR "promises_to_pay"."fulfilled_at" IS NOT NULL)
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
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
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
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"business_name_ar" text NOT NULL,
	"timezone" text DEFAULT 'Africa/Cairo' NOT NULL,
	"plan" text DEFAULT 'trial' NOT NULL,
	"trial_ends_at" timestamp with time zone,
	"settings" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_ledger" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" "usage_kind" NOT NULL,
	"units" bigint DEFAULT 0 NOT NULL,
	"cost_estimate_minor" bigint DEFAULT 0 NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
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
CREATE INDEX "ai_action_approvals_tenant_status_created_idx" ON "ai_action_approvals" USING btree ("tenant_id","status","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_conversations_id_tenant_uniq" ON "ai_conversations" USING btree ("id","tenant_id");
--> statement-breakpoint
CREATE INDEX "ai_conversations_tenant_user_updated_idx" ON "ai_conversations" USING btree ("tenant_id","user_id","updated_at");
--> statement-breakpoint
CREATE INDEX "ai_global_usage_period_idx" ON "ai_global_usage" USING btree ("created_at","status");
--> statement-breakpoint
CREATE INDEX "ai_messages_tenant_conversation_created_idx" ON "ai_messages" USING btree ("tenant_id","conversation_id","created_at");
--> statement-breakpoint
CREATE INDEX "ai_messages_tenant_created_idx" ON "ai_messages" USING btree ("tenant_id","created_at");
--> statement-breakpoint
CREATE INDEX "audit_log_tenant_created_idx" ON "audit_log" USING btree ("tenant_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "cheque_alerts_cheque_kind_uniq" ON "cheque_alerts" USING btree ("cheque_id","alert_kind");
--> statement-breakpoint
CREATE INDEX "cheque_alerts_tenant_idx" ON "cheque_alerts" USING btree ("tenant_id","alert_date");
--> statement-breakpoint
CREATE INDEX "cheques_tenant_due_idx" ON "cheques" USING btree ("tenant_id","due_date","status");
--> statement-breakpoint
CREATE INDEX "cheques_tenant_debtor_idx" ON "cheques" USING btree ("tenant_id","debtor_id");
--> statement-breakpoint
CREATE INDEX "collection_tasks_tenant_status_due_idx" ON "collection_tasks" USING btree ("tenant_id","status","due_at");
--> statement-breakpoint
CREATE INDEX "collection_tasks_tenant_assignee_idx" ON "collection_tasks" USING btree ("tenant_id","assigned_to_user_id","status");
--> statement-breakpoint
CREATE INDEX "collection_tasks_debtor_idx" ON "collection_tasks" USING btree ("debtor_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "debtors_tenant_phone_unique" ON "debtors" USING btree ("tenant_id","phone_e164") WHERE "debtors"."deleted_at" is null;
--> statement-breakpoint
CREATE INDEX "debtors_tenant_idx" ON "debtors" USING btree ("tenant_id");
--> statement-breakpoint
CREATE INDEX "disputes_tenant_invoice_idx" ON "disputes" USING btree ("tenant_id","invoice_id","status");
--> statement-breakpoint
CREATE INDEX "disputes_tenant_status_idx" ON "disputes" USING btree ("tenant_id","status","debtor_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "files_tenant_sha256_uniq" ON "files" USING btree ("tenant_id","sha256");
--> statement-breakpoint
CREATE INDEX "files_tenant_kind_idx" ON "files" USING btree ("tenant_id","kind");
--> statement-breakpoint
CREATE INDEX "import_jobs_tenant_created_idx" ON "import_jobs" USING btree ("tenant_id","created_at");
--> statement-breakpoint
CREATE INDEX "import_rows_job_idx" ON "import_rows" USING btree ("job_id");
--> statement-breakpoint
CREATE INDEX "invoices_tenant_status_due_idx" ON "invoices" USING btree ("tenant_id","status","due_on");
--> statement-breakpoint
CREATE INDEX "invoices_tenant_issued_idx" ON "invoices" USING btree ("tenant_id","issued_on");
--> statement-breakpoint
CREATE INDEX "invoices_debtor_idx" ON "invoices" USING btree ("debtor_id");
--> statement-breakpoint
CREATE INDEX "invoices_tenant_debtor_status_idx" ON "invoices" USING btree ("tenant_id","debtor_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_tenant_reference_uniq" ON "invoices" USING btree ("tenant_id","reference");
--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_tenant_user_unique" ON "memberships" USING btree ("tenant_id","user_id");
--> statement-breakpoint
CREATE INDEX "message_intents_tenant_created_idx" ON "message_intents" USING btree ("tenant_id","created_at");
--> statement-breakpoint
CREATE INDEX "message_intents_tenant_triage_idx" ON "message_intents" USING btree ("tenant_id","resolved_by","action_taken");
--> statement-breakpoint
CREATE UNIQUE INDEX "message_intents_message_uniq" ON "message_intents" USING btree ("message_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "messages_provider_msg_uniq" ON "messages" USING btree ("provider","provider_message_id");
--> statement-breakpoint
CREATE INDEX "messages_tenant_debtor_idx" ON "messages" USING btree ("tenant_id","debtor_id","created_at");
--> statement-breakpoint
CREATE INDEX "messages_tenant_direction_idx" ON "messages" USING btree ("tenant_id","direction","status");
--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_tenant_dedupe_uniq" ON "notifications" USING btree ("tenant_id","dedupe_key");
--> statement-breakpoint
CREATE INDEX "notifications_tenant_unread_idx" ON "notifications" USING btree ("tenant_id","dismissed_at","read_at","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "opt_outs_tenant_phone_uniq" ON "opt_outs" USING btree ("tenant_id","phone_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_allocations_payment_invoice_unique" ON "payment_allocations" USING btree ("payment_id","invoice_id");
--> statement-breakpoint
CREATE INDEX "payment_allocations_invoice_idx" ON "payment_allocations" USING btree ("invoice_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_links_reference_uniq" ON "payment_links" USING btree ("special_reference");
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_links_tenant_idempotency_uniq" ON "payment_links" USING btree ("tenant_id","idempotency_key");
--> statement-breakpoint
CREATE INDEX "payment_links_tenant_debtor_idx" ON "payment_links" USING btree ("tenant_id","debtor_id","status");
--> statement-breakpoint
CREATE INDEX "payments_tenant_debtor_idx" ON "payments" USING btree ("tenant_id","debtor_id");
--> statement-breakpoint
CREATE INDEX "payments_tenant_received_idx" ON "payments" USING btree ("tenant_id","received_on");
--> statement-breakpoint
CREATE INDEX "payments_tenant_status_received_idx" ON "payments" USING btree ("tenant_id","status","received_on");
--> statement-breakpoint
CREATE INDEX "payments_tenant_ref_idx" ON "payments" USING btree ("tenant_id","reference_no");
--> statement-breakpoint
CREATE UNIQUE INDEX "payments_tenant_gateway_txn_uniq" ON "payments" USING btree ("tenant_id","gateway_transaction_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "payments_tenant_idempotency_uniq" ON "payments" USING btree ("tenant_id","idempotency_key");
--> statement-breakpoint
CREATE INDEX "promises_tenant_status_date_idx" ON "promises_to_pay" USING btree ("tenant_id","status","promised_on");
--> statement-breakpoint
CREATE INDEX "promises_debtor_date_idx" ON "promises_to_pay" USING btree ("tenant_id","debtor_id","promised_on");
--> statement-breakpoint
CREATE INDEX "promises_invoice_idx" ON "promises_to_pay" USING btree ("invoice_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "reminders_invoice_step_channel_uniq" ON "reminders" USING btree ("invoice_id","step_key","channel");
--> statement-breakpoint
CREATE UNIQUE INDEX "reminders_tenant_idem_uniq" ON "reminders" USING btree ("tenant_id","idempotency_key");
--> statement-breakpoint
CREATE INDEX "reminders_tenant_due_idx" ON "reminders" USING btree ("tenant_id","status","due_at");
--> statement-breakpoint
CREATE INDEX "reminders_debtor_idx" ON "reminders" USING btree ("tenant_id","debtor_id","status");
--> statement-breakpoint
CREATE UNIQUE INDEX "statement_links_token_hash_uniq" ON "statement_links" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX "statement_links_tenant_debtor_idx" ON "statement_links" USING btree ("tenant_id","debtor_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_invoices_tenant_period_uniq" ON "subscription_invoices" USING btree ("tenant_id","period_start");
--> statement-breakpoint
CREATE INDEX "subscription_invoices_tenant_idx" ON "subscription_invoices" USING btree ("tenant_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_dedupe_uniq" ON "webhook_events" USING btree ("dedupe_key");
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_action_approvals" ADD CONSTRAINT "ai_action_approvals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_action_approvals" ADD CONSTRAINT "ai_action_approvals_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_action_approvals" ADD CONSTRAINT "ai_action_approvals_approved_by_user_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_tenant_fk" FOREIGN KEY ("conversation_id","tenant_id") REFERENCES "public"."ai_conversations"("id","tenant_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cheque_alerts" ADD CONSTRAINT "cheque_alerts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cheque_alerts" ADD CONSTRAINT "cheque_alerts_cheque_id_cheques_id_fk" FOREIGN KEY ("cheque_id") REFERENCES "public"."cheques"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_debtor_id_debtors_id_fk" FOREIGN KEY ("debtor_id") REFERENCES "public"."debtors"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_image_file_id_files_id_fk" FOREIGN KEY ("image_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "collection_tasks" ADD CONSTRAINT "collection_tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "collection_tasks" ADD CONSTRAINT "collection_tasks_debtor_id_debtors_id_fk" FOREIGN KEY ("debtor_id") REFERENCES "public"."debtors"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "collection_tasks" ADD CONSTRAINT "collection_tasks_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "collection_tasks" ADD CONSTRAINT "collection_tasks_assigned_to_user_id_user_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "collection_tasks" ADD CONSTRAINT "collection_tasks_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "debtors" ADD CONSTRAINT "debtors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_debtor_id_debtors_id_fk" FOREIGN KEY ("debtor_id") REFERENCES "public"."debtors"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_job_id_import_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."import_jobs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_debtor_id_debtors_id_fk" FOREIGN KEY ("debtor_id") REFERENCES "public"."debtors"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoice_sequences" ADD CONSTRAINT "invoice_sequences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_debtor_id_debtors_id_fk" FOREIGN KEY ("debtor_id") REFERENCES "public"."debtors"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_evidence_file_id_files_id_fk" FOREIGN KEY ("evidence_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "message_intents" ADD CONSTRAINT "message_intents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "message_intents" ADD CONSTRAINT "message_intents_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_debtor_id_debtors_id_fk" FOREIGN KEY ("debtor_id") REFERENCES "public"."debtors"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "opt_outs" ADD CONSTRAINT "opt_outs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "opt_outs" ADD CONSTRAINT "opt_outs_debtor_id_debtors_id_fk" FOREIGN KEY ("debtor_id") REFERENCES "public"."debtors"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_debtor_id_debtors_id_fk" FOREIGN KEY ("debtor_id") REFERENCES "public"."debtors"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_paid_payment_id_payments_id_fk" FOREIGN KEY ("paid_payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_debtor_id_debtors_id_fk" FOREIGN KEY ("debtor_id") REFERENCES "public"."debtors"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_reversal_of_payments_id_fk" FOREIGN KEY ("reversal_of") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "promises_to_pay" ADD CONSTRAINT "promises_to_pay_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "promises_to_pay" ADD CONSTRAINT "promises_to_pay_debtor_id_debtors_id_fk" FOREIGN KEY ("debtor_id") REFERENCES "public"."debtors"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "promises_to_pay" ADD CONSTRAINT "promises_to_pay_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "promises_to_pay" ADD CONSTRAINT "promises_to_pay_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "promises_to_pay" ADD CONSTRAINT "promises_to_pay_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_debtor_id_debtors_id_fk" FOREIGN KEY ("debtor_id") REFERENCES "public"."debtors"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "statement_links" ADD CONSTRAINT "statement_links_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "statement_links" ADD CONSTRAINT "statement_links_debtor_id_debtors_id_fk" FOREIGN KEY ("debtor_id") REFERENCES "public"."debtors"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "usage_ledger" ADD CONSTRAINT "usage_ledger_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'tahseel_app') THEN
    CREATE ROLE tahseel_app LOGIN PASSWORD 'tahseel_app_dev' NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_current_tenant() TO tahseel_app;
--> statement-breakpoint
INSERT INTO plans (key, name_ar, name_en, monthly_message_quota, price_minor, features) VALUES
  ('trial', 'تجريبي', 'Trial', 100, 0, '{}'),
  ('starter', 'الأساسية', 'Starter', 500, 4900, '{}'),
  ('growth', 'النمو', 'Growth', 2000, 14900, '{}')
ON CONFLICT (key) DO NOTHING;
--> statement-breakpoint
GRANT SELECT ON plans TO tahseel_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON tenants TO tahseel_app;
--> statement-breakpoint
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenants_select_own ON tenants FOR SELECT USING (id = app_current_tenant());
--> statement-breakpoint
CREATE POLICY tenants_insert_any ON tenants FOR INSERT WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY tenants_update_own ON tenants FOR UPDATE USING (id = app_current_tenant()) WITH CHECK (id = app_current_tenant());
--> statement-breakpoint
CREATE POLICY tenants_delete_owner ON tenants FOR DELETE USING (id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "memberships" TO tahseel_app;
--> statement-breakpoint
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "memberships" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "audit_log" TO tahseel_app;
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "audit_log" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "usage_ledger" TO tahseel_app;
--> statement-breakpoint
ALTER TABLE "usage_ledger" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "usage_ledger" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "usage_ledger" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "debtors" TO tahseel_app;
--> statement-breakpoint
ALTER TABLE "debtors" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "debtors" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "debtors" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "invoices" TO tahseel_app;
--> statement-breakpoint
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "invoices" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "invoices" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "payments" TO tahseel_app;
--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "payments" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "payment_allocations" TO tahseel_app;
--> statement-breakpoint
ALTER TABLE "payment_allocations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "payment_allocations" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "payment_allocations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "import_jobs" TO tahseel_app;
--> statement-breakpoint
ALTER TABLE "import_jobs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "import_jobs" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "import_jobs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "import_rows" TO tahseel_app;
--> statement-breakpoint
ALTER TABLE "import_rows" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "import_rows" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "import_rows" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "reminders" TO tahseel_app;
--> statement-breakpoint
ALTER TABLE "reminders" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "reminders" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "reminders" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "messages" TO tahseel_app;
--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "messages" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "opt_outs" TO tahseel_app;
--> statement-breakpoint
ALTER TABLE "opt_outs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "opt_outs" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "opt_outs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "payment_links" TO tahseel_app;
--> statement-breakpoint
ALTER TABLE "payment_links" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "payment_links" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "payment_links" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "statement_links" TO tahseel_app;
--> statement-breakpoint
ALTER TABLE "statement_links" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "statement_links" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "statement_links" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "disputes" TO tahseel_app;
--> statement-breakpoint
ALTER TABLE "disputes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "disputes" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "disputes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "files" TO tahseel_app;
--> statement-breakpoint
ALTER TABLE "files" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "files" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "files" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "message_intents" TO tahseel_app;
--> statement-breakpoint
ALTER TABLE "message_intents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "message_intents" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "message_intents" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "cheques" TO tahseel_app;
--> statement-breakpoint
ALTER TABLE "cheques" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "cheques" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "cheques" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "cheque_alerts" TO tahseel_app;
--> statement-breakpoint
ALTER TABLE "cheque_alerts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "cheque_alerts" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "cheque_alerts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "subscription_invoices" TO tahseel_app;
--> statement-breakpoint
ALTER TABLE "subscription_invoices" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "subscription_invoices" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "subscription_invoices" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "notifications" TO tahseel_app;
--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "notifications" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "ai_conversations" TO tahseel_app;
--> statement-breakpoint
ALTER TABLE "ai_conversations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "ai_conversations" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "ai_conversations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "ai_messages" TO tahseel_app;
--> statement-breakpoint
ALTER TABLE "ai_messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "ai_messages" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "ai_messages" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "promises_to_pay" TO tahseel_app;
--> statement-breakpoint
ALTER TABLE "promises_to_pay" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "promises_to_pay" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "promises_to_pay" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "collection_tasks" TO tahseel_app;
--> statement-breakpoint
ALTER TABLE "collection_tasks" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "collection_tasks" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "collection_tasks" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "ai_action_approvals" TO tahseel_app;
--> statement-breakpoint
ALTER TABLE "ai_action_approvals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "ai_action_approvals" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "ai_action_approvals" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "invoice_sequences" TO tahseel_app;
--> statement-breakpoint
ALTER TABLE "invoice_sequences" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "invoice_sequences" USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE "invoice_sequences" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON webhook_events FROM tahseel_app;
--> statement-breakpoint
REVOKE ALL ON ai_global_budget FROM tahseel_app;
--> statement-breakpoint
REVOKE ALL ON ai_global_usage FROM tahseel_app;
--> statement-breakpoint
REVOKE ALL ON tenant_deletions FROM tahseel_app;
--> statement-breakpoint
REVOKE ALL ON "session" FROM tahseel_app;
--> statement-breakpoint
REVOKE ALL ON account FROM tahseel_app;
--> statement-breakpoint
REVOKE ALL ON verification FROM tahseel_app;
--> statement-breakpoint
REVOKE ALL ON "user" FROM tahseel_app;
--> statement-breakpoint
GRANT SELECT (id, name) ON "user" TO tahseel_app;
