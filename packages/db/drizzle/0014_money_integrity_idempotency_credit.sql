-- 0014_money_integrity_idempotency_credit
-- Prompt 02 financial-core hardening (audit F02/F04/F05, H01/H05):
--  * payments.currency: every payment records its currency (was missing;
--    aggregates silently summed minor units across currencies).
--  * payments.idempotency_key + UNIQUE(tenant_id, idempotency_key):
--    a retried recordPayment returns the original row instead of
--    double-recording (requireIdempotencyKey existed but was never called
--    on any money mutation).
--  * debtors.credit_minor: overpayment credit is persisted (was computed
--    and displayed but never stored or consumed) and recomputed from the
--    ledger after every money mutation. It may go negative: that is the
--    over-reversal signal (a reversed payment whose credit was already
--    consumed), surfaced rather than clamped to 0.
--  * invoice_sequences: per-tenant atomic counter replacing the racy
--    count()+1001 reference generation, + UNIQUE(tenant_id, reference).
--  * CHECK backstops on the money tables (H01): amounts positive,
--    paid_minor within [0, amount_minor], reversal rows non-zero, and
--    currencies restricted to the supported set. Reversal allocations
--    are negative by design (planReversalAllocations), so the allocation
--    check is != 0, not > 0.
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "currency" text NOT NULL DEFAULT 'EGP';
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_currency_supported"
  CHECK ("currency" IN ('EGP','SAR','USD','AED','EUR','KWD','JPY'));
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "idempotency_key" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "payments_tenant_idempotency_uniq" ON "payments" ("tenant_id", "idempotency_key");
--> statement-breakpoint
ALTER TABLE "debtors" ADD COLUMN "credit_minor" bigint NOT NULL DEFAULT 0;
--> statement-breakpoint
-- The currency the stored credit belongs to. Credit is consumed only by
-- payments in the same currency (there is no FX conversion); a payment in
-- another currency neither consumes nor creates stored credit.
ALTER TABLE "debtors" ADD COLUMN "credit_currency" text NOT NULL DEFAULT 'EGP';
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_currency_supported"
  CHECK ("currency" IN ('EGP','SAR','USD','AED','EUR','KWD','JPY'));
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_amount_positive" CHECK ("amount_minor" > 0);
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_paid_range" CHECK ("paid_minor" >= 0 AND "paid_minor" <= "amount_minor");
--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_nonzero" CHECK ("amount_minor" <> 0);
--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_amount_nonzero" CHECK ("amount_minor" <> 0);
--> statement-breakpoint
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_amount_positive" CHECK ("amount_minor" > 0);
--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_amount_positive" CHECK ("amount_minor" > 0);
--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_tenant_reference_uniq" ON "invoices" ("tenant_id", "reference");
--> statement-breakpoint
CREATE TABLE "invoice_sequences" (
  "tenant_id" uuid PRIMARY KEY REFERENCES "public"."tenants"("id") ON DELETE cascade,
  "next_val" bigint NOT NULL DEFAULT 1001,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "invoice_sequences_next_val_positive" CHECK ("next_val" > 0)
);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON invoice_sequences TO tahseel_app;
--> statement-breakpoint
ALTER TABLE invoice_sequences ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON invoice_sequences USING (tenant_id = app_current_tenant()) WITH CHECK (tenant_id = app_current_tenant());
--> statement-breakpoint
ALTER TABLE invoice_sequences FORCE ROW LEVEL SECURITY;
