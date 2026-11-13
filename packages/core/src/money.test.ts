import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { parseEgp, formatEgp, parseMoney, formatMoney, currencyMinorExponent, sumMoney, MoneyParseError } from "./money";

describe("parseEgp", () => {
  it("parses plain and grouped amounts into integer minor units", () => {
    expect(parseEgp("1250")).toBe(125000n);
    expect(parseEgp("1,250.50")).toBe(125050n);
    expect(parseEgp("0.05")).toBe(5n);
    expect(parseEgp("  42.5 ")).toBe(4250n);
  });
  it("accepts Eastern Arabic digits and the Arabic decimal separator", () => {
    expect(parseEgp("١٢٥٠٫٥٠")).toBe(125050n);
    expect(parseEgp("١٬٢٥٠")).toBe(125000n);
    expect(parseEgp("١،٥٠٠")).toBe(150000n);
    expect(parseEgp("١٢٥٠،٥٠")).toBe(125050n);
    expect(parseEgp("1.250,50")).toBe(125050n);
    expect(parseEgp("1250,50")).toBe(125050n);
    expect(parseEgp("١َ٥ُ٠٠")).toBe(150000n);
  });
  it("rejects more than 2 decimal places, junk and empty input", () => {
    expect(() => parseEgp("1.234")).toThrow(MoneyParseError);
    expect(() => parseEgp("abc")).toThrow(MoneyParseError);
    expect(() => parseEgp("")).toThrow(MoneyParseError);
    expect(() => parseEgp("1.2.3")).toThrow(MoneyParseError);
  });
  it("property: parse(format(x)) === x for non-negative minor units", () => {
    fc.assert(fc.property(fc.bigInt({ min: 0n, max: 999_999_999_99n }), (minor) => {
      expect(parseEgp(formatEgp(minor))).toBe(minor);
    }));
  });
});
describe("per-currency minor units (KWD 3 decimals, JPY 0 decimals)", () => {
  it("exponents follow ISO 4217", () => {
    expect(currencyMinorExponent("EGP")).toBe(2);
    expect(currencyMinorExponent("SAR")).toBe(2);
    expect(currencyMinorExponent("USD")).toBe(2);
    expect(currencyMinorExponent("KWD")).toBe(3);
    expect(currencyMinorExponent("JPY")).toBe(0);
  });
  it("KWD parses 3 decimals (1.234 KWD = 1234 fils) and formats back", () => {
    expect(parseMoney("1.234", "KWD")).toBe(1234n);
    expect(parseMoney("0.001", "KWD")).toBe(1n);
    expect(formatMoney(1234n, "KWD")).toBe("1.234 د.ك");
  });
  it("KWD rejects more than 3 decimal places", () => {
    expect(() => parseMoney("1.2345", "KWD")).toThrow(MoneyParseError);
  });
  it("JPY has no decimals: whole yen only, fractional input rejected", () => {
    expect(parseMoney("500", "JPY")).toBe(500n);
    expect(parseMoney("1,000", "JPY")).toBe(1000n);
    expect(formatMoney(500n, "JPY")).toBe("500 ¥");
    expect(() => parseMoney("500.5", "JPY")).toThrow(MoneyParseError);
    expect(() => parseMoney("500.50", "JPY")).toThrow(MoneyParseError);
  });
  it("property: parse(format(x)) === x per currency", () => {
    fc.assert(fc.property(fc.bigInt({ min: 0n, max: 999_999_999n }), (minor) => {
      expect(parseMoney(formatMoney(minor, "KWD").replace(" د.ك", ""), "KWD")).toBe(minor);
      expect(parseMoney(formatMoney(minor, "JPY").replace(" ¥", ""), "JPY")).toBe(minor);
    }));
  });
});

describe("formatEgp / sumMoney", () => {
  it("formats with grouping and 2 decimals, Latin digits by default", () => {
    expect(formatEgp(125050n)).toBe("1,250.50");
    expect(formatEgp(5n)).toBe("0.05");
  });
  it("can render Eastern Arabic digits on request", () => {
    expect(formatEgp(125050n, { digits: "eastern" })).toBe("١٬٢٥٠٫٥٠");
  });
  it("sums bigint minor units exactly (no floats anywhere)", () => {
    expect(sumMoney([100n, 250n, 5n])).toBe(355n);
    expect(sumMoney([])).toBe(0n);
  });
});
