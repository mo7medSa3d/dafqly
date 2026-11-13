# DAFQLY / Tahseel — Project Architecture

Status: written 2026-11-13 (Prompt 09) from the shipped tree at `3bf42a8`
plus the verification evidence in `TESTING_EVIDENCE.md`. Internal name
**Tahseel (تحصيل)**; public brand **DAFQLY (دفّقلي)**; package `tahseel`
v0.9.0. Multi-tenant, Arabic-first (RTL default, EN LTR) receivables and
collections SaaS for Egyptian small businesses.

## 1. Stack and layout

- pnpm monorepo (`pnpm@10.34.9`, `pnpm-lock.yaml`, workspaces `apps/*`,
  `packages/*`), Node ≥ 22, TypeScript 5.9, ESLint 9, Vitest 3, Playwright 1.65.
- `apps/web` — Next.js App Router + tRPC + next-intl (`ar` default RTL,
  `en` LTR) + Drizzle ORM. `apps/worker` — BullMQ worker (planner,
  dispatcher, maintenance queues over Redis).
- `packages/core` — pure business logic: money (integer minor units,
  0/2/3-decimal exponents), invoices, payments, cheques, forecast, import,
  intelligence, plans, reminders, reports, time, timeline, phone, digits,
  env, idempotency, like, files-crypto. Most modules have `.test.ts`.
- `packages/db` — Drizzle schema, client, migrate, seed, RLS tests;
  migrations `0000`–`0017` (see §4). `packages/providers` — Gemini,
  Anthropic, WhatsApp Cloud, Paymob, S3-compatible storage, messaging,
  LLM abstractions (all with fake/deterministic doubles for tests).
- `packages/reminders` — reminder engine (planning, dispatch, webhook
  intake, race/load tests). `packages/templates`, `packages/eval`,
  `packages/brand` (**do not edit** — brand tokens; app code must use them,
  no hardcoded colors/fonts), `packages/core` plans.
- Root scripts: `dev`, `start`, `worker`, `build` (`pnpm -r`), `lint`
  (eslint + brand check + secrets scan + message parity),
  `typecheck`, `test`, `test:e2e` (migrate + seed + Playwright), `eval`,
  `db:migrate`, `db:seed`. No formatter is configured (no prettier).

## 2. Request path

```
Browser (AR RTL / EN LTR, Next.js App Router)
  → app/[locale]/* pages (server components fetch via services)
  → tRPC routers (apps/web/src/server/routers.ts) — tenantProcedure /
    protectedProcedure / ownerProcedure; rate-limited (120/min tRPC,
    20/min AI prefixes); AppError → HTTP status via responseMeta
  → services (apps/web/src/server/*.ts: ledger, reports, gateway,
    statements, cheques, receipts, ai-workspace, intelligence, …)
  → withTenant(tx) — every tenant read/write runs inside a tenant-scoped
    transaction (RLS enforced in Postgres, FORCE RLS on tenant tables)
  → Postgres 16 (Drizzle) + Redis queues + S3-compatible storage
```

- **One authoritative business-logic layer.** A confirmed payment updates
  payments, allocations, invoice outstanding/status, customer balance,
  statement, collection task state, reminder eligibility, dashboard,
  reports and audit history through the server services — never through
  frontend calculations (Prompt 10 rule; H09/M01/M03 verified).
- **Money is integer minor units, never floats.** Currencies EGP, SAR,
  USD, AED, EUR, KWD (3 decimals), JPY (0 decimals). No raw summation
  across currencies (F02/M04); per-currency KPIs/statements; no invented
  FX rates.
- **Auth:** Better Auth 1.7.18 (`app/api/auth/[...all]`), argon2id,
  7-day sessions, SameSite=strict, cookie cache 60s. Email verification
  exists as a seam (`EMAIL_VERIFICATION_ENABLED`, default off) — activation
  is BLOCKED on real SMTP credentials (Batch 8e, ADR-030).
- **Env:** Zod-validated `parseEnv` (`packages/core/src/env.ts`) with
  production guards (HTTPS S3, non-default keys, AI key, WhatsApp
  completeness, no SMS without an adapter). `E2E_FAKE_PROVIDERS` (ADR-033)
  relaxes only the "no real provider" checks for the e2e harness.
- **Outbox/worker:** BullMQ `reminders-planner` (nightly 02:00),
  `reminders-dispatcher` (every minute), `maintenance` (nightly 03:00,
  incl. the 90-day webhook-payload purge). `DRY_RUN_MESSAGING=true` by
  default — nothing real is ever sent from dev/CI/tests.

## 3. Data model (packages/db/src/schema.ts, 32 tables)

Tenant tables (all carry `tenant_id` + RLS, 27 tables covered by the RLS
factory + `rls.test.ts` 30/30): tenants, users/memberships (via Better Auth
tables), debtors (incl. `credit_minor`/`credit_currency`), invoices
(`invoice_sequences` counter for unique references), payments (+
allocations, idempotency keys, gateway transaction ids, reversals as
negative payments), cheques, payment_links, statement_links (SHA-256
token hashes only), disputes (+ `resolution`), promises_to_pay,
collection_tasks, reminders, messages, intents (AI inbox), files
(UNIQUE(tenant_id, sha256) dedupe), imports (+ jobs/rows), receipts
(claims), ai_conversations/ai_messages, ai_action_approvals,
ai_global_budget/ai_global_usage (platform, owner-only), usage_ledger,
webhook_events (payloads purged after 90 days), audit_log, tenant_deletions
(tombstone, no tenant_id, no RLS), plans (platform).

Key invariants (all test-pinned): invoice status machine
(open → partially_paid → paid; disputed freezes collectibility; cancelled /
written_off terminal); payments confirmed only via allocations;
`paidMinor` recomputed from confirmed allocations; disputed invoices are
never auto-allocated to; credit is single-currency-tagged stored credit;
cheque machine held → deposited → cleared/bounced/returned; promises are
kept only by confirmed allocated payments covering the amount.

## 4. Migrations

`0000`–`0013` (base + Batch 3/7: FORCE RLS, grants), `0014` (money
integrity: payments.currency, credit, CHECKs, invoice_sequences),
`0015` (refund intent + link idempotency + per-tenant gateway txn index),
`0016` (platform-table REVOKEs), `0017` (dispute resolution + files
UNIQUE(tenant_id, sha256)). Forward-only (ADR-024): rollback = redeploy
the previous tag + restore the pre-deploy backup. Journal: 18 entries in
`drizzle.__drizzle_migrations`.

## 5. External integrations (see INTEGRATION_MATRIX.md)

WhatsApp Cloud API (HMAC-SHA256 webhooks, templates, outbox, retries,
opt-out, weekly cap, quality guard), Paymob Intention API (HMAC-SHA512,
idempotency, reconciliation, refunds), Gemini + Anthropic (tenant-scoped
tools, Zod-validated output, usage/cost ledger, $50 global monthly cap
with atomic reservations), S3-compatible storage (SigV4, magic-byte
validation, EXIF strip), SMTP via nodemailer (seam only — no live server).
**None of these has live credentials on this VM; all live paths are
BLOCKED, fake-provider paths are tested.**

## 6. Verification posture

- Full suite 525 passed / 0 failed / 0 skipped (`test56-full.log`,
  REQUIRE_DB_TESTS=1); typecheck 0; lint 0 (708 files, message parity
  403 keys); production build exit 0 (102 kB shared First Load JS);
  e2e 32/32 (Playwright, production build + server); axe-core 0
  violations on login/dashboard/invoices/debtors.
- Test-verification rule (hard-earned): a suite is green only from its
  complete log + exit code, never a filtered/truncated view; read failing
  tests before calling pinned behaviour a bug (most "failures" in this
  programme were test bugs — the production code was correct).
- Known gaps are in `KNOWN_LIMITATIONS.md` (cross-currency credit
  remainder, dispute evidence not modelled, H5 SMTP activation, L7 HSTS,
  audit-endpoint unreachable, Redis absent, no real Windows/printer — n/a).
