import { describe, it, expect } from "vitest";
import { isBrandFontEnabled } from "./brand";

describe("brand font flag", () => {
  it("is on unless explicitly 'off' (kill switch, ADR-025)", () => {
    expect(isBrandFontEnabled(undefined)).toBe(true);
    expect(isBrandFontEnabled("off")).toBe(false);
    expect(isBrandFontEnabled("on")).toBe(true);
    expect(isBrandFontEnabled("yes")).toBe(true);
  });
});
