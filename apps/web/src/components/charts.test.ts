import { describe, it, expect } from "vitest";
import { axisLabel } from "./charts";

describe("axisLabel (F-06: tenant-currency exponent)", () => {
  it("scales by the currency exponent, not a hardcoded /100", () => {
    // EGP (2 decimals): 125,050 minor = 1,250.50 → "k" scale.
    expect(axisLabel(125050, false)).toBe("1.3k");
    // KWD (3 decimals): 1,234,000 minor = 1,234 KWD → "1.2k".
    expect(axisLabel(1234000, false, "KWD")).toBe("1.2k");
    // JPY (0 decimals): 500 minor = 500 yen → whole units, no decimals.
    expect(axisLabel(500, false, "JPY")).toBe("500");
    // The same minor value reads differently per currency: 1000 minor is
    // 10 EGP, 1 KWD, and 1000 JPY.
    expect(axisLabel(1000, false, "EGP")).toBe("10");
    expect(axisLabel(1000, false, "KWD")).toBe("1");
    expect(axisLabel(1000, false, "JPY")).toBe("1k");
    // Small books keep one decimal instead of a row of zeros.
    expect(axisLabel(550, false, "EGP")).toBe("5.5");
  });

  it("uses Western/Latin digits in Arabic mode too", () => {
    expect(axisLabel(125050, true, "EGP")).toBe("1.3k");
    expect(axisLabel(550, true, "EGP")).toBe("5.5");
  });
});
