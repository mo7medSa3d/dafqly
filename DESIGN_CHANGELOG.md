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


---

# Yaseir Design Guide v2.1 Integration & System Completion — v1.0.0 (2026-11-09)

Complete visual and functional integration of **Yaseir Design Guide v2.1** (`https://ui.yaseir.site/`) across the entire system, plus fixes for all identified UI/UX and service flaws:

1. **Yaseir v2.1 Color Palette & Contrast (`packages/brand/tokens/tokens.json` & `tokens.css`):**
   - Primary UI Blue `#0953DE` (hover `#0742B2`), Ink `#101219`, Surface `#F6F7F9`, White `#FFFFFF`, Callout `#F4F8FF`, Muted Text `#5A606C`, Control Border `#7A8190`.
   - Secondary & Reserve Accents: Cyan `#00C7FC`, Yellow `#FFE451`, Pink `#F48CC0`, Violet `#6852AE`, Teal `#12716B`, Coral `#B84C3D`.
   - All 40 WCAG AA contrast pairs in `packages/brand/contrast.test.ts` verified passing (`>= 4.5:1` text, `>= 3.0:1` focus).
2. **Yaseir Typography, Sizes, Spacing & Capsule Components (`apps/web/src/components/ui.tsx`):**
   - Font stack led by `Thmanyah Sans` with `Plus Jakarta Sans` and `IBM Plex Sans Arabic`.
   - Page titles `32px–40px`, section titles `24px`, card titles `18px`, body `16px` (`line-height: 1.7`), controls & tables `14px`, footnotes `12px`.
   - Capsule/Pill buttons (`border-radius: 9999px`, `44px` standard height, `48px` hero height, `24px` horizontal padding).
3. **Purposeful Illustrations & Security Badges (`apps/web/src/components/illustrations.tsx`):**
   - Integrated Yaseir's `workspace-art.svg` (`HeroDashboardIllustration`), `finance-art.svg` (`ReceivablesIllustration`), `signin-art.svg` (`SecuritySignInIllustration`), and `SecurityLockBadge` using CSS token variables (zero hardcoded hexes).
   - Fixed standalone `mark-*.svg` viewBox (`540x512`) so the symbol's right stroke is never clipped.
4. **Bugs Fixed & Missing Features Completed:**
   - Fixed `listDebtorsPage` in `apps/web/src/server/services.ts` omitting `notes`, `phoneValid`, and `riskFlag` on initial load.
   - Fixed `scripts/check-secrets.mjs` crashing when run outside a git repository (`git ls-files` fallback to directory walk).
   - Replaced `window.prompt()` in `DebtorDetailClient.tsx` gateway refund flow with an inline custom-amount refund bar.
   - Added safe clipboard copy with fallback and visual confirmation in `DebtorDetailClient.tsx`.
   - Added inline **Edit Customer** (`trpc.debtors.update` for name, notes, riskFlag) in `DebtorDetailClient.tsx`.
   - Added `description` input and inline **Edit Invoice** (`trpc.invoices.update`) in `InvoicesClient.tsx`.
   - Added Subscription Invoices list (`trpc.billing.invoices`) in `BillingClient.tsx`.
   - Upgraded `AppShell.tsx` with Yaseir's collapsible sidebar (`272px` expanded / `80px` compact icon-only), top header breadcrumbs, security badge, and capsule language switcher (`العربية` / `English`).
   - Upgraded `AuthForm.tsx` with capsule tab switcher, password visibility eye toggle, `SecuritySignInIllustration`, and `SecurityNotice`.

---

# World-Class Mobile Navigation & Dedicated Settings/Billing Architecture (2026-11-10)

1. **Restored Signature Blue Hero Band (`apps/web/app/[locale]/dashboard/page.tsx`):**
   - Re-instated `.hero-band` with `brand-pattern`, `SecurityLockBadge`, and `HeroBandArt` vector illustration.
   - Live date badge, business name header, and direct actionable CTAs.
2. **Mobile Navigation Overhaul (`apps/web/src/components/AppShell.tsx`):**
   - Eliminated the cluttered 7-icon bottom bar on mobile screens.
   - Built a sleek vertical side rail navigation (`fixed inset-y-0 start-0 z-40 w-[64px]` on mobile, `w-[272px]` on desktop) with `ps-[64px]` main content offset, keeping the bottom of the screen completely clear.
   - Added direct navigation items for Billing and Settings.
3. **Dedicated Merchant Settings Suite (`apps/web/app/[locale]/settings/page.tsx` & `SettingsClient.tsx`):**
   - Company Profile (Arabic/English names, CR/Tax ID, timezone).
   - Invoicing & Currency (multi-currency selector: EGP, SAR, USD, AED, EUR, KWD; payment terms; export language).
   - WhatsApp & Automation (tone: polite vs. formal/firm, quiet hours window, Friday morning pause, auto-close on verified receipt).
   - Backups & Danger Zone (JSON backup, CSV downloads, safe account deletion).
4. **Dedicated Billing Dashboard (`apps/web/app/[locale]/billing/page.tsx`):**
   - Focused subscription and message quota management.
5. **Full-Width Edge-to-Edge Landing Page (`apps/web/app/[locale]/page.tsx`):**
   - Expanded to `max-w-[1600px] w-full px-4 sm:px-6 lg:px-10` matching modern international SaaS platforms.
6. **Robust Error Handling & Invoices Action Polish:**
   - Fixed tRPC error serialization (`apps/web/src/server/trpc.ts`) preserving numeric JSON-RPC error codes.
   - Filtered invoice transition buttons via `canTransition(status, target)` from `@tahseel/core`.
   - Replaced unstyled checkbox blocks with custom styled rounded checkboxes.

---

# Quiet Ledger redesign (2026-11-13, ADR-034)

Full visual redesign on top of the Yaseir v2.1 look, driven by DESIGN.md
(Stripe tables × Mercury calm × Ramp queues × Linear density). Zero
backend/business/API/schema/env changes; every screen consumes exactly the
data calls it consumed before; all data-testids preserved.

## Research limits (honest)

No Inspo MCP search was executed (Inspo v0.2.0 is an MCP server, not a
searchable CLI; no MCP client was available in this session). References
come from web search + text fetch of secondary extracts (SaaSFrame
dashboard guide, free tier; Mobbin NOT inspected — Pro paywalled). No
reference screenshots were viewed and no logged-in product was inspected.

## Tokens — the navy-vs-blue mismatch, resolved

`docs/BRAND_GUIDELINES.md` said primary navy #14243A + teal #27C7A5, but
`tokens.css` actually shipped primary blue #0953DE. Resolution (ADR-034):
navy #14243A is ink/identity (text, sidebar tile, mark, solid bands);
blue #0953DE is the single action accent (CTA/link/focus only); teal
#27C7A5 survives only inside the brand mark. Scales rewritten:
navy/teal/slate per the v0.8.0 guidelines values; semantic light/dark per
DESIGN.md §3; status pairs kept (light) / kept (dark). Radius sm 4 / md 8 /
lg 12 / xl 12; touch target 40px. `packages/brand/brand.ts` colours
updated to match (scatter keys removed). `docs/BRAND_GUIDELINES.md`
corrected to agree (contrast numbers recomputed, layout section rewritten).

## Contrast (recomputed 2026-11-13, suite-asserted)

Light: text/bg 14.66, text_muted/bg 4.71, text_subtle/bg 5.48,
primary_fg/primary 6.36, link/bg 5.96, focus/bg 5.96; statuses 5.23–7.04.
Dark: text/bg 16.33, text_muted/bg 8.84, text_subtle/bg 7.24,
primary_fg/primary 8.04, link/bg 8.04, focus/bg 8.04; statuses 6.93–11.78.
All ≥4.5 text / ≥3 focus. One real defect found and fixed in the pass: a
`text-status-paid-fg` (#12716B) label on the navy band computed ≈2.6:1 —
changed to white / `text-navy-200` on landing, auth, and statement headers.
No change to `packages/brand/contrast.test.ts` was needed (it reads
`tokens.json`; the "teal is never a text color" pin still holds).

## Primitives + shell (`ui.tsx`, `globals.css`, `AppShell.tsx`)

- Buttons 8px radius, 40px min-height, 16px padding; `btnSmall` 32px/4px.
  Panel 12px radius, border-first, no shadow; `.panel-shadow` reduced to a
  near-invisible hairline. StatusPill rectangular 4px. PageHeader 28px
  title + rectangular eyebrow. InitialAvatar 8px radius. EmptyState 12px.
- Deleted: `.hero-band`, `.brand-pattern`, `.brand-pattern-light`,
  `.yaseir-stage`, all `--yaseir-*` tokens and `@theme` mappings.
- Shell: sidebar 280px → 232px (collapsed rail 82px → 64px), nav rows
  42px → 32px, active state is callout bg + primary text + 2px start
  border (never a filled pill), content max-width 1600px → 1200px,
  page padding 24px. AI launcher rectangular, border-first, no glow/ring.
  Mobile overlay breakpoint stays 1024px (existing drawer + e2e
  single-nav-instance assertion) — see DESIGN.md §14.
- Mechanical sweep across all 30 app-code files: `rounded-full` → `rounded`
  (tiny status dots ≤10px kept), `rounded-3xl/2xl` → `rounded-xl`, shadow
  utilities removed, Tailwind emerald/amber/orange/red/violet/teal palette
  classes mapped to `status-*` tokens, `min-h-[44px/42px]` → 40px.

## Dashboard — genuine re-layout (same five server calls)

- Gradient hero band replaced by a plain header (eyebrow + date/timezone,
  28px title, subtitle, primary/ghost actions).
- 4-equal-KPI-card grid replaced by one headline figure (total outstanding
  at 40px + open-invoice/debtor counts + other-currency lines) over a
  hairline-divided 4-stat row (overdue in danger red only, collected,
  collection rate, DSO). All `kpi-*` testids preserved.
- Work-queue cards, forecast, aging, top debtors, reminder funnel keep
  their data and testids; restyled to the new discipline.

## Charts (`charts.tsx`)

Token-only colours. Forecast: expected = primary blue, conservative =
neutral slate-400 dashed (was paid-green). Aging severity ramp: current
slate-400 → 0–7 primary → 8–30 due → 31–60 overdue → 60+ navy-700.
Funnel: sent slate-400, delivered primary, replied due, paid paid-green.

## Illustrations (`illustrations.tsx`)

Redrawn two-tone (ink + single blue accent + neutral greys), same
exported names + props. Yellow/pink/violet/cyan scatter removed;
`--yaseir-*` references gone; `HeroBandArt` dots are now white tints
(on navy bands); the Receivables check disc uses the paid-status token.

## Screens pass

Landing (solid navy hero, white-on-navy primary CTA, max-width 1200px),
auth split (solid navy brand side), onboarding, settings, billing,
platform/ai-budget, all list clients (debtors, invoices, cheques, tasks,
import, ledger-photo, ai-inbox), debtor detail, public statement (solid
navy header, white pay-total button), error + new
404 in the same system (see below), command palette, AI copilot drawer,
notification bell — same components, same logic, new spacing/radius/colour
discipline.

**404 — two files by Next.js necessity (found by the e2e server log,
fixed same day):** the first redesign e2e run logged `TypeError: Cannot
destructure property 'locale' of undefined` 23 times from
`[locale]/not-found.tsx` (Next invokes it with `params` undefined on
some render paths) and unmatched URLs served Next's builtin 404. Fixes:
`[locale]/not-found.tsx` now takes optional `params` (default "ar") and
renders the shared `src/components/NotFoundContent.tsx` panel; a new
root `app/not-found.tsx` serves unmatched URLs — it renders without the
`[locale]` layout, so no stylesheet loads there, and it therefore renders
the same panel with inline styles whose values are imported from
`@tahseel/brand` tokens (never hardcoded), locale from the
`X-NEXT-INTL-LOCALE` request header the next-intl middleware sets, theme
from the `dafqly-theme` cookie. Verified by curl: `/ar/…` and `/en/…`
unknown paths return 404 with the correct translated copy, `lang`/`dir`,
and dashboard link, in light and dark; server log shows zero errors.
`apps/web/e2e/quiet-ledger-en.spec.ts` (new) covers landing/login/
dashboard in English (desktop 1440 + mobile 390) plus the 404 in both
locales. `m0.spec.ts` brand-wiring expectation updated #101219 → #14243A
(the test's own name pins "theme color is navy-700", and #14243A is the
token navy-700 — the manifest change was intentional in cb513e7).
`apps/web/e2e/axe.spec.ts` (new, `@axe-core/playwright` devDependency)
re-runs the axe gate on landing/login/dashboard/invoices.
Tables: sticky solid header + `overflow-x-auto` scroll container with a
`min-w-[560–720px]` floor on all five data tables; lists stay stacked
rows. Money formatting verified by reading (`money.ts`,
`CurrencyContext.tsx`): bigint minor units, per-currency exponents,
tenant-currency headlines + separate other-currency lines. Known
pre-existing non-EGP defects found by reading and NOT fixed (each needs a
logic change + tests): hardcoded `/100`/`*100` in `LedgerPhotoClient.tsx`
(L118, L274–275), `DebtorDetailClient.tsx` (L459),
`CollectionWorkspaceClient.tsx` (L81); `charts.tsx` `axisLabel` divides
by 100 (display-only).

## Logo SVGs + raster assets

- Recoloured to the token palette, geometry untouched:
  `logo/mark-color.svg` (D → #14243A, flow → #27C7A5, check → #27C7A5),
  `logo/mark-white.svg` (flow → #27C7A5), `logo/app-icon.svg`
  (tile → #14243A, flow → #27C7A5, check → #FFFFFF).
- Deleted: `logo/lockup-horizontal-rtl.svg` (unreferenced pre-rebrand
  petrol/brass asset Phase D meant to delete).
- Manifest: `packages/brand/public/manifest.webmanifest` theme
  #101219 → #14243A, background #F6F7F9 → #F6F8F7 (dynamic
  `app/manifest.ts` already reads both from `tokens.json`).
- Regenerated with `scripts/regenerate-brand-assets.mjs` (sharp 0.35.5
  from the pnpm store, no new dependency; re-runnable): og-image
  1200×630, six splash screens, favicon 16/32/48/64, apple-touch-icon
  180, icon 192/512/1024, maskable 192/512, whatsapp profile 640,
  favicon.ico (PNG-embedded 16/32/48), email header 1200×240; copies to
  `apps/web/public/icons/*`, `apps/web/app/favicon.ico`,
  `apps/web/app/icon.svg` (copy of the quiet `icons/app-icon.svg`),
  `apps/web/app/apple-icon.png`. Corner pixel of every navy asset
  verified RGB (20, 36, 58) = #14243A. Full asset table in DESIGN.md §12.

## Verification (this VM — see docs/REDESIGN_EVIDENCE.md)

- `pnpm lint` exit 0, `pnpm typecheck` exit 0 (final tree, `/tmp/lint4.log`,
  `/tmp/typecheck4.log`).
- Full unit/integration suite vs recorded baseline (HEAD b5471c3:
  525/525, e2e 32/32, build exit 0, axe-core 0 violations on 4 pages):
  **525/525, exit 0** (`/tmp/test-full4.log` — brand 40, templates 5,
  core 237, providers 40, db 32, eval 19, reminders 27, worker 1, web 124).
- Production build exit 0 via the documented e2e route
  (`E2E_FAKE_PROVIDERS=true PAYMOB_ALLOW_FAKE=true pnpm build`,
  `/tmp/build5.log`); plain `pnpm build` is BLOCKED in this VM by the
  pre-existing ADR-033 env guard (no real S3/AI credentials).
- Full e2e via the root script (`pnpm test:e2e`: migrate + `RESET_SEED=1`
  seed + tests): **35/35, exit 0** (`/tmp/e2e-full3.log`) — 32 baseline
  + 2 new EN/404 tests + 1 new axe test. Intermediate runs: 33/34 (stale
  `#101219` theme-color pin in `m0.spec.ts`, fixed to token navy-700
  `#14243A`), then 34/34 (`/tmp/e2e-full2.log`).
- `apps/web/e2e/redesign.spec.ts` (desktop 1440 + mobile 390, light/dark,
  landing/login/dashboard/invoices/debtors + mobile list pages + debtor
  detail + statement + onboarding) with fresh before/after screenshots;
  ar + en verified for landing/login/dashboard
  (`apps/web/e2e/quiet-ledger-en.spec.ts`).
- Axe-core re-run as a committed spec (`apps/web/e2e/axe.spec.ts`,
  `@axe-core/playwright` devDependency): **0 violations** on
  landing/login/dashboard/invoices — after fixing 1 contrast defect
  (locale-toggle 4.49:1) + 3 label-in-name mismatches the gate exposed,
  then 2 more contrast defects on the invoices page (muted text on
  solid muted/callout fills, 4.35/4.46:1). See DESIGN.md §10.
- 404 verified by curl + screenshots in ar/en, light/dark, with zero
  server errors (was: 23 `locale` destructure errors per run + Next's
  builtin 404).

## Final verification + optimization (2026-11-14)

Finisher pass on top of the Quiet Ledger base (`43b41b4` → `06cc98e`).
Full evidence: `docs/FINAL_VERIFICATION_EVIDENCE.md`.

- Rich synthetic dataset in a separate tenant (`pnpm db:seed:rich`,
  `97181e8`): 12 debtors, 32 invoices, 16 payments, 6 cheques, 6 promises,
  3 disputes, 14 reminders, 18 messages, 3 intents, 5 tasks, 1 statement
  link; login `rich@tahseel.test`; demo tenant untouched.
- F-06 money fixes (`be36714`): amounts in tenant/receipt currency
  (DebtorDetailClient, CollectionWorkspaceClient, ChequesClient, charts
  axisLabel, receipt summaries); LedgerPhoto `/100` is EGP-by-design.
- Promise button NaN fix (`ddbd691`): disabled for unparseable amounts.
- **Real bug found by the exploratory spec and fixed (`6c82fa7`):**
  `createMerchantPromise` / `decidePromiseToPay` returned raw rows with a
  bigint `amountMinor`; tRPC has no transformer, so the HTTP response
  failed with "Do not know how to serialize a BigInt" (500) while the row
  WAS created — the UI showed an error and a retry duplicated the promise.
  Both now return the `listPromisesToPay` serialization; regression
  assertions in journeys test D; verified over HTTP (200, `"75000"`).
- Exploratory spec (`apps/web/e2e/exploratory.spec.ts`, 13 tests) green
  after fixing 4 spec bugs (forecast not-enough state, payment-row race,
  invoices form-is-always-visible + submit-by-testid, copilot Ask-tab
  Enter) and documenting that the server invoice search matches
  reference/description only.
- Dead code: `toInvoiceView` unexported, unused deps/exports/scripts
  removed, `localDateOf` re-export + `better-auth` in `packages/db`
  removed (`06cc98e`); knip now flags only entry-point scripts + the
  exceljs false positive.
- Final numbers: lint 0, typecheck 0, unit+integration **527/527**,
  production build exit 0 (First Load JS shared **102 kB**, 40/40 pages),
  full e2e **48/48**, axe **0 violations**. Plain `pnpm build` still
  BLOCKED (ADR-033); `pnpm audit` still BLOCKED (ECONNRESET).
- A VM restart mid-pass (~03:04 EET) wiped `/tmp` logs, Postgres, global
  pnpm, the `pgtest` user and `.next`; the environment was recovered and
  the whole chain was re-run from complete logs stored in
  `~/workspace/dafqly-work/final-verification-logs/`.

## 2026-11-14 — Indigo Ledger palette
- Replaced the blue/navy palette with deep-indigo ink + indigo action accent; light/dark re-tuned as a pair (all text pairs >= 4.5:1, verified).
- Status colours: emerald / amber / red / violet / indigo, stronger fg-on-bg.
- Shared primitives (ui.tsx): focus rings, button depth + press state, panel depth, status ring, dashed empty state.

- Icons: replaced Phosphor with lucide-react (shadcn/ui default). Local identifiers keep their old names via `import { Search as MagnifyingGlass }` aliasing; WhatsApp mark is a custom SVG (ui/icons.tsx). Supersedes the 2026-11 "filled icons" note above.

- All remaining raw buttons/fields converted to shadcn variants (added variants: soft, success, dangerSoft; sizes: xs, iconSm). Menu rows, tab/filter chips and icon buttons now use buttonVariants with state-driven variants.
