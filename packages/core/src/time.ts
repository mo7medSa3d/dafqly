/**
 * Quiet-hours logic in the tenant timezone (BUILD_PLAN §6).
 * All functions are pure: the caller injects `now`, so tests use fixed instants
 * (the "fake clock" is simply passing explicit Dates).
 */
export interface SchedulePolicy {
  timezone: string;
  quietStart: string; // "HH:MM" local, inclusive
  quietEnd: string; // "HH:MM" local, exclusive
  fridayMorningSkip: boolean;
}

export const DEFAULT_POLICY: SchedulePolicy = {
  timezone: "Africa/Cairo",
  quietStart: "21:00",
  quietEnd: "09:00",
  fridayMorningSkip: false,
};

/**
 * True when `tz` is a real IANA timezone. `Intl.DateTimeFormat` throws
 * RangeError on unknown zones — an unvalidated tenant timezone used to
 * brick every request that computed "today" with a 500.
 */
const MAX_DTF_CACHE = 64;
const dtfCache = new Map<string, Intl.DateTimeFormat>();

function getCachedDtf(key: string, locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const cached = dtfCache.get(key);
  if (cached) return cached;
  const fmt = new Intl.DateTimeFormat(locale, options);
  if (dtfCache.size >= MAX_DTF_CACHE) {
    const oldest = dtfCache.keys().next().value;
    if (oldest !== undefined) dtfCache.delete(oldest);
  }
  dtfCache.set(key, fmt);
  return fmt;
}

export function isValidTimezone(tz: string): boolean {
  if (typeof tz !== "string" || tz.trim() === "") return false;
  try {
    getCachedDtf(`date:${tz}`, "en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    return true;
  } catch {
    return false;
  }
}

/** The timezone itself when valid, else `fallback` (never throws). */
export function safeTimezone(tz: string | null | undefined, fallback = "Africa/Cairo"): string {
  return tz && isValidTimezone(tz) ? tz : fallback;
}

interface LocalParts { hour: number; minute: number; weekday: string }
function localParts(at: Date, timezone: string): LocalParts {
  const tz = safeTimezone(timezone);
  const fmt = getCachedDtf(`parts:${tz}`, "en-GB", {
    timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
  });
  const parts = fmt.formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { hour: Number(get("hour")), minute: Number(get("minute")), weekday: get("weekday") };
}
const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":");
  const hours = Number(h);
  const mins = Number(m ?? 0);
  if (!Number.isFinite(hours) || !Number.isFinite(mins)) return Number.NaN;
  return hours * 60 + mins;
};

export function isInQuietHours(at: Date, policy: SchedulePolicy): boolean {
  if (Number.isNaN(at.getTime())) throw new Error("Invalid Date passed to isInQuietHours");
  const { hour, minute, weekday } = localParts(at, policy.timezone);
  const mins = hour * 60 + minute;
  if (policy.fridayMorningSkip && weekday === "Fri" && mins < 12 * 60) return true;
  const start = toMinutes(policy.quietStart);
  const end = toMinutes(policy.quietEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start === end) return false;
  if (start > end) return mins >= start || mins < end; // wraps midnight (default)
  return mins >= start && mins < end;
}

/** The UTC instant of a wall-clock date+time in a timezone (e.g. a due date at 10:00 tenant-local). */
export function zonedTimeToUtc(dateIso: string, hhmm: string, timezone: string): Date {
  const [y, mo, d] = dateIso.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const target = Date.UTC(y!, mo! - 1, d!, hh!, mm!, 0);
  if (Number.isNaN(target)) throw new Error(`Invalid date/time: ${dateIso} ${hhmm}`);
  const tz = safeTimezone(timezone);
  const fmt = getCachedDtf(`zoned:${tz}`, "en-GB", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const parts = fmt.formatToParts(new Date(guess));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    const offset = asUtc - Math.floor(guess / 1000) * 1000;
    const next = target - offset;
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}

/** Local calendar date (YYYY-MM-DD) of an instant in a timezone. */
export function localDateOf(at: Date, timezone: string): string {
  if (Number.isNaN(at.getTime())) throw new Error("Invalid Date passed to localDateOf");
  const tz = safeTimezone(timezone);
  const fmt = getCachedDtf(`date:${tz}`, "en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  return fmt.format(at);
}

/** Move an instant forward to the next allowed slot; allowed instants are returned unchanged. Never drops a reminder. */
export function nextAllowedSlot(at: Date, policy: SchedulePolicy): Date {
  if (Number.isNaN(at.getTime())) throw new Error("Invalid Date passed to nextAllowedSlot");
  if (!isInQuietHours(at, policy)) return new Date(at);
  // Step forward in 5-minute increments until allowed, then snap to exact
  // minute boundary (zero seconds/ms) and rewind 1-minute steps to the exact
  // start of the allowed window so e.g. 21:02 shifts to 09:00, not 09:02.
  let candidate = new Date(Math.floor(at.getTime() / 60_000) * 60_000 + 60_000);
  for (let i = 0; i < 3 * 24 * 12; i++) {
    if (!isInQuietHours(candidate, policy)) {
      for (let back = 0; back < 5; back++) {
        const prev = new Date(candidate.getTime() - 60_000);
        if (prev.getTime() <= at.getTime() || isInQuietHours(prev, policy)) break;
        candidate = prev;
      }
      return candidate;
    }
    candidate = new Date(candidate.getTime() + 5 * 60_000);
  }
  return candidate;
}
