-- 0015: gateway link idempotency (M8) + per-tenant gateway txn uniqueness (M07).
-- A retried createGatewayLink with the same key returns the original link
-- instead of minting a second Paymob intention for the same debt.
ALTER TABLE payment_links ADD COLUMN idempotency_key text;
CREATE UNIQUE INDEX payment_links_tenant_idempotency_uniq
  ON payment_links (tenant_id, idempotency_key);

-- The gateway transaction id was unique GLOBALLY, so one tenant's callback
-- could (in theory) collide with another tenant's transaction id. Scope it
-- per tenant; NULLs stay distinct, so rows without a gateway transaction
-- (manual/cheque payments) are unaffected.
DROP INDEX payments_gateway_txn_uniq;
CREATE UNIQUE INDEX payments_tenant_gateway_txn_uniq
  ON payments (tenant_id, gateway_transaction_id);
