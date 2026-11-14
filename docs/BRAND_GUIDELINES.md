# DAFQLY — Brand Guidelines (implemented, v0.9.0 + Quiet Ledger redesign 2026-11-13)

Final implemented guidelines for the DAFQLY rebrand (ADR-025), the v0.9.0 premium redesign (ADR-026), and the Quiet Ledger redesign (ADR-034, DESIGN.md). Where this file and DESIGN.md disagree on UI, DESIGN.md wins; this file remains authoritative for logo-asset usage. Candidate name: trademark/domain clearance is pending on the owner; brand strings are centralized in `packages/brand/brand.ts` (`BRAND`) so they can change without code-wide edits.

- **Name:** DAFQLY (EN and AR display)
- **Tagline:** Track. Follow. Get Paid. / تتبّع. تابع. وحصّل.
- **Supporting line:** Smarter Receivables. Better Cash Flow. / منصة إدارة المستحقات والتحصيل

## Color tokens (final)

Scales: navy 50 `#EEF2F6` 100 `#D8E1EA` 200 `#B3C3D4` 300 `#84A0B9` 400 `#55708D` 500 `#354C66` 600 `#22344D` 700 `#14243A` 800 `#0F1B2D` 900 `#0B1522` 950 `#070F18`; teal 50 `#E7FAF4` 100 `#C9F3E7` 200 `#97E7D2` 300 `#5FDDBE` 400 `#27C7A5` 500 `#17AB8A` 600 `#0F8A6E` 700 `#0C6B57` 800 `#0A5747` 900 `#084739`; slate 50 `#F6F8F7` 100 `#EAF0EE` 200 `#E3EAE8` 300 `#C4D0CC` 400 `#93A5B4` 500 `#697989` 600 `#556777` 700 `#46586A` 800 `#2E3D4D` 900 `#1E2B3A` 950 `#121D29`.

**Navy-vs-blue resolution (ADR-034, settles the old mismatch):** navy
`#14243A` is ink/identity (text, sidebar tile, brand mark, solid bands);
blue `#0953DE` is the single action accent (primary CTA, link, focus —
never a background or gradient). Teal `#27C7A5` survives only inside the
brand mark. The Yaseir scatter accents (yellow/pink/violet/cyan/coral)
are removed.

Semantic light: bg `#F6F8F7`, surface `#FFFFFF`, surface_muted `#EAF0EE`, border `#E3EAE8`, border_strong `#93A5B4`, text `#14243A`, text_muted `#5F7183`, text_subtle `#556777`, primary `#0953DE`, primary_hover `#0742B2`, primary_fg `#FFFFFF`, accent `#0953DE`, accent_fg `#FFFFFF`, link `#0953DE`, focus `#0953DE`.
Semantic dark: bg `#0B1522`, surface `#14243A`, surface_muted `#1B2F47`, border `#24344D`, border_strong `#33465F`, text `#EDF3F1`, text_muted `#A7B6C2`, text_subtle `#93A5B4`, primary `#84ACF5`, primary_hover `#A8C4F8`, primary_fg `#0B1522`, accent `#84ACF5`, accent_fg `#0B1522`, link `#84ACF5`, focus `#84ACF5`.

Radius: sm 4px, md 8px, lg 12px, xl 12px. Teal is never a text color. Status colors are semantic tokens (see `tokens.json`): light paid `#12716B`/`#E6F6F3`, due_soon `#854D0E`/`#FEF3C7`, overdue `#B42318`/`#FEE4E2`, disputed `#593E9E`/`#F1EEFA`, partial `#0953DE`/`#EAF2FF`, draft `#4F5663`/`#EEF2F7`; dark paid `#5EEAD4`/`#0D2B29`, due_soon `#FDE047`/`#2E2210`, overdue `#FCA5A5`/`#331616`, disputed `#C4B5FD`/`#231B3D`, partial `#84ACF5`/`#122240`, draft `#B0B8C5`/`#1A1D26`.

### Contrast results (suite-computed, WCAG — recomputed 2026-11-13)

Light: text/bg 14.66, text/surface 15.63, text/surface_muted 13.55, text_muted/bg 4.71, text_muted/surface 5.03, text_subtle/bg 5.48, text_subtle/surface 5.85, primary_fg/primary 6.36, primary_fg/primary_hover 8.64, accent_fg/accent 6.36, link/bg 5.96, link/surface 6.36, focus/bg 5.96, focus/surface 6.36; statuses 5.23–7.04.
Dark: text/bg 16.33, text/surface 13.92, text/surface_muted 12.10, text_muted/bg 8.84, text_muted/surface 7.53, text_subtle/bg 7.24, text_subtle/surface 6.17, primary_fg/primary 8.04, primary_fg/primary_hover 10.41, accent_fg/accent 8.04, link/bg 8.04, link/surface 6.85, focus/bg 8.04, focus/surface 6.85; statuses 6.93–11.78.
All pairs pass AA (≥4.5 text, ≥3 focus). Verified by `packages/brand/contrast.test.ts`.

## Typography

Plus Jakarta Sans (Latin) + IBM Plex Sans Arabic (Arabic), SIL Open Font License 1.1, self-hosted via @fontsource; stack in `tokens.css` `--font-brand` only. Never apply letter-spacing to Arabic. Tabular numerals for amounts.

## Logo assets

`packages/brand/logo/`: mark-color.svg, mark-mono.svg, mark-white.svg, lockup-horizontal.svg, lockup-stacked.svg (live SVG text, font-dependent), app-icon.svg. `packages/brand/icons/`: favicon.svg, favicon.ico (PNG-embedded 16/32/48), app-icon.svg, app-icon-fullbleed.svg, png/ (favicon-16/32/48/64, apple-touch-icon-180, icon-192/512, icon-maskable-192/512, icon-1024). Symbol: stroke D + teal flow + check; clear space ≥¼ symbol width; never stretch/rotate/recolor outside the approved variants.

**Outlined lockups (v0.9.0, font-independent — real glyph paths, no `<text>`):** `packages/brand/logo/wordmark-horizontal-outlined.svg` (color), `wordmark-horizontal-reversed-outlined.svg` (white/teal for dark backgrounds), `wordmark-stacked-outlined.svg` (symbol + wordmark + tagline). Generated with opentype.js from the OFL Plus Jakarta Sans (wordmark 800, tagline 600). Use these wherever the brand font may be absent (OG, email, print, third-party embeds). Known note: the standalone mark SVGs' 512 viewBox clips the symbol's right stroke (~529 units); the outlined lockups embed the paths unclipped.

**Social / splash / email (v0.9.0):** OG image `apps/web/public/og-image.png` (1200×630; navy, reversed outlined lockup, tagline; wired via layout `openGraph`/`twitter` metadata). iOS splash images `apps/web/public/splash/splash-*.png` (750×1624, 828×1792, 1080×2340, 1170×2532, 1242×2688, 1290×2796; navy + centered mark; wired via `appleWebApp.startupImage`). Email header: `packages/brand/email/email-header.png` (1200×240) + `email-header.html` snippet + usage README (sent mail must reference an absolute HTTPS URL or a CID embed).

## Icon system (v0.9.0)

One library only: **@phosphor-icons/react at `weight="fill"`** — solid, filled glyphs everywhere (navigation 21px, inline/panel 17–19px, pills 13px). No outline icon sets, no emoji icons, no mixing libraries (owner directive; ADR-026 records the deviation from the kit's Lucide note — lucide-react was in fact declared but never imported, and has been removed). Status is always icon + text on the semantic status tokens, never color alone.

## Layout system (v0.9.0)

App shell: desktop sidebar (232px; lockup, filled-icon nav with callout + start-border active state, tenant footer; collapsed icon rail 64px) that morphs into a mobile top bar + overlay drawer — one DOM instance at every viewport. Content max width 1200px, section gaps 24px, page padding 24px, panels are 12px-radius bordered surfaces (border-first, no shadow — `.panel-shadow` is a near-invisible hairline kept for legacy callers); header zones are solid navy (`bg-navy-700`), never a gradient — `.hero-band`, `.brand-pattern`, and `.yaseir-stage` are deleted. Lists are divided surfaces (hairline `border` dividers, tabular numerals) rather than stacks of individual cards; data tables are full-width bordered tables with a sticky header. Shared primitives live in `apps/web/src/components/ui.tsx` (Panel, PageHeader, StatusPill, InitialAvatar, EmptyState, BackLink).

## Motion policy

`Reveal` (pure CSS keyframes, `motion.tsx`): fade + 8px rise, 350ms, once per section; `prefers-reduced-motion` disables transforms (tokens.css also collapses durations). No perpetual motion, no motion on tables/forms critical paths, never delay navigation/submission for animation.

## Illustrations

`apps/web/src/components/illustrations.tsx` — original inline SVGs, CSS vars only, `aria-hidden`, no embedded text (alt text is therefore empty/decorative; surrounding HTML carries the meaning): EmptyInvoicesIllustration (dashboard empty state), PaymentSuccessIllustration (statement payments area), OnboardingIllustration (onboarding first step), ConnectionErrorIllustration (`[locale]/error.tsx` and `[locale]/not-found.tsx`), HeroDashboardIllustration (landing hero). v0.9.0 additions: HeroBandArt (motif on navy bands — auth brand side, landing hero), ForecastIllustration (forecast not-enough-data state), ChequesIllustration (cheques empty state), ImportIllustration (import dropzone). Quiet Ledger redraw (2026-11-13): all illustrations are two-tone (ink + single blue accent + neutral greys); the yellow/pink/violet/cyan scatter is removed.
