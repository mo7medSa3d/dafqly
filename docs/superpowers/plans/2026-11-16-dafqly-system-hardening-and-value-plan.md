# Dafqly System Hardening, Simplification & Client Value Plan

> **For agentic workers:** Implementing natively task-by-task with verification after each step.

**Goal:** Harden Dafqly end-to-end as a unified, simple, bug-free B2B collections SaaS by finishing AI config/budget unification, fixing BigInt/tool-execution issues, integrating AI approvals with workspace notifications, and surfacing high-value Copilot actions in the UI.

**Architecture:** Single unified AI provider (`UnifiedAiProvider` via `AI_PROVIDER` + `AI_API_KEY`), modular server tool handlers under PostgreSQL RLS (`withTenant`), and tight integration between AI proposals, operational notifications, and the bilingual Copilot drawer.

**Tech Stack:** TypeScript, Next.js App Router, tRPC, Drizzle ORM, PostgreSQL RLS, Zod, Vitest, Tailwind CSS.

## Global Constraints
- Never hardcode hex colors or font names in app code (`scripts/check-no-hardcoded-brand.mjs`).
- Never leak secrets (`scripts/check-secrets.mjs`).
- Maintain 100% Arabic/English key parity (`scripts/check-message-parity.mjs`).
- No per-tenant AI API key UI in Settings; AI is configured once at the platform level.
- All monetary amounts use `bigint` minor units—never coerce `bigint` balances to `Number`.

## Review Focus
- `draft_collection_message` passing `Number(outstanding)` instead of `bigint` could lose precision on large balances.
- `ai-budget.ts` missing pricing entries for `UnifiedAiProvider` default models (`gemini-2.5-flash`, `gpt-4o-mini`, `claude-sonnet-4-5`) would overcharge budget caps at fallback `$10/$40`.
- `createPendingAiApproval` creating pending approvals without notifying the owner in the Notification Bell leaves proposals unseen.
- `ai-budget.ts` and `env.ts` retaining stale `AI_PROVIDERS_JSON` / `AI_PRICE_*` / `LLM_MODEL_*` clutter.
- `AiCopilotDrawer.tsx` not exposing 1-click chips for cheques & inbox/dispute triage.

---

### Task 1: Complete AI Config & Budget Unification
**Files:**
- Modify: `apps/web/src/server/ai-budget.ts`
- Modify: `packages/core/src/env.ts`
- Modify: `apps/web/src/server/ai-budget.test.ts`
- Modify: `packages/core/src/env.test.ts`

- [ ] **Step 1:** Update `estimateAiCostUsdMicros` in `apps/web/src/server/ai-budget.ts` to include built-in rates for `gemini-2.5-flash`, `gpt-4o-mini`, `claude-sonnet-4-5`, `deepseek-chat`, `llama-3.3-70b`, and remove `rateOverrideFor` / `AI_PROVIDERS_JSON` / `AI_PRICE_*` clutter.
- [ ] **Step 2:** Simplify `packages/core/src/env.ts` by removing `AI_PROVIDERS_JSON`, `AI_PRICE_INPUT_USD_PER_M`, `AI_PRICE_OUTPUT_USD_PER_M`, `GEMINI_MODEL_*`, `LLM_MODEL_*`, and `AI_MODEL_AGENT`/`FAST`/`VISION` (keeping `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`, `AI_BASE_URL`, plus `GEMINI_API_KEY`/`ANTHROPIC_API_KEY` fallbacks).
- [ ] **Step 3:** Update `packages/core/src/env.test.ts` and `apps/web/src/server/ai-budget.test.ts` to match the simplified unified config.

### Task 2: Fix BigInt Safety & Modularize Copilot Tool Execution
**Files:**
- Modify: `apps/web/src/server/intelligence.ts`

- [ ] **Step 1:** Fix `draft_collection_message` to pass `amountMinor: outstanding` (`bigint`) instead of `Number(outstanding)`.
- [ ] **Step 2:** Extract the large inline `executeTool` switch inside `askWorkspaceCopilot` into a clean, focused `executeCopilotTool(ctx, name, rawArgs)` helper function.
- [ ] **Step 3:** Add `auditLog` recording inside `send_workspace_notification` so every AI-emitted notification is auditable.

### Task 3: Integrate AI Approvals with Workspace Notifications
**Files:**
- Modify: `apps/web/src/server/workflows.ts`

- [ ] **Step 1:** Import `upsertNotificationInTx` from `./notifications` and call it inside `createPendingAiApproval` so every new AI proposal (`create_collection_task` or `schedule_reminder`) immediately alerts the workspace owner in the Notification Bell.

### Task 4: Surface High-Value Copilot Actions in `AiCopilotDrawer.tsx`
**Files:**
- Modify: `apps/web/src/components/AiCopilotDrawer.tsx`

- [ ] **Step 1:** Add 1-click quick-action chips for **Cheques & Due Risk** and **Inbox & Disputes Triage** (`inbox_triage`) in `AiCopilotDrawer.tsx` so users can trigger the new workspace tools effortlessly.

### Task 5: Final Verification & Packaging
**Files:**
- Output: `/working_dir/c_36b33dda7c50ea88/artifacts/file_generation/ttl=63d/output/dafqly-upgraded.zip`

- [ ] **Step 1:** Run `check-no-hardcoded-brand.mjs`, `check-secrets.mjs`, `check-message-parity.mjs`, and static reference/import checks.
- [ ] **Step 2:** Package the verified project into `dafqly-upgraded.zip` and present it to the user.
