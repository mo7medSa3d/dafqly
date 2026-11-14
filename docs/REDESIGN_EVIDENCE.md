# Quiet Ledger redesign — before/after visual evidence (2026-11-13)

Direction: **Quiet Ledger** (Stripe tables × Mercury calm × Ramp queues ×
Linear density), specified in `DESIGN.md`, decided in ADR-034. This report
is the per-screen before/after record plus the checks table. The design
itself (tokens, type, spacing, components, states, contrast, money,
assets) lives in `DESIGN.md`; the change log lives in
`DESIGN_CHANGELOG.md`.

## How to read this report

- **Before** = the v0.9.0 premium look (gradient hero, pill buttons/KPI
  cards, multi-colour scatter), captured by the Prompt 08/09 redesign
  spec as `after-*.png` and preserved here as `before-quiet-ledger-*.png`
  (20 files) before the Quiet Ledger spec overwrote the `after-*` names.
  Screenshots are gitignored; they live in
  `apps/web/e2e/screenshots/redesign/`.
- **After** = the Quiet Ledger build (28 files in the same folder).
- **EN before-shots do not exist** — the v0.9.0 spec captured ar only.
  The EN before-state is the same v0.9.0 look shown by the ar
  before-shots; EN after-shots are new coverage added by this redesign
  (`apps/web/e2e/quiet-ledger-en.spec.ts`).
- **404 before-state**: no custom page existed — unmatched URLs showed
  Next's builtin 404. The after-state is the new custom page in both
  locales (no before file to pair it with).
- **Demo data differs between some captures.** The demo tenant is shared
  and mutated by e2e runs (documented M3 caveat): during the evidence
  runs a concurrent full-suite spec recorded a gateway payment of
  125,050 minor (INV-2026-001) at 2026-11-13 23:42:20+02, so captures
  taken after it (dark dashboard, debtor detail, statement) show the
  invoice paid, while the SSG-prerendered light dashboard still showed
  it open. The layout/system comparison is unaffected — only the numbers
  differ. The final full run re-seeds first (`pnpm test:e2e` runs
  `db:migrate` + `RESET_SEED=1 db:seed`), so its assertions see pristine
  seed data.
- **Full-page captures and fixed elements.** The specs use Playwright
  `fullPage` screenshots. Fixed elements (AI copilot launcher, sidebar)
  render at their viewport position inside the stitched image — e.g. the
  launcher appears mid-page overlapping content. That is a capture
  artefact, not a layout defect: in a live viewport the launcher sits in
  the bottom-left corner.

## Per-screen evidence

Paths are relative to `apps/web/e2e/screenshots/redesign/`.

### Landing — desktop 1440, ar

- Before: `before-quiet-ledger-landing-desktop.png`
- After: `after-landing-desktop.png` (+ EN: `after-en-landing-desktop-light.png`)
- What changed: gradient hero → solid navy `#14243A` band; white-on-navy
  primary CTA (was blue-on-white pill); feature illustrations redrawn
  two-tone (navy + teal + slate, no yellow/pink/violet scatter); content
  max-width 1200px; rectangular 8px buttons; 12px bordered cards.
- Compared against: Stripe (restrained hero, one accent), Mercury (calm
  single message). No fixes needed after comparison.

### Landing — mobile 390, ar + en

- Before: (ar only, in the v0.9.0 mobile set — no dedicated landing-mobile
  before file; the desktop before-shot is the reference)
- After: `after-en-landing-mobile-light.png` (en); ar mobile covered by
  the redesign spec's mobile pass.
- No horizontal overflow (`scrollWidth − clientWidth ≤ 1`, asserted in
  both specs). Hero stacks, CTAs full-width, 40px targets.

### Login — desktop 1440 + mobile 390, ar light/dark, en light

- Before: `before-quiet-ledger-login-desktop.png`,
  `before-quiet-ledger-login-desktop-dark.png`,
  `before-quiet-ledger-login-mobile-dark.png`
- After: `after-login-desktop.png`, `after-login-desktop-dark.png`,
  `after-login-mobile-dark.png`, `after-en-login-desktop-light.png`,
  `after-en-login-mobile-light.png`
- What changed: auth split keeps the solid navy brand side (no gradient);
  inputs 40px / 8px radius, `border-border-strong/60`, focus
  `border-primary`; primary button rectangular; the paid-status label on
  the navy side is white (was `#12716B` at ≈2.6:1 — fixed).
- Compared against: Mercury/Ramp (quiet auth, one accent). No fixes
  needed after comparison.

### Dashboard — desktop 1440 + mobile 390, ar light/dark, en light

- Before: `before-quiet-ledger-dashboard-desktop.png`,
  `before-quiet-ledger-dashboard-desktop-dark.png`,
  `before-quiet-ledger-dashboard-mobile.png`,
  `before-quiet-ledger-dashboard-mobile-dark.png`
- After: `after-dashboard-desktop.png`, `after-dashboard-desktop-dark.png`,
  `after-dashboard-mobile.png`, `after-dashboard-mobile-dark.png`,
  `after-en-dashboard-desktop-light.png`,
  `after-en-dashboard-mobile-light.png`
- What changed (the genuine re-layout): gradient hero band → plain
  header (eyebrow + date/timezone, 28px title, subtitle, primary/ghost
  actions); 4-equal-KPI-card grid → one headline figure (total
  outstanding 40px + open-invoice/debtor counts + other-currency lines)
  over a hairline-divided 4-stat row; sidebar 280px → 232px, nav rows
  42px → 32px, active = callout bg + primary text + 2px start border;
  aging ramp recoloured to the token-only severity scale; forecast
  conservative line is slate-400 dashed (was paid-green). All `kpi-*`
  testids preserved; the five server calls are unchanged.
- EN check: sidebar mirrors to the left, LTR, amounts `4,250.50 EGP`
  tabular with Latin digits, Arabic debtor names embedded correctly.
- Dark check: navy surfaces, light text, blue accents, status colours
  readable; no washed-out text.
- Fixes made after comparison: none on layout. Two defects found by the
  axe gate on this page and fixed (see Checks): locale-toggle contrast
  4.49:1 → label now `text-text`; three `label-content-name-mismatch`
  buttons (notification bell, compact locale toggle, copilot trigger)
  had their accessible names corrected (see DESIGN.md §10).

### Invoices — desktop 1440 + mobile 390

- Before: `before-quiet-ledger-invoices-desktop.png`,
  `before-quiet-ledger-invoices-mobile.png`
- After: `after-invoices-desktop.png`, `after-invoices-mobile.png`
- What changed: list rows are stacked cards (avatar/initial, title,
  meta, amount, rectangular status badge, chevron/action); the new
  invoice form stacks cleanly on mobile; aging section keeps the
  token-only ramp; filters are 40px rectangular controls.
- Mobile pattern: stacked rows, no horizontal scroll; row actions
  (WhatsApp, edit, status chips) reachable by touch; no page overflow
  (asserted).
- Fixes made after comparison: axe found `text-text-muted` on the solid
  `bg-surface-muted` (4.35:1) and `bg-callout` (4.46:1) fills on this
  page — the Reminders/Collections labels and the invoices-count chip
  now use `text-text-subtle` (5.06:1 / 5.20:1).

### Debtors (+ detail) — desktop + mobile

- Before: `before-quiet-ledger-debtors-desktop.png`,
  `before-quiet-ledger-debtors-mobile.png`,
  `before-quiet-ledger-debtor-detail-mobile.png`
- After: `after-debtors-desktop.png`, `after-debtors-mobile.png`,
  `after-debtor-detail-mobile.png`
- What changed: same list-client discipline as invoices; detail page
  stacks sections (header, payment form, quick links, reconciliation,
  statement, invoices, payments, timeline) with 12px bordered panels
  and hairline dividers.
- Fixes made after comparison: reconciliation notes
  (`gw-recon`/`ledger-recon`) were `text-text-muted` on solid
  `bg-callout` (4.46:1) → `text-text-subtle`.

### Import / Ledger-photo / AI inbox / Cheques — mobile 390

- Before: `before-quiet-ledger-import-mobile.png`,
  `before-quiet-ledger-ledger-photo-mobile.png`,
  `before-quiet-ledger-ai-inbox-mobile.png`,
  `before-quiet-ledger-cheques-mobile.png`
- After: `after-import-mobile.png`, `after-ledger-photo-mobile.png`,
  `after-ai-inbox-mobile.png`, `after-cheques-mobile.png`
- What changed: all five data tables (Import preview, Ledger-photo
  review, Collection promises, Billing invoices, Audit trail) have a
  sticky solid header + `overflow-x-auto` scroll container with a
  `min-w-[560–720px]` floor; list screens stay stacked rows. No page
  overflow on any of them (asserted in the redesign spec).
- Fixes made after comparison: `LedgerPhotoClient` review note and
  `AiInboxClient` confidence badge were `text-text-muted` on solid
  `bg-surface-muted` (4.35:1) → `text-text-subtle`; the `ImportClient`
  XLSX/XLS/CSV badges likewise.

### Debtor reports — mobile

- Before: `before-quiet-ledger-reports-mobile.png`
- After: `after-reports-mobile.png`
- Element screenshot of the reports section; same table/list discipline,
  no overflow.

### Public statement `/s/[token]` — mobile 390

- Before: `before-quiet-ledger-statement-mobile.png`
- After: `after-statement-mobile.png`
- What changed: solid navy header band with white text; the pay-total
  button is white-on-navy (the ≈2.6:1 paid-label defect was fixed
  here too); invoice + payment rows use tabular amounts; security
  notice kept.
- Note: the after-shot shows INV-2026-001 paid — the concurrent
  payment mutation described above, not a redesign effect.

### Onboarding — mobile 390

- Before: `before-quiet-ledger-onboarding-mobile.png`
- After: `after-onboarding-mobile.png`
- What changed: wizard steps restyled to the same primitives (40px
  inputs, rectangular primary CTA, 12px panels); no logic change.

### 404 — desktop 1440, ar + en (new coverage, no before)

- After: `after-404-ar-desktop-light.png`, `after-404-en-desktop-light.png`
- What changed: new custom 404 in the Quiet Ledger system (bordered
  panel, brand mark, translated title/body, rectangular primary action
  to the dashboard). Before, unmatched URLs showed Next's builtin 404.
- Verified by curl as well as screenshots: `/ar/…` and `/en/…` unknown
  paths return 404 with the correct translated copy, `lang`/`dir`, and
  dashboard link, in light and dark (dark via `dafqly-theme=dark`
  cookie); server log shows zero errors. See "404 — two files" in
  `DESIGN_CHANGELOG.md` for why the root `app/not-found.tsx` uses
  inline token styles.

## Money formatting (verified by reading + rendered screenshots)

- Helpers read, not changed: `packages/core/src/money.ts` +
  `apps/web/src/components/CurrencyContext.tsx` — bigint minor units,
  per-currency exponents (EGP/SAR/USD/AED/EUR 2, KWD 3, JPY 0), negative
  with leading `-`, zero renders `0.00`, thousands grouped, tabular
  numerals (`tnum`) throughout, amounts `dir="ltr"`.
- Rendered evidence: dashboard headline `4,250.50 EGP` (+ `2 Open
  invoices · 3 Customers`), overdue `1,250.50 EGP`, collected `0.00`,
  DSO `54.6 days`; invoices list `750.00`/`5,000.00`/`1,250.50` with
  `ج.م`; statement `1,250.50 ج.م`; EN dashboard `3,000.00 EGP` /
  `1,250.50 EGP`. Headline KPIs are tenant currency only; the
  other-currency lines render separately where they already existed —
  never summed across currencies.
- The non-EGP money defects (§Money formatting above) were FIXED on
  2026-11-14 in the final verification pass (commit be36714): hardcoded
  `/100`/`*100` in `DebtorDetailClient.tsx`, `CollectionWorkspaceClient.tsx`,
  `ChequesClient.tsx`, `charts.tsx` `axisLabel`, and the receipt summary in
  `packages/core/src/ai.ts` — all now exponent-aware, with regression
  tests. `LedgerPhotoClient.tsx` (L118, L274–275) was re-checked and is
  NOT a defect: the ledger-photo import is EGP-denominated by design
  (committed invoices are created with currency `EGP`). See DESIGN.md §11.

## Contrast (both themes, recomputed 2026-11-13)

Full numbers in DESIGN.md §10. Light: text/bg 14.66, text_muted/bg
4.71, text_muted/surface 5.03, primary_fg/primary 6.36, link/bg 5.96;
statuses 5.23–7.04. Dark: text/bg 16.33, text_muted/bg 8.84,
primary_fg/primary 8.04, link/bg 8.04; statuses 6.93–11.78. All ≥4.5
text / ≥3 focus. Defects found by axe-core after the token pairs passed
and fixed in place (see DESIGN.md §10): muted text on the
`bg-surface-muted/60` blend (4.49:1), muted text on solid
`bg-surface-muted` (4.35:1) and `bg-callout` (4.46:1) — all now
`text-text` or `text-text-subtle` (5.06–13.98:1); three WCAG 2.5.3
label-in-name mismatches (notification bell, compact locale toggle,
copilot trigger). Known thin margin left deliberately:
`text-text-muted` on the `bg-surface-muted/50` blend is 4.53:1
(`CollectionWorkspaceClient` assignee note) — passes, recorded in
DESIGN.md §14.

## Research limits (honest)

- Inspo MCP v0.2.0 exists via npx but is an MCP server, not a
  searchable CLI; no Inspo search was executed (no MCP client
  available). References come from web search + text fetch of secondary
  extracts, not logged-in products; no reference screenshots were
  viewed. SaaSFrame dashboard guide usable (free tier); Mobbin NOT
  inspected (Pro paywalled).
- References: (A) Stripe Dashboard — tables/KPIs/aging; (B) Mercury —
  calm, one number first; (C) Ramp — work queues/AI inbox,
  near-monochrome + one accent; (D) Linear — density/nav; (E) Wise —
  per-currency balances as first-class objects (one pattern only).
  URLs + access date are in DESIGN.md §1.

## Checks table

Baseline (recorded, HEAD b5471c3, Prompt 08/09): full unit+integration
suite 525/525 passed, e2e 32/32, production build exit 0, axe-core 0
violations on 4 pages. Baseline method: cited recorded baseline (no
clean-HEAD stash run was done — the redesign commits sit on top of
b5471c3 and the before/after counts are compared side by side below).

| Check | Result | Evidence (log / path / command) | Baseline → After |
|---|---|---|---|
| `pnpm lint` | pass | `/tmp/lint4.log`, exit 0 (brand + secrets + message-parity OK, 405 keys) | exit 0 → exit 0 |
| `pnpm typecheck` | pass | `/tmp/typecheck4.log`, exit 0 | exit 0 → exit 0 |
| Full unit/integration suite | pass | `/tmp/test-full4.log`, exit 0; complete log read: brand 40, templates 5, core 237, providers 40, db 32, eval 19, reminders 27, worker 1, web 124 | 525/525 → 525/525 |
| Production build (fake-providers route) | pass | `/tmp/build5.log`, exit 0 ("Compiled successfully", 41/41 pages) | exit 0 → exit 0 |
| Production build (plain `pnpm build`) | BLOCKED (pre-existing) | `/tmp/build.log`, exit 1 at the ADR-033 env guard ("Production requires S3_ENDPOINT to be an HTTPS object-storage endpoint") — fails before any UI code, no real S3/AI credentials in this VM; not a redesign regression | exit 0 (with credentials) → BLOCKED in this VM, same as before the redesign |
| Redesign e2e spec (ar, desktop+mobile, light/dark) | pass | `/tmp/e2e-redesign2.log`, exit 0, 2 passed, 0 server errors | new coverage → 2/2 |
| EN + 404 e2e spec | pass | `/tmp/e2e-redesign2.log`, exit 0, 2 passed (landing/login/dashboard en desktop+mobile; 404 ar+en) | new coverage → 2/2 |
| Full e2e suite | pass | `/tmp/e2e-full3.log`, exit 0, 35 passed (root script: migrate + `RESET_SEED=1` seed + 35 tests) | 32/32 → 35/35 (2 en/404 tests + 1 axe test added) |
| Axe-core (landing/login/dashboard/invoices) | pass | `/tmp/e2e-axe4.log`, exit 0, 1 passed, 0 violations | 0 violations → 0 violations (after fixing 1 contrast + 3 label defects the gate exposed) |
| 404 curl verification (ar/en, light/dark) | pass | `/tmp/nf-ar.html`, `/tmp/nf-en.html`, `/tmp/nf-dark.html` — correct copy, `lang`/`dir`, dashboard href, dark tokens; server log 0 errors | no custom 404 → custom 404 both locales |
| Playwright screenshots (before vs after) | pass | `apps/web/e2e/screenshots/redesign/` — 20 `before-quiet-ledger-*.png`, 28 `after-*.png`; inspected: dashboard (ar/en, light/dark), landing, login, invoices mobile, debtor detail mobile, statement mobile, 404 ar/en | — |
| Contrast recomputation (both themes) | pass | DESIGN.md §10; `packages/brand/contrast.test.ts` green inside the 525 (brand 40/40); axe-core 0 violations | AA pass → AA pass |
| Clean ZIP | pass | `~/workspace/your_files/DAFQLY-v0.9.0-quiet-ledger-2026-11-13.zip` (819 files) — `git archive --format=zip` from the final commit, prefix `DAFQLY-v0.9.0-quiet-ledger/`; `unzip -t` clean ("No errors detected"); exclusions verified (0 files matching PROGRESS/EXECUTION_LEDGER/TESTING_EVIDENCE/node_modules/.next/test-results); clean-dir extraction check: `pnpm install` exit 0, `pnpm typecheck` exit 0, `pnpm lint` exit 0 | — |

Note on the full-e2e count: the final run (`/tmp/e2e-full3.log`, exit 0,
35 passed) is the root-script run (`pnpm test:e2e`: migrate +
`RESET_SEED=1` seed + 35 tests: 32 baseline + 2 en/404 + 1 axe). Two
intermediate full runs are also on record: 33/34 (`/tmp/e2e-full.log` —
the single failure was the stale `m0.spec.ts` `#101219` theme-color pin,
fixed by updating the expectation to the token navy-700 `#14243A`) and
34/34 (`/tmp/e2e-full2.log`, before the axe spec and the contrast/label
fixes were added).

## What was deliberately NOT changed (with reasons)

- No business logic, API contracts, routes, data-testids, i18n keys,
  auth, RLS, or reminder rules. The only test change is the `m0.spec.ts`
  theme-color expectation (`#101219` → `#14243A`, the token navy-700 the
  test's own name pins) and the two new specs (`quiet-ledger-en`,
  `axe`). The only a11y-attribute changes are `aria-label`s and text
  colour classes (no visual redesign beyond the intended palette, no
  behaviour change).
- The known non-EGP money defects (§Money formatting above) were FIXED
  on 2026-11-14 in the final verification pass (commit be36714), with
  regression tests — they were out of scope for the visual redesign, not
  left open.
- Sidebar overlay breakpoint stays 1024px (not 720px); content
  max-width 1200px; forecast chart keeps its 8-week SVG (recoloured);
  checkbox accent stays `accent-[var(--teal-600)]`. See DESIGN.md §14.
- `pnpm audit` was not run: the npm audit endpoint is unreachable from
  this VM (ECONNRESET, same as Prompt 08) — recorded as BLOCKED in
  Prompt 08, not re-attempted here.
