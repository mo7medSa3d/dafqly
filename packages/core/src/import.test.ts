import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  detectHeaderRow, suggestMapping, parseImportGrid, dedupeImportRows,
  excelSerialToIso, parseImportDate, readWorkbookGrid, parseCsvText, type Grid,
} from "./import";

describe("header detection and mapping (F2: Arabic + English headers, header on row 3)", () => {
  it("finds an English header on row 1", () => {
    const grid: Grid = [["Name", "Phone", "Amount", "Due Date"], ["Ahmed", "01001234567", "100", "2026-11-20"]];
    const found = detectHeaderRow(grid);
    expect(found?.rowIndex).toBe(0);
    expect(found?.mapping).toMatchObject({ name: 0, phone: 1, amount: 2, dueDate: 3 });
  });
  it("finds an Arabic header on row 3 under title rows", () => {
    const grid: Grid = [
      ["كشف حسابات العملاء", null, null, null],
      ["شركة النيل", null, null, null],
      ["اسم العميل", "رقم الهاتف", "المبلغ المستحق", "تاريخ الاستحقاق"],
      ["محمد علي", "01001234567", "250.50", "2026-11-20"],
    ];
    const found = detectHeaderRow(grid);
    expect(found?.rowIndex).toBe(2);
    expect(found?.mapping.name).toBe(0);
    expect(found?.mapping.phone).toBe(1);
    expect(found?.mapping.amount).toBe(2);
    expect(found?.mapping.dueDate).toBe(3);
  });
  it("suggestMapping tolerates variants, case and extra words", () => {
    const m = suggestMapping(["Customer Name", "Mobile Number", "TOTAL (EGP)", "Invoice No", "Notes"]);
    expect(m).toMatchObject({ name: 0, phone: 1, amount: 2, reference: 3, notes: 4 });
  });
  it("returns null when no header row exists", () => {
    expect(detectHeaderRow([["a", "b"], ["c", "d"]])).toBeNull();
  });
});

describe("date parsing (F2 edge: Excel serials and text dates)", () => {
  it("converts Excel serials", () => {
    expect(excelSerialToIso(44927)).toBe("2023-01-01");
    expect(excelSerialToIso(46285)).toBe("2026-09-20");
  });
  it("parses text dates in common formats, Arabic digits included", () => {
    expect(parseImportDate("2026-11-20")).toBe("2026-11-20");
    expect(parseImportDate("20/11/2026")).toBe("2026-11-20");
    expect(parseImportDate("٢٠/١١/٢٠٢٦")).toBe("2026-11-20");
    expect(parseImportDate("05-03-2026")).toBe("2026-03-05");
    expect(parseImportDate(44927)).toBe("2023-01-01");
    expect(parseImportDate("not a date")).toBeNull();
    expect(parseImportDate("")).toBeNull();
    expect(parseImportDate(null)).toBeNull();
  });
});

describe("row parsing and validation (F2: invalid rows reported with row number + reason, never dropped)", () => {
  const grid: Grid = [
    ["الاسم", "الهاتف", "المبلغ", "تاريخ الاستحقاق", "المرجع"],
    ["أحمد سمير", "01001234567", "1,250.50", "2026-11-20", "INV-1"],
    ["سارة محمود", "٠١٠٠٩٨٧٦٥٤٣", "٢٬٥٠٠٫٧٥", "٢٥/١١/٢٠٢٦", "INV-2"], // Eastern digits + Arabic separators
    ["بدون هاتف", "", "100", "2026-11-20", "INV-3"], // invalid: empty phone
    ["مبلغ خاطئ", "01005554444", "abc", "2026-11-20", "INV-4"], // invalid: amount
    [null, null, null, null, null], // empty row: reported as empty, not silently skipped
    ["تاريخ سيريال", "01006667777", 750, 46304, "INV-6"], // Excel serial date cell + numeric amount
    ["", "01007778888", "100", "2026-11-20", "INV-7"], // invalid: missing name
  ];
  const rows = parseImportGrid(grid, { name: 0, phone: 1, amount: 2, dueDate: 3, reference: 4 }, 0);
  it("parses valid rows with normalized phone and integer minor units", () => {
    expect(rows[0]).toMatchObject({ rowNumber: 2, status: "valid" });
    expect(rows[0]?.data).toMatchObject({ name: "أحمد سمير", phoneE164: "+201001234567", amountMinor: "125050", dueOn: "2026-11-20", reference: "INV-1" });
    expect(rows[1]?.data).toMatchObject({ phoneE164: "+201009876543", amountMinor: "250075", dueOn: "2026-11-25" });
    expect(rows[5]?.data).toMatchObject({ amountMinor: "75000", dueOn: "2026-10-09" });
  });
  it("reports invalid rows with sheet row number and field reasons", () => {
    expect(rows[2]).toMatchObject({ rowNumber: 4, status: "invalid" });
    expect(rows[2]?.errors.map((e) => e.field)).toContain("phone");
    expect(rows[3]?.errors.map((e) => e.field)).toContain("amount");
    expect(rows[6]?.errors.map((e) => e.field)).toContain("name");
    expect(rows[4]).toMatchObject({ rowNumber: 6, status: "empty" });
    expect(rows).toHaveLength(7); // every sheet row after the header is accounted for
  });
});

describe("dedupe (F2: against existing debtors by normalized phone, and within the file)", () => {
  it("marks existing-phone rows and in-file repeats as duplicates", () => {
    const grid: Grid = [
      ["Name", "Phone", "Amount"],
      ["Existing", "01001234567", "100"],
      ["New One", "01009998888", "200"],
      ["Repeat", "+201009998888", "300"],
    ];
    const parsed = parseImportGrid(grid, { name: 0, phone: 1, amount: 2 }, 0);
    const deduped = dedupeImportRows(parsed, new Map([["+201001234567", "debtor-existing"]]));
    expect(deduped[0]).toMatchObject({ status: "duplicate", duplicateDebtorId: "debtor-existing" });
    expect(deduped[1]).toMatchObject({ status: "valid" });
    expect(deduped[2]).toMatchObject({ status: "duplicate", duplicateOfRow: 3 });
  });
});

describe("workbook reading (F2 edge: merged cells)", () => {
  it("reads an xlsx buffer and forward-fills merged cells", () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["Name", "Phone", "Amount"],
      ["Merged Name", "01001234567", "100"],
      [null, "01009998888", "200"],
    ]);
    ws["!merges"] = [{ s: { r: 1, c: 0 }, e: { r: 2, c: 0 } }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const { grid } = readWorkbookGrid(new Uint8Array(buf));
    expect(grid[2]?.[0]).toBe("Merged Name");
    expect(grid[1]?.[1]).toBe("01001234567");
  });
  it("parses CSV text including quoted commas", () => {
    const grid = parseCsvText('Name,Phone,Amount\n"Ali, Ahmed",01001234567,"1,250.50"\n');
    expect(grid[1]).toEqual(["Ali, Ahmed", "01001234567", "1,250.50"]);
  });
  it("handles a 5,000-row file completely (chunked processing)", () => {
    const grid: Grid = [["Name", "Phone", "Amount"]];
    for (let i = 0; i < 5000; i++) grid.push([`Customer ${i}`, `0100${String(1000000 + i)}`, "10.00"]);
    const rows = parseImportGrid(grid, { name: 0, phone: 1, amount: 2 }, 0);
    expect(rows).toHaveLength(5000);
    expect(rows.every((r) => r.status === "valid")).toBe(true);
    expect(rows[4999]?.rowNumber).toBe(5001);
  });
});
