CREATE TYPE "promise_status" AS ENUM ('pending', 'accepted', 'kept', 'broken', 'rejected', 'cancelled');
--> statement-breakpoint
CREATE TYPE "promise_source" AS ENUM ('manual', 'customer_portal', 'ai');
--> statement-breakpoint
CREATE TABLE "promises_to_pay" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "public"."tenants"("id") ON DELETE cascade,
  "debtor_id" uuid NOT NULL REFERENCES "public"."debtors"("id") ON DELETE cascade,
  "invoice_id" uuid REFERENCES "public"."invoices"("id") ON DELETE set null,
  "amount_minor" bigint NOT NULL,
  "promised_on" date NOT NULL,
  "status" "promise_status" NOT NULL DEFAULT 'pending',
  "source" "promise_source" NOT NULL DEFAULT 'manual',
  "note" text,
  "requested_by" text REFERENCES "public"."user"("id") ON DELETE SET NULL,
  "reviewed_by" text REFERENCES "public"."user"("id") ON DELETE SET NULL,
  "reviewed_at" timestamptz,
  "fulfilled_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "promises_amount_positive" CHECK ("amount_minor" > 0),
  CONSTRAINT "promises_kept_requires_fulfilled_at" CHECK ("status" <> 'kept' OR "fulfilled_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX "promises_tenant_status_date_idx" ON "promises_to_pay" ("tenant_id", "status", "promised_on");
CREATE INDEX "promises_debtor_date_idx" ON "promises_to_pay" ("tenant_id", "debtor_id", "promised_on");
CREATE INDEX "promises_invoice_idx" ON "promises_to_pay" ("invoice_id");
--> statement-breakpoint
CREATE TYPE "collection_task_status" AS ENUM ('open', 'in_progress', 'done', 'cancelled');
--> statement-breakpoint
CREATE TYPE "collection_task_priority" AS ENUM ('low', 'normal', 'high', 'urgent');
--> statement-breakpoint
CREATE TABLE "collection_tasks" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "public"."tenants"("id") ON DELETE cascade,
  "debtor_id" uuid NOT NULL REFERENCES "public"."debtors"("id") ON DELETE cascade,
  "invoice_id" uuid REFERENCES "public"."invoices"("id") ON DELETE set null,
  "title" varchar(180) NOT NULL,
  "description" text,
  "priority" "collection_task_priority" NOT NULL DEFAULT 'normal',
  "status" "collection_task_status" NOT NULL DEFAULT 'open',
  "assigned_to_user_id" text REFERENCES "public"."user"("id") ON DELETE SET NULL,
  "due_at" timestamptz NOT NULL,
  "created_by" text NOT NULL REFERENCES "public"."user"("id") ON DELETE restrict,
  "completed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "collection_tasks_title_not_blank" CHECK (length(trim("title")) >= 3)
);
--> statement-breakpoint
CREATE INDEX "collection_tasks_tenant_status_due_idx" ON "collection_tasks" ("tenant_id", "status", "due_at");
CREATE INDEX "collection_tasks_tenant_assignee_idx" ON "collection_tasks" ("tenant_id", "assigned_to_user_id", "status");
CREATE INDEX "collection_tasks_debtor_idx" ON "collection_tasks" ("debtor_id");
--> statement-breakpoint
CREATE TYPE "ai_action_type" AS ENUM ('create_collection_task', 'schedule_reminder');
--> statement-breakpoint
CREATE TYPE "ai_action_status" AS ENUM ('pending', 'approved', 'rejected', 'executed', 'failed');
--> statement-breakpoint
CREATE TABLE "ai_action_approvals" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "public"."tenants"("id") ON DELETE cascade,
  "requested_by" text NOT NULL REFERENCES "public"."user"("id") ON DELETE restrict,
  "action_type" "ai_action_type" NOT NULL,
  "status" "ai_action_status" NOT NULL DEFAULT 'pending',
  "title" varchar(180) NOT NULL,
  "rationale" text NOT NULL,
  "payload" jsonb NOT NULL,
  "approved_by" text REFERENCES "public"."user"("id") ON DELETE SET NULL,
  "approved_at" timestamptz,
  "executed_at" timestamptz,
  "result" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "ai_action_approvals_tenant_status_created_idx" ON "ai_action_approvals" ("tenant_id", "status", "created_at");
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON promises_to_pay, collection_tasks, ai_action_approvals TO tahseel_app;
--> statement-breakpoint
ALTER TABLE promises_to_pay ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON promises_to_pay USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE collection_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON collection_tasks USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE ai_action_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_action_approvals USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
-- Platform accounting is visible only to the migration/owner database role.
CREATE TABLE "ai_global_budget" (
  "singleton_id" integer PRIMARY KEY DEFAULT 1 CHECK ("singleton_id" = 1),
  "period_start" date NOT NULL,
  "cap_usd_micros" bigint NOT NULL,
  "spent_usd_micros" bigint NOT NULL DEFAULT 0,
  "reserved_usd_micros" bigint NOT NULL DEFAULT 0,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ai_global_budget_amounts_nonnegative" CHECK ("cap_usd_micros" > 0 AND "spent_usd_micros" >= 0 AND "reserved_usd_micros" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ai_global_usage" (
  "id" uuid PRIMARY KEY NOT NULL,
  "request_key" varchar(96) NOT NULL UNIQUE,
  "tenant_id" uuid NOT NULL,
  "model" varchar(120) NOT NULL,
  "status" varchar(16) NOT NULL DEFAULT 'reserved',
  "reserved_usd_micros" bigint NOT NULL,
  "actual_usd_micros" bigint NOT NULL DEFAULT 0,
  "input_tokens" integer NOT NULL DEFAULT 0,
  "output_tokens" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ai_global_usage_amounts_nonnegative" CHECK ("reserved_usd_micros" >= 0 AND "actual_usd_micros" >= 0),
  CONSTRAINT "ai_global_usage_tokens_nonnegative" CHECK ("input_tokens" >= 0 AND "output_tokens" >= 0),
  CONSTRAINT "ai_global_usage_status_valid" CHECK ("status" IN ('reserved','settled','released'))
);
--> statement-breakpoint
CREATE INDEX "ai_global_usage_period_idx" ON "ai_global_usage" ("created_at", "status");
--> statement-breakpoint
INSERT INTO "ai_global_budget" ("singleton_id", "period_start", "cap_usd_micros")
VALUES (1, date_trunc('month', CURRENT_DATE)::date, 50000000);
