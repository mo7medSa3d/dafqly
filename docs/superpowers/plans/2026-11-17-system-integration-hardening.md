# System Integration & Production Hardening Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all 3 Must-Fix and 3 Should-Fix integration/security/scale findings from the `@ponytail-review` audit with minimal, root-cause-only diffs.

**Architecture:** Handle `sub_<invoiceId>` Paymob callbacks in `gateway.ts` inside `withTenant`, add a `DELETE` RLS policy for `tenants` in migration `0019`, align `/api/files/[id]` with `protectedProcedure` email verification, replace `quotaExceededFromDb` 32-day row loading with SQL `SUM`, and remove dead `decryptWhatsappToken` from `services.ts`.

**Tech Stack:** Next.js 15/16, TypeScript, Drizzle ORM + PostgreSQL (`FORCE RLS`), `@tahseel/core`, `@tahseel/reminders`.

## Global Constraints

- Preserve PostgreSQL `FORCE RLS` and `withTenant` across all 27 tenant tables.
- Keep diffs minimal (`ponytail` full mode) with zero unnecessary abstractions or breaking signature changes.
- Verify all standalone scripts (`check-no-hardcoded-brand`, `check-secrets`, `check-message-parity`) pass after every task.

## Review Focus

- Paymob webhook arrives with `merchantOrderId: "sub_<uuid>"`, `success: true`: must mark `subscription_invoices.status = 'paid'` and update `tenants.plan` idempotently.
- Managed Postgres role without `BYPASSRLS` runs `deleteTenantData`: `tenants` `DELETE` RLS policy must allow deleting `id = app_current_tenant()`.
- Unverified user hits `GET /api/files/[id]` when `EMAIL_VERIFICATION_ENABLED=true`: must return `403`.
- High-volume tenant runs `quotaExceededFromDb`: must compute `SUM(units)` in SQL without loading 32 days of `usage_ledger` rows into JS.

---

### Task 1: Paymob SaaS Subscription Webhook Fulfillment

**Files:**
- Modify: `apps/web/src/server/gateway.ts`
- Test: `apps/web/src/server/gateway.integration.test.ts`

- [ ] **Step 1: Handle `sub_<invoiceId>` callbacks in `handlePaymobCallback` (`apps/web/src/server/gateway.ts`)**
  When `cb.merchantOrderId` starts with `"sub_"` and no `paymentLinks` row matches, look up `subscriptionInvoices` by `id = cb.merchantOrderId.slice(4)` via `deps.owner`; if `cb.success && !cb.pending && !cb.isRefunded && !cb.isVoided`, mark `subscriptionInvoices` `paid` and update `tenants.plan` inside `withTenant(deps.app, sub.tenantId, ...)` idempotently.
- [ ] **Step 2: Add regression test case in `gateway.integration.test.ts`**
  Verify a `sub_<id>` Paymob callback upgrades the tenant's plan and marks the subscription invoice `paid`.

---

### Task 2: `tenants` RLS `DELETE` Policy Migration

**Files:**
- Create: `packages/db/drizzle/0019_tenants_delete_policy.sql`
- Modify: `packages/db/drizzle/meta/_journal.json`

- [ ] **Step 1: Create `0019_tenants_delete_policy.sql` and register `idx: 19` in `_journal.json`**
  Add `DROP POLICY IF EXISTS tenants_delete_owner ON tenants; CREATE POLICY tenants_delete_owner ON tenants FOR DELETE USING (id = app_current_tenant());`.

---

### Task 3: Email Verification Gate on `/api/files/[id]`

**Files:**
- Modify: `apps/web/app/api/files/[id]/route.ts`

- [ ] **Step 1: Enforce `emailVerificationEnabled() && !session.user.emailVerified` returning `403 FORBIDDEN`**
  Match `protectedProcedure` in `apps/web/src/server/trpc.ts`.

---

### Task 4: SQL `SUM` Quota Check & Remove Dead `decryptWhatsappToken`

**Files:**
- Modify: `packages/reminders/src/engine.ts` (`quotaExceededFromDb`)
- Modify: `apps/web/src/server/services.ts` (remove unused `decryptWhatsappToken`)

- [ ] **Step 1: Replace 32-day `usage_ledger` row fetch in `quotaExceededFromDb` with SQL `COALESCE(SUM(units), 0)`**
  Compute exact tenant-local month UTC `[startUtc, endUtc)` bounds via `zonedTimeToUtc` from `@tahseel/core` and aggregate in PostgreSQL.
- [ ] **Step 2: Remove dead `decryptWhatsappToken` from `apps/web/src/server/services.ts`**
  Verify zero callers exist across `apps/` and `packages/`.
