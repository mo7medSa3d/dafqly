> **SUPERSEDED (2026-11-09, DAFQLY rebrand, ADR-025):** this is the old Tahseel brand spec, kept for history. The implemented brand guidelines are in `docs/BRAND_GUIDELINES.md`.

# Tahseel (تحصيل): Brand and Design System Spec for the Build Agent

*Companion to the Build Plan. Add this kit to the repo as `packages/brand/` and treat this file as `docs/BRAND.md`. Where this file and the plan overlap (UI, i18n, RTL, PWA), this file wins for anything visual.*

## 0. What to do with this kit (add to Milestone M0)

1. Copy the kit into `packages/brand/` unchanged. Never hand-edit the SVGs; if something must change, ask the human.
2. Wire tokens: import `tokens/tokens.css` once in the web app's global stylesheet; use `tokens/tailwind.preset.ts` (Tailwind v3) or the same variables via `@theme` (Tailwind v4). Match the installed Tailwind version. No hardcoded hex values anywhere in app code: use tokens only (enforce with a lint rule or a grep test in CI).
3. Place assets as in Section 9.
4. Build the text-dependent assets (outlined wordmark, OG image, splash screens, email header). These need the font files from the human (Section 2), so request them early.
5. Run the acceptance checks in Section 10 and record the evidence in `docs/PROGRESS.md`.

Kit contents:

```
logo/      mark-color.svg, mark-mono.svg, mark-white.svg, lockup-horizontal-rtl.svg (live text, see 2.4)
icons/     app-icon.svg, app-icon-fullbleed.svg, favicon.svg (adapts to dark mode), favicon.ico, png/*
tokens/    tokens.json, tokens.css, tailwind.preset.ts
public/    manifest.webmanifest
preview/   brand-sheet.png
```

## 1. Concept

**Name:** تحصيل (Tahseel), a working name. Before launch the human must check trademark and domain availability in Egypt, because the word is a generic term for collection.

**Mark:** the Arabic letter ت drawn as an open hand or scoop: one wide curve with a tall right-hand tail, and its two dots rendered as brass coins resting inside. It says money coming back, in the letter the product is named after.

**Personality:** a trustworthy shopkeeper's ledger, not a bank and not a debt collector. Calm, polite, exact. Collection is a sensitive act, so the identity avoids aggressive red, avoids WhatsApp green (it would blur with the channel we send through), and keeps shapes soft.

**Where the boldness lives:** in one place only, the brass coins. Everything else stays quiet.

## 2. Typography

### 2.1 Typeface

**Thmanyah Font (خط ثمانية)**, the Arabic typeface released free by Thmanyah. UI font stack: `Thmanyah, 'Noto Sans Arabic', 'Segoe UI', Tahoma, system-ui, sans-serif` (already in `tokens.css` as `--font-brand`).

### 2.2 License constraints (verified from Thmanyah's official font page; re-read the full license before shipping)

- Allowed: commercial use in logos, identity, websites, applications and print.
- Not allowed: redistributing the font files; modifying, renaming or creating derivative works from the files; using the name or identity of Thmanyah in a way that implies endorsement or affiliation.
- The font is distributed as **OTF only** (no TTF, no WOFF2). The official FAQ answers "no" to using it on mobile devices (installed on the device), and has a question about uploading the files to your own server whose answer I could not read in full.

**Consequences for the agent (do not skip):**

1. Ask the human for the font files, and **do not commit them to any public repo or to the brand kit**. Keep them in `apps/web/assets/fonts/` (gitignored) and load them locally in development.
2. **Do not convert to WOFF2, subset, or rename the font until the human confirms with Thmanyah (support at ask.thmanyah.com) that doing so, and self-hosting the files on the production server, is permitted.** Format conversion and subsetting may count as modification. Until then ship with the fallback stack as the production font and treat Thmanyah as a progressive enhancement behind one config flag (`NEXT_PUBLIC_BRAND_FONT=on|off`).
3. Log the confirmation (or refusal) in `docs/DECISIONS.md`. If refused, fall back to a licensed alternative chosen by the human, and the rest of this spec remains valid.
4. Never mention "Thmanyah" in the product UI, store listings or marketing as a partner.

### 2.3 Rules

- **Never apply letter-spacing to Arabic** (it breaks letter joining). No italics, no faux bold, no uppercase tricks.
- Arabic body line-height 1.7, headings 1.4. Arabic needs more air than Latin.
- Scale: 12, 14, 16 (body), 18, 20, 24, 30, 36 px. Body never below 14. Use at most three weights from what the font ships; map them to regular (400), medium (500), bold (700) and report which weights exist.
- Numerals: default to **Latin digits (0-9)** for amounts, dates and phone numbers (common in Egyptian business use), with a tenant setting to show Eastern Arabic digits. Always accept both on input. Wrap phone numbers, references and amounts in `<bdi>` or `dir="ltr"` so they do not reorder inside RTL text. Use `font-variant-numeric: tabular-nums` where the font supports it.
- Before relying on the font for numbers, inspect it with `fonttools`: confirm Latin digit glyphs, tabular figures and the Arabic punctuation you need. If Latin digits are missing, the stack falls back per glyph; document what you found.

### 2.4 Wordmark

`logo/lockup-horizontal-rtl.svg` uses **live text** so it renders with the fallback until the font is available. Once the human supplies the font, convert the text to outlines (fonttools pen or Inkscape) and save as `lockup-horizontal-rtl.outlined.svg`. This is allowed because the license covers use in logos. In RTL lockups the mark sits on the **right** of the wordmark.

## 3. Logo usage

- Use `mark-color.svg` on paper and white surfaces, `mark-white.svg` on petrol and photos, `mark-mono.svg` (inherits `currentColor`) for single-color contexts such as print, stamps and receipts.
- **Clear space:** at least one coin diameter around the mark.
- **Minimum size:** 16 px for the favicon version, 24 px for the standalone mark, 96 px wide for the lockup.
- **Do not:** recolor outside the kit, rotate, add shadows or gradients, outline it, stretch it, put it on a busy photo, or add a smile or face (the mark was deliberately made asymmetric so it never reads as a face).
- The app icon is a petrol squircle with the paper-white letter and brass coins. The full-bleed variant is the source for iOS, maskable and WhatsApp.

## 4. Color

Tokens live in `tokens.css` and `tokens.json`. Three families:

- **Petrol** (ink-teal, primary): 600 `#1A6070` for buttons and links, 700 `#154E5B` for hover and the brand surface, 800 `#103E49` for the app icon.
- **Brass** (accent, coins): 400 `#EEAC32`. Used sparingly (target under 5% of any screen): the coin motif, key highlights, the focus moment of a screen. **Never use brass as text on light backgrounds.**
- **Paper** (neutrals): `#F7F7F5` page, white surface, text `#171A19`.

Semantic tokens (`--bg`, `--surface`, `--text`, `--text-muted`, `--primary`, `--accent`, `--border`, `--focus`, etc.) switch automatically for dark mode through `prefers-color-scheme`, with `data-theme="light|dark"` as a manual override. Build components from the semantic tokens, not the raw palette.

**Invoice status colors** (each is a foreground and background pair, light and dark): `paid` green, `due_soon` brass, `overdue` red, `disputed` violet, `partial` petrol, `draft` neutral. Always pair color with an icon and a text label (never color alone).

**Contrast:** every text pair in the kit passes WCAG AA (4.5:1), and focus rings pass 3:1, in both light and dark. This was computed, not assumed. Add `packages/brand/contrast.test.ts` that recomputes these from `tokens.json` and fails CI on regression.

## 5. Shape, spacing, motion

- Radii: 6 (inputs, chips), 10 (buttons), 14 (cards), 20 (sheets). Do not use one radius for everything.
- 4 px spacing grid. Minimum touch target **44 px**. Mobile-first, one-hand reachable primary actions, bottom sheets rather than centered modals on phones.
- Elevation: prefer borders (`--border`) over shadows; use a shadow only on floating layers.
- Motion: 120, 200, 320 ms with the kit's easing. Respect `prefers-reduced-motion` (already in `tokens.css`).
- **One signature moment:** when an invoice becomes paid, a brass coin drops into the ت scoop (200-320 ms), then settles to the paid state. Reduced-motion users get an instant state change with the same final frame. No other decorative or scroll-triggered animation.

## 6. Iconography and illustration

- Icon set: **Lucide** (the shadcn default). 24 px grid, stroke 1.75, round caps, inherit `currentColor`. Do not mix icon sets. Verify the exact icon names against the installed Lucide version (some names were renamed, for example `AlertCircle` became `CircleAlert`).
- Semantic map (use these consistently): invoice `FileText`, customer `UserRound`, reminder `BellRing`, opt-out `BellOff`, WhatsApp message `MessageCircle` (do not use the WhatsApp logo without reading Meta's brand rules), payment `Banknote`, receipt `Receipt`, cheque `FileCheck`, photo import `ScanLine`, camera `Camera`, forecast `TrendingUp`, statement link `Link2`, dispute `Scale`, overdue `Clock` plus warning color, paid `CircleCheck`, settings `Settings`, bank `Landmark`.
- **RTL:** mirror directional icons (arrows, chevrons, back and forward, send, list indents). Do not mirror check, clock, plus, phone, camera, media controls or any logo.
- Illustrations (empty states, onboarding): flat, two-tone (petrol and brass on paper), built from circles and the ت curve. No stock people, no gradients, no 3D.

## 7. Voice, tone and glossary (Arabic copy)

Polite, short, clear, respectful of the debtor even when the invoice is late. Sentence case. Active voice. Say what happened and what to do next. Errors never blame and never apologize vaguely. No threats, no shaming, no exclamation marks in collection messages.

| Concept | Arabic term | Notes |
|---|---|---|
| Receivable / amount due | مستحق | not "دين" in customer-facing text |
| Customer | عميل | never "مدين" |
| Invoice | فاتورة | |
| Reminder | تذكير | |
| Overdue | متأخر | |
| Paid / partially paid | مدفوع / مدفوع جزئيًا | |
| Collected | تم التحصيل | |
| Cheque | شيك | |
| Statement | كشف حساب | |
| Dispute | اعتراض | |
| Forecast | توقع التحصيل | |

Keep one name per action across the whole flow (the button says "إرسال التذكير", the toast says "تم إرسال التذكير"). Store all copy in the i18n catalog; no string literals in components.

## 8. Layout principles

Mobile-first single column; the dashboard leads with the one number that matters (total outstanding and overdue), then the list of who to chase today. Use structure that carries information (status chips, aging bars, timelines) and skip decorative cards, eyebrow labels and generic gradient hero blocks. Lists beat tables on phones.

## 9. Asset wiring checklist

| Asset | Source in kit | Destination and notes |
|---|---|---|
| Favicon (adaptive) | `icons/favicon.svg` | `apps/web/app/icon.svg` |
| Favicon fallback | `icons/favicon.ico` | `apps/web/app/favicon.ico` |
| Apple touch icon | `icons/png/apple-touch-icon-180.png` | `apps/web/app/apple-icon.png` (full-bleed, no transparency) |
| PWA icons | `icons/png/icon-192.png`, `icon-512.png`, `icon-maskable-192.png`, `icon-maskable-512.png` | `apps/web/public/icons/` (paths already match the manifest) |
| Manifest | `public/manifest.webmanifest` | `apps/web/app/manifest.webmanifest` or a `manifest.ts`; `lang=ar`, `dir=rtl` |
| Theme color | petrol-700 `#154E5B` | `<meta name="theme-color">` with light and dark media variants, plus `color-scheme` |
| App logo in UI | `logo/mark-*.svg` | inline SVG component `<BrandMark variant="color|mono|white" />` |
| WhatsApp Business profile photo | `icons/png/whatsapp-business-profile-640.png` | give to the human to upload; the mark survives the circular crop |
| OG / share image (1200x630) | build | HTML template rendered with Playwright using the real font; lockup on petrol-800 with the tagline |
| Email header | build | lockup (outlined) on paper, 600 px wide, 2x export |
| Splash screens | build | petrol-800 background, white mark centered, per the framework's PWA convention |

Check the current Next.js metadata file conventions (icon, apple-icon, manifest, opengraph-image) in the official docs before placing files, rather than trusting this table blindly.

## 10. Acceptance checks (agent runs these and records evidence)

- [ ] No hardcoded colors or font names in app code (grep test in CI); everything uses tokens.
- [ ] `contrast.test.ts` passes for light and dark.
- [ ] Favicon renders legibly at 16 px in light and dark browser themes (screenshot both).
- [ ] The PWA passes installability checks; the maskable icons look right in a maskable previewer.
- [ ] Dark mode and light mode both reviewed on key screens (dashboard, invoice list, invoice detail, statement page).
- [ ] RTL review: directional icons mirrored, numbers and phone numbers not reordered, no clipped Arabic ascenders or descenders at body size.
- [ ] Font flag works: with `NEXT_PUBLIC_BRAND_FONT=off` the app is fully usable with the fallback stack.
- [ ] Outlined wordmark, OG image, email header and splash screens produced after the font files arrive.
- [ ] Reduced-motion test: the coin-drop animation is skipped, final state correct.

## 11. Decisions the human must make

1. Provide the Thmanyah font files and get Thmanyah's answer on WOFF2 conversion and server hosting (Section 2.2).
2. Confirm the name تحصيل after a trademark and domain check, or choose another (the kit is name-independent except the lockup).
3. Approve the mark (the asymmetric ت with two coins) and the petrol and brass palette before the agent builds all screens on them.
4. Decide whether Eastern Arabic digits should be the default instead of Latin digits.
