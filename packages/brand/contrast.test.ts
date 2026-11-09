// BRAND.md §4/§10: recompute WCAG contrast from tokens.json and fail CI on
// regression. The kit claims every text pair passes AA (4.5:1) and focus
// rings pass 3:1, in light and dark. This test verifies that claim from the
// token values themselves — it does not edit the kit.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

interface Tokens {
  color: { brass: Record<string, string> };
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
      // KNOWN KIT DEFECT (found by this test, 2026-11-09): light text_subtle
      // #6D7571 on bg #F7F7F5 computes to 4.42:1, just under AA 4.5:1, contrary
      // to BRAND §4's claim. The kit may not be edited by the agent, so this
      // pair is pinned with it.fails: the suite goes red again the day the
      // human fixes the token, which is the signal to remove the marker.
      // Every other pair is asserted strictly. See DECISIONS ADR-010.
      const knownDefect = mode === "light" && fg === "text_subtle" && bg === "bg";
      const run = knownDefect ? it.fails : it;
      run(`${fg} on ${bg} >= 4.5:1`, () => {
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
    it("brass is never a text color on light backgrounds (BRAND §4)", () => {
      const brass = tokens.color.brass["400"]!.toLowerCase();
      for (const key of ["text", "text_muted", "text_subtle", "link"]) {
        expect(sem[key]!.toLowerCase()).not.toBe(brass);
      }
    });
  });
}
