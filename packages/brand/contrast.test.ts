// BRAND.md §4/§10: recompute WCAG contrast from tokens.json and fail CI on
// regression. The kit claims every text pair passes AA (4.5:1) and focus
// rings pass 3:1, in light and dark. This test verifies that claim from the
// token values themselves — it does not edit the kit.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

interface Tokens {
  color: { teal: Record<string, string> };
  semantic: Record<"light" | "dark", Record<string, string>>;
  status: Record<"light" | "dark", Record<string, { fg: string; bg: string }>>;
}
const tokens = JSON.parse(readFileSync(new URL("./tokens/tokens.json", import.meta.url), "utf8")) as Tokens;

function luminance(hex: string): number {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) =>
    v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * (rgb[0] ?? 0) + 0.7152 * (rgb[1] ?? 0) + 0.0722 * (rgb[2] ?? 0);
}
export function contrastRatio(fg: string, bg: string): number {
  const [l1, l2] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (l1! + 0.05) / (l2! + 0.05);
}

const TEXT_PAIRS: Array<[string, string]> = [
  ["text", "bg"], ["text", "surface"], ["text", "surface_muted"],
  ["text_muted", "bg"], ["text_muted", "surface"],
  ["text_subtle", "bg"], ["text_subtle", "surface"],
  ["primary_fg", "primary"], ["primary_fg", "primary_hover"],
  ["accent_fg", "accent"], ["link", "bg"], ["link", "surface"],
];

for (const mode of ["light", "dark"] as const) {
  describe(`contrast (${mode})`, () => {
    const sem = tokens.semantic[mode];
    for (const [fg, bg] of TEXT_PAIRS) {
      // ADR-010 defect closed by the DAFQLY rebrand palette (ADR-025):
      // light text_subtle #556777 on bg #F6F8F7 passes AA strictly.
      it(`${fg} on ${bg} >= 4.5:1`, () => {
        expect(contrastRatio(sem[fg]!, sem[bg]!)).toBeGreaterThanOrEqual(4.5);
      });
    }
    it(`focus ring on bg and surface >= 3:1`, () => {
      expect(contrastRatio(sem.focus!, sem.bg!)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(sem.focus!, sem.surface!)).toBeGreaterThanOrEqual(3);
    });
    for (const [status, pair] of Object.entries(tokens.status[mode])) {
      it(`status ${status} fg on its bg >= 4.5:1`, () => {
        expect(contrastRatio(pair.fg, pair.bg)).toBeGreaterThanOrEqual(4.5);
      });
    }
    it("teal is never a text color", () => {
      const teal = tokens.color.teal["400"]!.toLowerCase();
      for (const key of ["text", "text_muted", "text_subtle", "link"]) {
        expect(sem[key]!.toLowerCase()).not.toBe(teal);
      }
    });
  });
}
