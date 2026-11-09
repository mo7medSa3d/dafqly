/**
 * <BrandMark> — inline SVG component per BRAND §9. Geometry is copied
 * verbatim from packages/brand/logo/mark-*.svg (the kit is not edited);
 * colors reference the brand CSS variables (petrol-700 = --petrol-700,
 * brass-400 = --brass-400, paper-0 = --paper-0 in tokens.css) so no hex
 * values live in app code.
 */
export function BrandMark({ variant = "color", size = 40 }: { variant?: "color" | "mono" | "white"; size?: number }) {
  const stroke = variant === "color" ? "var(--petrol-700)" : variant === "white" ? "var(--paper-0)" : "currentColor";
  const coin = variant === "color" ? "var(--brass-400)" : variant === "white" ? "var(--paper-0)" : "currentColor";
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="56 56 400 400" width={size} height={size} fill="none" role="img" aria-label="Tahseel">
      <title>Tahseel mark</title>
      <path d="M104 256 C104 346 172 372 244 372 C336 372 388 304 408 140" fill="none" stroke={stroke} strokeWidth="54" strokeLinecap="round" />
      <circle cx="214" cy="200" r="34" fill={coin} />
      <circle cx="292" cy="200" r="34" fill={coin} />
    </svg>
  );
}
