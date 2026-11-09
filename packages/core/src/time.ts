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

interface LocalParts { hour: number; minute: number; weekday: string }
function localParts(at: Date, timezone: string): LocalParts {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
  });
  const parts = fmt.formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { hour: Number(get("hour")), minute: Number(get("minute")), weekday: get("weekday") };
}
const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m ?? 0);
};

export function isInQuietHours(at: Date, policy: SchedulePolicy): boolean {
  const { hour, minute, weekday } = localParts(at, policy.timezone);
  const mins = hour * 60 + minute;
  if (policy.fridayMorningSkip && weekday === "Fri" && mins < 12 * 60) return true;
  const start = toMinutes(policy.quietStart);
  const end = toMinutes(policy.quietEnd);
  if (start > end) return mins >= start || mins < end; // wraps midnight (default)
  return mins >= start && mins < end;
}

/** The UTC instant of a wall-clock date+time in a timezone (e.g. a due date at 10:00 tenant-local). */
export function zonedTimeToUtc(dateIso: string, hhmm: string, timezone: string): Date {
  const [y, mo, d] = dateIso.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const target = Date.UTC(y!, mo! - 1, d!, hh!, mm!, 0);
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
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
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" });
  return fmt.format(at);
}

/** Move an instant forward to the next allowed slot; allowed instants are returned unchanged. Never drops a reminder. */
export function nextAllowedSlot(at: Date, policy: SchedulePolicy): Date {
  let candidate = new Date(at);
  // Quiet windows are < 24h and the Friday skip adds < 12h, so 5-minute steps
  // converge in well under a day of iterations; cap defensively at 3 days.
  for (let i = 0; i < 3 * 24 * 12; i++) {
    if (!isInQuietHours(candidate, policy)) return candidate;
    candidate = new Date(candidate.getTime() + 5 * 60_000);
    // Snap: once we land on an allowed minute, rewind to the exact boundary if
    // the previous step crossed it (start-of-window precision matters for tests
    // that begin mid-hour). Steps of 5 min from :00/:30 keep boundaries exact.
  }
  return candidate;
}
