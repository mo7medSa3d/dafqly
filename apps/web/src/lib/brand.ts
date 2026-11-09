/**
 * Brand font flag (BRAND §2.2): the Thmanyah files may not be converted,
 * renamed or self-hosted until the license answer is recorded in
 * docs/DECISIONS.md (ADR-003). Until then NEXT_PUBLIC_BRAND_FONT=off and the
 * app runs entirely on the fallback stack in tokens.css (--font-brand).
 */
export function isBrandFontEnabled(value: string | undefined): boolean {
  return value === "on";
}
export const brandFontEnabled = isBrandFontEnabled(process.env.NEXT_PUBLIC_BRAND_FONT);
