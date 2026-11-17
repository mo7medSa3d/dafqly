# Dafqly SaaS Simplification, Landing & UI Overhaul, and Critical Fixes Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Dafqly into a clean, minimal, global-grade B2B SaaS: remove debtor-facing online payment gateways (keeping Paymob strictly for platform SaaS subscriptions), redesign the Landing Page (`full-bleed` edge-to-edge, zero dead/decorative controls, zero repetition, mobile + desktop responsive) and public Statement Portal, unify all app UIs, wire per-tenant WhatsApp Cloud API + inbound receipt media download, fix cheque/ledger bugs, and establish a single source of truth for prompts, templates, and rules.

**Architecture:** Keep the `@tahseel/*` monorepo, Drizzle `FORCE RLS` (27 tables), and `UnifiedAiProvider` intact. Apply minimal, root-cause-only edits (`ponytail` full mode): strip debtor-facing gateway UI/routes (`StatementClient`, `DebtorDetailClient`, `SettingsClient`, `/api/public/statement/[token]/pay`), keep `billing.ts` Paymob strictly for SaaS subscriptions, add per-tenant encrypted WhatsApp credentials + `paymentInstructions`, rebuild `DafqlyLanding.tsx` as a full-width, value-driven SaaS landing page with 100% working controls, redesign `StatementClient` and audit all `components/**` for mobile/desktop responsiveness, and deduplicate/tighten AI prompts and shared rules.

**Tech Stack:** Next.js 16 (App Router), React 19, Tailwind CSS + `tokens.json`, tRPC, Drizzle ORM + PostgreSQL (`FORCE RLS`), WhatsApp Cloud API (`v27.0`), Vitest, Playwright.

**Spec:** User audit, simplification, landing page, and UI overhaul request (2026-11-17) grounded in codebase review of `dafqly-main`.

## Global Constraints

- Preserve PostgreSQL `FORCE RLS` and `withTenant(...)` isolation on all 27 tenant tables; never bypass `appDb` for tenant reads/writes.
- **No debtor-facing payment gateway**: Paymob is used **only** by the platform owner in `billing.ts` to collect SaaS subscription revenue. Debtors pay merchants via the merchant's own offline instructions (`paymentInstructions` e.g. Bank IBAN / InstaPay / Cheque / Cash) and upload receipts.
- Keep `AI_PROVIDER` + `AI_API_KEY` platform-only in `env.ts`; never expose AI keys in tenant settings UI.
- **Single Source of Truth**: one shared prompt/template/config source per domain (`unified-ai.ts`, `@tahseel/templates`, `tokens.json`, `ui/*` primitives); delete dead/duplicate helpers and unused UI controls.
- **Zero decorative/dead UI**: every button, tab, link, or interactive control (especially on `DafqlyLanding.tsx`) must perform a real action.
- Every UI screen (`DafqlyLanding.tsx`, `StatementClient.tsx`, and all `components/**`) must be responsive on mobile (`360px+`) and large desktops (`1280px–1920px+`) with minimal, clear, value-focused copy.

## Review Focus

- Inbound WhatsApp image webhook arrives with `mediaId` when tenant uses per-tenant `accessToken` (must download bytes with 10 MB cap and call `processReceiptImage`; on Meta failure, fall back to `receipt_image_pending` without returning HTTP 500).
- Merchant registers a `payable` cheque in `ChequesClient.tsx` (must hide `cheque-invoice` select and clear `invoiceId` when `direction === "payable"`).
- Visitor opens `DafqlyLanding.tsx` on mobile (`360px`) and desktop (`1440px+`): full-bleed sections (`w-full`, no boxed outer container), zero horizontal overflow, zero dead buttons, preserved E2E hooks (`landing-cta-login`, `landing-cta-signup`, `#mobile-nav`, `aria-label="القائمة"`).
- Debtor opens `/s/[token]` on mobile and desktop: sees clean balance summary, merchant `paymentInstructions`, one-tap receipt upload, and promise/dispute actions with zero Paymob buttons or clutter.
- Ledger photo extraction receives international phone (`+966...`, `+971...`) or missing phone (must use `normalizePhone` and never crash).
- Tenant exports data via `tenantData.export` (must produce `dafqly-export-<tenantId>.json` and pass updated `m6.spec.ts`).

---

### Task 1: Fix `payable` Cheque Invoice UI & Region-Neutral Ledger Phone Extraction

**Files:**
- Modify: `apps/web/src/components/ChequesClient.tsx:396-428`
- Modify: `apps/web/src/server/ledger-ai.ts:4,155`

**Interfaces:**
- Consumes: `normalizePhone(raw: string, defaultCountry?: string)` from `@tahseel/core`
- Produces: Conditional `cheque-invoice` field (`form.direction === "receivable"`) and international phone normalization in `runLedgerExtraction`.

- [ ] **Step 1: Hide and clear `invoiceId` when `direction === "payable"` in `ChequesClient.tsx`**
- [ ] **Step 2: Replace `normalizeEgPhone` with `normalizePhone` in `ledger-ai.ts`**
- [ ] **Step 3: Verify `node scripts/check-no-hardcoded-brand.mjs`** (Expected: OK).

---

### Task 2: Wire Meta Media Download for Inbound WhatsApp Receipt Images

**Files:**
- Modify: `packages/providers/src/whatsapp.ts` (add `downloadMedia(mediaId: string)`)
- Modify: `apps/web/app/api/webhooks/whatsapp/route.ts:89-97`
- Test: `packages/providers/src/whatsapp.test.ts`

**Interfaces:**
- Produces: `WhatsAppCloudProvider.downloadMedia(mediaId, overrideConfig?)` with 15s timeout + 10 MB cap; `onInboundImage` routes downloaded bytes into `processReceiptImage` with safe fallback to `recordPendingReceiptIntent`.

- [ ] **Step 1: Add `downloadMedia` unit test in `whatsapp.test.ts`**
- [ ] **Step 2: Implement `downloadMedia` in `whatsapp.ts` and hook in `whatsapp/route.ts`**
- [ ] **Step 3: Run `pnpm --filter @tahseel/providers test`** (Expected: PASS).

---

### Task 3: Per-Tenant WhatsApp Cloud API Routing (BYO Number per Customer)

**Files:**
- Modify: `packages/db/src/schema.ts` (`TenantSettings.whatsapp`: `phoneNumberId`, `wabaId?`, `encryptedAccessToken`)
- Modify: `packages/providers/src/whatsapp.ts` (optional per-call credential override)
- Modify: `apps/web/app/api/webhooks/whatsapp/route.ts` & `packages/reminders/src/` (resolve `tenantId` by `metadata.phone_number_id`)
- Modify: `apps/web/src/components/SettingsClient.tsx` (clean per-tenant WhatsApp Cloud API connection panel)

**Interfaces:**
- Produces: Each tenant sends/receives on its own WhatsApp number through a single central Meta webhook; token stored encrypted and never returned in plaintext.

- [ ] **Step 1: Add encrypted `whatsapp` config to `TenantSettings` + `services.ts` validation**
- [ ] **Step 2: Update `WhatsAppCloudProvider` and webhook routing by `phone_number_id`**
- [ ] **Step 3: Verify `pnpm typecheck` and `pnpm --filter @tahseel/reminders test`** (Expected: PASS).

---

### Task 4: Remove Debtor-Facing Gateway & Dead SMS UI (Keep Paymob Strictly for SaaS Billing)

**Files:**
- Modify: `packages/db/src/schema.ts` (`TenantSettings`: `paymentInstructions?: string`; default `gatewayEnabled: false`)
- Modify: `apps/web/src/components/DebtorDetailClient.tsx` (remove `onCreateGatewayLink`, `paymentLinks` card, `gw-create-invoice` buttons, and `"gateway"` option; keep manual/receipt/cheque payment recording)
- Modify: `apps/web/src/components/SettingsClient.tsx` (remove debtor Paymob toggle & dead `SMS` toggle; add `paymentInstructions` field e.g. Bank IBAN / InstaPay handle)
- Modify: `apps/web/app/api/public/statement/[token]/pay/route.ts` (return `410 Gone` so debtor checkout is disabled while `billing.ts` Paymob remains active for SaaS subscriptions)
- Modify: `apps/web/src/server/statements.ts` (expose `paymentInstructions` in `getStatementData`)

**Interfaces:**
- Produces: Clean offline-first B2B collection flow; Paymob isolated solely to platform subscription billing (`billing.ts`).

- [ ] **Step 1: Remove debtor-facing gateway UI from `DebtorDetailClient.tsx` and `SettingsClient.tsx`, and dead SMS toggle from `SettingsClient.tsx`**
- [ ] **Step 2: Add `paymentInstructions` to `TenantSettings`, `SettingsClient.tsx`, and `statements.ts`**
- [ ] **Step 3: Run `node scripts/check-message-parity.mjs`** (Expected: OK).

---

### Task 5: Redesign Public Statement Portal (`StatementClient.tsx`) — Mobile & Desktop

**Files:**
- Modify: `apps/web/src/components/StatementClient.tsx`
- Modify: `apps/web/src/messages/ar.json` & `apps/web/src/messages/en.json`

**Interfaces:**
- Produces: Modern, minimal SaaS statement portal with: (1) clean header + total due summary, (2) merchant `paymentInstructions` copyable card, (3) one-tap receipt upload dropzone, (4) compact invoice list (responsive cards on mobile, clean rows on desktop) with inline Promise / Dispute actions, (5) payment history. Zero Paymob buttons or verbose text.

- [ ] **Step 1: Redesign `StatementClient.tsx` layout using `ui/*` primitives and `tokens.json` semantic tokens**
- [ ] **Step 2: Verify responsive spacing (`grid`, `min-w-0`, `overflow-x-hidden`, touch targets `>= 40px`) for mobile and desktop**
- [ ] **Step 3: Run `node scripts/check-no-hardcoded-brand.mjs` and `node scripts/check-message-parity.mjs`** (Expected: OK).

---

### Task 6: Redesign Landing Page (`DafqlyLanding.tsx`) — Full-Bleed, Zero Dead Controls, Zero Repetition

**Files:**
- Modify: `apps/web/src/components/DafqlyLanding.tsx`
- Modify: `apps/web/src/components/landing-art.tsx` (trim unused/redundant SVGs if any; keep sharp, purposeful visuals)
- Modify: `apps/web/src/messages/ar.json` & `apps/web/src/messages/en.json` (concise, high-value SaaS copy)

**Interfaces:**
- Preserves E2E selectors: `data-testid="landing-cta-login"`, `data-testid="landing-cta-signup"`, `#mobile-nav`, `aria-label="القائمة"`
- Produces: Full-width (`w-full` edge-to-edge bands, no boxed outer container) global SaaS landing page with:
  1. Sticky full-width header (Logo, real anchor links, locale switcher, Login, Start Free CTA, working mobile drawer `#mobile-nav`).
  2. High-impact Hero band (concise value proposition + working primary CTAs + interactive/live product preview).
  3. End-to-end Lifecycle Showcase (4 distinct, non-overlapping stages: Invoice/Ledger Import → WhatsApp Reminders → Receipt AI Verification → Cheque & Cashflow Control) — zero repeated cards.
  4. Real interactive ROI / Collection Calculator or live workflow tabs where every control actually responds to user input.
  5. Clear Pricing / Plans band (single source of truth aligned with `plans` catalogue) + compact FAQ accordion + clean full-width Footer.

- [ ] **Step 1: Remove outer boxed container constraints and any non-functional/decorative buttons or filler copy from `DafqlyLanding.tsx`**
- [ ] **Step 2: Rebuild sections with full-bleed responsive bands (`px-4 sm:px-8 lg:px-12 xl:px-16`), working interactive controls, and concise bilingual copy**
- [ ] **Step 3: Verify E2E selectors and run `node scripts/check-no-hardcoded-brand.mjs` and `node scripts/check-message-parity.mjs`** (Expected: OK).

---

### Task 7: Global SaaS UI Pass Across All App Screens (Mobile + Desktop)

**Files:**
- Audit & simplify: `apps/web/src/components/AppShell.tsx`, `DashboardClient.tsx`, `DebtorsClient.tsx`, `InvoicesClient.tsx`, `CollectionWorkspaceClient.tsx`, `AiInboxClient.tsx`, `BillingClient.tsx`, `OnboardingWizard.tsx`

**Interfaces:**
- Produces: Consistent, uncluttered SaaS UI across every page: concise labels, zero redundant helper paragraphs, unified `Panel` / `Button` / `StatusPill` usage, and verified mobile + desktop layouts.

- [ ] **Step 1: Audit and trim verbose copy, redundant cards, and responsive overflow issues across the listed components**
- [ ] **Step 2: Ensure `BillingClient.tsx` clearly reflects platform SaaS subscription payment only**
- [ ] **Step 3: Run `node scripts/check-no-hardcoded-brand.mjs` and `node scripts/check-message-parity.mjs`** (Expected: OK).

---

### Task 8: Single-Source-of-Truth Cleanup for AI Prompts, Templates & Core Rules

**Files:**
- Modify: `packages/providers/src/unified-ai.ts` (tighten, unify, and deduplicate system prompts for receipt, cheque, ledger, reply classification, and copilot; strip redundant instructions)
- Modify: `apps/web/src/server/intelligence.ts` (ensure copilot system prompt and workspace tools enforce concise, grounded output and remove any references to debtor payment links)
- Modify: `packages/templates/src/registry.ts` (remove unused/obsolete template variables or payment-gateway copy superseded by `paymentInstructions`)

**Interfaces:**
- Produces: Single, strict, unified prompt & template layer with zero conflicting rules or dead references.

- [ ] **Step 1: Audit `unified-ai.ts`, `intelligence.ts`, and `packages/templates/src/registry.ts` for duplicate/verbose prompts and stale gateway references**
- [ ] **Step 2: Tighten prompts and remove unused helpers**
- [ ] **Step 3: Verify `node scripts/check-no-hardcoded-brand.mjs` and `node scripts/check-secrets.mjs`** (Expected: OK).

---

### Task 9: Legacy Export Naming Cleanup & Final Verification

**Files:**
- Modify: `apps/web/src/server/tenant-data.ts:64,83,90` (`dafqly-tenant-export-v1`, `dafqly-export-${tenantId}.json`)
- Modify: `apps/web/e2e/m6.spec.ts:77` (assert `dafqly-export-`)
- Modify: `apps/web/e2e/m0.spec.ts` / `m5.spec.ts` / `rebrand.spec.ts` (align any E2E assertions affected by removing debtor Paymob buttons & landing overhaul)

**Interfaces:**
- Produces: Clean `dafqly` naming and aligned E2E suite.

- [ ] **Step 1: Update `tenant-data.ts` and affected E2E specs**
- [ ] **Step 2: Run `node scripts/check-no-hardcoded-brand.mjs`, `node scripts/check-secrets.mjs`, `node scripts/check-message-parity.mjs`, and JSON validation** (Expected: OK).

---

## Self-Review

1. **Spec coverage**: Covers every user requirement — removing debtor-facing payment gateways while keeping Paymob for SaaS owner subscriptions (Task 4), redesigning `StatementClient.tsx` (Task 5), full-bleed Landing Page overhaul with zero dead buttons or repetition (Task 6), unifying all app UIs for mobile + desktop (Task 7), unifying/cleaning AI prompts & templates as a single source of truth (Task 8), plus all earlier fixes (Tasks 1–3, 9).
2. **Step scan**: Each task maps to exact files, preserved selectors, and checkable outputs.
3. **Type consistency**: `TenantSettings.paymentInstructions`, `TenantSettings.whatsapp`, `normalizePhone`, and `downloadMedia` align across all tasks.
4. **Review Focus**: All 6 failure modes in Review Focus are covered across Tasks 1–9.
5. **Proportion**: Concise, minimal diffs only (`ponytail` compliant).
