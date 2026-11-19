import { describe, it, expect } from "vitest";
import { todayIso, toSafeLocalePath } from "./utils";

describe("todayIso", () => {
  it("resolves Cairo local date deterministically across the UTC-vs-Cairo midnight window", () => {
    // 2026-11-18T22:30:00Z is 2026-11-19 00:30 in Africa/Cairo (UTC+2)
    const midnightCairo = new Date("2026-11-18T22:30:00Z");
    expect(todayIso(0, "Africa/Cairo", midnightCairo)).toBe("2026-11-19");
    expect(todayIso(0, "UTC", midnightCairo)).toBe("2026-11-18");
  });

  it("applies day offsets cleanly across month and year boundaries", () => {
    const dec31 = new Date("2026-12-31T10:00:00Z");
    expect(todayIso(1, "Africa/Cairo", dec31)).toBe("2027-01-01");
    expect(todayIso(-1, "Africa/Cairo", new Date("2026-03-01T10:00:00Z"))).toBe("2026-02-28");
  });
});

describe("toSafeLocalePath", () => {
  it("normalizes safe relative paths under the active locale", () => {
    expect(toSafeLocalePath("/debtors/123", "ar")).toBe("/ar/debtors/123");
    expect(toSafeLocalePath("invoices?overdue=true", "en")).toBe("/en/invoices?overdue=true");
    expect(toSafeLocalePath("/ar/tasks", "ar")).toBe("/ar/tasks");
    expect(toSafeLocalePath("/en", "en")).toBe("/en");
  });

  it("rejects external URLs, protocol schemes, protocol-relative paths, and backslashes", () => {
    expect(toSafeLocalePath("https://evil.com/phish", "en")).toBeNull();
    expect(toSafeLocalePath("javascript:alert(1)", "ar")).toBeNull();
    expect(toSafeLocalePath("//evil.com/path", "en")).toBeNull();
    expect(toSafeLocalePath("/\\evil.com", "en")).toBeNull();
    expect(toSafeLocalePath("data:text/html,<script>", "en")).toBeNull();
    expect(toSafeLocalePath("", "en")).toBeNull();
    expect(toSafeLocalePath(null, "en")).toBeNull();
  });
});
