import { describe, it, expect } from "vitest";
import {
  formatCount,
  formatCurrency,
  formatCurrencyAmount,
  formatDateTime,
  formatNumber,
  formatPercent,
  getDateTimeFormatter,
  getNumberFormatter,
  toSafeBigInt,
} from "./format";

describe("format helpers (Western/Latin digits)", () => {
  it("formats numbers and counts with Western digits in both ar and en", () => {
    expect(formatNumber(12345.67, "ar")).toBe("12,345.67");
    expect(formatNumber(12345.67, "en")).toBe("12,345.67");
    expect(formatCount(12, "ar")).toBe("12");
    expect(formatCount(1200, "en")).toBe("1,200");
    expect(formatNumber(Number.NaN, "ar")).toBe("0");
  });

  it("formats percentages consistently with Western digits", () => {
    expect(formatPercent(0.583, "ar")).toBe("58.3%");
    expect(formatPercent(0.583, "en")).toBe("58.3%");
    expect(formatPercent(Number.POSITIVE_INFINITY, "ar")).toBe("0.0%");
  });

  it("formats currency amounts with Western digits in both ar and en", () => {
    expect(formatCurrency(123450n, "EGP", "ar")).toBe("1,234.50 ج.م");
    expect(formatCurrency(123450n, "EGP", "en")).toBe("EGP 1,234.50");
    expect(formatCurrencyAmount(123450n, "EGP")).toBe("1,234.50");
  });

  it("converts minor-unit inputs safely without throwing on floats or malformed values", () => {
    expect(toSafeBigInt(42n)).toBe(42n);
    expect(toSafeBigInt(12.9)).toBe(12n);
    expect(toSafeBigInt(-7.4)).toBe(-7n);
    expect(toSafeBigInt(Number.NaN)).toBe(0n);
    expect(toSafeBigInt(Number.POSITIVE_INFINITY)).toBe(0n);
    expect(toSafeBigInt(" -950 ")).toBe(-950n);
    expect(toSafeBigInt("12.34")).toBe(0n);
    expect(toSafeBigInt("abc")).toBe(0n);
    expect(toSafeBigInt(null)).toBe(0n);
  });

  it("caches Intl.NumberFormat and Intl.DateTimeFormat instances regardless of option key order", () => {
    const nf1 = getNumberFormatter("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const nf2 = getNumberFormatter("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
    expect(nf1).toBe(nf2);

    const dtf1 = getDateTimeFormatter("en-GB", { day: "numeric", month: "short" });
    const dtf2 = getDateTimeFormatter("en-GB", { month: "short", day: "numeric" });
    expect(dtf1).toBe(dtf2);

    const sample = new Date("2026-11-19T10:30:00Z");
    expect(formatDateTime(sample, "en-GB", { day: "numeric", month: "short", timeZone: "UTC" })).toBe("19 Nov");
  });
});
