import { describe, it, expect } from "vitest";
import { isBrandFontEnabled } from "./brand";

describe("brand font flag", () => {
  it("is off unless explicitly 'on'", () => {
    expect(isBrandFontEnabled(undefined)).toBe(false);
    expect(isBrandFontEnabled("off")).toBe(false);
    expect(isBrandFontEnabled("on")).toBe(true);
    expect(isBrandFontEnabled("yes")).toBe(false);
  });
});
