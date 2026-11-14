# DAFQLY Known Limitations

Updated 2026-11-12. Items here are NOT silently fixed or hidden; each names
the evidence and the condition that would clear it.

## External integrations — BLOCKED (no credentials, never PASS)

- Gemini / Anthropic (real LLM): no API keys in this environment. The fake
  LLM provider is used in tests only; the UI now shows a demo-mode banner
  when no real AI key is configured.
- WhatsApp Cloud API: no credentials. `DRY_RUN_MESSAGING=true` default;
  no real message has been sent from this environment.
- Paymob (live): no credentials. Gateway links are created against the
  fake provider in tests; no live payment has been attempted.
- Production S3 / object storage: no credentials; local MinIO not running.
- SMS: no vendor adapter exists at all (quota copy still mentions SMS —
  see F-09).
- SMTP / email verification: no mail credentials, so live delivery is
  untested and verification stays OFF by default
  (`EMAIL_VERIFICATION_ENABLED=0`). The wiring is done and tested
  (nodemailer seam verified against a stub SMTP server; the gate and
  session revocation are in place) — activation needs a real SMTP sender.

## Environment limits (this run)

- No Docker, no system Postgres/Redis. Postgres 16.5 was built from source
  and runs locally on 127.0.0.1:5433 for tests only. Redis is absent: the
  worker and queue paths have not been exercised.
- `pnpm build` (production build) has never been run in this run.
- Playwright E2E (`pnpm test:e2e`) has never been run in this run.
- No real Windows machine, no real printer, no real debtor phone: WhatsApp
  delivery, Paymob settlement and PDF/receipt rendering against real
  providers are unverified.

## Product limitations (by design or pending decision)

- Pricing is undecided (HUMAN_INPUTS #10): paid plan changes are refused
  with `PRICING_NOT_FINAL` (409) until prices are decided.
- Multi-currency is incomplete: no FX rates table, no conversion; KPIs and
  statements must not sum across currencies (financial F02 — fix pending).
  KWD (3 decimals) and JPY (0) are handled in core money code; the
  `generateSmartNotification` path still formats amounts with a hardcoded
  ÷100 because the currency arriving there is a display symbol, not a code.
- The statement portal is Arabic-only (F-08 open).
- Dashboard is snapshot-only; refresh on focus/visibility is open (F-10).
- Forecast requires ≥10 paid invoices, else reports "not enough data"
  (honest by design).
- AI actions require human approval and revalidation before execution;
  the AI never confirms payments, approves refunds, or alters balances.
- Shared-behavior feature F14 is deliberately NOT built (groundwork only),
  per AGENTS.md.
- `getKpisReference` has no production caller; `AuditTrail` is unmounted
  (F-16 open — delete or wire up, do not leave silently).
- HEIC/HEIF uploads are magic-byte verified but their EXIF is NOT stripped
  (M5 partial): EXIF lives in nested `meta` boxes and stripping it needs a
  real HEIF parser, which this stack does not have. JPEG/PNG/WebP EXIF is
  stripped on upload; HEIC stays as-received until a parser lands.
- Cross-currency overpayment remainder is unrepresented (M01 finding):
  stored credit is single-currency-tagged, so a debtor holding EGP credit
  who overpays a USD invoice leaves a USD remainder that appears in no
  balance (no credit row, no allocation). The ledger reconciliation now
  surfaces it as `unattributed_remainder` instead of silently dropping it;
  fixing it needs multi-currency credit (per-currency credit rows) — a
  design decision, not a bug fix.
- Reminder pre-send re-check (M05) has a residual window inherent to
  calling a provider outside a transaction: a payment that starts after
  the locked re-check commits, during the provider call itself, can still
  produce a reminder for a just-paid invoice. The guard, sweep and
  send-time check close every other window.
- A sequential duplicate receipt upload still creates a second CLAIMED
  payment for human review (M06): only the double auto-confirm is closed;
  the duplicate is visible to staff, not silently merged.
- The demo account password in `seed.ts` and the `tahseel_app` role
  password in migration 0000 are dev-only values committed in the repo
  (security H6 open — rotate for any real deployment; do not rewrite
  applied migration history blindly).
- Dispute evidence is not modelled (Prompt 03 E, "evidence where
  supported"): the `disputes` table carries reason + resolution only, and
  neither the portal dispute form nor the merchant resolution flow accepts
  a file. Receipt/ledger photos attach to `files`, but disputes do not
  link them. Adding evidence is a data-model change (new column/link +
  migration), not a fix — recorded here for the Prompt 09 classification
  instead of built unilaterally.
- AI-budget enforcement is bypassed when `NODE_ENV === "test"`
  (`budgetedLlmProvider` in ai-budget.ts returns the raw provider): the
  reserve/settle/release machinery is unit- and integration-tested
  directly, but no test exercises the provider-wrapper path. Production
  wiring (engine.ts `aiDeps()`) is unchanged.
- E2E suite order dependency (Prompt 07): the M3 spec pays INV-2026-001
  (Paymob webhook success) and disputes INV-2026-002 (portal dispute) on
  the shared demo tenant, so the demo tenant's outstanding is 0.00 after
  M3 runs. M0's seed-total assertions only pass because M0 runs first.
  Later specs must not assert pristine demo totals (prompt07 asserts
  visibility / uses fresh tenants). Making M3 use its own tenant instead
  would remove the dependency but is a larger suite redesign, left for
  Prompt 09 if time allows.
- Charts stay LTR in both locales (Prompt 07, F-20): the forecast SVG maps
  week index to x left→right with no locale branch, and SVG geometry does
  not flip under dir=rtl. This is deliberate — time flows left→right in
  both locales; only the week labels localise. Pinned by the prompt07
  forecast test (first week-label x < last week-label x in AR and EN).
