import * as XLSX from "xlsx";
import { normalizeDigits } from "./digits";
import { parseEgp } from "./money";
import { normalizeEgPhone } from "./phone";

/**
 * Excel/CSV import parsing (BUILD_PLAN F2). Pure transforms over in-memory
 * grids/buffers — no fs, network or DB — so the same code serves the web
 * commit path and the golden-fixture harness in packages/eval.
 * Every data row produces exactly one ParsedImportRow: invalid rows carry
 * their sheet row number and field reasons and are NEVER silently dropped.
 */

export type CellValue = string | number | boolean | null;
export type Grid = CellValue[][];

export const IMPORT_FIELDS = ["name", "phone", "amount", "dueDate", "issuedDate", "reference", "description", "notes"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
/** field -> column index */
export type ColumnMapping = Partial<Record<ImportField, number>>;

const HEADER_ALIASES: Record<ImportField, readonly string[]> = {
  name: ["name", "customer", "customername", "client", "debtor", "الاسم", "اسم", "اسم العميل", "العميل", "اسم المدين", "المدين"],
  phone: ["phone", "phonenumber", "mobile", "mobilenumber", "telephone", "whatsapp", "الهاتف", "رقم الهاتف", "الموبايل", "رقم الموبايل", "التليفون", "رقم التليفون", "جوال"],
  amount: ["amount", "total", "balance", "due", "amountdue", "owed", "price", "value", "المبلغ", "المبلغ المستحق", "القيمة", "المستحق", "الرصيد", "المديونية"],
  dueDate: ["duedate", "due", "deadline", "تاريخ الاستحقاق", "الاستحقاق", "تاريخ السداد", "موعد السداد"],
  issuedDate: ["issueddate", "issued", "date", "invoicedate", "التاريخ", "تاريخ الإصدار", "تاريخ الفاتورة", "تاريخ الاصدار"],
  reference: ["reference", "ref", "invoiceno", "invoicenumber", "invoice", "no", "number", "المرجع", "رقم الفاتورة", "رقم", "كود الفاتورة"],
  description: ["description", "desc", "details", "item", "الوصف", "البيان", "التفاصيل"],
  notes: ["notes", "note", "comments", "comment", "remarks", "ملاحظات", "ملحوظات"],
};

function normalizeHeader(raw: unknown): string {
  return normalizeDigits(String(raw ?? ""))
    .trim()
    .toLowerCase()
    .replace(/[\s_\-().:：/\\|]+/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه");
}
const ALIAS_SETS = Object.fromEntries(
  IMPORT_FIELDS.map((f) => [f, new Set(HEADER_ALIASES[f].map(normalizeHeader))]),
) as unknown as Record<ImportField, ReadonlySet<string>>;

function matchField(cell: unknown): ImportField | null {
  const n = normalizeHeader(cell);
  if (!n) return null;
  for (const f of IMPORT_FIELDS) if (ALIAS_SETS[f].has(n)) return f;
  // Containment fallback for headers like "Customer Name (EN)" or "اسم العميل بالكامل"
  for (const f of IMPORT_FIELDS) {
    for (const alias of ALIAS_SETS[f]) {
      if (alias.length >= 3 && n.includes(alias)) return f;
    }
  }
  return null;
}

export function suggestMapping(headers: readonly unknown[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  headers.forEach((h, idx) => {
    const field = matchField(h);
    if (field && mapping[field] === undefined) mapping[field] = idx;
  });
  return mapping;
}

const REQUIRED_FIELDS: readonly ImportField[] = ["name", "phone", "amount"];

/** Scans the first rows for a header row matching at least the required-ish fields. */
export function detectHeaderRow(grid: Grid, maxScanRows = 10): { rowIndex: number; mapping: ColumnMapping } | null {
  let best: { rowIndex: number; mapping: ColumnMapping; score: number } | null = null;
  const limit = Math.min(grid.length, maxScanRows);
  for (let r = 0; r < limit; r++) {
    const mapping = suggestMapping(grid[r] ?? []);
    const score = Object.keys(mapping).length;
    const hasCore = mapping.phone !== undefined && mapping.amount !== undefined && mapping.name !== undefined;
    if (hasCore && score >= 3 && (!best || score > best.score)) best = { rowIndex: r, mapping, score };
  }
  return best ? { rowIndex: best.rowIndex, mapping: best.mapping } : null;
}

// --------------------------------------------------------------------- dates
/** Excel serial day -> YYYY-MM-DD (epoch 1899-12-30, the standard SheetJS convention). */
export function excelSerialToIso(serial: number): string {
  const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
const pad = (n: number) => String(n).padStart(2, "0");

/** Accepts Excel serials (number), ISO text, and d/m/Y or d-m-Y text, with Arabic digits. Returns YYYY-MM-DD or null. */
export function parseImportDate(value: CellValue | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") {
    if (value > 20000 && value < 80000) return excelSerialToIso(value);
    return null;
  }
  const s = normalizeDigits(String(value)).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return isRealDate(+m[1]!, +m[2]!, +m[3]!) ? `${m[1]}-${pad(+m[2]!)}-${pad(+m[3]!)}` : null;
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (m) return isRealDate(+m[3]!, +m[2]!, +m[1]!) ? `${m[3]}-${pad(+m[2]!)}-${pad(+m[1]!)}` : null;
  return null;
}

// ---------------------------------------------------------------------- rows
export interface ImportRowError { field: ImportField | "row"; reason: string }
export interface ParsedImportData {
  name: string;
  phoneE164: string;
  whatsappCapable: boolean;
  amountMinor: string; // bigint serialized
  dueOn: string | null;
  issuedOn: string | null;
  reference: string | null;
  description: string | null;
  notes: string | null;
}
export type ParsedRowStatus = "valid" | "invalid" | "empty" | "duplicate";
export interface ParsedImportRow {
  /** 1-based sheet row number, exactly as the merchant sees it in Excel. */
  rowNumber: number;
  status: ParsedRowStatus;
  errors: ImportRowError[];
  data: ParsedImportData | null;
  raw: (string | null)[];
  duplicateDebtorId?: string;
  duplicateOfRow?: number;
}

export const IMPORT_CHUNK_SIZE = 500;

function cellText(v: CellValue | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  return String(v).trim();
}

function parseRow(row: CellValue[], mapping: ColumnMapping, rowNumber: number): ParsedImportRow {
  const raw = row.map((c) => (c === null || c === undefined ? null : String(c)));
  const get = (f: ImportField) => (mapping[f] === undefined ? undefined : row[mapping[f]!]);
  if (row.every((c) => cellText(c) === "")) {
    return { rowNumber, status: "empty", errors: [{ field: "row", reason: "empty row" }], data: null, raw };
  }
  const errors: ImportRowError[] = [];
  const name = cellText(get("name"));
  if (!name) errors.push({ field: "name", reason: "name is required" });

  const phoneRaw = cellText(get("phone"));
  let phoneE164 = "";
  let whatsappCapable = false;
  if (!phoneRaw) {
    errors.push({ field: "phone", reason: "phone is required" });
  } else {
    try {
      const p = normalizeEgPhone(phoneRaw);
      phoneE164 = p.e164;
      whatsappCapable = p.whatsappCapable;
    } catch {
      errors.push({ field: "phone", reason: `invalid Egyptian phone: ${phoneRaw}` });
    }
  }

  const amountRaw = get("amount");
  let amountMinor = 0n;
  if (amountRaw === undefined || cellText(amountRaw) === "") {
    errors.push({ field: "amount", reason: "amount is required" });
  } else if (typeof amountRaw === "number") {
    if (!Number.isFinite(amountRaw) || amountRaw <= 0) errors.push({ field: "amount", reason: "amount must be positive" });
    else {
      const minor = Math.round(amountRaw * 100);
      if (Math.abs(amountRaw * 100 - minor) > 1e-6) errors.push({ field: "amount", reason: "amount has more than 2 decimal places" });
      else amountMinor = BigInt(minor);
    }
  } else {
    try {
      amountMinor = parseEgp(cellText(amountRaw).replace(/جنيه|ج\.م\.?/g, "").trim());
      if (amountMinor <= 0n) errors.push({ field: "amount", reason: "amount must be positive" });
    } catch {
      errors.push({ field: "amount", reason: `unparseable amount: ${cellText(amountRaw)}` });
    }
  }

  const dueRaw = get("dueDate");
  const dueOn = parseImportDate(dueRaw);
  if (dueRaw !== undefined && cellText(dueRaw) !== "" && dueOn === null) {
    errors.push({ field: "dueDate", reason: `unparseable due date: ${cellText(dueRaw)}` });
  }
  const issuedRaw = get("issuedDate");
  const issuedOn = parseImportDate(issuedRaw);
  if (issuedRaw !== undefined && cellText(issuedRaw) !== "" && issuedOn === null) {
    errors.push({ field: "issuedDate", reason: `unparseable issued date: ${cellText(issuedRaw)}` });
  }

  if (errors.length > 0) return { rowNumber, status: "invalid", errors, data: null, raw };
  return {
    rowNumber, status: "valid", errors: [],
    data: {
      name, phoneE164, whatsappCapable, amountMinor: amountMinor.toString(),
      dueOn, issuedOn,
      reference: cellText(get("reference")) || null,
      description: cellText(get("description")) || null,
      notes: cellText(get("notes")) || null,
    },
    raw,
  };
}

/** Parses every row below the header, in chunks so 5,000-row files stay flat in memory behaviour. */
export function parseImportGrid(grid: Grid, mapping: ColumnMapping, headerRowIndex: number): ParsedImportRow[] {
  for (const f of REQUIRED_FIELDS) {
    if (mapping[f] === undefined) throw new Error(`import mapping is missing required field: ${f}`);
  }
  const out: ParsedImportRow[] = [];
  for (let start = headerRowIndex + 1; start < grid.length; start += IMPORT_CHUNK_SIZE) {
    const chunk = grid.slice(start, start + IMPORT_CHUNK_SIZE);
    chunk.forEach((row, i) => out.push(parseRow(row ?? [], mapping, start + i + 1)));
  }
  return out;
}

/** Dedupe against existing debtors (by normalized phone) and within the file itself. Returns new row objects. */
export function dedupeImportRows(rows: readonly ParsedImportRow[], existingByPhone: ReadonlyMap<string, string>): ParsedImportRow[] {
  const seenInFile = new Map<string, number>();
  return rows.map((r) => {
    if (r.status !== "valid" || !r.data) return r;
    const existing = existingByPhone.get(r.data.phoneE164);
    if (existing) return { ...r, status: "duplicate" as const, duplicateDebtorId: existing };
    const earlier = seenInFile.get(r.data.phoneE164);
    if (earlier !== undefined) return { ...r, status: "duplicate" as const, duplicateOfRow: earlier };
    seenInFile.set(r.data.phoneE164, r.rowNumber);
    return r;
  });
}

// ------------------------------------------------------------------ workbook
export interface WorkbookGrid { grid: Grid; sheetName: string }

/** Reads the first sheet of an .xlsx/.xls buffer to a grid, forward-filling merged-cell values (F2 edge case). */
export function readWorkbookGrid(data: Uint8Array): WorkbookGrid {
  const wb = XLSX.read(data, { type: "array", cellDates: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) throw new Error("workbook has no sheets");
  const ws = wb.Sheets[sheetName]!;
  const grid = XLSX.utils.sheet_to_json<CellValue[]>(ws, { header: 1, raw: true, defval: null }) as Grid;
  for (const merge of ws["!merges"] ?? []) {
    const value = grid[merge.s.r]?.[merge.s.c] ?? null;
    for (let r = merge.s.r; r <= merge.e.r; r++) {
      while ((grid[r]?.length ?? 0) <= merge.e.c) (grid[r] ??= []).push(null);
      for (let c = merge.s.c; c <= merge.e.c; c++) grid[r]![c] = value;
    }
  }
  return { grid, sheetName };
}

/** Minimal RFC-4180 CSV parser (quoted fields, embedded commas/newlines, CRLF). */
export function parseCsvText(text: string): Grid {
  const rows: Grid = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else field += ch;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}
