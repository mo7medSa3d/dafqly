#!/usr/bin/env node
/**
 * M6 load dataset (BUILD_PLAN §8): one tenant with 100,000 invoices across
 * 5,000 debtors, confirmed payments for the paid/partial share, and one
 * scheduled reminder per open invoice. Deterministic (pure generate_series
 * arithmetic, no randomness). Run against a SCRATCH database that already
 * has the migrations applied:
 *   LOAD_DATABASE_URL=postgres://... node scripts/load/generate-100k.mjs
 * Prints the load tenant id at the end (also stored in load_meta).
 */
import { execFileSync } from "node:child_process";

const url = process.env.LOAD_DATABASE_URL;
if (!url) { console.error("LOAD_DATABASE_URL is required"); process.exit(1); }

const sql = /* sql */ `
\\set QUIET on
BEGIN;
CREATE TABLE IF NOT EXISTS load_meta (tenant_id uuid);
DELETE FROM load_meta;
WITH t AS (
  INSERT INTO tenants (id, name, business_name_ar, timezone, plan, settings)
  VALUES (gen_random_uuid(), 'Load Tenant', 'شركة الحمل', 'Africa/Cairo', 'growth',
          '{"quietStart":"21:00","quietEnd":"09:00","fridayMorningSkip":false,"autoCloseEnabled":false,"defaultChannel":"whatsapp","tone":"polite","defaultTermsDays":14,"easternDigits":false}'::jsonb)
  RETURNING id
)
INSERT INTO load_meta SELECT id FROM t;

-- 5,000 debtors
INSERT INTO debtors (id, tenant_id, display_name, phone_e164, phone_hash)
SELECT gen_random_uuid(), (SELECT tenant_id FROM load_meta),
       'Load Debtor ' || i,
       '+2010' || lpad(i::text, 8, '0'),
       md5('load' || i::text)
FROM generate_series(1, 5000) AS i;

-- 100,000 invoices: 55% open, 15% partially_paid, 30% paid (deterministic by i % 20)
INSERT INTO invoices (id, tenant_id, debtor_id, reference, amount_minor, paid_minor, currency, issued_on, due_on, status, last_reminded_at)
SELECT gen_random_uuid(), (SELECT tenant_id FROM load_meta), d.id,
       'LD-' || i,
       50000 + ((i * 37) % 450000),
       CASE WHEN i % 20 < 11 THEN 0 WHEN i % 20 < 14 THEN (50000 + ((i * 37) % 450000)) / 2 ELSE 50000 + ((i * 37) % 450000) END,
       'EGP',
       (date '2026-06-01' + ((i * 7) % 165)),
       (date '2026-06-01' + ((i * 7) % 165) + 14),
       CASE WHEN i % 20 < 11 THEN 'open' WHEN i % 20 < 14 THEN 'partially_paid' ELSE 'paid' END::invoice_status,
       CASE WHEN i % 20 < 14 THEN timestamptz '2026-11-01 10:00+02' ELSE NULL END
FROM generate_series(1, 100000) AS i
JOIN (SELECT id, row_number() OVER (ORDER BY phone_e164) AS rn FROM debtors WHERE tenant_id = (SELECT tenant_id FROM load_meta)) d
  ON d.rn = ((i - 1) % 5000) + 1;

-- one confirmed payment per paid/partial invoice (45,000), allocation = paid_minor
INSERT INTO payments (id, tenant_id, invoice_id, debtor_id, amount_minor, method, received_on, status, source)
SELECT gen_random_uuid(), inv.tenant_id, inv.id, inv.debtor_id, inv.paid_minor, 'cash'::payment_method,
       inv.due_on + 5, 'confirmed'::payment_status, 'manual'::payment_source
FROM invoices inv
WHERE inv.tenant_id = (SELECT tenant_id FROM load_meta) AND inv.paid_minor > 0;

INSERT INTO payment_allocations (id, tenant_id, payment_id, invoice_id, amount_minor)
SELECT gen_random_uuid(), p.tenant_id, p.id, p.invoice_id, p.amount_minor
FROM payments p WHERE p.tenant_id = (SELECT tenant_id FROM load_meta);

-- one scheduled reminder per open/partial invoice (70,000)
INSERT INTO reminders (id, tenant_id, invoice_id, debtor_id, step_key, channel, template_key, due_at, status, idempotency_key)
SELECT gen_random_uuid(), inv.tenant_id, inv.id, inv.debtor_id, 'd+3', 'whatsapp'::channel, 'invoice_overdue',
       timestamptz '2026-11-10 10:00+02', 'scheduled'::reminder_status, 'load-' || inv.id
FROM invoices inv
WHERE inv.tenant_id = (SELECT tenant_id FROM load_meta) AND inv.status IN ('open', 'partially_paid');

-- a few messages for reminder-performance (sent/delivered/inbound samples)
INSERT INTO messages (id, tenant_id, debtor_id, direction, channel, provider, status, body_text)
SELECT gen_random_uuid(), (SELECT tenant_id FROM load_meta), d.id, 'out'::message_direction, 'whatsapp'::channel, 'whatsapp',
       CASE WHEN i % 2 = 0 THEN 'delivered' ELSE 'sent' END::message_status, 'load outbound'
FROM generate_series(1, 2000) AS i
JOIN (SELECT id, row_number() OVER (ORDER BY phone_e164) AS rn FROM debtors WHERE tenant_id = (SELECT tenant_id FROM load_meta)) d
  ON d.rn = i;
INSERT INTO messages (id, tenant_id, debtor_id, direction, channel, provider, status, body_text)
SELECT gen_random_uuid(), (SELECT tenant_id FROM load_meta), d.id, 'in'::message_direction, 'whatsapp'::channel, 'whatsapp', 'received'::message_status, 'تمام'
FROM generate_series(1, 300) AS i
JOIN (SELECT id, row_number() OVER (ORDER BY phone_e164) AS rn FROM debtors WHERE tenant_id = (SELECT tenant_id FROM load_meta)) d
  ON d.rn = i;
COMMIT;
SELECT 'load_tenant=' || tenant_id FROM load_meta;
SELECT 'invoices=' || count(*) FROM invoices WHERE tenant_id = (SELECT tenant_id FROM load_meta);
SELECT 'debtors=' || count(*) FROM debtors WHERE tenant_id = (SELECT tenant_id FROM load_meta);
SELECT 'payments=' || count(*) FROM payments WHERE tenant_id = (SELECT tenant_id FROM load_meta);
SELECT 'reminders=' || count(*) FROM reminders WHERE tenant_id = (SELECT tenant_id FROM load_meta);
`;
const out = execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-At"], { input: sql, encoding: "utf8" });
console.log(out.trim());
