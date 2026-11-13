# Tahseel: Build Plan for the Implementation Agent

*Receivables collection platform for Egyptian small businesses. Plan v1.0, 9 Nov 2026. Audience: the AI coding agent that will build, test and ship the product. "Tahseel" is a working name.*

## 1. Mission and non-negotiables

**Mission.** Build a multi-tenant SaaS, Arabic-first (RTL), that lets any small business in Egypt, in any sector, record money owed to it, remind debtors automatically over WhatsApp (SMS fallback), and close invoices when payment arrives. Differentiators: (a) ledger photo import, (b) transfer-receipt reading, (c) Egyptian-Arabic reply understanding, (d) cheque tracking, (e) cash-flow forecast.

**Non-negotiables (violating any of these is a bug, regardless of tests passing):**

1. Money is stored as integer minor units (piasters) in BIGINT. Never floats. Default currency EGP.
2. Every tenant-owned table has `tenant_id` and Postgres Row Level Security. Cross-tenant leakage tests must exist and pass.
3. A reminder is never sent twice, never to an opted-out debtor, never in quiet hours, never for an invoice that is already paid.
4. LLM output is untrusted structured data. It may only select from an allowlist of actions, is validated with Zod, and below the confidence threshold it routes to human review. Inbound customer text is untrusted input (prompt-injection defense): it is passed as quoted data, never as instructions.
5. A payment screenshot is a claim, not proof. By default the system records a claimed payment and asks the merchant to confirm. Auto-close is opt-in per tenant.
6. Verify every third-party API (WhatsApp Cloud API, Paymob, Anthropic API, SMS provider) against its official current documentation at implementation time. Do not rely on memory for endpoints, field names, versions, limits or prices. Record what you verified in `docs/DECISIONS.md`.
7. Arabic-first UI with correct RTL, English as secondary locale. Inputs must accept Eastern Arabic numerals and normalize them.
8. No secrets in the repo. All config via validated env (Zod) that fails fast at boot.

## 2. Working protocol for the agent

For every task, follow this loop:

1. Restate the acceptance criteria in your own words in `docs/PROGRESS.md`.
2. Write failing tests first (unit or integration).
3. Implement the smallest correct change.
4. Run `pnpm lint && pnpm typecheck && pnpm test`. All must be green.
5. Exercise the feature for real: Playwright for UI flows, `curl` or a script for APIs and webhooks. Capture the evidence (command and output) in `docs/PROGRESS.md`.
6. Self-review the diff against Section 1.
7. Commit small, with conventional messages (`feat(reminders): ...`).

**Definition of done for any feature:** acceptance criteria met, tests added and green, edge cases from the feature spec covered, Arabic copy reviewed, empty/loading/error states handled, audit log entries written for state changes, docs updated.

**Stop and ask the human when:** you need credentials or an external account; a decision involves legal, pricing or privacy; an ambiguity changes the data model; a test still fails after three genuinely different attempts (report your diagnosis, do not hack around it).

Keep two living files: `docs/PROGRESS.md` (what is done, evidence, what is next) and `docs/DECISIONS.md` (short ADRs: context, decision, consequences).

## 3. Stack (decided; deviate only with an ADR)

- **Language:** TypeScript (strict) everywhere. Node 22 LTS. pnpm workspaces.
- **Web app:** Next.js (App Router), React, Tailwind, shadcn/ui, `next-intl` for ar/en with RTL. Internal API via tRPC; plain REST route handlers only for webhooks and public pages.
- **DB:** PostgreSQL 16, Drizzle ORM and drizzle-kit migrations. RLS via `SET LOCAL app.tenant_id` per transaction.
- **Queue and scheduler:** Redis and BullMQ in a separate `worker` process. Repeatable jobs for the planner and dispatcher.
- **Auth:** email and password (argon2id) with secure session cookies via Better Auth. WhatsApp OTP login is a later enhancement. Roles: owner, staff.
- **Validation:** Zod on every boundary (HTTP, webhooks, env, LLM output).
- **Files:** S3-compatible object storage (MinIO locally), private bucket, signed URLs, strip EXIF, max 8 MB, allow jpeg/png/webp/heic.
- **LLM:** Anthropic API through one wrapper in `packages/providers/llm`. Model IDs come from env (`LLM_MODEL_FAST`, `LLM_MODEL_VISION`). Suggested defaults, to verify in current docs: `claude-haiku-5-5` for text classification, `claude-sonnet-5-5` for vision extraction. Use structured output or tool-use for JSON, with retries and a token/cost log per call.
- **Providers (behind interfaces, each with a fake for tests):** `MessagingProvider` (WhatsApp Cloud API, SMS fallback), `PaymentProvider` (Paymob), `OcrLlmProvider`, `Storage`, `Clock`.
- **Observability:** pino structured logs with request and job correlation IDs, Sentry, `/healthz` and `/readyz`, an `/admin` metrics page (queue depth, send success rate, LLM cost).
- **Testing:** Vitest, Playwright, MSW and recorded fixtures for providers, Testcontainers for Postgres and Redis, a fake clock for all time-dependent logic.
- **Local dev:** `docker compose up` brings up Postgres, Redis, MinIO and Mailpit. One command seeds demo data.
- **Deploy:** Docker images for `web` and `worker`, GitHub Actions CI (lint, typecheck, test, build, migration dry run). Target host chosen by the human; keep the app host-agnostic.

## 4. Repo layout

```
apps/web            Next.js app, tRPC routers, public pages, webhook routes
apps/worker         BullMQ workers and schedulers
packages/db         Drizzle schema, migrations, RLS policies, seed
packages/core       Pure domain logic (no IO): money, phone, schedules, matching, forecast
packages/providers  whatsapp, sms, paymob, llm, storage, clock (+ fakes)
packages/templates  Message template registry (ar, en) and variable schemas
packages/eval       Golden datasets and eval runners for LLM features
docs/               PROGRESS.md, DECISIONS.md, RUNBOOK.md
```

Keep `packages/core` free of IO so it can be tested exhaustively and cheaply.

## 5. Data model

All tables: `id` (uuid v7), `created_at`, `updated_at`, and `tenant_id` unless noted. Soft-delete via `deleted_at` only where stated.

- **tenants:** name, business_name_ar, timezone (default `Africa/Cairo`), plan, trial_ends_at, settings jsonb (schedule policy, quiet hours, auto_close_enabled, default channel, tone).
- **users / memberships:** user, tenant, role.
- **debtors:** display_name, phone_e164, phone_valid, whatsapp_status (unknown, reachable, unreachable), opted_out_at, notes, risk_flag, `phone_hash` (HMAC-SHA256 with server pepper, for the future shared-behavior feature). Unique (tenant_id, phone_e164).
- **invoices:** debtor_id, reference, description, amount_minor, currency, issued_on, due_on, status (open, partially_paid, paid, disputed, written_off, cancelled), paid_minor (derived and cached, recomputed from allocations), source (manual, import, ledger_photo), last_reminded_at. Overdue is derived (`status in open/partially_paid and due_on < today`), not stored.
- **payments (append-only):** invoice_id nullable, debtor_id, amount_minor, method (cash, instapay, bank, wallet, cheque, gateway, other), received_on, reference_no, status (claimed, confirmed, rejected), source (manual, gateway_webhook, receipt_ai), evidence_file_id, confirmed_by. Corrections are new rows, never updates.
- **payment_allocations:** payment_id, invoice_id, amount_minor. A payment can cover several invoices.
- **reminders:** invoice_id, step_key (e.g. `d-3`, `d0`, `d+3`), channel, template_key, due_at (UTC), status (scheduled, queued, sent, delivered, read, failed, skipped, cancelled), skip_reason, provider_message_id, idempotency_key. Unique (invoice_id, step_key, channel).
- **messages:** debtor_id, direction (out, in), channel, provider_message_id (unique per provider), type (text, image, template, status), body, template_key, media_file_id, raw jsonb, status, cost_estimate_minor, at.
- **message_intents:** message_id, intent, extracted jsonb, confidence, resolved_by (auto, human), action_taken.
- **opt_outs:** tenant_id, phone_e164, reason, at. Checked on every send.
- **cheques:** debtor_id, direction (receivable, payable), number, bank, amount_minor, issue_date, due_date, status (held, deposited, cleared, bounced, returned, cancelled), image_file_id.
- **import_jobs / import_rows:** kind (excel, ledger_photo), status, file_id, mapping jsonb, per-row parsed jsonb, row_status (pending_review, accepted, rejected, duplicate), confidence.
- **statement_links:** debtor_id, token_hash, expires_at, revoked_at, last_viewed_at.
- **disputes:** invoice_id, raised_by (debtor, merchant), reason, status.
- **audit_log:** actor, action, entity, entity_id, before jsonb, after jsonb. Write on every state change.
- **usage_ledger:** tenant_id, kind (whatsapp_utility, sms, llm_vision, llm_text), units, cost_estimate_minor, at. Drives quotas and billing.
- **files:** storage_key, mime, size, sha256, kind. The `sha256` is used to detect re-submitted receipts.

## 6. Domain rules (implement in `packages/core`, fully unit-tested)

- **Money:** helpers `parseEgp` (accepts `1,250.50` and Eastern Arabic digits), `format`, `sum`. Reject more than 2 decimals. Property-based tests.
- **Phone:** `libphonenumber-js`, default region EG, store E.164. Accept `010...`, `+2010...`, `002010...` and Eastern Arabic digits. Reject landlines for WhatsApp. Normalization must be idempotent.
- **Time:** store UTC. All business logic evaluates in the tenant timezone. Quiet hours default 21:00 to 09:00 local. Optional Friday-morning skip. A reminder that falls in quiet hours moves to the next allowed slot, never skipped silently.
- **Invoice status machine:** transitions are explicit and tested. `paid_minor` is recomputed from confirmed allocations only. Overpayment creates a credit balance on the debtor, not a negative invoice.
- **Reminder planner:** pure function `planReminders(invoice, policy, now) -> ReminderPlanStep[]`. Default policy: `d-3`, `d0`, `d+3`, `d+7`, `d+14`, then weekly, capped at 6 reminders per invoice. Tenant-level policy with per-invoice override. Re-planning on any invoice or payment change must be idempotent (upsert by unique key, cancel obsolete future steps).
- **Grouping:** if a debtor has several reminders due the same day, send one consolidated message listing the invoices and the total, not several.
- **Caps:** at most 1 reminder message per debtor per channel per day, plus a tenant-configurable weekly cap.

## 7. Features

Each feature lists scope, flow, edge cases and acceptance criteria. Build in the milestone order of Section 10.

### F0. Foundation

**Scope:** monorepo, CI, env validation, auth, tenant onboarding wizard (business name, timezone, schedule policy, tone), RBAC, i18n and RTL shell, audit log, error handling, rate limiting, seed data.

**Acceptance:**
- A new user can sign up, create a tenant and land on an empty dashboard in Arabic RTL.
- RLS test: a user in tenant A cannot read or write tenant B rows through any tRPC procedure or REST route (write a generic test that iterates every tenant table).
- API error shape is uniform: `{ error: { code, message, details } }`. All list endpoints use cursor pagination. POST endpoints that trigger sends require an `Idempotency-Key`.

### F1. Debtors and invoices

**Scope:** CRUD, search, filters (overdue, aging bucket, status), bulk actions, per-debtor timeline (invoices, payments, messages, disputes), manual payment entry with partial payments and allocation across invoices.

**Edge cases:** duplicate phone; invoice with no due date (treat as due on issue date plus tenant default terms); editing an invoice after reminders were sent (re-plan, never resend sent steps); deleting a debtor with history (soft-delete, keep audit); currency other than EGP (store it but show a warning; out of scope for forecasting).

**Acceptance:** all status transitions covered by tests; the timeline renders mixed events in the correct order; allocating one payment across three invoices updates all three.

### F2. Excel and CSV import

**Flow:** upload, detect headers (Arabic and English), auto-map columns with a confirmable mapping UI, preview with per-row validation, dedupe against existing debtors by normalized phone, commit in a transaction, 24-hour undo window.

**Edge cases:** merged cells, header on row 3, dates as Excel serials or text, amounts with Arabic digits or the Arabic comma, empty phone, 5,000-row files (stream and chunk).

**Acceptance:** golden fixtures (at least 10 messy files, in `packages/eval/fixtures/import`) import with the expected results; invalid rows are reported with row number and reason, never silently dropped.

### F3. WhatsApp integration (Cloud API)

**Decision for MVP (confirm with the human):** one platform-owned WhatsApp Business Account and number; messages state the merchant name via a template variable. Phase 2: Embedded Signup so each tenant can use its own number. Design the `MessagingProvider` interface so this is a config change, not a rewrite.

**Scope:**
- Send template messages with variables, send free-form replies inside the 24-hour customer-service window, receive inbound messages and status callbacks.
- Webhook route: handle the GET verification challenge; verify `X-Hub-Signature-256` HMAC over the raw body with the app secret before parsing; respond 200 quickly, persist the raw payload, enqueue processing; dedupe by provider message ID.
- Status mapping: sent, delivered, read, failed (store the provider error code and map known codes: not on WhatsApp, template paused, rate limit, policy block).
- Template registry in `packages/templates` with versioned keys, variable schemas, and a submission script that prints what to submit to Meta. Never hardcode message text outside the registry. Draft Arabic templates (polite, short, no threats, no pressure language):
  - `invoice_upcoming`: تذكير ودّي من {{business}}: مستحق عليكم مبلغ {{amount}} بتاريخ {{due_date}}. شكرًا لتعاونكم.
  - `invoice_due_today`: من {{business}}: نذكّركم بأن مبلغ {{amount}} مستحق اليوم. للاستفسار أو التسوية يمكنكم الرد على هذه الرسالة.
  - `invoice_overdue`: من {{business}}: لاحظنا تأخر سداد مبلغ {{amount}} المستحق في {{due_date}}. إن كان قد تم السداد، برجاء إرسال إيصال التحويل هنا. شكرًا لكم.
  - `payment_received`: وصلنا مبلغ {{amount}}، شكرًا لكم. المتبقي: {{remaining}}.
  - `payment_received_pending`: استلمنا الإيصال وجارٍ التأكد من التحويل. شكرًا لكم.
  - Every outbound reminder includes an opt-out line (reply with the word `إيقاف`).
- Check current Meta rules on template categories and pricing in the official docs. Categorization is decided by Meta, so the cost model must tolerate a template being recategorized. Meta moved to per-message pricing in July 2025 and changes how service replies are charged from October 2026, so read the live rate card and keep rates in a config table, not in code.
- Quality guard: track per-tenant and global delivery failure and block rates; auto-pause a tenant's sending if thresholds are crossed and alert the admin.

**Edge cases:** debtor not on WhatsApp (fall back to SMS if enabled); inbound media download (fetch with the token, store, hash); webhook replay; out-of-order status events; template rejected or paused.

**Acceptance:** with a fake provider and recorded webhook fixtures, the full lifecycle (queued, sent, delivered, read, inbound reply) updates the DB correctly; a replayed webhook creates no duplicates; a bad signature returns 401 and stores nothing; a manual end-to-end test against the real sandbox number is documented in `RUNBOOK.md`.

### F4. Reminder engine

**Components:**
- **Planner job:** on invoice or payment change, and nightly, regenerates future reminder rows.
- **Dispatcher (every minute):** select due reminders with `FOR UPDATE SKIP LOCKED` and apply guards in this order: invoice still unpaid, debtor not opted out, phone valid, channel allowed, quiet hours, daily cap, tenant quota and plan status, provider health. A failed guard sets `skipped` with a precise `skip_reason` (or reschedules for quiet hours). Passing reminders are enqueued.
- **Sender worker:** builds the message from the template registry, calls the provider with the reminder's `idempotency_key`, stores the provider message ID and writes a `usage_ledger` row. Retry on 429 and 5xx with exponential backoff and jitter (max 5); never retry policy errors. After a final not-reachable WhatsApp failure, fall back to SMS when enabled.
- **Kill switches:** per-tenant pause, global pause, and a dry-run mode that renders messages without sending.

**Acceptance (use the fake clock):**
- Time-travel test: create an invoice due in 10 days; advance the clock day by day; assert that exactly the expected reminders fire at the expected local times.
- Paying an invoice at any point cancels all future reminders within one dispatcher cycle.
- Two dispatcher instances running concurrently never double-send (race test with 20 concurrent workers).
- An opt-out reply stops all further sends for that phone across the tenant, immediately.
- Load test: 50,000 due reminders processed without exceeding provider rate limits and without memory growth.

### F5. Payments (manual and gateway)

**Scope:** mark as paid (full or partial), record method and date, optional attached proof. Paymob payment link per invoice or per debtor total, included in reminders via a template button or URL variable. Gateway webhook with HMAC verification (per Paymob's current docs), idempotent by transaction ID, creates a `confirmed` payment and allocates it. Refunds and chargebacks create reversing payments.

**Edge cases:** webhook arrives before the redirect, duplicate webhooks, amount mismatch, payment for an already-paid invoice (credit balance), link expiry.

**Acceptance:** sandbox end-to-end documented; webhook replay is a no-op; a reconciliation report shows the gateway total equals the sum of confirmed gateway payments.

### F6. Ledger photo import

**Flow:** the merchant uploads or photographs pages of a handwritten ledger; a job sends the images to the vision model; the model returns rows `{name, phone?, amount, date?, note?, row_confidence}`; the UI shows an editable review table next to the image, with low-confidence cells highlighted; the merchant fixes and confirms; rows are imported with dedupe.

**Rules:** normalize Eastern Arabic digits; resolve names to existing debtors by fuzzy match (suggest, never auto-merge); keep the source image on each imported invoice as evidence; process asynchronously with a progress indicator; resize and compress images before sending; cap pages per job.

**Eval:** a golden set of at least 40 ledger images (neat, messy, tilted, low-light, Arabic and Latin digits), supplied or synthetically generated and labeled. Targets: amount-cell accuracy at least 90%, name accuracy at least 85%, and at least 90% of wrong cells must carry a low-confidence flag. Nothing is imported without the merchant pressing confirm.

### F7. Transfer receipt reading

**Flow:** an inbound image on a debtor's chat (or a merchant upload) triggers extraction: `{amount, currency, datetime, sender_name, sender_account_tail, reference_no, method (InstaPay, bank transfer, Vodafone Cash, Fawry, other), status_text, is_receipt, tamper_signals}`. Then matching:

1. Candidate invoices are the open invoices of the debtor identified by the inbound phone number.
2. Match the exact amount to one invoice or to a sum of invoices; otherwise treat it as partial.
3. Checks: image `sha256` seen before; same `reference_no` seen before; date plausibility; amount mismatch; non-receipt image; low OCR confidence.
4. Result: create a `claimed` payment with the evidence and notify the merchant with one-tap Confirm or Reject. If the tenant enabled auto-close **and** all checks pass **and** confidence is at least 0.9, confirm automatically and notify. In all cases reply to the debtor with `payment_received_pending` or `payment_received` as configured.

**Eval:** at least 60 receipt images across InstaPay, major banks and wallets, including blurry, cropped, dark-mode, Arabic and English UIs, plus 15 negatives (random photos) and 10 edited or duplicate cases. Targets: exact amount extraction at least 95% on clean images, zero false auto-confirms on the whole set, duplicates always caught.

### F8. Reply understanding (Egyptian Arabic)

**Intents (closed set):** `promise_to_pay` (with `promised_date`), `already_paid`, `dispute`, `request_extension` (with date), `partial_payment_offer` (with amount), `wrong_person`, `opt_out`, `question`, `greeting_or_other`. Handle Egyptian colloquial, Franco-Arabic, typos and mixed messages.

**Action allowlist:**
- `promise_to_pay`: create a promise record and re-plan the next reminder for the day after the promised date.
- `already_paid`: ask for a receipt and flag the invoice for merchant check.
- `dispute`: pause reminders and open a dispute for the merchant.
- `request_extension`: ask the merchant to approve.
- `opt_out`: record the opt-out immediately and confirm politely.
- `wrong_person`: mark the phone invalid.
- Everything else goes to the human inbox.

Auto-replies (if enabled) come only from approved templates, never free generation.

**Safety:** relative dates (الخميس، آخر الشهر، بعد العيد) are resolved with the tenant timezone and current date injected into the prompt; ambiguity routes to human review. Keyword-based opt-out detection runs before and independently of the LLM.

**Eval:** at least 150 labeled replies written by humans in realistic Egyptian dialect (include sarcasm, anger, and injection attempts such as asking the bot to ignore its rules). Targets: intent accuracy at least 90%, date extraction at least 95%, zero cases where an injection triggers a non-allowlisted action, opt-out recall 100%.

### F9. Cheques

**Scope:** register receivable and payable cheques (manual, or photo extraction through the same vision pipeline); status transitions; alerts three days before and on the due date (deposit or fund reminder); bounced-cheque flow (set the debtor risk flag, restore the invoice to open, notify the merchant); calendar view by due week.

**Acceptance:** all transitions tested; depositing a cheque creates a pending payment that confirms when marked cleared; a bounce reverses it correctly.

### F10. Customer statement page

**Scope:** public page `/s/{token}` with business name, open invoices, payment history, total due, a Pay button (if the gateway is enabled) and a dispute button. Tokens are 32 random bytes, stored hashed, expiring (default 30 days) and revocable. Rate-limited, `noindex`, no merchant-internal notes shown, mobile-first, Arabic RTL. Include the link in reminders when enabled.

**Acceptance:** an expired or revoked token returns a generic not-found; brute force is rate-limited; the dispute button creates a dispute and pauses reminders.

### F11. Dashboard and reports

KPIs: total outstanding, overdue amount, collected this month, collection rate, DSO, aging buckets (0-7, 8-30, 31-60, 60+ days), top 10 debtors, reminder performance (sent, delivered, replied, paid within 7 days of a reminder). CSV export of invoices, payments and debtors. Every KPI has a unit test against a small hand-computed fixture.

### F12. Cash-flow forecast

**Method (no ML needed):** per debtor, compute the distribution of days-late from their paid invoices. With fewer than 3 data points, fall back to the tenant median, then to a conservative default. For each open invoice, the expected payment date is the due date plus the median lateness, and the conservative date uses the 80th percentile. Aggregate by week for 8 weeks and show an expected line and a conservative line, with an explanation of how each number was computed. If the tenant has fewer than 10 paid invoices, show a not-enough-data state instead of a fake forecast.

**Acceptance:** deterministic unit tests on fixtures; a backtest script that predicts the last 8 weeks from earlier data and reports the error.

### F13. Plans, quotas and billing

Trial of 14 days, then plans with a monthly message quota. Metering comes from `usage_ledger`. Soft enforcement first (warn at 80%, block sends at 100% with a clear banner and an upgrade path). Subscription payment through the payment provider; subscription invoices are generated automatically. Keep plan limits in a config table.

### F14. Shared payment behavior (design only, do NOT enable)

This feature carries legal and privacy risk under Egypt's personal data protection law and needs human legal sign-off. For now, only prepare the groundwork: store `phone_hash` on debtors (HMAC with a server pepper), record payment-timing events, and add a disabled feature flag `shared_behavior`. Do not build any cross-tenant read path.

## 8. Cross-cutting requirements

- **Privacy and security:** TLS everywhere, argon2id, CSRF protection, rate limits on auth and public routes, secure headers, upload validation, signed file URLs, no PII in logs (mask phone numbers), daily DB backups with a documented restore test, data export and delete-tenant-data endpoints.
- **Consent and tone:** onboarding requires the merchant to confirm they have a legitimate relationship with their debtors. Message tone guard: templates only, no threats or shaming language, no contact outside allowed hours, an opt-out line on every message.
- **Resilience:** all external calls have timeouts, retries and circuit breakers. Provider outages degrade gracefully (queue grows, UI shows status). Jobs are idempotent.
- **Performance:** dashboard queries under 300 ms for 100k invoices per tenant (add indexes and verify with `EXPLAIN`).
- **UX:** mobile-first (most merchants use phones), large touch targets, works on slow connections, clear Arabic copy, empty states that guide the next action. Onboarding goal: sign up, import, first reminder scheduled within 5 minutes.
- **LLM governance:** one prompt file per task under version control, each with an eval run; log model, prompt version, tokens and latency; redact data not needed for the task; budget alarms per tenant.

## 9. Testing strategy (the agent must run and report these)

- **Unit:** all of `packages/core`, including property-based tests for money and phone.
- **Integration:** Testcontainers Postgres and Redis; RLS isolation tests; planner and dispatcher with the fake clock; webhook handlers with recorded fixtures and signature checks.
- **Contract tests:** provider fakes must pass the same suite as the real adapters (run the real-adapter suites only when sandbox credentials exist).
- **E2E (Playwright, Arabic RTL, mobile viewport):** sign up and onboard, import Excel, review a ledger photo import, create an invoice, simulate an inbound reply via the webhook route, confirm a claimed payment, view the statement page, pause and resume reminders.
- **LLM evals:** `pnpm eval` runs the golden sets, prints metrics against the targets above, and fails CI if a target regresses. Never tune a prompt on the test set; keep a separate dev set.
- **Concurrency and load:** the double-send race test and the 50k-reminder test from F4.
- **Security checks:** dependency audit in CI, a test that every route requires auth unless it is on an explicit public allowlist, and a secrets scan.
- **Manual runbook:** `docs/RUNBOOK.md` lists the real-world checks that need a human (real WhatsApp number, real payment sandbox, template approval status).

## 10. Milestones and exit criteria

| Milestone | Scope | Exit criteria |
|---|---|---|
| M0 (week 1) | F0 foundation, CI, seed | Sign-up to empty dashboard in RTL; RLS tests green |
| M1 (week 2) | F1, F2 | Import a messy Excel file and manage invoices with correct statuses |
| M2 (weeks 3-4) | F3, F4 | End-to-end reminders on the sandbox; fake-clock, opt-out and race tests green |
| M3 (week 5) | F5, F10 | Manual and gateway payments, statement page, dispute flow |
| M4 (weeks 6-7) | F6, F7, F8 | All three LLM evals meet targets; review UIs complete |
| M5 (week 8) | F9, F11, F12, F13 | Cheques, dashboard, forecast, quotas |
| M6 (week 9) | Hardening | Security checklist, backups, load test, runbook, pilot-ready |

At the end of each milestone: update `PROGRESS.md`, tag a release, and write a short demo script the human can follow.

## 11. Inputs the human must provide (ask early)

1. Meta Business verification and a WhatsApp Business Account with a dedicated number; app secret and access token; template approval (start immediately, it can take time).
2. A Paymob merchant account (sandbox first) and an SMS provider account.
3. A Gemini or Anthropic API key. Set provider-side spend alerts and limits; this release meters token usage but does not implement a hard global USD spend cap.
4. Choices for object storage, Redis and Postgres hosting, plus a domain name and an email sender.
5. Legal review of: collection-message wording, data protection obligations, and the shared-behavior feature.
6. Seed data for evals: real anonymized ledger photos, transfer screenshots, and 150 realistic Egyptian-Arabic replies.
7. Pricing decisions: plan prices and quotas, after the real per-message cost is confirmed from Meta's current rate card.

## 12. Final acceptance checklist

- [ ] All Section 1 rules demonstrably enforced by tests.
- [ ] Every feature F0 to F13 meets its acceptance criteria, with evidence in `PROGRESS.md`.
- [ ] `pnpm lint`, `typecheck`, `test`, `eval` and E2E are all green in CI.
- [ ] No double-send under race, no cross-tenant leakage, no non-allowlisted LLM action.
- [ ] Arabic RTL UI reviewed on a real phone.
- [ ] Runbook, backup restore test and rollback procedure documented.
- [ ] A pilot tenant can complete onboarding and schedule its first reminders in under 5 minutes.
