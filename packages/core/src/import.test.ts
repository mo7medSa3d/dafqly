import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  detectHeaderRow, suggestMapping, parseImportGrid, dedupeImportRows,
  excelSerialToIso, parseImportDate, readWorkbookGrid, parseCsvText, decodeCsvBuffer, type Grid,
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
  it("normalizes Arabic Tashkeel, Tatweel, and letter variants in headers", () => {
    const m = suggestMapping([
      "الاسْــــم", // Tashkeel + Tatweel
      "رقْم الهَاتِف :", // Tashkeel + colon
      "صَافِى المَبْلَغ (ج.م)", // Tashkeel + Yaa/Alif Maqsura + parentheses
      "تَارِيخ الإِسْتِحْقَاق", // Tashkeel + Hamza variant
      "كُود الفَاتُورَة #", // Tashkeel + hash symbol
    ]);
    expect(m).toMatchObject({ name: 0, phone: 1, amount: 2, dueDate: 3, reference: 4 });
  });
  it("recognizes Egyptian merchant column aliases", () => {
    const m1 = suggestMapping(["جهة التعامل", "رقم التواصل", "الرصيد المطلوب"]);
    expect(m1).toMatchObject({ name: 0, phone: 1, amount: 2 });

    const m2 = suggestMapping(["الزبون", "المحمول", "اجمالي الفاتورة", "ملاحظات"]);
    expect(m2).toMatchObject({ name: 0, phone: 1, amount: 2, notes: 3 });

    const m3 = suggestMapping(["اسم الحساب", "واتساب", "المديونية"]);
    expect(m3).toMatchObject({ name: 0, phone: 1, amount: 2 });
  });
  it("falls back to data inspection when amount column header is non-standard", () => {
    const grid: Grid = [
      ["اسم العميل", "رقم الهاتف", "العمود الثالث الغريب"],
      ["أحمد سمير", "01001234567", 1500.5],
      ["محمود علي", "01123456789", 2500],
    ];
    const found = detectHeaderRow(grid);
    expect(found?.rowIndex).toBe(0);
    expect(found?.mapping.name).toBe(0);
    expect(found?.mapping.phone).toBe(1);
    expect(found?.mapping.amount).toBe(2);
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
  it("auto-detects semicolon CSV delimiter from Egyptian Windows Excel exports", () => {
    const csv = "اسم العميل;رقم الهاتف;المبلغ;تاريخ الاستحقاق\nأحمد علي;01001234567;1500;2026-12-01\n";
    const grid = parseCsvText(csv);
    expect(grid[0]).toEqual(["اسم العميل", "رقم الهاتف", "المبلغ", "تاريخ الاستحقاق"]);
    expect(grid[1]).toEqual(["أحمد علي", "01001234567", "1500", "2026-12-01"]);
    const detected = detectHeaderRow(grid);
    expect(detected?.rowIndex).toBe(0);
    expect(detected?.mapping).toMatchObject({ name: 0, phone: 1, amount: 2, dueDate: 3 });
  });
  it("auto-detects tab delimiter (TSV)", () => {
    const tsv = "Name\tPhone\tAmount\nSara\t01009876543\t2000\n";
    const grid = parseCsvText(tsv);
    expect(grid[0]).toEqual(["Name", "Phone", "Amount"]);
    expect(grid[1]).toEqual(["Sara", "01009876543", "2000"]);
  });
  it("decodes Windows-1256 encoded Arabic CSV from Egyptian Windows Excel exports", () => {
    // Windows-1256 byte sequence for "الاسم,الموبايل,المبلغ\nأحمد,01001234567,500\n"
    // Encode text as windows-1256 using TextEncoder or custom buffer
    // In windows-1256: 'ا'=0xC7, 'ل'=0xE1, 'ا'=0xC7, 'س'=0xD3, 'م'=0xE3
    const win1256Bytes = Buffer.from([
      0xC7, 0xE1, 0xC7, 0xD3, 0xE3, 0x2C, // الاسم,
      0xC7, 0xE1, 0xE3, 0xE6, 0xC8, 0xC7, 0xED, 0xE1, 0x2C, // الموبايل,
      0xC7, 0xE1, 0xE3, 0xC8, 0xE1, 0xDB, 0x0A, // المبلغ\n
      0xC3, 0xCD, 0xE3, 0xCF, 0x2C, // أحمد,
      0x30, 0x31, 0x30, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x2C, // 01001234567,
      0x35, 0x30, 0x30, 0x0A, // 500\n
    ]);
    const decoded = decodeCsvBuffer(win1256Bytes);
    const grid = parseCsvText(decoded);
    expect(grid[0]).toEqual(["الاسم", "الموبايل", "المبلغ"]);
    expect(grid[1]).toEqual(["أحمد", "01001234567", "500"]);
    const detected = detectHeaderRow(grid);
    expect(detected).not.toBeNull();
    expect(detected?.mapping).toMatchObject({ name: 0, phone: 1, amount: 2 });
  });
  it("decodes UTF-16LE CSV with BOM from Excel Unicode export", () => {
    const text = "Name\tPhone\tAmount\nOmar\t01111223344\t1200\n";
    const utf16le = Buffer.from("\uFEFF" + text, "utf16le");
    const decoded = decodeCsvBuffer(utf16le);
    const grid = parseCsvText(decoded);
    expect(grid[0]).toEqual(["Name", "Phone", "Amount"]);
    expect(grid[1]).toEqual(["Omar", "01111223344", "1200"]);
  });
  it("reads multi-sheet Excel workbooks and selects the data sheet over a blank cover sheet", () => {
    const wb = XLSX.utils.book_new();
    const coverSheet = XLSX.utils.aoa_to_sheet([["Company Name: Al-Amal"], ["Notes: Important data"]]);
    const dataSheet = XLSX.utils.aoa_to_sheet([
      ["الطرف المدين", "رقم التواصل", "المبلغ المطلوب سداده"],
      ["محمود سامي", "01223344556", "3500"],
      ["نادية حسن", "01556677889", "4200"],
    ]);
    XLSX.utils.book_append_sheet(wb, coverSheet, "Cover");
    XLSX.utils.book_append_sheet(wb, dataSheet, "Invoices");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;

    const result = readWorkbookGrid(buf);
    expect(result.sheetName).toBe("Invoices");
    expect(result.grid[0]).toEqual(["الطرف المدين", "رقم التواصل", "المبلغ المطلوب سداده"]);
    const detected = detectHeaderRow(result.grid);
    expect(detected?.mapping).toMatchObject({ name: 0, phone: 1, amount: 2 });
  });
  it("detects header rows buried under multiple title/header metadata rows (up to 25 rows)", () => {
    const grid: Grid = [];
    for (let r = 0; r < 14; r++) {
      grid.push([`Meta Row ${r}`, null, null]);
    }
    grid.push(["جهة التعامل", "موبايل التواصل", "صافي المبلغ المطلوب"]);
    grid.push(["كريم سمير", "01011223344", "850"]);
    const detected = detectHeaderRow(grid);
    expect(detected?.rowIndex).toBe(14);
    expect(detected?.mapping).toMatchObject({ name: 0, phone: 1, amount: 2 });
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
