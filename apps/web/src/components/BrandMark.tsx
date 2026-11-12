/**
 * <BrandMark> & <BrandLockup> — Adaptive visual identity for "دفقلي" (Dafqly).
 * Automatically adapts to both Light Mode and Dark Mode via CSS token variables
 * and renders "دفقلي" (connected single word) in Arabic or "Dafqly" in English.
 */
export function BrandMark({
  variant = "color",
  size = 40,
}: {
  variant?: "color" | "mono" | "white";
  size?: number;
}) {
  const main =
    variant === "color"
      ? "var(--brand-mark-primary)"
      : variant === "white"
        ? "white"
        : "currentColor";
  const flow = variant === "mono" ? "currentColor" : "var(--brand-mark-accent)";
  const check =
    variant === "color"
      ? "var(--brand-mark-check)"
      : variant === "white"
        ? "var(--yaseir-yellow)"
        : "currentColor";
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
 * <BrandLockup> — Signature brand lockup rendering "دفقلي" (connected) in Arabic
 * or "Dafqly" in English according to the active locale.
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
  const tileSize = size === "sm" ? "size-9 rounded-xl" : size === "lg" ? "size-12 rounded-2xl" : "size-10 rounded-2xl";
  const markPx = size === "sm" ? 21 : size === "lg" ? 28 : 24;
  const textCls = size === "sm" ? "text-lg" : size === "lg" ? "text-2xl" : "text-xl";
  const tileStyle = onDark
    ? "bg-white/12 border border-white/20"
    : "bg-[var(--brand-tile-bg)] border border-[var(--brand-tile-border)]";

  return (
    <div className="inline-flex min-w-0 items-center gap-3">
      <span className={`flex shrink-0 items-center justify-center shadow-sm transition-colors ${tileSize} ${tileStyle}`}>
        <BrandMark variant="white" size={markPx} />
      </span>
      <div className="flex min-w-0 flex-col leading-none">
        <span className={`font-extrabold ${textCls} ${onDark ? "text-white" : "text-text"}`}>
          {isEn ? "Dafqly" : "دفقلي"}
        </span>
        {showTagline && (
          <span className={`mt-1 whitespace-nowrap text-[10px] font-medium leading-none text-text-muted ${onDark ? "text-navy-100" : "text-text-muted"}`}>
            {isEn ? "Track. Follow. Get Paid." : "تتبّع. تابع. وحصّل."}
          </span>
        )}
      </div>
    </div>
  );
}
