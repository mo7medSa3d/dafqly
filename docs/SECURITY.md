# SECURITY checklist (BUILD_PLAN §8/§9) — M6 walk, 2026-11-09 (CVE audit updated 2026-11-19)

Each item: status + how it was verified in this session. "Blocked" means the
check needs something only the human has (an account, a pushed repo, a
production host) — the exact procedure is in RUNBOOK.md.

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | Every route requires auth unless on an explicit public allowlist (§9) | ✅ Verified | `apps/web/src/server/security-routes.test.ts`: walks `apps/web/app` — all 28 route/page files classified (12 public, 16 session); an unclassified new route fails the suite. Behavioural half: all 61 tRPC procedures called with no session — every one except the public `health` probe throws UNAUTHORIZED before any DB access. |
| 2 | Public allowlist contents | ✅ By design | healthz/readyz (no data), Better Auth sign-in/up endpoints (rate-limited), WhatsApp webhook (HMAC-SHA256 over raw body, 401 stores nothing), Paymob webhook (HMAC-SHA512, 401 stores nothing), statement page/APIs (32-byte token, SHA-256 hash only, per-IP rate limits 60/min read, 10/min write, unknown=expired=revoked generic 404), login/signup pages. |
| 3 | Secure headers | ✅ Verified over HTTP | `apps/web/next.config.ts` sets nosniff, Referrer-Policy strict-origin-when-cross-origin, X-Frame-Options DENY + CSP (default-src 'self'; object-src 'none'; frame-ancestors 'none'; script/style keep 'unsafe-inline' — Next bootstrap + Tailwind, nonce migration is a tracked follow-up), HSTS in production only. Verified with curl against the production build. |
| 4 | Rate limits on auth + public routes | ✅ Re-verified | App token-bucket limiter suite (`rate-limit.test.ts`) + M0 live evidence (401×10 → 429); statement limits tested M3. |
| 5 | CSRF | ✅ Documented + spot-checked | Better Auth session cookies are HttpOnly + SameSite (library defaults, session cookie observed in M0 live run); all mutations go through session-authenticated tRPC POSTs; public POSTs are signature/token-gated instead. No cookie-authenticated GET mutates state. |
| 6 | Password hashing argon2id | ✅ Re-verified | M0 proof stands (stored hash prefix `$argon2id$v=`); auth code unchanged since. |
| 7 | Upload validation | ✅ Re-verified | M4 suite: jpeg/png/webp/heic only, 8 MB cap, sha256 recorded (`validateUpload` tests in providers). |
| 8 | Signed file URLs | 🟡 Implemented; live verification pending | `S3CompatibleStorageProvider` now signs PUT/GET/DELETE with AWS SigV4 and produces private GET URLs capped at 7 days; tests mock the HTTP endpoint and check expiry, key traversal rejection, and 404 handling. Still required: run the same upload/download/expiry checks against the actual MinIO/AWS bucket and verify bucket policy blocks anonymous reads. |
| 9 | No PII in logs | ✅ Verified | `maskPhone` in @tahseel/core (+2 unit tests); worker pino configured with redact paths for phone fields (M6); code scan: web/worker log calls carry ids/counts only — no raw phone, body text, or secrets. Log scan over an exercised worker boot + e2e server run: no unmasked EG phone pattern found. |
| 10 | Secrets scan | ✅ In lint | `scripts/check-secrets.mjs` runs in `pnpm lint` (green at the M6 gate); `.env` is gitignored and absent from every milestone zip (verified by archive listing). |
| 11 | Dependency audit | 🟡 Lockfile CVE audit verified; live `pnpm audit` pending online CI | Offline `pnpm-lock.yaml` audit (2026-11-19): `next@15.5.29` & `react@19.3.1` are patched past CVE-2025-66478 / CVE-2025-55182; `better-auth@1.7.18` is patched past CVE-2025-61928, CVE-2025-71402, and CVE-2026-109346; `exceljs@4.4.0` is affected by CVE-2026-128341 (mitigated in `packages/core/src/import.ts` via ZIP bomb + `dataValidations` `sqref` pre-validation). Live `pnpm audit --prod --audit-level=high` remains blocked in offline VMs (`ECONNRESET`) and must run in online CI. |
| 12 | RLS cross-tenant isolation | 🟡 Schema and test coverage extended; rerun pending | `TENANT_TABLES` now includes the persistent AI conversation/message tables and the collection workflow tables; migrations `0010_persisted_ai_conversations.sql` and `0011_collections_team_ai_actions_budget.sql` enable tenant RLS on all tenant-owned additions, and the generic RLS suite includes them. Re-run the DB integration suite after applying migration 0010; `tenant_deletions` remains deliberately outside RLS (ADR-024). |
| 13 | §1 hard rules regression | 🟡 Extended guardrails; rerun pending | Copilot read tools are server-side allowlisted, Zod-validated and tenant-scoped. Write proposals are only pending approvals; Owner approval revalidates eligibility and schedules reminders without sending immediately. Owner-only promise state changes protect review, and Promise `kept` state is derived only from confirmed allocations after acceptance. Streaming endpoint is session-authenticated and added to the route inventory. Tests added but not executed in this environment. |
| 14 | TLS everywhere | ⚠️ Deployment | App assumes TLS termination at the host (HSTS sent in production mode). No production host exists yet (HUMAN_INPUTS #13). |
| 15 | Data export + delete-tenant-data (§8) | ✅ Verified | M6: `tenantData.export` (RLS-scoped JSON bundle) + `tenantData.deleteAll` (owner-only, typed confirmation, tombstone record); integration suite proves tenant B byte-identical after tenant A is deleted, staff refused, wrong confirmation refused. |
| 16 | Backups + restore (§8) | ✅ Verified (procedure) | `scripts/backup.sh`/`restore.sh`; real dump+restore performed twice in this VM (small dev DB and the 100k-invoice load DB) with matching row counts (see RUNBOOK). Production daily schedule is documented, NOT deployed. |

## Verified Dependency CVE Audit (`pnpm-lock.yaml`, 2026-11-19)

| Package | Locked Version | Advisory / CVE | Status & Mitigation |
|---|---|---|---|
| `next` / `react` | `15.5.29` / `19.3.1` | CVE-2025-66478, CVE-2025-55182 | ✅ Patched in lockfile |
| `better-auth` | `1.7.18` | CVE-2025-61928, CVE-2025-71402, CVE-2026-109346 | ✅ Patched in lockfile |
| `exceljs` | `4.4.0` | CVE-2026-128341 | 🟡 Affected; mitigated in `packages/core/src/import.ts` via ZIP bomb + `dataValidations` `sqref` pre-validation. Upgrade or replace when a patched upstream release is published. |

## Online Remediation Playbook (run on first networked host / CI push)

1. **Run live dependency audit**: Execute `pnpm audit --prod --audit-level=high` in CI or on a networked machine. If `exceljs@4.4.0` (CVE-2026-128341) still lacks an upstream patch and fails the CI gate, either upgrade/replace `exceljs` or record a scoped `pnpm.auditConfig.ignoreGhsas` entry with a review date while the `import.ts` pre-validation remains active.
2. **Pin `:latest` Docker images**: In `docker-compose.yml`, replace `pgsty/minio:latest`, `pgsty/mc:latest`, and `axllent/mailpit:latest` with pinned release tags (or immutable `@sha256:...` digests) and re-verify with `docker compose config -q && docker compose up -d`.
3. **Align workspace `package.json` specifiers**: Root `pnpm.overrides` currently enforces `drizzle-orm@^0.45.4` and `zod@4.6.7`, while workspace manifests (`apps/web`, `packages/core`, `packages/db`, `packages/reminders`, `packages/templates`) still declare `^0.44.7` and `^3.25.76`. Align those workspace specifiers on the next online `pnpm install` lockfile refresh.
4. **Generate missing FK indexes**: Add foreign-key indexes in `@tahseel/db` schema, run `pnpm --filter @tahseel/db generate`, and confirm CI's migration drift check passes cleanly.

## Known follow-ups (honest, not hidden)
- CSP nonce migration to drop script-src 'unsafe-inline'. (L1, 2026-11-12:
  `unsafe-eval` is already dev-only in next.config.ts — verified by reading
  the `isProd` branch, which omits it in production; the nonce migration
  itself is still deferred, not done.)
- Real MinIO/AWS SigV4 verification and private-bucket policy check.
- A platform-wide monthly USD AI admission-control guard is now implemented in `ai_global_budget` / `ai_global_usage`. Every provider method called inside a tenant request context reserves funds atomically before execution and settles the estimate from returned token usage. Rates are estimates and the per-call reservation may be below actual usage; an in-flight call can therefore settle above the cap. Reconcile provider invoices and configure a conservative reservation. `AI_DAILY_TOKEN_LIMIT` remains a separate non-atomic Copilot token preflight threshold.
- Live `pnpm audit` result — obtainable only from a network that reaches the npm audit endpoint (see Online Remediation Playbook above).
