/**
 * <BrandMark> & <BrandLockup> — Adaptive visual identity for "دفقلي" (Dafqly).
 * Matches DafqlyLogo on the landing page 100% in geometry, proportions, and colors
 * across Light Mode and Dark Mode.
 */
export function BrandMark({
  variant = "color",
  size = 40,
}: {
  variant?: "color" | "mono" | "white" | "inverse";
  size?: number;
}) {
  const main =
    variant === "color"
      ? "var(--brand-mark-primary)"
      : variant === "inverse" || variant === "white"
        ? "var(--primary-foreground)"
        : "currentColor";
  const flow = variant === "mono" ? "currentColor" : "var(--brand-mark-accent)";
  const check = variant === "mono" ? "currentColor" : "var(--brand-mark-check)";
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 540 512"
      width={size}
      height={size}
      fill="none"
      role="img"
      aria-label="دفقلي — Dafqly"
      className="shrink-0"
    >
      <title>دفقلي — Dafqly</title>
      <path
        d="M118 142c0-49 40-89 89-89h101c104 0 188 84 188 188s-84 188-188 188H199c-50 0-90-40-90-90"
        stroke={main}
        strokeWidth="66"
        strokeLinecap="round"
      />
      <path
        d="M72 252c0-50 40-90 90-90h105c32 0 61 12 84 34"
        stroke={flow}
        strokeWidth="66"
        strokeLinecap="round"
      />
      <path
        d="m236 258 44 43 86-93"
        stroke={check}
        strokeWidth="44"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * <BrandLockup> — Signature brand lockup rendering the exact same mark as the
 * landing page alongside "دفقلي" in Arabic or "Dafqly" in English.
 */
export function BrandLockup({
  size = "md",
  onDark = false,
  showTagline = false,
  locale = "ar",
}: {
  size?: "sm" | "md" | "lg";
  onDark?: boolean;
  showTagline?: boolean;
  locale?: string;
}) {
  const isEn = locale === "en";
  const markPx = size === "sm" ? 28 : size === "lg" ? 38 : 32;
  const textCls = size === "sm" ? "text-lg" : size === "lg" ? "text-2xl" : "text-xl";

  return (
    <div className="inline-flex min-w-0 items-center gap-2.5">
      <BrandMark variant={onDark ? "inverse" : "color"} size={markPx} />
      <div className="flex min-w-0 flex-col leading-none">
        <span className={`font-extrabold ${textCls} ${onDark ? "text-primary-foreground" : "text-foreground"}`}>
          {isEn ? "Dafqly" : "دفقلي"}
        </span>
        {showTagline && (
          <span className={`mt-1 whitespace-nowrap text-[10px] font-medium leading-none ${onDark ? "text-primary-foreground/75" : "text-muted-foreground"}`}>
            {isEn ? "Track. Follow. Get Paid." : "تتبّع. تابع. وحصّل."}
          </span>
        )}
      </div>
    </div>
  );
}
