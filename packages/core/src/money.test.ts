import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { parseEgp, formatEgp, sumMoney, MoneyParseError } from "./money";

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
