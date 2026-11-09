/**
 * Brand fonts are SIL OFL 1.1 open fonts (Plus Jakarta Sans + IBM Plex Sans
 * Arabic via @fontsource), self-hosted through the bundle and ON by default.
 * NEXT_PUBLIC_BRAND_FONT is kept only as an opt-out kill switch:
 * brandFontEnabled = process.env.NEXT_PUBLIC_BRAND_FONT !== "off".
 * This supersedes the ADR-003 Thmanyah logic (ADR-025). The core env schema
 * default stays "off" (config plumbing, unchanged); the web default-on here
 * is the documented behaviour.
 */
export function isBrandFontEnabled(value: string | undefined): boolean {
  return value !== "off";
}
export const brandFontEnabled = isBrandFontEnabled(process.env.NEXT_PUBLIC_BRAND_FONT);
