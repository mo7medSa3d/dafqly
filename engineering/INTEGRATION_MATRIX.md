# DAFQLY — Integration Matrix (Prompt 09)

Written 2026-11-13 from the tree at `3bf42a8`. Status vocabulary:
**LIVE-TESTED** = exercised against the real provider in this programme (none —
no live credentials exist) · **FAKE-TESTED** = deterministic fake/double
exercised by unit, integration and e2e tests · **CODE-ONLY** = implemented,
covered by unit tests where possible, never exercised against any provider ·
**BLOCKED** = cannot be exercised without credentials/accounts this VM lacks.
Every row names where the seam lives and what proves it.

## 1. Messaging — WhatsApp Cloud API

| Aspect | Status | Detail |
|---|---|---|
| Send template / text (outbox, worker, retries, idempotency) | FAKE-TESTED | `packages/providers/src/messaging.ts` (`DryRunMessagingProvider`, `NotConfiguredMessagingProvider`); reminders engine + load tests; `DRY_RUN_MESSAGING=true` default — nothing real is ever sent from dev/CI/tests |
| Inbound webhook: signature, lifecycle (queued→sent→delivered→read, no downgrade), dedupe, opt-out | FAKE-TESTED | `packages/reminders/src/webhook.ts` (HMAC-SHA256 over raw body, timing-safe verify-token); webhook integration tests; e2e m2 (handshake/signature/opt-out in UI), m4 (signed promise auto-acted, injection → human inbox) |
| Templates + scheduling + weekly cap + quality guard auto-pause | FAKE-TESTED | Engine tests (weekly cap, quality guard); templates in `packages/templates` |
| Live sending to real numbers | BLOCKED | No `WHATSAPP_ACCESS_TOKEN` / phone number id; AGENTS.md rule 6 (verify against current official docs before coding) logged for Paymob/Anthropic in ADR-019/ADR-022 |
| SMS provider | NOT IMPLEMENTED | Engine has a fallback path (`NotConfiguredSmsProvider` fails closed); no adapter shipped, no UI copy (F-09) |

## 2. Payments — Paymob

| Aspect | Status | Detail |
|---|---|---|
| Intention API (create intention, checkout URL, 1h expiry) | FAKE-TESTED | `apps/web/src/server/gateway.ts` (`FakePaymentProvider` in tests/e2e; `PAYMOB_ALLOW_FAKE=true` only in the e2e harness); ADR-019 documents the official API (Intention API only, HMAC-SHA512 over 20 fields, transaction callback is the only source of truth) |
| Webhook: HMAC verify, replay protection, fulfil-once, reconciliation | FAKE-TESTED | gateway 17/17; e2e m3 (bad-HMAC 401, success-pays-once, replay-noop) |
| Refunds (intent-first, idempotent) | FAKE-TESTED | Batch 8b; migration 0015 |
| Live checkout / real money | BLOCKED | No Paymob secret/public keys or integration id; `PAYMOB_ALLOW_FAKE=false` default (production refuses the fake) |
| Amount parsing (strict, BigInt-safe) | FAKE-TESTED | M08: safe-integer numbers or all-digits strings; 7 decision booleans required |

## 3. AI — Gemini / Anthropic

| Aspect | Status | Detail |
|---|---|---|
| LLM adapters (Gemini + Anthropic, native tool loops, vision) | CODE-ONLY | `packages/providers/src/gemini.ts`, `llm.ts`; fetch-injectable, mocked-fetch tests only; model ids verified against official pricing (ADR-032) |
| Deterministic fake LLM (synthetic PNG payloads for OCR/extraction) | FAKE-TESTED | `FakeLlmProvider.readSyntheticPayload`; e2e m4 (ledger photo, receipt claim, cheque photo); ai integration tests |
| Tenant-scoped tools, Zod-validated output, allowlisted actions | FAKE-TESTED | Copilot integration tests; low-confidence → human; AI never confirms payments / approves refunds / bypasses permissions |
| Usage/cost ledger + global $50 monthly cap (atomic reserve/settle/release) | FAKE-TESTED | ai-budget 2/2: 40 concurrent reserves → exactly 33 succeed; settle idempotent |
| Live model calls | BLOCKED | No `GEMINI_API_KEY` / `ANTHROPIC_API_KEY`; production guard refuses to boot without one (unless `E2E_FAKE_PROVIDERS`) |

## 4. Storage, email, infrastructure

| Aspect | Status | Detail |
|---|---|---|
| S3-compatible storage (SigV4, private keys, magic-byte validation, EXIF strip) | FAKE-TESTED | `FakeStorageProvider` in tests/e2e; `S3CompatibleStorageProvider` code + unit tests; no live bucket |
| Production S3 endpoint | BLOCKED | No real bucket/credentials; production guard requires HTTPS + non-default keys |
| Email (nodemailer SMTP seam, verification emails AR/EN) | CODE-ONLY | `apps/web/src/server/email.ts`; tested against an in-process SMTP stub; **activation BLOCKED — no SMTP credentials** |
| Postgres 16 (Drizzle, RLS, migrations 0000–0017) | LIVE-TESTED | Source-built Postgres 16.5 on this VM; full suite with `REQUIRE_DB_TESTS=1` (525 green); RLS fail-closed verified via psql |
| Redis / BullMQ queues | CODE-ONLY | Worker unit tests pass; queues never run live — **Redis absent on this VM** |
| MinIO (local S3) | BLOCKED | No Docker on this VM; compose file exists (`docker-compose.yml`, loopback-bound, passwords from `.env`) |

## 5. Internal seams (frontend → API → service → DB → jobs)

| Flow | Chain | Proof |
|---|---|---|
| Debtor → invoice → payment → ledger → dashboard | UI → tRPC debtors/invoices/payments → ledger.ts → Postgres (RLS) → replanLater → planner queue | Journeys A–C; e2e m1 + prompt07 (DB-verified partial pay) |
| Promise → payment → kept | Portal → statements → promises → recordPayment → refreshPromiseFulfillment | Journeys D |
| Dispute → freeze → resolve | Portal/API → statements → disputes → invoice status machine | Journeys E; e2e m3 |
| Receipt photo → claim → confirm → paid | AiInboxClient → receipts.uploadAndProcess → storeUpload → FakeLlmProvider → decideReceiptOutcome → payments.confirm | e2e m4; M06 dedupe |
| Cheque photo → pre-fill → register → deposit → clear | ChequesClient → cheques.extractChequePhoto / registerCheque → LLM + ledger | e2e m5; cheque-photo integration test |
| Reminder → WhatsApp | Planner → dispatcher → DryRun/WhatsApp provider → webhook delivery receipts | Reminders engine/load/webhook tests; e2e m2 |
| Paymob link → webhook → fulfil | DebtorDetailClient → gateway.createGatewayLink → Paymob intention → webhook → fulfil | gateway 17/17; e2e m3 |
| Copilot question → tools → answer / approval | AiCopilotDrawer → ai/copilot SSE → intelligence tools → ai_action_approvals → owner review | ai integration; e2e notifications-ai |
| Import file → preview → commit → invoices | ImportClient → imports → core import parser → ledger commit | e2e m1/m2; import tests |

## 6. What "verified" means here

A row is FAKE-TESTED only when a test in `TESTING_EVIDENCE.md` exercises
that seam end-to-end with the fake (not a unit test of a helper alone).
No row claims a live provider success: per the brief, "no external
integration is successful without credentials + real test" — every live
path is BLOCKED and labelled as such in `KNOWN_LIMITATIONS.md` and
`FEATURE_INVENTORY.md`.
