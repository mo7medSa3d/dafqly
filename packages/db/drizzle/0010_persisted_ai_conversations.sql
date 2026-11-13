CREATE TABLE "ai_conversations" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "public"."tenants"("id") ON DELETE cascade,
  "user_id" text NOT NULL REFERENCES "public"."user"("id") ON DELETE cascade,
  "title" varchar(180) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ai_conversations_id_tenant_uniq" ON "ai_conversations" USING btree ("id", "tenant_id");
--> statement-breakpoint
CREATE INDEX "ai_conversations_tenant_user_updated_idx" ON "ai_conversations" USING btree ("tenant_id", "user_id", "updated_at");
--> statement-breakpoint
CREATE TABLE "ai_messages" (
  "id" uuid PRIMARY KEY NOT NULL,
  "tenant_id" uuid NOT NULL REFERENCES "public"."tenants"("id") ON DELETE cascade,
  "conversation_id" uuid NOT NULL,
  "role" varchar(16) NOT NULL,
  "content" text NOT NULL,
  "model" varchar(120),
  "input_tokens" integer DEFAULT 0 NOT NULL,
  "output_tokens" integer DEFAULT 0 NOT NULL,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_messages_conversation_tenant_fk"
    FOREIGN KEY ("conversation_id", "tenant_id")
    REFERENCES "ai_conversations"("id", "tenant_id") ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX "ai_messages_tenant_conversation_created_idx" ON "ai_messages" USING btree ("tenant_id", "conversation_id", "created_at");
--> statement-breakpoint
CREATE INDEX "ai_messages_tenant_created_idx" ON "ai_messages" USING btree ("tenant_id", "created_at");
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ai_conversations, ai_messages TO tahseel_app;
--> statement-breakpoint
ALTER TABLE ai_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_conversations
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE ai_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_messages
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
