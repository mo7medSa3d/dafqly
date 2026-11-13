# DAFQLY — Feature Inventory & Classification (Prompt 09)

Written 2026-11-13 from the tree at `3bf42a8`. Classification per Prompt 09:
**VW** = VERIFIED WORKING · **IN** = IMPLEMENTED BUT NOT FULLY VERIFIED ·
**PA** = PARTIALLY IMPLEMENTED · **BL** = BLOCKED BY EXTERNAL DEPENDENCY ·
**NI** = NOT IMPLEMENTED · **DF** = DEFERRED WITH JUSTIFICATION.
"UI exists" is never proof — the evidence column names the test or the
reason it is not verified. Full per-suite evidence: `TESTING_EVIDENCE.md`.

## 1. Auth, tenants, platform

| Feature | Class | Evidence / note |
|---|---|---|
| Sign-up / login / onboarding wizard | VW | e2e m0, m6; unit + integration auth tests |
| Sessions (7d, SameSite=strict, 60s cache) + revoke-all-sessions | VW | Batch 8e tests; Settings "Sign out everywhere" e2e-covered UI |
| Owner/staff roles, owner-only actions (refunds, plan change, exports, settings, audit list) | VW | `ownerProcedure`, RLS 30/30, cross-tenant tests |
| Tenant isolation (RLS FORCE, `withTenant`, forged tenant IDs) | VW | db rls 32/32; journeys isolation tests |
| Email verification gate | IN | Code + stub-SMTP tests (Batch 8e); **activation BL — no SMTP credentials**; flag defaults off |
| Tenant creation, settings, deletion tombstone | VW | services + integration tests |
| Platform AI-budget page | VW | ai-budget tests; concurrency 33/40 reserves proven |
| Billing tiers display | VW | Placeholder prices labelled as undecided (HUMAN_INPUTS #10); paid actions disabled with PRICING_NOT_FINAL |

## 2. Ledger — customers, invoices, payments

| Feature | Class | Evidence / note |
|---|---|---|
| Debtors CRUD, search, pagination, row counts | VW | ledger integration 15/15; e2e m1 |
| Invoices CRUD, keyset pagination, references | VW | ledger + journeys A; e2e m1 |
| Payments: partial, multiple per invoice, one payment across invoices, idempotent replay | VW | money-integrity 8/8; journeys B/C; e2e m1 |
| Allocations (oldest-first, disputed never auto-allocated) | VW | Batch 2b + H09 cross-surface test |
| Reversals/refunds (intent-first, negative payments) | VW | Batch 8b gateway 17/17 |
| Stored credit (single-currency) | VW | Batch 2b |
| Multi-currency invoices/payments/allocations (EGP/SAR/USD/AED/EUR/KWD/JPY, 0/2/3 decimals) | VW | F-06 input parsing; per-currency KPIs/statements |
| Cross-currency credit (debtor holding EGP credit overpaying a USD invoice) | PA | Surfaces as `unattributed_remainder` in reconciliation; **proper fix needs a multi-currency credit design decision (ADR-031)** — not taken |
| Ledger reconciliation (replay + drift detection) | VW | M01 core + integration tests |
| Disputes: raise / review / resolve (idempotent, reopen vs cancel) | VW | M09; journeys E; e2e m3 (portal dispute) |
| Dispute evidence (file upload/link) | NI | Not modelled — `disputes` has reason + resolution only; needs a data-model change (migration + UI) |
| Promises to pay (portal pending → owner review → kept only by confirmed payments) | VW | Journeys D; e2e m4 (signed promise webhook) |
| Cheques: register/deposit/clear/bounce/return, photo pre-fill (never auto-registers) | VW | e2e m5; cheque-photo integration test |
| Gateway payment links (Paymob intention, fake in sandbox, SIMULATED badge) | VW | Fake-provider paths green; **live checkout BL — no Paymob keys** |
| Statements / customer portal (token, expiry, revocation, i18n AR/EN) | VW | Journeys F; e2e m3 + prompt07 portal (mobile + desktop) |
| CSV exports (invoices/payments, formula-injection safe) | VW | Batch 3 L3; e2e m6 |
| Import: CSV/Excel (mapping, preview, duplicates, errors, commit, undo) | VW | e2e m1/m2; import integration tests |
| Ledger-photo import (OCR rows, editable, confidence, audit) | VW | e2e m4 (fake LLM synthetic PNGs); ai integration tests |
| Receipt OCR: extract amount/currency/reference/date/sender/method, claim, confirm pays | VW | e2e m4; M06 dedupe test (concurrent identical uploads → 1 confirmed + 1 claimed) |

## 3. Collections, reminders, notifications

| Feature | Class | Evidence / note |
|---|---|---|
| Reminder planning + dispatch (grouping, quiet hours, opt-out, no-double-send) | VW | reminders engine/webhook/race/load tests; 50k load test green |
| Pre-send re-check (paid/closed invoices cancel before send) | VW | M05 (+2 integration tests) |
| WhatsApp templates, outbox, retries, delivery reconciliation, dedupe, opt-out, rate limits | VW | Fake-provider paths green (HMAC, lifecycle, retries, caps) |
| Live WhatsApp sending | BL | No WhatsApp Cloud credentials; `DRY_RUN_MESSAGING=true` default |
| SMS sending | PA | Engine has a fallback path; **no SMS provider adapter is shipped** and the UI carries no SMS copy (F-09) |
| AI inbox classification (payment claim, promise, dispute, delay, partial, wrong recipient, opt-out, human help) | VW | Inbox + reply integration tests; low-confidence → human |
| Copilot: tenant-scoped read tools, proposals need owner approval + revalidation | VW | Journeys + ai integration; e2e notifications-ai (drawer) |
| Copilot usage/cost tracking + global $50 cap (atomic reservations) | VW | ai-budget 2/2 concurrency; **wrapper path IN — bypassed when NODE_ENV=test** |
| AI budgets enforced under concurrency | VW | 40 concurrent reserves → exactly 33 succeed |
| Smart notification drafts (rules + guarded AI rewrite) | VW | ai-workspace tests; F-12 failure surfacing |
| Dashboard: KPIs, aging, forecast, cash-flow, tasks, recent payments | VW | m5 + prompt07 (screenshots); KPI definitions pinned (ADR-023) |
| Forecast (collected amounts, single-currency, beyond-horizon) | VW | M04; backtest; m5 not-enough-data state |
| Collection tasks (assign, prioritise, lifecycle) | VW | Journeys A; e2e route tour |
| Notification bell + AI briefing + debtor health | VW | e2e notifications-ai |

## 4. Security, performance, operations

| Feature | Class | Evidence / note |
|---|---|---|
| Rate limits (tRPC, webhooks, statement, dispute/pay/promise per-token) | VW | Batch 8a/8c tests |
| Webhook signature verification (WhatsApp HMAC-SHA256, Paymob HMAC-SHA512) | VW | Gateway + reminders webhook tests; e2e m2/m3 |
| Upload validation (magic bytes, size caps, EXIF strip JPEG/PNG/WebP) | VW | Batch 8d; HEIC EXIF DF (needs a real HEIF parser) |
| Audit log (actor, tenant, action, target, timestamp, masked phone, owner-only list) | VW | Batch 8c M6; Settings audit trail UI |
| Webhook payload redaction + 90-day retention purge | VW | Batch 8c; maintenance queue |
| Production env guards (S3 HTTPS, keys, AI key, WhatsApp completeness) | VW | core env tests; ADR-033 e2e flag |
| CSP/HSTS | PA | Headers set (ADR-024); HSTS prod-only no preload DF (needs a production domain decision); CSP nonce DF |
| Secrets hygiene (no committed secrets, rotation runbook) | VW | check-secrets in lint; Batch 8e H6 |
| Production build | VW | `pnpm build` exit 0; First Load JS shared 102 kB |
| Accessibility (WCAG 2.2 AA target) | VW | axe-core 0 violations on login/dashboard/invoices/debtors (Prompt 08) |
| Performance (dashboard KPIs <300ms at 100k invoices) | VW | M6 bench 209ms median (ADR-024); warm small-book renders 25–86ms (Prompt 08) |
| Worker queues live (BullMQ planner/dispatcher/maintenance) | IN | Worker unit tests pass; **never run live — Redis absent on this VM** |
| Dependency audit | BL | `pnpm audit` endpoint unreachable from this VM (ECONNRESET); ADR-027 overrides verified in place |
| Shared-behavior feature (F14) | NI | Deliberately not built — needs Egyptian-law legal sign-off (ADR-006) |

## 5. Routes (all render; e2e-covered unless noted)

`/[locale]` landing · `/[locale]/login` · `/[locale]/signup` ·
`/[locale]/onboarding` · `/[locale]/dashboard` · `/[locale]/debtors` (+`[id]`) ·
`/[locale]/invoices` · `/[locale]/tasks` · `/[locale]/cheques` ·
`/[locale]/ai-inbox` · `/[locale]/import` · `/[locale]/ledger-photo` ·
`/[locale]/billing` · `/[locale]/settings` · `/[locale]/platform/ai-budget` ·
`/s/[token]` public portal. API: `/api/ai/copilot` (+`/stream`),
`/api/auth/[...all]`, `/api/public/statement/[token]` (+`/dispute`, `/pay`,
`/promise`), `/api/trpc/[trpc]`, `/api/webhooks/paymob`,
`/api/webhooks/whatsapp`, `/healthz`, `/readyz`.
