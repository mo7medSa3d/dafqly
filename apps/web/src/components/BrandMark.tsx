/**
 * <BrandMark> — DAFQLY symbol (stroke D + teal flow + check), geometry from
 * packages/brand/logo/mark-*.svg; colors via brand CSS variables
 * (--navy-700 / --teal-400) so no hex lives in app code.
 */
export function BrandMark({ variant = "color", size = 40 }: { variant?: "color" | "mono" | "white"; size?: number }) {
  const main = variant === "color" ? "var(--navy-700)" : variant === "white" ? "white" : "currentColor";
  const flow = variant === "mono" ? "currentColor" : "var(--teal-400)";
  const check = main;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width={size} height={size} fill="none" role="img" aria-label="DAFQLY">
      <title>DAFQLY</title>
      <path d="M118 142c0-49 40-89 89-89h101c104 0 188 84 188 188s-84 188-188 188H199c-50 0-90-40-90-90" stroke={main} strokeWidth="66" strokeLinecap="round" />
      <path d="M72 252c0-50 40-90 90-90h105c32 0 61 12 84 34" stroke={flow} strokeWidth="66" strokeLinecap="round" />
      <path d="m236 258 44 43 86-93" stroke={check} strokeWidth="44" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
