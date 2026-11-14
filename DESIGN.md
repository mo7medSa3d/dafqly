# DESIGN.md — DAFQLY "Quiet Ledger"

Visual direction for the whole app. This file is the authority for look and
feel; `docs/BRAND_GUIDELINES.md` carries the brand-asset rules that agree
with it. If the two disagree, this file wins for UI and the guidelines win
for logo-asset usage.

## 1. Direction — why

Receivables work is a queue, not a gallery. The previous look (Yaseir v2.1:
blue #0953DE backgrounds and gradients, pill buttons, a 4-equal-KPI-card
grid, yellow/pink/violet/cyan scatter illustrations) made every screen shout
at the same volume, so nothing read as urgent and nothing read as calm.

Quiet Ledger (Stripe tables × Mercury calm × Ramp work queues × Linear
density) inverts that:

1. **One number, then the queue, then the table.** The dashboard opens with
   a single headline figure (total outstanding), a hairline-divided stat row,
   then the day's collection work, then dense tables. No 4–6 equal KPI-card
   grid.
2. **Colour means status or action only.** One strong indigo action accent
   (#4338CA light / #8B9CFF dark, CTA/link/focus duty only — never a background, gradient, or
   fill). Green/amber/red/violet appear only as aging/status semantics with
   a text label, never as card fills or gradients.
3. **Tables are the product; cards are the exception.** Full-width bordered
   tables, sticky 12px uppercase header, 44px rows, tabular numerals,
   right-aligned amounts, hover row; rectangular 4px status badges, not
   pills. Sectioned lists + hairline dividers; borders, not shadows, for
   elevation.
4. **Compact, Arabic-first type.** 8px base scale, 28–32px nav rows,
   32–40px controls, page padding 24px, content max-width 1200px, sidebar
   232px. One Arabic-capable family, tabular numerals throughout; hierarchy
   from size/weight, never colour.
5. **Polite-collections copy as a design token.** Every queue row shows a
   specific next action + date + amount; every exception links to its
   filtered list; empty states show the zero as a fact + one next action.

## 2. References (researched 2026-11-13)

Honest limits: no Inspo MCP search was executed in this session (Inspo
v0.2.0 is an MCP server, not a searchable CLI, and no MCP client was
available); no reference screenshots were viewed and no logged-in product
was inspected. The references below come from web search + text fetch of
secondary extracts (SaaSFrame dashboard guide, free tier; Mobbin was NOT
inspected — Pro paywalled). Values marked *(measured)* come from those
extracts; values marked *(estimated)* are the designer's reading of them.

- **(A) Stripe Dashboard** — best for tables/KPIs/aging. 220px sidebar,
  1120px content *(measured)*, full-width tables, sticky header, 44px rows,
  8px base spacing, buttons 8px radius never pill, cards 12px soft shadow,
  4px status badges never pill, mono tabular-nums amounts right-aligned,
  colour reserved for status.
  https://stripe.com/docs/dashboard (accessed 2026-11-13)
- **(B) Mercury** — best for tone. Calm, one number first (total balance),
  then money-in-motion, then dense transaction feed; green/blue only, red
  strictly error. https://mercury.com (accessed 2026-11-13)
- **(C) Ramp** — best for work queues / AI inbox. Near-monochrome + one
  accent, borders not shadows, no gradients, no pills; "finance dashboards
  are to-do lists wearing charts". https://ramp.com (accessed 2026-11-13)
- **(D) Linear** — best for density/nav. 220–240px sidebar, 28–32px rows,
  6px radius, hairlines, compact controls. https://linear.app
  (accessed 2026-11-13)
- **(E) Wise** — borrow one pattern only: per-currency balances as
  first-class objects + fee transparency. https://wise.com
  (accessed 2026-11-13)

What was taken from each: (A) table/KPI/aging grammar, (B) one-number-first
hierarchy, (C) queue-first layout and border-not-shadow elevation,
(D) density and nav compactness, (E) multi-currency lines under the headline
figure (never summed across currencies). No reference's branding, artwork,
or copy was copied.

## 3. Tokens

Source of truth: `packages/brand/tokens/tokens.css` + `tokens.json`
(`@tahseel/brand`). App code must never hardcode a colour or font name
(enforced by `scripts/check-no-hardcoded-brand.mjs`).

### The navy-vs-blue decision (settles the old mismatch)

`docs/BRAND_GUIDELINES.md` (v0.8.0) said primary navy #14243A + teal
#27C7A5, but `tokens.css` actually shipped primary blue #0953DE. Both
were half right. Resolution: **navy #14243A is ink/identity** (text,
sidebar tile, brand mark, solid bands); **blue #0953DE is the single action
accent** (primary CTA, link, focus). Teal #27C7A5 survives only inside the
brand mark (its flow + check). The Yaseir scatter accents (yellow #FFE451,
pink #F48CC0, violet #6852AE, cyan #00C7FC, coral #B84C3D) are removed.

### Scales

| Scale | Values |
|---|---|
| navy | 50 `#EEF2F6`, 100 `#D8E1EA`, 200 `#B3C3D4`, 300 `#84A0B9`, 400 `#55708D`, 500 `#354C66`, 600 `#22344D`, 700 `#14243A`, 800 `#0F1B2D`, 900 `#0B1522`, 950 `#070F18` |
| teal (mark only) | 50 `#E7FAF4`, 100 `#C9F3E7`, 200 `#97E7D2`, 300 `#5FDDBE`, 400 `#27C7A5`, 500 `#17AB8A`, 600 `#0F8A6E`, 700 `#0C6B57`, 800 `#0A5747`, 900 `#084739` |
| slate | 50 `#F6F8F7`, 100 `#EAF0EE`, 200 `#E3EAE8`, 300 `#C4D0CC`, 400 `#93A5B4`, 500 `#697989`, 600 `#556777`, 700 `#46586A`, 800 `#2E3D4D`, 900 `#1E2B3A`, 950 `#121D29` |

### Semantic — light

bg `#F6F8F7`, surface `#FFFFFF`, surface_muted `#EAF0EE`,
callout `#EEF2F6`, border `#E3EAE8`, border_strong `#93A5B4`,
text `#14243A`, text_muted `#5F7183`, text_subtle `#556777`,
primary `#0953DE`, primary_hover `#0742B2`, primary_fg `#FFFFFF`,
accent `#0953DE`, accent_fg `#FFFFFF`, link `#0953DE`, focus `#0953DE`.

### Semantic — dark

bg `#0B1522`, surface `#14243A`, surface_muted `#1B2F47`,
callout `#16283F`, border `#24344D`, border_strong `#33465F`,
text `#EDF3F1`, text_muted `#A7B6C2`, text_subtle `#93A5B4`,
primary `#84ACF5`, primary_hover `#A8C4F8`, primary_fg `#0B1522`,
accent `#84ACF5`, accent_fg `#0B1522`, link `#84ACF5`, focus `#84ACF5`.

### Status (both themes; fg on its bg, always icon + text label)

Light: paid `#12716B`/`#E6F6F3`, due_soon `#854D0E`/`#FEF3C7`,
overdue `#B42318`/`#FEE4E2`, disputed `#593E9E`/`#F1EEFA`,
partial `#0953DE`/`#EAF2FF`, draft `#4F5663`/`#EEF2F7`.
Dark: paid `#5EEAD4`/`#0D2B29`, due_soon `#FDE047`/`#2E2210`,
overdue `#FCA5A5`/`#331616`, disputed `#C4B5FD`/`#231B3D`,
partial `#84ACF5`/`#122240`, draft `#B0B8C5`/`#1A1D26`.

### Brand-mark tokens

Light: mark primary `#14243A`, mark accent (flow) `#27C7A5`, mark check
`#27C7A5`, tile bg `#14243A`, tile border `#22344D`, icon-box bg `#EEF2F6`,
icon-box fg `#0953DE`, icon-box border `#D8E1EA`. Dark: mark primary
`#D8E1EA`, accent/check `#27C7A5`, tile bg `#1B2F47`, tile border `#33465F`,
icon-box bg `#1B2F47`, fg `#84ACF5`, border `#33465F`.
Illustration tokens: light stage `#EEF2F6`, card `#FFFFFF`, muted `#EAF0EE`,
border `#D8E1EA`, bar `#84A0B9`; dark stage `#0F1B2D`, card `#16283F`,
muted `#1B2F47`, border `#24344D`, bar `#55708D`.

## 4. Typography

- Family (token `--font-brand` only): `"Thmanyah Sans", "Plus Jakarta
  Sans", "IBM Plex Sans Arabic", "Segoe UI", Tahoma, system-ui, sans-serif`.
  Plus Jakarta Sans + IBM Plex Sans Arabic are self-hosted via @fontsource
  (SIL OFL); Thmanyah files are NOT committed (licence pending, ADR-003).
- **Never letter-spacing on Arabic text.** Latin digits by default; Eastern
  Arabic digits only when the tenant opted in (rendered via the money
  helpers, never by CSS).
- Scale *(implemented)*: page title 28px/700, section title 18–20px/700,
  card/panel title 16px/700, body 16px/1.7, controls & tables 14px,
  footnote/label 12px, headline figure 40px/800. Landing hero display
  36px (44px ≥sm) is the one exception.
- Amounts: tabular numerals (`.tnum`), `dir="ltr"` on the amount span,
  currency symbol separated; never colour alone for a money state.

## 5. Spacing, radius, shadow

- Base unit 8px; scale 4 / 8 / 12 / 16 / 24 / 32. Page padding 24px
  (`px-4 sm:px-6`); section gap 24px; panel padding 16–20px; table cell
  padding 12px vertical / 12px horizontal.
- Radius: sm 4px (badges, checkboxes), md 8px (buttons, inputs, icon
  chips), lg 12px (panels, table containers). `--radius-pill` (9999px) is
  retained for compat and is used ONLY for tiny status dots (≤10px);
  buttons, badges, and panels must never be pills.
- Shadow: none by design. Elevation is a 1px `border-border` hairline.
  `.panel-shadow` is kept as a near-invisible 1px hairline for legacy
  callers; new code relies on the border alone. No gradients anywhere
  (`.hero-band`, `.brand-pattern`, `.yaseir-stage` deleted).

## 6. Layout, grid, breakpoints

- Shell: sidebar 232px (collapsed icon rail 64px), mirrored to the right
  in RTL (`start-0`, `ps-*`, `border-e` — no hardcoded left/right).
  Mobile <1024px: sidebar becomes an overlay drawer + top bar (the
  pre-existing drawer pattern, kept because the e2e spec asserts exactly
  one nav instance per testid; the <720px overlay in the original brief
  was not adopted — see §10).
- Content: max-width 1200px, centred; main column `flex flex-col gap-6`.
- Dashboard grid: headline panel full width → work-queue cards
  (3 cols ≥sm) → reports 12-col (`lg:col-span-8` analytics +
  `lg:col-span-4` rail). List screens: single column, divided surfaces.
- Breakpoints (Tailwind defaults): sm 640, md 768, lg 1024, xl 1280.
  Desktop screenshots 1440px, mobile 390px.

## 7. Components

All in `apps/web/src/components/ui.tsx` unless noted; same components,
same logic, new discipline.

- **Buttons:** `btnPrimary` / `btnInverse` / `btnAccent` / `btnGhost` /
  `btnDanger`: 40px min-height, 8px radius, 16px horizontal padding,
  14px/500. `btnSmall`: 32px, 4px radius, 12px. Disabled `opacity-50`.
  On a dark navy band the primary action is white bg + navy text (not
  blue on navy).
- **Panels:** `Panel`: 12px radius, `border-border`, no shadow; header
  12–16px padding, title 16px/700 with 32px icon chip (8px radius),
  hairline header divider.
- **PageHeader:** 28px title, rectangular 4px eyebrow chip, subtitle
  14px muted, actions right.
- **StatusPill:** rectangular 4px, `px-2 py-0.5`, 12px/700, filled status
  icon (13px) + label; never colour alone.
- **Tables:** container `overflow-x-auto` + `rounded-xl border
  border-border`; header row solid `bg-surface-muted`, 12px uppercase
  semibold muted, sticky (`sticky top-0`) on the five data tables
  (Import preview, Ledger photo review, Collection promises, Billing
  subscription invoices, Audit trail); body rows 44px, `divide-y
  divide-border`, hover `bg-callout/30`; amounts `tnum`, right-aligned
  (end), `dir="ltr"`. See §8 for the mobile pattern.
- **Lists (no `<table>`):** divided surfaces — invoices, debtors, cheques,
  tasks, AI inbox are stacked rows (avatar/initial, title, meta, amount,
  status badge, chevron/action). The row itself is the primary touch
  target (≥44px tall via padding); inline icon actions are 32px.
- **Forms:** inputs 40px, 8px radius, `border-border-strong/60`,
  focus `border-primary`; labels 14px/500, helper 12px muted.
  Checkboxes/radios keep the token `accent-[var(--teal-600)]`.
- **Nav:** rows 32px, 8px radius, 14px/600; active = `bg-callout` +
  `text-primary` + 2px start border in primary (never a filled pill);
  icon chip 28px; group labels 11px/700 muted; badges rectangular 4px.
- **AI launcher (AppShell):** rectangular 8px button, border-first, no
  glow/shadow/ring; menu popover 12px radius, border-first.
- **EmptyState:** 12px bordered panel, illustration, 18px title, 14px
  muted body, one CTA. **LoadingState:** centred pulsing dot + label —
  shown while the first round-trip is in flight so a list never flashes
  its empty state (F-17). **Error:** `[locale]/error.tsx` + the 404
  panel (shared body in `src/components/NotFoundContent.tsx`): same
  bordered panel + illustration + rectangular primary action. The 404
  is two files by Next.js necessity (verified 2026-11-13): unmatched
  URLs render the root `app/not-found.tsx` through the synthetic
  `/_not-found` route — which loads NO stylesheet — so that file renders
  the same panel with inline styles whose values are imported from
  `@tahseel/brand` tokens (never hardcoded), locale from the
  `X-NEXT-INTL-LOCALE` request header the next-intl middleware sets,
  theme from the `dafqly-theme` cookie; `[locale]/not-found.tsx` is the
  segment boundary for `notFound()` calls from inside `[locale]` (its
  `params` is optional — Next invokes it with `params` undefined on
  some render paths).
- **Charts (`charts.tsx`):** token-only. Forecast: expected = primary
  blue line, conservative = neutral slate-400 dashed line. Aging severity
  ramp: current slate-400 → 0–7 primary → 8–30 due → 31–60 overdue →
  60+ navy-700. Funnel: sent slate-400, delivered primary, replied due,
  paid paid-green. No gradients, no emerald/amber/orange Tailwind
  palette classes anywhere in app code.

## 8. Mobile table pattern (chosen, consistent)

- **Data tables** (`<table>`): horizontal scroll inside the bordered
  container (`overflow-x-auto`, `min-w-[560–720px]` per table), sticky
  header, sticky first column NOT used (identity columns are short and
  the scroll container keeps the page itself overflow-free — asserted by
  `apps/web/e2e/redesign.spec.ts`: `scrollWidth - clientWidth ≤ 1` at
  390px on every list page). Row actions stay reachable: the scroll
  container is thumb-scrollable and action cells are ≥32px targets
  inside ≥44px rows.
- **List screens** (invoices, debtors, cheques, tasks, AI inbox): stacked
  card rows — the row reflows (title/meta wrap, amount + badge stay on
  one line), no horizontal scroll at all.
- **Queue rows** (dashboard work centre, debtor detail): 2-col grid on
  mobile, full row on desktop.

## 9. Interaction states

- Hover: `hover:bg-callout` (rows), `hover:border-primary` (cards/inputs),
  `hover:bg-primary-hover` (primary buttons). No scale/translate on rows.
- Focus-visible: 2px solid `var(--focus)` outline, 2px offset, in both
  themes (token `--focus`: light `#0953DE`, dark `#84ACF5`).
- Disabled: `opacity-50`, no pointer events change beyond native.
- Pressed: `active:scale-95` only on icon buttons.
- Motion: `.reveal` fade + 8px rise, 350ms, once; collapses under
  `prefers-reduced-motion`. No motion on tables/forms.
- Dark mode: same tokens via `[data-theme]` / `prefers-color-scheme`;
  the navy band (`bg-navy-700`) is identical in both themes, with
  `text-navy-100`/`text-navy-200` secondary text on it.

## 10. Accessibility — contrast (recomputed 2026-11-13)

Computed with the same luminance function as
`packages/brand/contrast.test.ts` (WCAG AA: ≥4.5:1 text, ≥3:1 focus).
All pairs pass in both themes; the suite asserts them from `tokens.json`.

Light: text/bg 14.66, text/surface 15.63, text/surface_muted 13.55,
text_muted/bg 4.71, text_muted/surface 5.03, text_subtle/bg 5.48,
text_subtle/surface 5.85, primary_fg/primary 6.36,
primary_fg/primary_hover 8.64, accent_fg/accent 6.36, link/bg 5.96,
link/surface 6.36, focus/bg 5.96, focus/surface 6.36.
Statuses (fg on bg): paid 5.23, due_soon 6.15, overdue 5.45, disputed
7.04, partial 5.64, draft 6.57.

Dark: text/bg 16.33, text/surface 13.92, text/surface_muted 12.10,
text_muted/bg 8.84, text_muted/surface 7.53, text_subtle/bg 7.24,
text_subtle/surface 6.17, primary_fg/primary 8.04,
primary_fg/primary_hover 10.41, accent_fg/accent 8.04, link/bg 8.04,
link/surface 6.85, focus/bg 8.04, focus/surface 6.85.
Statuses: paid 10.18, due_soon 11.78, overdue 8.73, disputed 8.78,
partial 6.93, draft 8.42.

Deliberate deviations found and fixed during the redesign: a
`text-status-paid-fg` (`#12716B`) label on the navy band computed ≈2.6:1
and was changed to white / `text-navy-200` on landing, auth, and statement
headers. The old "teal is never a text color" test pin still holds (no
semantic text colour equals teal-400 `#27C7A5`).

**Blended-background rule (found by axe-core 2026-11-13, after the token
pairs above all passed):** `text-text-muted` (`#5F7183`) on
`bg-surface-muted/60` over the page bg blends to `#EFF3F2` and computes
4.49:1 — 0.01 under AA — so muted text must never sit on a translucent
muted fill. Fixed in place: `LocaleToggle` and the labelled
`LogoutButton` now use `text-text` (13.98:1 on the blend); the small
stat labels in `charts.tsx` (`Kpi`) and the `LedgerPhotoClient` review
note now use `text-text-subtle` (5.23:1 on the blend). The `/50` blend
(`#F0F4F2`, 4.53:1) is a known thin margin — see §14. Icon-only buttons
on the same fill are unaffected (no text node, axe does not flag them).
Gate: `apps/web/e2e/axe.spec.ts` runs axe-core on landing/login/
dashboard/invoices and fails on any violation.

**Solid-fill rule (same axe run, invoices page):** `text-text-muted`
also fails on the SOLID fills it was never computed against:
`bg-surface-muted` (`#EAF0EE`) 4.35:1 and `bg-callout` (`#EEF2F6`)
4.46:1. Fixed in place by switching those labels to `text-text-subtle`
(5.06:1 on surface-muted, 5.20:1 on callout; dark 5.36:1 / 5.88:1):
`InvoicesClient` (Reminders/Collections cards, invoices-count chip),
`DebtorDetailClient` (gateway + ledger reconciliation notes),
`StatementClient` (rejected promise badge),
`CollectionWorkspaceClient` (`Priority` badge), `ImportClient`
(XLSX/XLS/CSV badges), `AiInboxClient` (confidence badge),
`charts.tsx` (forecast table header). Rule of thumb going forward:
muted text goes on `bg` or `surface` only; anything on a muted/callout
fill uses `text-text-subtle` or darker.

**Label-in-name rule (same axe run, dashboard):** WCAG 2.5.3 — visible
text inside a button must appear in its accessible name. Fixed:
`NotificationBell` includes the unread-count badge in its aria-label
("الإشعارات، 3 غير مقروءة"); `LocaleToggle` in compact mode prefixes
the visible short label ("EN — Switch to English"); the AI copilot
trigger drops its aria-label so the name comes from its visible content
(title + count + subtitle) at every viewport and state. These are
pre-existing label defects exposed by the seeded demo state (badges
visible), not redesign regressions — the Prompt 08 baseline's 0
violations were measured before this gate existed as a committed spec.

## 11. Money formatting (verified, not changed)

`packages/core/src/money.ts` + `apps/web/src/components/CurrencyContext.tsx`
were read, not modified. Rules that hold: integer minor units (bigint,
never floats); per-currency exponents (EGP/SAR/USD/AED/EUR 2, KWD 3,
JPY 0); negative values render with a leading `-`; zero renders `0.00`;
thousands grouped with `,`; headline KPIs are in the tenant currency
only, other currencies appear as separate lines (never summed).
**Fixed 2026-11-14 (final verification, commit be36714):** the hardcoded
`/100` / `*100` conversions in `DebtorDetailClient.tsx` (L459, full-balance
prefill), `CollectionWorkspaceClient.tsx` (L81, promise amount),
`ChequesClient.tsx` (L106 extraction prefill, L373 invoice prefill) and
`charts.tsx` `axisLabel` now use the tenant currency's exponent via
`formatAmountOnly` / `parseMoney` / `currencyMinorExponent`; the receipt
summary in `packages/core/src/ai.ts` now formats in the receipt's own
currency via `formatMoney`. Regression tests: KWD/JPY receipt summaries
in `ai.test.ts`, `axisLabel` exponent cases in `charts.test.ts` (new).
**Not a defect — left as is:** `LedgerPhotoClient.tsx` (L118, L274–275)
divides by 100 because the ledger-photo import is EGP-denominated by
design: committed invoices are created with currency `EGP` and the review
edit parses with `parseEgp` (`ledger-ai.ts`, with an explicit comment).
`StatementClient.tsx` already uses exponent-aware `parseMoney` (F-06) and
is correct.

## 12. Images — one palette, one style

All illustrations redrawn two-tone (ink + single blue accent + neutral
greys; no yellow/pink/violet/cyan scatter) in
`apps/web/src/components/illustrations.tsx`, keeping every exported
component name + props. All raster assets regenerated from the
unchanged-geometry DAFQLY mark with
`scripts/regenerate-brand-assets.mjs` (sharp 0.35.5 from the pnpm store;
no new dependency). Corner pixel of every navy asset verified
RGB (20, 36, 58) = `#14243A`.

| Asset | Dimensions | Source SVG |
|---|---|---|
| `apps/web/public/og-image.png` | 1200×630 | `wordmark-horizontal-reversed-outlined.svg` (880px wide, centred on navy) |
| `apps/web/public/splash/splash-750x1624.png` | 750×1624 | `mark-white.svg` (mark 32% of short side, centred on navy) |
| `apps/web/public/splash/splash-828x1792.png` | 828×1792 | same |
| `apps/web/public/splash/splash-1080x2340.png` | 1080×2340 | same |
| `apps/web/public/splash/splash-1170x2532.png` | 1170×2532 | same |
| `apps/web/public/splash/splash-1242x2688.png` | 1242×2688 | same |
| `apps/web/public/splash/splash-1290x2796.png` | 1290×2796 | same |
| `packages/brand/email/email-header.png` | 1200×240 | `wordmark-horizontal-reversed-outlined.svg` (480px wide, centred on navy) |
| `packages/brand/icons/png/favicon-16/32/48/64.png` | 16/32/48/64 | `icons/app-icon.svg` |
| `packages/brand/icons/png/apple-touch-icon-180.png` | 180×180 | `icons/app-icon.svg` |
| `packages/brand/icons/png/icon-192/512/1024.png` | 192/512/1024 | `icons/app-icon.svg` |
| `packages/brand/icons/png/icon-maskable-192/512.png` | 192/512 | `icons/app-icon-fullbleed.svg` |
| `packages/brand/icons/png/whatsapp-business-profile-640.png` | 640×640 | `icons/app-icon.svg` |
| `packages/brand/icons/favicon.ico` | 16/32/48 PNG-embedded | `icons/app-icon.svg` |
| `apps/web/app/icon.svg` | 512 viewBox | copy of `icons/app-icon.svg` |
| `apps/web/app/apple-icon.png` | 180×180 | copy of `apple-touch-icon-180.png` |
| `apps/web/app/favicon.ico` | 16/32/48 | copy of `icons/favicon.ico` |
| `apps/web/public/icons/icon-192/512.png`, `icon-maskable-192/512.png` | 192/512 | copies of the kit PNGs |

SVG sources recoloured to the token palette (geometry untouched):
`logo/mark-color.svg` (D `#0953DE`→`#14243A`, flow `#00C7FC`→`#27C7A5`,
check `#101219`→`#27C7A5`), `logo/mark-white.svg` (flow →`#27C7A5`),
`logo/app-icon.svg` (tile →`#14243A`, flow →`#27C7A5`, check
`#FFE451`→`#FFFFFF`). Deleted: `logo/lockup-horizontal-rtl.svg`
(unreferenced pre-rebrand petrol/brass asset that Phase D meant to delete).
Manifest: `packages/brand/public/manifest.webmanifest` theme
`#101219`→`#14243A`, background `#F6F7F9`→`#F6F8F7` (the dynamic
`app/manifest.ts` already reads both from `tokens.json`).

## 13. What to avoid

- Generic AI dashboard layouts, equal KPI-card grids, random gradients,
  pill buttons/badges, multi-colour scatter illustrations, shadows for
  elevation, colour without a text label, summing across currencies,
  letter-spacing on Arabic, hardcoded hex/font names in app code.
- Do not reintroduce `.hero-band`, `.brand-pattern`, `.yaseir-stage`, or
  the `yaseir-*` token names; do not use Tailwind's emerald/amber/orange/
  violet/teal/red palette classes in app code — use the `status-*` tokens.
- Do not change business logic, API contracts, routes, data-testids,
  i18n keys, auth, RLS, or reminder rules for a visual reason.

## 14. Deviations from the original brief (recorded, not hidden)

- Sidebar overlay breakpoint stays at 1024px (the existing drawer
  pattern + e2e single-nav-instance assertion), not 720px.
- Content max-width is 1200px (brief said ~1120–1200px).
- The dashboard "queue" section and reports keep their existing data
  calls and testids; the forecast chart keeps its 8-week SVG (recoloured).
- `text-teal-600` checkbox accent (`accent-[var(--teal-600)]`) is kept:
  it is a form-control accent, not a text colour, and the contrast test
  does not cover it.
- `text-text-muted` on the `bg-surface-muted/50` blend (`#F0F4F2`,
  4.53:1) is a known thin margin — one spot remains
  (`CollectionWorkspaceClient` assignee note); it passes AA today but
  any darkening of the fill or lightening of the text would break it, so
  new text on a translucent muted fill must use `text-text-subtle` or
  darker (see §10).
