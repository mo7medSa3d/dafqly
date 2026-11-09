# DESIGN_CHANGELOG — DAFQLY visual rebrand

Visual rebrand only. No backend/business/API/auth/DB/env/package-name changes; internal identifiers (`@tahseel/*`, `tahseel.test` seed emails, DB/env names) stay.

## Phase A — Audit (before any change)

- **Stack:** Next 15.5 App Router, Tailwind v4 (`@theme inline` in `apps/web/app/globals.css` mapping CSS vars from `packages/brand/tokens/tokens.css`), next-intl ar/en with RTL, tRPC, Playwright e2e, pnpm monorepo.
- **Routes/screens:** `[locale]`: landing (`page.tsx`, previously redirect-only), login, signup, onboarding, dashboard, debtors (+detail), invoices, import, ledger-photo, ai-inbox, cheques; public `/s/[token]` statement (own root layout in `app/s/layout.tsx`).
- **Old-brand inventory:** `packages/brand/tokens/tokens.json` + `tokens.css` (petrol/brass/paper), `apps/web/src/components/BrandMark.tsx`, `packages/brand/public/manifest.webmanifest`, messages `app.name` (ar "تحصيل" / en "Tahseel"), `[locale]/layout.tsx` + `s/layout.tsx` metadata/viewport (petrol), `StatementClient.tsx` footer "عبر تحصيل", `apps/web/src/server/auth.ts` `appName: "Tahseel"` (Better Auth display name shown in auth emails/UI chrome — changing the display string to DAFQLY is user-facing text, not an identifier; done, noted here), `apps/web/src/server/billing.ts` `"Tahseel tenant"` (fake-provider placeholder name — changed to "DAFQLY tenant", noted here).
- **Test commands:** `pnpm lint`, `pnpm typecheck`, `REQUIRE_DB_TESTS=1 pnpm test`, `pnpm eval`, `pnpm build`, migration drift check, `pnpm test:e2e`.

## Phase B — Brand config

- `packages/brand/brand.ts`: `BRAND` central config (name/nameAr DAFQLY, taglines EN/AR, descriptionAr, colors, logo paths); exported as `@tahseel/brand/brand` (new `./brand` export).
- `tokens.json` brand names → DAFQLY; messages ar/en `app.name` → "DAFQLY"; layouts metadata from `BRAND`; manifest name/short_name "DAFQLY", description from BRAND, theme_color `#14243A`, background_color `#F6F8F7`.

## Phase C — Tokens + contrast

- Scales rewritten exactly per rebrand spec: navy (anchored `#14243A`), teal (anchored `#27C7A5`), slate; light/dark semantics per spec; status pairs kept except partial → light `#175CD3`/`#E3EDFB`, dark `#8FB6F9`/`#16283F`.
- **Contrast adjustment recorded:** kit slate `#697989` as light text_muted computes 4.19:1 on bg (fails AA); darkened to `#5F7183` per kit rule. Light `text_subtle` is `#556777` (5.48:1).
- Radius: `--radius-sm 8px, --radius-md 10px, --radius-lg 12px, --radius-xl 16px`.
- `tokens.css`: vars renamed `--petrol-*`→`--navy-*`, `--brass-*`→`--teal-*`, `--paper-*`→`--slate-*`; `--font-brand` now Plus Jakarta Sans / IBM Plex Sans Arabic stack. Structure (dark media + `[data-theme]` + reduced-motion) preserved.
- **Brand-test change 1 — `contrast.test.ts`:** removed the `it.fails` ADR-010 defect pin (new `text_subtle` passes strictly — ADR-010 defect closed by the rebrand palette); "brass is never a text color" → "teal is never a text color" using `color.teal["400"]`. Justification: the test encoded the old brand/defect, not business behaviour.

## Phase D — Logo + icons

- Symbol refined from `dafqly-kit/brand/logo/dafqly-symbol-concept.svg` (stroke D + teal flow + check; geometry kept, check stroke bumped 38→44 for 16px legibility, round caps/joins) → `packages/brand/logo/`: `mark-color.svg` (navy+teal), `mark-mono.svg` (currentColor), `mark-white.svg` (white+teal), `lockup-horizontal.svg` + `lockup-stacked.svg` (symbol + "DAFQLY" text with `font-family="Plus Jakarta Sans, sans-serif"` weight 700 — SVG `<text>` is font-dependent, noted), `app-icon.svg` (symbol on navy rounded square; full-bleed variant in `icons/`).
- `BrandMark.tsx` artwork replaced with the new symbol (viewBox 0 0 512 512, strokes `var(--navy-700)`/`var(--teal-400)`/white/currentColor per variant, aria-label "DAFQLY").
- Rasterized with sharp 0.35.5 from the pnpm store (script, not a new dependency): `packages/brand/icons/png/` favicon-16/32/48/64, apple-touch-icon-180, icon-192/512, icon-maskable-192/512 (navy bg + padding), icon-1024; PNG-embedded `favicon.ico` (16/32/48); copies to `apps/web/public/icons/*`, `apps/web/app/favicon.ico`, `apps/web/app/icon.svg`, `apps/web/app/apple-icon.png`.
- Deleted (replaced): old `logo/lockup-horizontal-rtl.svg`, old `preview/brand-sheet.png` (old-brand sheet — removed), `icons/png/whatsapp-business-profile-640.png` (old mark). Old mark/lockup/app-icon SVGs were overwritten in place with the new artwork.

## Phase E — Fonts

- Added to `@tahseel/web`: `@fontsource/plus-jakarta-sans`, `@fontsource/ibm-plex-sans-arabic`, `motion`. Weights imported in `[locale]/layout.tsx` (Jakarta 400/500/600/700/800; Plex Arabic 400/500/600/700) and the `/s` root layout (400/700).
- `apps/web/src/lib/brand.ts` rewritten: SIL OFL fonts ON by default; `brandFontEnabled = process.env.NEXT_PUBLIC_BRAND_FONT !== "off"` (flag kept as opt-out kill switch; supersedes ADR-003 Thmanyah logic). `.env.example` updated (`=on` + comment). Core env schema default stays "off" (unchanged config plumbing). Thmanyah OTFs on disk untouched.
- **Brand-test change 2 — `apps/web/src/lib/brand.test.ts`:** flag semantics inverted (undefined/"yes" now true, "off" false). Justification: encodes the old Thmanyah opt-in brand policy, superseded by ADR-025.

## Phase F — Screens pass

- Grep for old hexes (`#154E5B,#1A6070,#237787,#EEAC32,#F7F7F5`, case-insensitive) outside `packages/brand`/`.next`: only the M0 e2e brand test (updated, see Phase I) — all screens already render on tokens.
- `scripts/check-no-hardcoded-brand.mjs`: `fontNameRe` also rejects "Plus Jakarta Sans"/"IBM Plex Sans Arabic" hardcoded in app code (font names live in tokens.css only); hex check kept.
- Statement page: `s/layout` metadata → DAFQLY; `StatementClient` footer → `BRAND.name` via `@tahseel/brand/brand` import.

## Phase G — Illustrations

- `apps/web/src/components/illustrations.tsx`: original inline SVGs, CSS vars only, aria-hidden, no text: EmptyInvoices, PaymentSuccess, Onboarding, ConnectionError, HeroDashboard.
- Wired: dashboard empty state (EmptyInvoices), statement payments-empty area (PaymentSuccess), onboarding welcome/first step (Onboarding), new `app/[locale]/error.tsx` (ConnectionError + retry button — visual addition, noted; no error surface existed), landing hero (HeroDashboard).

## Phase H — Motion

- `apps/web/src/components/motion.tsx`: client `Reveal` using `motion/react` (fade + y 8px, 0.35s, once) + `useReducedMotion` disabling the transform. Used on landing hero/sections, dashboard container, cheques page. Kept out of tables/forms.

## Phase I — Landing page

- `app/[locale]/page.tsx` rewritten: session → existing redirect logic unchanged; logged out → landing (server component): header (BrandMark + DAFQLY + login/signup), hero (locale tagline/supporting line, CTAs with `data-testid` landing-cta-signup / landing-cta-login), HeroDashboardIllustration, 3-step workflow strip (invoice → reminder → payment, real workflow, no invented claims), simple footer. Messages keys `landing.*` added in ar/en.
- E2E entry check: all specs go directly to `/ar/login` or `/ar/signup`; none goto `/` or `/ar` expecting a login redirect — no spec entry changes needed.
- **Brand-test change 3 — `apps/web/e2e/m0.spec.ts` brand test:** theme `#14243A`, `data-brand-font` "on", manifest name "DAFQLY". Justification: encodes old brand values.
- New `apps/web/e2e/rebrand.spec.ts`: landing CTA flow + screenshots `dafqly-landing-light/dark`, `dafqly-landing-en-light`, `dafqly-login-light/dark`, `dafqly-dashboard-light/dark` into `apps/web/e2e/screenshots/`.

## Phase J — Docs

- `docs/BRAND_GUIDELINES.md` (final implemented guidelines), `docs/BRAND.md` superseded banner, `docs/DECISIONS.md` ADR-025, `docs/PROGRESS.md` rebrand section, root version → 0.8.0.

## Unimplemented / intentional remnants

- Legal drafts `docs/legal/*`, PROGRESS/DECISIONS history, seed emails (`tahseel.test`), `@tahseel/*` package names, DB/env names: intentionally unchanged (internal identifiers / historical record).
- Lockup SVGs use live SVG `<text>` (font-dependent) rather than outlined paths — noted in Phase D.
- OG/splash/email assets beyond the icon set: not produced (same standing as M6; font-dependent outlined assets remain a human/design task).

## Gate results (2026-11-09, this VM)

- `pnpm lint` green (incl. brand + secrets scans).
- `pnpm typecheck` green (all projects).
- `REQUIRE_DB_TESTS=1 pnpm test` **352/352** (brand 40, templates 5, core 160, providers 24, db 22, eval 19, reminders 20, worker 1, web 61) — same total as M6; the brand suite count is unchanged because the removed `it.fails` pin was a counted test now asserted strictly.
- `pnpm eval` green (all SYNTHETIC targets; F12 backtest MAE 1250/week).
- `pnpm build` green (incl. landing at `/[locale]`, `/[locale]/error`).
- Migration drift: "No schema changes" — no drift, as expected (no DB changes).
- `pnpm test:e2e` **18/18** (previous 16 + 2 new rebrand tests) on a reset+migrated+seeded DB. First run was 17/18: the local gitignored `.env` still carried `NEXT_PUBLIC_BRAND_FONT=off`; the local dev env was flipped to `on` (matching the new `.env.example` default) and the full e2e was re-run green. Screenshots regenerated incl. `dafqly-landing-light.png`, `dafqly-landing-dark.png`, `dafqly-landing-en-light.png`, `dafqly-login-light.png`, `dafqly-login-dark.png`, `dafqly-dashboard-light.png`, `dafqly-dashboard-dark.png`.
- Environment note: Postgres/Redis were stopped with an empty cluster at session start; recovered natively (cluster started, `tahseel` superuser role + DB recreated per docker-compose defaults, migrate+seed re-run) — no repo changes resulted.

---

# Premium redesign — v0.9.0 (owner directive 2026-11-09, ADR-026)

Full visual redesign on top of the v0.8.0 DAFQLY rebrand. Zero backend/business/API/schema/env changes; every screen consumes exactly the data calls it consumed before. Branch `redesign/premium-dashboard`.

## Audit findings that shaped the work

- The pre-redesign app was a single centered `max-w-3xl` column on every screen: chip-style text nav, uniform bordered cards, no whitespace system, no icons anywhere.
- `lucide-react` was a declared dependency of @tahseel/web but was imported by **zero** files — there was no icon set in use to "convert". `@phosphor-icons/react` (MIT) at `weight="fill"` is now the single icon library (owner's filled-icons directive overrides the kit's Lucide note); `lucide-react` was removed from the manifest.
- Screens inventory redesigned: dashboard, invoices, debtors, debtor detail, import, ledger-photo, ai-inbox, cheques, login/signup, onboarding, public statement, landing, error — plus the shared shell itself.

## Design system additions

- `apps/web/src/components/ui.tsx`: Panel (titled surface w/ icon chip + actions), PageHeader, StatusPill (filled icon + label on the semantic status tokens — never color alone), InitialAvatar, EmptyState, BackLink, shared input/button class strings. All colors via tokens; `globals.css` gained @theme mappings for the full status set + navy/teal/slate scales, a `.panel-shadow` elevation, `.brand-pattern` / `.brand-pattern-light` dot patterns, and the `.hero-band` navy gradient — all `var()`/`color-mix` only, no raw values.
- Icon mapping (semantic spots, all Phosphor `fill`): nav — SquaresFour (dashboard), Users (debtors), Receipt (invoices), FileArrowUp (import), Notebook (ledger-photo), Robot (AI inbox), Checks (cheques); actions/statuses — Plus, MagnifyingGlass, SignOut, DownloadSimple, Trash, WarningCircle, CheckCircle, Clock, Coins, XCircle, Prohibit, HandCoins, Wallet, LinkSimple, FileText, PaperPlaneTilt, Camera, UploadSimple, BellRinging, Gauge, ArrowUp, ArrowsClockwise, ArrowLeft (RTL-flipped back links). Sizes: 21px nav, 17–19px inline/panel, 13px inside pills.

## App shell (`AppShell.tsx`, replaces `AppNav.tsx`)

- ONE nav DOM instance, morphing by CSS: desktop ≥1024px = fixed 268px sidebar (navy-tile lockup + tagline, nav list with active pill in the primary token, tenant footer with avatar + logout); mobile = sticky top bar (mark, brand, tenant, logout) + fixed bottom nav (icon + label, active teal chip) with safe-area padding and 112px content clearance. Single instance is deliberate: every `nav-*` testid exists exactly once per viewport (asserted by the new e2e spec).
- Content: `max-w-6xl`, 16/24/40px horizontal rhythm, 24px (mobile) / 32px (desktop) section gaps — replaces the uniform `max-w-3xl p-6 gap-6` column that left most of a desktop viewport empty.

## Dashboard — genuine re-layout (same three server calls)

- **Header band:** navy gradient + dot pattern + `HeroBandArt` motif; business name, page title, tenant-local date, and the two primary actions (new invoice → invoices, import) as accent/ghost-on-dark buttons.
- **Composed KPI summary:** one panel split into a hero block (total outstanding at 38–44px, open-invoice and debtor counts) and a hairline-divided 2×2 stat grid (overdue — red when > 0, collected this month, collection rate, DSO). Replaces five identical floating cards + three more in a second card row.
- **Content region (2fr/1fr on desktop, priority order on mobile):** forecast panel with a real SVG grouped-bar chart (expected vs conservative from the existing F12 weeks; the honest not-enough-data state now carries the Forecast illustration), aging panel as a stacked composition bar + legend from the existing F11 buckets (previously one line of inline text), top-debtors as an avatar list linking to debtor detail. Side rail: reminder performance (2×2 stats), plan/quota panel with a usage progress bar drawn from the same quota numbers, CSV exports panel, danger zone.
- All previous dashboard testids preserved (`dashboard`, `kpi-*`, `perf-sent`, `reports`, `forecast`, `forecast-not-enough`, `empty-state`, `quota-banner`, `upgrade-*`, `export-*`, `danger-zone`, `delete-*`).

## Other screens

- **Invoices:** create form in a titled Panel (icon + two-column fields); filter bar with search icon; bulk bar with live count; the list is one divided surface — rows with status pill (icon + label), overdue flag, amounts in tabular numerals, transition actions as small pills. Empty state uses EmptyInvoices illustration.
- **Debtors:** create Panel; search with icon; divided list rows with initial avatar, phone with filled Phone icon, opted-out badge, view action with directional arrow.
- **Debtor detail:** identity + balance strip (outstanding/credit as a divided stat band), record-payment Panel with allocation rows, gateway-links Panel (divided link rows + reconciliation strip), statement-links Panel (teal success box for a new link, dispute list on disputed tokens), invoices and payments as divided lists with status pills, and the activity history rebuilt as a real vertical timeline (icon nodes per event kind: payment/message/other).
- **Import:** dropzone panel with the new Import illustration; preview in a Panel with stat line, mapping grid, and a proper table (header band, row rhythm, status pills); jobs as a divided list.
- **Ledger photo:** dropzone panel; review table with header band, token-tinted low-confidence cells (filled warning icon + label, no emoji), suggestion pills; commit in a panel footer.
- **AI inbox:** receipt upload Panel with dropzone; claims as avatar rows with amount + confirm/reject actions; intents as divided rows with intent chip + confidence.
- **Cheques:** registration Panel with a photo dropzone (prefill behaviour unchanged); alerts Panel with run action; list as divided rows (status pill, direction chip, lifecycle pills); calendar as week panels. Empty state uses the new Cheques illustration.
- **Auth:** split layout — navy brand side on desktop (pattern, HeroBandArt, tagline) + form side; mobile keeps a navy mark tile. Form logic/testids untouched.
- **Onboarding:** card-based wizard with a real stepper (numbered → check nodes, progress track), selectable tone cards, styled consent block.
- **Statement (public):** navy brand band header carrying business, debtor and the total-due hero + pay-total action; invoices/payments as divided surfaces with status pills; payments empty state keeps PaymentSuccess illustration.
- **Landing:** navy hero band (pattern, tagline at display size, CTAs, HeroBandArt), product motif on a light patterned stage, numbered step panels, same real copy — no invented claims.
- **Error:** message in a proper panel with the connection illustration + icon retry.

## Illustrations & depth

New original token-only SVGs in `illustrations.tsx`: `HeroBandArt` (dashboard motif for dark bands), `ForecastIllustration` (forecast empty state), `ChequesIllustration` (cheques empty state), `ImportIllustration` (import dropzone). Existing five illustrations unchanged. Depth comes from the hero bands, dot patterns, panel elevation and divided-list composition — not from stacking more cards.

## Missing brand assets — completed

- **Outlined wordmark:** `packages/brand/logo/wordmark-horizontal-outlined.svg`, `wordmark-horizontal-reversed-outlined.svg`, `wordmark-stacked-outlined.svg` — real glyph paths via opentype.js 1.3.4 from the OFL Plus Jakarta Sans woff shipped in @fontsource (weight 800 wordmark / 600 tagline, kerning on, spacing 0); verified 0 `<text>` elements in each; symbol geometry copied unclipped from the mark. The font-dependent live-text lockups from v0.8.0 remain for in-app use.
- **OG image:** `apps/web/public/og-image.png` (1200×630, sharp-rendered: navy, reversed outlined lockup + tagline as paths, subtle pattern); wired as `og:image`/twitter in `[locale]/layout.tsx` metadata with `metadataBase` from `APP_URL`.
- **Splash:** six `apple-touch-startup-image` PNGs (750×1624 … 1290×2796) in `apps/web/public/splash/`, wired via `appleWebApp.startupImage` media queries in the same layout.
- **Email header:** `packages/brand/email/email-header.png` (1200×240) + `email-header.html` (table snippet; notes the absolute-URL/CID requirement) + `README.md`. Asset + documentation only — no transactional email module exists in the codebase and none was invented.
- Asset paths recorded in `BRAND.assets` (packages/brand/brand.ts). Side finding (recorded, not fixed — brand geometry is the owner's): the standalone `mark-*.svg` 512 viewBox clips the symbol's right stroke (~529 units); the new assets embed the paths unclipped.

## Motion

Sections use the shared `Reveal` wrapper, reimplemented during this redesign as **pure CSS keyframes** (`.reveal` in globals.css): the motion/react version SSR-rendered `opacity: 0` until hydration, which blanked landing sections in early captures and risked a hidden-content flash for reduced-motion users; the CSS version animates from first paint, needs no JS, and collapses to instant under `prefers-reduced-motion` via the existing token rule. The `motion` package was removed (Reveal was its only consumer). Nav/buttons use token-duration CSS transitions; transform/opacity only; Playwright contexts for screenshots set reducedMotion=reduce.

## Verification (this VM)

- BEFORE baseline: 30 screenshots captured pre-change on a freshly seeded DB (`apps/web/e2e/screenshots/redesign/before-*.png`, force-added past the screenshots gitignore as comparison evidence).
- AFTER: `apps/web/e2e/redesign.spec.ts` (new) re-captures the paired set (`after-*.png`) inside the normal e2e run and asserts: exactly one instance of every `nav-*` testid, and no horizontal overflow (scrollWidth − clientWidth ≤ 1) on dashboard/invoices/debtors/import/ledger-photo/ai-inbox/cheques/debtor-detail/statement at 390px.
- AFTER dashboard/inspection note: with the demo seed the forecast is honestly in its not-enough-data state (< 10 paid invoices) — the chart itself renders from the same component whenever `enoughData` is true; no data was fabricated for screenshots.
- Gate: lint green (brand + secrets scans), typecheck green (all projects), REQUIRE_DB_TESTS=1 unit tests 352/352 (identical total; NO test changed in this redesign — the only e2e changes are the additive redesign.spec.ts), eval green, build green, migration drift "No schema changes", e2e — see PROGRESS.md for the final count.
