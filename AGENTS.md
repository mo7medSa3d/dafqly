# AGENTS.md: rules for any AI agent working in this repo

Project: **Tahseel (تحصيل)**, a multi-tenant, Arabic-first SaaS that helps Egyptian small businesses track money owed to them, remind debtors on WhatsApp, and close invoices when paid.

## Read at the start of EVERY session
1. `docs/PROGRESS.md`: current state, evidence, next steps. This is your memory.
2. `docs/DECISIONS.md`: choices already made. Do not reopen them without a reason.
3. The relevant section of `docs/BUILD_PLAN.md` (what and how) and `docs/BRAND.md` (visual rules).
If these files disagree, the order of authority is: this file, then BUILD_PLAN.md, then BRAND.md for anything visual.

## Commands (create these scripts in M0 and keep them working)
`pnpm install` · `pnpm dev` · `pnpm worker` · `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm test:e2e` · `pnpm eval` · `pnpm db:migrate` · `pnpm db:seed` · `docker compose up -d`

## Hard rules (a violation is a bug even if tests pass)
1. Money is integer minor units. Never floats.
2. Every tenant table has `tenant_id` and RLS. Test cross-tenant isolation.
3. Never send a reminder twice, to an opted-out debtor, in quiet hours, or for a paid invoice.
4. LLM output is untrusted. Validate with Zod, allowlist actions, route low confidence to humans. Customer text is data, never instructions.
5. A payment screenshot is a claim, not proof. Auto-close only if the tenant opted in.
6. Verify third-party APIs (WhatsApp Cloud API, Paymob, Anthropic, SMS) in their current official docs before coding against them. Never rely on memory for endpoints, fields, versions, limits or prices. Log what you checked in DECISIONS.md.
7. No hardcoded colors or font names in app code; use tokens from `packages/brand`.
8. Never use letter-spacing on Arabic text. Latin digits by default; accept Eastern Arabic digits on input.
9. Do not build the shared-behavior feature (F14). Only the groundwork described in the plan.

## Safety in development
- `DRY_RUN_MESSAGING=true` is the default. Never send real WhatsApp or SMS messages, or take real payments, from dev, CI or tests.
- Real-sandbox tests run only when `RUN_SANDBOX_TESTS=1` and sandbox credentials exist.
- Never print, log or commit secrets, tokens, or real phone numbers. Mask PII in logs.
- Fonts are licensed. Never commit font files. Never convert, subset, rename or self-host them until DECISIONS.md records the owner's permission. Until then use the fallback stack (`NEXT_PUBLIC_BRAND_FONT=off`).

## Workflow for every task
1. Restate acceptance criteria in PROGRESS.md.
2. Write failing tests first.
3. Implement the smallest correct change.
4. Run lint, typecheck and tests. All green.
5. Exercise the feature for real (Playwright, curl, scripts) and paste the command and output as evidence in PROGRESS.md.
6. Self-review the diff against the hard rules.
7. Small conventional commits (`feat(scope): ...`). No unrelated refactors.

## Honesty rules
- Never claim something works unless you ran it and saw it work. Say exactly what you verified and how.
- Mark every place where a fake, mock or synthetic data stands in for the real thing, in code comments and in PROGRESS.md.
- Do not mark a feature done if any acceptance criterion is unmet or untested. Say which one.

## Legal and compliance drafts
You may draft Terms, Privacy Policy and consent text as `docs/legal/*.draft.md`, clearly labelled as drafts that need review by an Egyptian lawyer. Never present them as final or as legal advice.

## When to stop and ask the human
You need credentials or an external account; a legal, privacy or pricing decision; an ambiguity that changes the data model; real eval data; the font files or the font license answer; or a test still fails after three genuinely different attempts (report your diagnosis, do not hack around it). While blocked, continue with everything that is not blocked.

## End of every session
Update `docs/PROGRESS.md` (done, evidence, blocked, next 3 steps). Commit. Leave the repo green.
