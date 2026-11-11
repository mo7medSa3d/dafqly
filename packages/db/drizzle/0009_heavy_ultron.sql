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
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_tenant_dedupe_uniq" ON "notifications" USING btree ("tenant_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_tenant_unread_idx" ON "notifications" USING btree ("tenant_id","dismissed_at","read_at","created_at");--> statement-breakpoint
-- ============================================================
-- HAND-WRITTEN (not generated): row level security for notifications.
-- ============================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON notifications TO tahseel_app;--> statement-breakpoint
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notifications USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());