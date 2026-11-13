# DAFQLY Known Limitations

Updated 2026-11-13. Items here are NOT silently fixed or hidden; each names
the evidence and the condition that would clear it.

## External integrations — BLOCKED (no credentials, never PASS)

- Gemini / Anthropic (real LLM): no API keys in this environment. The fake
  LLM provider is used in tests only; the UI shows a demo-mode banner
  when no real AI key is configured.
- WhatsApp Cloud API: no credentials. `DRY_RUN_MESSAGING=true` default;
  no real message has been sent from this environment.
- Paymob (live): no credentials. Gateway links are created against the
  fake provider in tests; no live payment has been attempted.
- Production S3 / object storage: no credentials; local MinIO not running.
- SMS: no vendor adapter exists at all (`NotConfiguredSmsProvider`).
- SMTP / email verification: no mail credentials, so live delivery is
  untested and verification stays OFF by default
  (`EMAIL_VERIFICATION_ENABLED=0`). Activation needs a real SMTP sender.

## Environment limits (this run — 2026-11-13)

- Offline VM without `node_modules`, `pnpm`, Node >= 22 (VM has Node v18.20.4),
  Docker, Postgres, or Redis. Package installation and outbound network access
  are disabled in this sandbox.
- Because `node_modules` and `pnpm`/Node >= 22 are absent, `pnpm install`,
  `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm db:migrate`, and
  Playwright browser E2E (`pnpm test:e2e`) are **BLOCKED** in this run.
- Standalone Node scripts (`check-no-hardcoded-brand.mjs`, `check-secrets.mjs`,
  `check-message-parity.mjs`) ran and passed on the final tree.

## Product limitations (by design or pending decision)

- Pricing is undecided (HUMAN_INPUTS #10): paid plan changes are refused
  with `PRICING_NOT_FINAL` (409) until prices are decided.
- Multi-currency FX conversion: no FX rates table, no automatic conversion;
  KPIs and statements group by currency and never sum raw amounts across
  currencies. Minor-unit exponents (0 for JPY, 2 for EGP/SAR/USD/AED/EUR,
  3 for KWD) are enforced across `packages/core/src/money.ts`,
  `generateSmartNotification`, `parseReceiptScreenshotAnalysis`, `charts.tsx`,
  and all client input/edit forms (`ChequesClient`, `CollectionWorkspaceClient`,
  `DebtorDetailClient`, `InvoicesClient`, `LedgerPhotoClient`, `StatementClient`).
- Forecast requires >= 10 paid invoices, else reports "not enough data"
  (honest by design).
- AI actions require human approval and revalidation before execution;
  the AI never confirms payments, approves refunds, or alters balances.
- Shared-behavior feature F14 is deliberately NOT built (groundwork only),
  per AGENTS.md.
- HEIC/HEIF uploads are magic-byte verified but their EXIF is NOT stripped
  (M5 partial): JPEG/PNG/WebP EXIF is stripped on upload; HEIC stays
  as-received until a real HEIF parser lands.
- Cross-currency overpayment remainder is unrepresented (M01 finding):
  stored credit is single-currency-tagged, so a debtor holding EGP credit
  who overpays a USD invoice leaves a USD remainder surfaced as
  `unattributed_remainder` in ledger reconciliation.
- Reminder pre-send re-check (M05) has a residual window inherent to
  calling a provider outside a transaction.
- Dispute evidence is not modelled (`disputes` table carries reason +
  resolution only).
- AI-budget enforcement is bypassed when `NODE_ENV === "test"`.
- Charts stay LTR in both locales (time flows left-to-right in both AR and EN).
