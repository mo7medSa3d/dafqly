import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

const DEFAULT_TIMEZONE = "Africa/Cairo";
const CAIRO_ISO_FMT = new Intl.DateTimeFormat("en-CA", {
  timeZone: DEFAULT_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** shadcn/ui class merger: clsx + tailwind-merge. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Deterministic calendar date (YYYY-MM-DD) in `timeZone` (default `Africa/Cairo`), `offsetDays` from today. Avoids SSR(UTC)-vs-client(Cairo) hydration mismatches around midnight. */
export function todayIso(offsetDays = 0, timeZone = DEFAULT_TIMEZONE, now: Date = new Date()): string {
  const fmt =
    timeZone === DEFAULT_TIMEZONE
      ? CAIRO_ISO_FMT
      : new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = fmt.formatToParts(now);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);
  if (!offsetDays) {
    return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return new Date(Date.UTC(y, m - 1, d + offsetDays)).toISOString().slice(0, 10);
}

/** Validate and normalize an internal navigation path under `/${locale}/...`; rejects external URLs, protocol schemes, and protocol-relative paths. */
export function toSafeLocalePath(raw: string | null | undefined, locale: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.startsWith("//") || trimmed.includes("\\") || /[\u0000-\u001f\u007f]/.test(trimmed)) { // eslint-disable-line no-control-regex -- deliberate control-char rejection at a redirect boundary
    return null;
  }
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return null;
  if (trimmed === `/${locale}` || trimmed.startsWith(`/${locale}/`)) return trimmed;
  return `/${locale}${trimmed.startsWith("/") ? trimmed : `/${trimmed}`}`;
}
