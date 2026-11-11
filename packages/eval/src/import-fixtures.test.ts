import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  detectHeaderRow, parseImportGrid, dedupeImportRows, readWorkbookGrid, parseCsvText, type Grid,
} from "@tahseel/core";

/**
 * F2 ACCEPTANCE harness: every golden fixture in fixtures/import/test
 * (>= 10 messy files) imports with exactly the expected results from its
 * hand-written .expected.json — counts per status, and per-row phone /
 * amount / due-date / error-field checks. Fixtures are SYNTHETIC
 * (scripts/generate-import-fixtures.mjs), authored for this suite.
 */
interface ExpectedRow {
  rowNumber: number; status: string; phoneE164?: string; amountMinor?: string;
  dueOn?: string; name?: string; errorField?: string; whatsappCapable?: boolean;
  duplicateDebtorId?: string; duplicateOfRow?: number;
}
interface Expected {
  existingPhones: Record<string, string>;
  stats: { total: number; valid: number; invalid: number; empty: number; duplicate: number };
  headerRow?: number;
  rows: ExpectedRow[];
}

const dir = resolve(process.cwd(), "fixtures/import/test");
const fixtureFiles = readdirSync(dir).filter((f) => !f.startsWith(".") && !f.endsWith(".expected.json")).sort();

describe("F2 golden import fixtures", () => {
  it("has at least 10 messy fixture files", () => {
    expect(fixtureFiles.length).toBeGreaterThanOrEqual(10);
  });

  for (const file of fixtureFiles) {
    it(`${file} imports with the expected results`, async () => {
      const expected = JSON.parse(readFileSync(resolve(dir, `${file}.expected.json`), "utf8")) as Expected;
      const path = resolve(dir, file);
      let grid: Grid;
      if (file.endsWith(".csv")) {
        grid = parseCsvText(readFileSync(path, "utf8"));
      } else {
        grid = (await readWorkbookGrid(new Uint8Array(readFileSync(path)))).grid;
      }
      const detected = detectHeaderRow(grid);
      expect(detected, "header row must be detected").not.toBeNull();
      if (expected.headerRow !== undefined) expect(detected!.rowIndex).toBe(expected.headerRow);
      const parsed = dedupeImportRows(
        parseImportGrid(grid, detected!.mapping, detected!.rowIndex),
        new Map(Object.entries(expected.existingPhones)),
      );
      const stats = { total: parsed.length, valid: 0, invalid: 0, empty: 0, duplicate: 0 };
      for (const r of parsed) stats[r.status] += 1;
      expect(stats).toEqual(expected.stats);
      const byRow = new Map(parsed.map((r) => [r.rowNumber, r]));
      for (const want of expected.rows) {
        const got = byRow.get(want.rowNumber);
        expect(got, `row ${want.rowNumber} must exist`).toBeDefined();
        expect(got!.status, `row ${want.rowNumber} status`).toBe(want.status);
        if (want.phoneE164 !== undefined) expect(got!.data?.phoneE164).toBe(want.phoneE164);
        if (want.amountMinor !== undefined) expect(got!.data?.amountMinor).toBe(want.amountMinor);
        if (want.dueOn !== undefined) expect(got!.data?.dueOn).toBe(want.dueOn);
        if (want.name !== undefined) expect(got!.data?.name).toBe(want.name);
        if (want.whatsappCapable !== undefined) expect(got!.data?.whatsappCapable).toBe(want.whatsappCapable);
        if (want.errorField !== undefined) expect(got!.errors.map((e) => e.field)).toContain(want.errorField);
        if (want.duplicateDebtorId !== undefined) expect(got!.duplicateDebtorId).toBe(want.duplicateDebtorId);
        if (want.duplicateOfRow !== undefined) expect(got!.duplicateOfRow).toBe(want.duplicateOfRow);
      }
    });
  }
});
