import { describe, it, expect } from "vitest";
import { formatCount, formatCurrency, formatCurrencyAmount, formatNumber, formatPercent } from "./format";

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
});
