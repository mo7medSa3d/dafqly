# DAFQLY Execution Ledger (Prompts 00–09)

Run date: 2026-11-13
Source baseline: `DAFQLY-v0.9.0-rc-clean-2026-11-13.zip`

## Phases Executed

1. **Prompt 00 & 01 (Discovery & Full Audit)**
   - Extracted source archive and Prompt Pack into isolated workspace.
   - Verified baseline standalone checks: `check-no-hardcoded-brand.mjs` (OK), `check-secrets.mjs` (OK, 706 files), `check-message-parity.mjs` (OK, 403 keys).
   - Audited codebase for hardcoded currency assumptions (`/ 100`, `* 100`, `.toFixed(2)`), stale `KNOWN_LIMITATIONS.md` items (F-08, F-10, F-16 already resolved in code), and API routes.
2. **Prompt 02–06 (Financial Core, Multi-Currency & Integration Fixes)**
   - Fixed `generateSmartNotification` in `packages/core/src/ai.ts` to resolve ISO currency codes and display symbols and format minor units via `formatCurrencyMinor` + `getCurrencySymbol` (respecting 0-decimal JPY and 3-decimal KWD).
   - Fixed `parseReceiptScreenshotAnalysis` in `packages/core/src/ai.ts` to format receipt amounts via `formatMoney` in both `summaryAr` and `summaryEn` using `e.currency ?? "EGP"`.
   - Passed `currency: primaryInv.currency` in `scheduleSmartReminder` (`apps/web/src/server/ai-workspace.ts`).
   - Added unit tests for KWD (3 decimals) and JPY (0 decimals) in `packages/core/src/ai.test.ts`.
   - Fixed hardcoded `/ 100` and `* 100` minor-unit conversions in `apps/web/src/components/charts.tsx`, `ChequesClient.tsx`, `CollectionWorkspaceClient.tsx`, `DebtorDetailClient.tsx`, `InvoicesClient.tsx`, and `LedgerPhotoClient.tsx` to use `@tahseel/core` currency helpers (`currencyMinorExponent`, `formatCurrencyMinor`, `parseMoney`).
3. **Prompt 07–09 (Verification, Documentation & Clean Packaging)**
   - Re-ran standalone verification scripts after all edits (all PASS).
   - Recorded `BLOCKED` status for `pnpm`, TypeScript, Vitest, Next.js production build, Postgres/Redis, and Playwright browser tests due to offline VM environment (Node v18.20.4, no `node_modules`, no network, no Postgres/Redis).
   - Updated `engineering/KNOWN_LIMITATIONS.md`, created `engineering/EXECUTION_LEDGER.md` and `engineering/TESTING_EVIDENCE.md`.
   - Packaged clean source ZIP excluding `.git`, `node_modules`, build caches, temporary files, and secrets, and verified extraction into a clean directory.
