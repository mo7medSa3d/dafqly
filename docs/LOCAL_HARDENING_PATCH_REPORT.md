# Local Hardening Patch Report

Date: 2026-11-14

This report records the hardening changes applied to the supplied DAFQLY source archive during this review. It is intentionally explicit about what was and was not verified in the available environment.

## Changes applied

### Worker and tenant isolation
- Production Worker startup now requires `APP_DATABASE_URL`; it no longer silently falls back to the owner `DATABASE_URL` for tenant-scoped work.
- The Worker verifies the application database role before constructing BullMQ workers, so queued jobs are not consumed before the RLS role check succeeds.
- Platform-scoped enumeration remains on the owner connection; normal engine work uses the app connection.

### Reminder lifecycle and messaging
- Monthly message-quota lookup is fail-closed: an unavailable quota check is not interpreted as permission to send.
- Resuming reminders clears recorded opt-out state and reactivates only reminders cancelled specifically due to opt-out; it replans open invoices without deliberately replaying sent messages.
- Grouped reminder totals are calculated and formatted per currency instead of adding unlike minor units.
- Regression coverage was added for quota lookup failure, reminder resumption after opt-out, and mixed-currency grouped reminders.

### Ledger, payments, credit and currency integrity
- Payments and automatic allocations are constrained to one currency per payment.
- Debtor summaries expose outstanding and disputed balances by currency rather than presenting cross-currency sums as a single amount.
- Customer payment UI exposes an explicit currency selection and limits automatic allocation to invoices in that currency.
- Paymob settlement is kept in EGP and cannot silently allocate to non-EGP invoices or overwrite an existing credit balance in another currency.
- Receipt matching/allocation is currency-constrained.
- Changing a tenant's default currency is blocked after invoice, payment, cheque or promise activity exists, because unlinked cheque/promise records derive currency from the tenant default; a regression test covers an unlinked cheque.
- Cheque display and summaries preserve/group the associated currency; cheque OCR matching remains limited to the tenant's default currency where the underlying record does not store a currency.
- AI scoring, promise totals, reminder workspace totals and installment proposals avoid adding amounts from different currencies.
- Smart notification formatting uses ISO 4217 minor-unit exponents (including zero-decimal and three-decimal currencies) and preserves integer precision for `bigint` inputs.
- Regression coverage was added for mixed-currency payment allocation, tenant currency locking, and cheque currency display.

### Webhook request handling
- WhatsApp webhook signature verification accepts the original raw bytes; signature verification is performed before JSON parsing.
- WhatsApp and Paymob webhook bodies are read with explicit byte limits before full allocation; invalid UTF-8/JSON is rejected and oversized requests receive HTTP 413.
- A regression test covers HMAC verification using raw request bytes.

### AI workflow error handling
- AI workflow dispatch failures are no longer silently reported as successful operations.
- Installment proposal currency is carried to the UI and the EGP-only Paymob link is not offered for a non-EGP proposal.

## Verification completed in this environment

- TypeScript/TSX syntax transpilation: **0 diagnostics across 25 changed files**.
- `scripts/check-no-hardcoded-brand.mjs`: **passed**.
- `scripts/check-secrets.mjs`: **passed; 710 files scanned**.
- `scripts/check-message-parity.mjs`: **passed; 405 keys in both locales**.
- ZIP archive integrity is checked separately when the release archive is generated.

## Verification not completed

The repository declares `pnpm@10.34.9`, but `pnpm` and the workspace dependencies were not available in this environment. Fetching pnpm from `registry.npmjs.org` failed with a DNS `EAI_AGAIN` error. Consequently, the following were **not run** against this patched source:

- workspace TypeScript typecheck;
- ESLint and the complete lint pipeline;
- Vitest unit/integration suites;
- Next.js/worker/package builds;
- PostgreSQL/RLS and Redis-backed tests;
- browser E2E tests;
- live WhatsApp, Paymob, AI, object-storage, email or other provider tests.

A syntax/transpilation pass is not a substitute for those checks. No claim is made here that those suites passed.

## Remaining product/schema limitations

- The current debtor schema stores one credit-balance currency per debtor. The patch prevents silent overwrites/cross-currency allocations, but a proper multi-currency credit subledger is still required to support simultaneous credit balances in several currencies.
- No foreign-exchange conversion or FX-rate source is implemented. Cross-currency balances must remain separate.
- The SMS adapter is intentionally not configured/shipped; only the selected and configured messaging providers can send.
- Third-party integrations and production credentials were not available for live verification.

## Release interpretation

This archive contains source-level hardening changes and added regression tests. It is **not a production certification** and should not be deployed for live financial traffic until dependency installation succeeds and the omitted build, typecheck, automated test, database/RLS, browser, and provider verification gates are run in the target CI/staging environment.
