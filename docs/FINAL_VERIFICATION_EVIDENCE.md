# Final verification evidence — DAFQLY (Tahseel) v0.9.0

Date: 2026-11-14. Code HEAD verified: `06cc98e` (on top of the Quiet Ledger
base `43b41b4`). This pass added four commits on top of `bcbc7e9`:

- `6c82fa7` fix(promises): serialize promise rows returned by create/decide (BigInt)
- `bce5c01` test(e2e): fix exploratory spec failures — 4 spec bugs, 1 app bug found
- `738bad7` test(e2e): invoices spec — submit via inv-create, relative row counts
- `06cc98e` chore(dead-code): drop unused localDateOf re-export and db better-auth dep

Nothing was pushed. The user lands work on origin/main himself.

## Research sources

Design references for the Quiet Ledger direction (from `DESIGN.md` §2 and
`docs/REDESIGN_EVIDENCE.md`, "Research limits" — restated here, not
re-researched in this pass): Stripe Dashboard (tables/KPIs/aging), Mercury
(calm, one number first), Ramp (work queues, near-monochrome + one accent),
Linear (density/nav), Wise (per-currency balances, one pattern only);
SaaSFrame dashboard guide (free tier). Honesty limits, unchanged: no Inspo
MCP search was executed (MCP server, no client); no screenshots were viewed;
no logged-in products were inspected; Mobbin was not inspected (Pro
paywalled). References are secondary extracts + web search, not first-hand
product inspection.

## Optimizations — before / after

| Area | Before (Quiet Ledger `43b41b4`) | After (`06cc98e`) |
|---|---|---|
| First Load JS, shared | 102 kB | **102 kB** (unchanged — no regression) |
| Production build | exit 0, 41 pages | exit 0, **40/40 static pages** |
| Unit + integration tests | 525/525 | **527/527** (+2 regression tests: KWD/JPY receipt summaries, charts axisLabel) |
| Full e2e | 35/35 | **48/48** (+13 exploratory spec) |
| Axe | 1 passed, 0 violations | **1 passed, 0 violations** |
| Knip unused exports | `toInvoiceView`, `localDateOf` | **none** |
| Knip unused dependencies | `better-auth` in `packages/db` | **none** |
| Money formatting (F-06) | hardcoded `/100` in 4 clients + charts axisLabel | tenant/receipt currency everywhere (`be36714`); LedgerPhoto `/100` is EGP-by-design, documented |
| Promise button (NaN) | `Number("abc")` is NaN, `NaN <= 0` is false → button stayed enabled and the click silently did nothing | button disabled for unparseable amounts, derived from the same currency-aware `parseMoney` the submit path uses (`ddbd691`) |

No business logic, API contracts, routes, test IDs, i18n keys, auth, RLS, or
reminder rules were changed by this pass except the one bug fix below.

## Dead code removed — with proof

- `toInvoiceView` unexported (`414e88c`) — same-file use only.
- Unused dependencies removed, unlisted `tailwindcss` listed (`de66fab`).
- Unused exports, functions, one-off scripts removed (`f17e8eb`).
- `export { localDateOf }` in `apps/web/src/server/cheques.ts:417` +
  the now-unused `localDateOf` import (line 5) removed (`06cc98e`): nothing
  imports `localDateOf` from cheques — every use imports it from
  `@tahseel/core` (`packages/core/src/time.ts:86`). The build caught the
  leftover import (`'localDateOf' is defined but never used`); removing it
  made the build green again.
- `better-auth` removed from `packages/db/package.json` (`06cc98e`): only a
  comment in `packages/db/src/seed.ts:12` mentions it; the real import lives
  in `apps/web` (which keeps its own declaration). Lockfile updated via
  `pnpm install` (3 deletions).
- Knip re-run after the fixes (`fv-final-knip2.log`, exit 1 = knip's normal
  "found items" exit): `better-auth` and `localDateOf` are gone. Remaining,
  both kept with justification: 4 entry-point generator scripts
  (`packages/eval/scripts/generate-import-fixtures.mjs`,
  `packages/eval/scripts/generate-m4-fixtures.mjs`,
  `scripts/load/generate-100k.mjs`, `scripts/regenerate-brand-assets.mjs` —
  run directly, never imported, so knip cannot see them) and the `exceljs`
  devDependency (false positive: imported by
  `packages/eval/scripts/generate-import-fixtures.mjs:5`).

## Rich synthetic data (separate tenant)

Script: `pnpm db:seed:rich` (`packages/db/src/seed-rich.ts`). Never touches
the demo tenant (demo still has 3 invoices, so the m0/m3 demo-total
assertions keep passing). Login `rich@tahseel.test`, password from
`RICH_DEMO_PASSWORD`, else `DEMO_PASSWORD`, else random printed once.
Public statement `/s/rich-statement-demo-2026`. Idempotent;
`RESET_RICH_SEED=1` wipes only the rich tenant.

Seeded counts (verified by seed output and by a read-only SQL cross-check):
12 debtors, 32 invoices (open 18 / partial 4 / paid 6 / disputed 2 /
written-off 1 / cancelled 1; aging current 8, 0–7d 4, 8–30d 3, 31–60d 3,
60+d 2; KWD + JPY invoices), 16 payments + 13 allocations (incl. partial
refund and bounced-cheque reversal), 6 cheques (one per status), 6 promises
(one per status), 3 disputes (2 open, 1 resolved), 14 reminders (all
statuses), 18 messages driving the funnel (sent 12 / delivered 7 / replied 5
/ paid-within-7d 4), 3 AI-inbox intents, 5 tasks, 1 public statement link.

The DB was left in pristine rich-seed state at the end of this pass
(re-seeded with `RESET_RICH_SEED=1` after the last mutation check; SQL
counts re-verified: debtors 12, invoices 32, payments 16, promises 6,
cheques 6).

## Flows exercised

Exploratory spec `apps/web/e2e/exploratory.spec.ts` — **13/13, exit 0**
(`fv-exploratory-final.log`):

1. Rich dashboard (ar, desktop): KPIs (outstanding 159,880.00 / overdue
   93,980.00 / collected 34,650.00 / refunded 3,500.00 / 12 debtors),
   multi-currency KWD + JPY lines, reminder funnel 12/7/5/4, forecast
   not-enough-data state, aging buckets 0-7/8-30/31-60/60+.
2. Rich dashboard (en, mobile): LTR, same KPIs.
3. Debtors list: search + detail (12 rows, 1 after search, 13,000.00
   outstanding for الأفق, 3 invoices).
4. Debtors record payment: invalid rejected (no new row), valid partial
   recorded (rows +1), full-balance prefill 16,500.00.
5. Invoices: search by reference, status filter (paid 6), overdue filter
   (13), create disabled while amount empty, valid create (total +1, d3 +1).
6. Cheques: all six statuses, create invalid then valid.
7. Tasks + promises: seeded rows, create/start/complete task, record a
   750.00 promise (see bug fix below).
8. AI inbox: 1 human-routed intent (listIntents defaults to onlyHuman),
   receipt upload form.
9. Import + ledger-photo screens render; sample CSV downloads.
10. Billing, settings (save round-trip), platform ai-budget 404 for a
    tenant user (access control working as designed).
11. Shell: command palette, copilot drawer (Ask tab), notification bell,
    theme + locale toggles (→ /en/dashboard).
12. Public statement: renders, promise invalid then valid, dispute flow.
13. Landing, signup validation, 404 panel.

Forecast chart branch, proven live (not by the exploratory spec — the rich
tenant has only 6 paid invoices, below the F12 threshold of 10): after
creating + fully paying 4 extra 10.00 EGP invoices via tRPC (10 paid
invoices total, confirmed in the DB), the dashboard HTML rendered the
ForecastChart (`aria-label "رسم توقع التدفقات النقدية خلال ثمانية أسابيع"`
+ "عرض القيم الأسبوعية" button, `forecast-not-enough` absent). The
`getForecast` enoughData branch is also covered by
`m5.integration.test.ts`. The temporary invoices were wiped by the next
re-seed.

Full e2e (`pnpm test:e2e`: migrate + `RESET_SEED=1` seed + all specs) —
**48/48, exit 0** (`fv-final-e2e.log`): the 35 shipped tests + the 13
exploratory tests, including the axe spec (also run standalone:
`fv-final-axe.log`, 1 passed, 0 violations on landing/login/dashboard/
invoices).

## Bugs fixed in this pass

### 1. REAL APP DEFECT — merchant promise creation failed with a BigInt serialization error (fixed in `6c82fa7`)

- Symptom: recording a promise in the collection workspace showed
  "Do not know how to serialize a BigInt" and the new promise never
  appeared in the list — while the row WAS created server-side, so a
  retry created a duplicate.
- Root cause: tRPC has no transformer (plain JSON —
  `initTRPC.context<TrpcContext>().create({...})` in
  `apps/web/src/server/trpc.ts`, no `superjson`). `createMerchantPromise`
  and `decidePromiseToPay` (`apps/web/src/server/workflows.ts`) returned
  raw `promises_to_pay` rows whose `amountMinor` is a JS `bigint`
  (`bigint("amount_minor", { mode: "bigint" })` in
  `packages/db/src/schema.ts:719`). The HTTP response failed to serialize
  (500 `INTERNAL_SERVER_ERROR`) after the transaction had committed.
- Proof: reproduced over HTTP with curl against the production build —
  `collections.createPromise` returned 500 with exactly that message
  before the fix; after the fix it returns 200 with
  `amountMinor: "75000"` (string) and all dates as ISO strings. Same for
  `collections.decidePromise` (accept): 200 with `amountMinor: "200000"`.
  The exploratory tasks test (which creates a 750.00 promise and asserts
  it appears) failed before the fix and passes after it.
- Fix: `serializePromiseRow()` helper in `workflows.ts`, mirroring the
  `listPromisesToPay` mapping (`amountMinor.toString()`, dates to ISO),
  applied to both return sites. Sibling audit: `createCollectionTask` /
  `updateCollectionTask` return task rows (no BigInt columns — safe);
  `invoices.create` already returns a serialized object (verified live);
  the public statement promise flow already serializes (its e2e passes).
- Regression test: `journeys.integration.test.ts` test D now pins the
  wire shape (`JSON.stringify` must not throw, `amountMinor` is a
  string) for both `createMerchantPromise` and `decidePromiseToPay`.
  Verified the test FAILS without the fix (`TypeError: Do not know how
  to serialize a BigInt`) and passes with it.

### 2. Spec bugs found by the exploratory triage (fixed in `bce5c01`, `738bad7`)

- Dashboard forecast: the spec expected the chart, but the rich tenant
  has 6 paid invoices < 10 (F12), so the page correctly shows the
  not-enough-data state. Spec now asserts `forecast-not-enough`.
- Debtors payment: `count()` does not wait for navigation — `rowsBefore`
  was captured on the list page (0) and the test then "gained" a row
  after any submit. Spec now waits for the detail URL + first payment
  row before counting.
- Invoices create: the form is always on the page (no modal) and
  `inv-create` IS its submit button, disabled while the amount is empty.
  Clicking it hung to the 90 s test timeout. Spec now asserts disabled
  instead of clicking. Also: the submit must use the button's own testid
  (shipped pattern) — the `form + has(inv-amount) + button[type=submit]`
  locator chain hung resolving while the list refetches.
- Invoices search scope (app behavior, NOT a bug): the server search
  matches reference/description only (`ledger.ts` — `ilike` on
  `reference`/`description`), not debtor names, so searching "السلام"
  correctly returns 0. The spec now verifies the new row in the full
  list with relative before/after counts (retry-safe).
- Shell copilot: `copilot-generate-btn` belongs to the hidden
  message-composer tab; the Ask tab submits with Enter (shipped pattern
  in `notifications-ai.spec.ts`). Spec now presses Enter and closes the
  drawer with Escape before the header toggles.
- Two concurrent `seed:rich` runs with `RESET_RICH_SEED=1` (the
  coordinator's orphaned run + mine) corrupted an intermediate run: one
  run's wipe deleted the other's tenant mid-run (FK violation on invoice
  002). Test-harness race, not an app defect. The corrupted log
  (`fv-exploratory2.log`) was discarded; the definitive runs (3, 4, 5)
  ran alone.

## Blocked items (not passed, not hacked around)

- Plain `pnpm build` is BLOCKED by the pre-existing ADR-033 env guard
  (no S3/AI credentials in this VM). The production build is verified
  via the fake-providers route (`E2E_FAKE_PROVIDERS=true`) only.
- `pnpm audit` is BLOCKED (npm audit endpoint ECONNRESET from this VM).
- Live WhatsApp / Paymob / Gemini / SMTP / S3 / Redis paths are BLOCKED
  on credentials (release-candidate status, unchanged); e2e runs only
  with fake providers; `DRY_RUN_MESSAGING=true`.
- Inspo MCP search never executed (MCP server, no client).
- Pre-existing, out of scope for this pass: HEIC EXIF stripping
  remainder; cross-currency unattributed remainder (ADR-031, awaiting the
  user's decision); dispute evidence not modelled.

## Checks table — baseline → after

Baselines are the Quiet Ledger numbers (HEAD `43b41b4`, 2026-11-13).
"After" is HEAD `06cc98e`. Full logs live in
`~/workspace/dafqly-work/final-verification-logs/` (persistent — the
pre-restart `/tmp` logs were lost when the VM restarted mid-pass at
~03:04 EET 2026-11-14, which also took down Postgres, global pnpm, the
`pgtest` user, and `.next`; the environment was recovered — pnpm
reinstalled, `pgtest` recreated, Postgres restarted with clean recovery —
and every check below was re-run from complete logs).

| Check | Baseline | After | Log |
|---|---|---|---|
| `pnpm lint` | exit 0 | **exit 0** | `fv-final-lint.log` |
| `pnpm typecheck` | exit 0 | **exit 0** | `fv-final-typecheck.log` |
| Unit + integration (`REQUIRE_DB_TESTS=1 pnpm test`, `.env` sourced) | 525/525 | **527/527** — brand 40, templates 5, core 238, db 32, providers 40, eval 19, reminders 27, worker 1, web 125 | `fv-final-test.log` |
| Production build (`E2E_FAKE_PROVIDERS=true pnpm build`) | exit 0, 102 kB shared | **exit 0, 102 kB shared, 40/40 pages** | `fv-final-build.log` |
| Plain `pnpm build` | BLOCKED (ADR-033) | **BLOCKED (ADR-033)** — unchanged | — |
| Exploratory e2e (13 tests) | n/a (new) | **13/13, exit 0** | `fv-exploratory-final.log` |
| Full e2e (`pnpm test:e2e`) | 35/35 | **48/48, exit 0** | `fv-final-e2e.log` |
| Axe spec | 1 passed, 0 violations | **1 passed, 0 violations** | `fv-final-axe.log` |
| Knip (`pnpm dlx knip`) | unused: `toInvoiceView`, `localDateOf`, `better-auth` (db) | **only the 4 entry-point scripts + exceljs false positive remain** (exit 1 = knip's normal "found items" exit) | `fv-final-knip2.log` |
| `pnpm audit` | BLOCKED (ECONNRESET) | **BLOCKED (ECONNRESET)** — unchanged | — |
| Promise create/decide over HTTP | 500 BigInt error | **200, serialized rows** | `fv-promise-http-check.txt` |
| Forecast chart branch (live, 10 paid invoices) | not exercised | **renders** (aria-label + weekly-values button in dashboard HTML) | observed via curl (this doc) |
| Rich seed | — | **pristine, SQL-verified** (12/32/16/6/6) | seed output + SQL counts (this doc) |

## Deliberately not changed

- No new refactors; only the proven BigInt defect and the two dead-code
  items were fixed.
- The 4 knip-flagged entry-point scripts and the `exceljs` devDependency
  were kept (documented above).
- The invoice server search (reference/description only) was NOT changed
  to match debtor names — it is the existing, tested behavior; the spec
  was fixed instead.
- The forecast F12 threshold (10 paid invoices) was NOT lowered to make
  the rich tenant render the chart — the seed data and the rule are both
  settled; the chart branch was verified live instead.
- No Trivy re-scan was attempted (needs a Docker-capable environment);
  no baseline dates were extended.
