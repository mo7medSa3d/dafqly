import { describe, it, expect } from "vitest";
import { isInQuietHours, nextAllowedSlot, DEFAULT_POLICY } from "./time";

// Africa/Cairo in November is UTC+2 (DST ends late October).
// 2026-11-09 is a Monday; 2026-11-13 is a Friday.
describe("quiet hours (default 21:00-09:00 Africa/Cairo)", () => {
  it("21:00 local is quiet, 09:00 local is allowed", () => {
    expect(isInQuietHours(new Date("2026-11-09T19:00:00Z"), DEFAULT_POLICY)).toBe(true); // 21:00 Cairo
    expect(isInQuietHours(new Date("2026-11-09T07:00:00Z"), DEFAULT_POLICY)).toBe(false); // 09:00 Cairo
    expect(isInQuietHours(new Date("2026-11-09T06:59:00Z"), DEFAULT_POLICY)).toBe(true); // 08:59 Cairo
    expect(isInQuietHours(new Date("2026-11-09T10:00:00Z"), DEFAULT_POLICY)).toBe(false); // 12:00 Cairo
  });
  it("moves a quiet-hours instant to the next allowed slot, never drops it", () => {
    const slot = nextAllowedSlot(new Date("2026-11-09T19:30:00Z"), DEFAULT_POLICY); // Mon 21:30 Cairo
    expect(slot.toISOString()).toBe("2026-11-10T07:00:00.000Z"); // Tue 09:00 Cairo
  });
  it("returns the instant unchanged when already allowed", () => {
    const t = new Date("2026-11-09T10:00:00Z");
    expect(nextAllowedSlot(t, DEFAULT_POLICY).getTime()).toBe(t.getTime());
  });
  it("optional Friday-morning skip pushes Friday 10:00 to Friday 12:00", () => {
    const policy = { ...DEFAULT_POLICY, fridayMorningSkip: true };
    const slot = nextAllowedSlot(new Date("2026-11-13T08:00:00Z"), policy); // Fri 10:00 Cairo
    expect(slot.toISOString()).toBe("2026-11-13T10:00:00.000Z"); // Fri 12:00 Cairo
    expect(isInQuietHours(new Date("2026-11-13T08:00:00Z"), policy)).toBe(true);
    expect(isInQuietHours(new Date("2026-11-13T08:00:00Z"), DEFAULT_POLICY)).toBe(false);
  });
});
