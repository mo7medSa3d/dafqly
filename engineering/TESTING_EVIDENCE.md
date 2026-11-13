# DAFQLY Testing Evidence (2026-11-13 Run)

## Passed (Executed on Final Tree)

| Check | Command | Result |
|---|---|---|
| Brand token guard | `node scripts/check-no-hardcoded-brand.mjs` | PASS (`OK (no hardcoded hex colors or font names in app code)`) |
| Secrets scan | `node scripts/check-secrets.mjs` | PASS (`OK (706 files scanned)`) |
| i18n message parity | `node scripts/check-message-parity.mjs` | PASS (`OK (403 keys in both locales)`) |
| Currency `/ 100` static audit | `grep -rnE "amount.*\/\s*100\|\/\s*100.*toFixed\|minor\s*\*\s*100\|\* 100\)" apps packages --include="*.ts" --include="*.tsx" --exclude="*.test.ts"` | PASS (0 remaining currency `/100` or `*100` bugs in `apps/web/src/components/` or `ai.ts`) |

## Blocked (Environment Limitations — Never Claimed PASS)

| Check | Reason |
|---|---|
| `pnpm install` / `pnpm typecheck` / `pnpm test` / `pnpm build` | Offline sandbox VM has Node `v18.20.4` (project requires `>=22`), no `pnpm`, no `node_modules`, and outbound package installation is disabled. |
| `pnpm db:migrate` / `pnpm db:seed` / RLS & worker queue tests | Postgres and Redis are not installed/running in this VM. |
| Real browser E2E (`pnpm test:e2e`) | Application cannot be built/started without `node_modules`, Postgres, and Redis. |
| Live Gemini / Anthropic / WhatsApp / Paymob / S3 / SMTP | No external provider credentials in this environment. |
