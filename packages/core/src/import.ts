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
  name: [
    "name", "customer", "customername", "client", "clientname", "debtor", "debtorname",
    "accountname", "contact", "contactname", "fullname", "party", "partyname", "person", "merchant", "user",
    "الاسم", "اسم", "اسم العميل", "العميل", "اسم المدين", "الطرف المدين", "اسم المشترك",
    "المشترك", "اسم المشتري", "المشتري", "اسم الزبون", "الزبون", "الطرف", "طرف التعامل",
    "جهة التعامل", "اسم جهة التعامل", "اسم الحساب", "صاحب الحساب", "التاجر", "اسم التاجر", "الاسم بالكامل",
    "الاسم الكامل", "الاسم رباعي", "اسم الشخص", "اسم الطرف",
    "الشركة", "اسم الشركة", "المؤسسة", "طرف ثان", "الطرف الثاني", "المستفيد", "اسم المستفيد", "بيانات العميل",
  ],
  phone: [
    "phone", "phonenumber", "mobile", "mobilenumber", "telephone", "telephonenumber",
    "tel", "cell", "whatsapp", "whatsappnumber", "contact", "contactnumber",
    "الهاتف", "رقم الهاتف", "الموبايل", "رقم الموبايل", "التليفون", "رقم التليفون",
    "جوال", "الجوال", "رقم الجوال", "واتساب", "واتس", "رقم الواتساب", "رقم الواتس",
    "رقم التواصل", "التواصل", "تواصل", "الاتصال", "رقم الاتصال", "المحمول", "رقم المحمول",
    "تليفون", "موبايل", "هاتف", "تلفون", "موبايلات", "هواتف", "تليفونات",
    "ارقام الهواتف", "ارقام الموبايل", "تليفون العميل", "موبايل العميل", "هاتف العميل", "رقم هاتف العميل",
    "رقم تليفون العميل", "رقم محمول العميل", "جهة الاتصال", "وسيلة التواصل", "وسيلة الاتصال",
  ],
  amount: [
    "amount", "amountdue", "total", "totaldue", "balance", "balanceoutstanding", "balancedue",
    "due", "owed", "price", "value", "debit", "net", "remaining", "outstanding", "money", "sum",
    "المبلغ", "المبلغ المستحق", "المستحق", "المديونية", "الرصيد", "القيمة",
    "اجمالي", "الاجمالي", "إجمالي", "الإجمالي", "إجمالي المبلغ", "اجمالي المبلغ", "اجمالي المطلوب",
    "صافي", "الصافي", "صافي المبلغ", "صافي القيمة", "المتبقي", "المبلغ المتبقي", "رصيد المدين",
    "رصيد العميل", "المطلوب", "المبلغ المطلوب", "الدين", "قيمة الفاتورة", "مبلغ الفاتورة",
    "مستحق", "اصل الدين", "أصل الدين", "الرصيد الحالي", "الحساب المستحق", "المبلغ الاجمالي", "المبلغ المطلوب سداده",
    "المطلوب سداده", "المستحق دفعه", "الباقي", "المتبقي عليه", "له / عليه", "عليه", "مدين", "المدين", "المبلغ المدين",
    "رصيد ختامي", "رصيد سابق", "رصيد حالي", "حساب مستحق", "قيمة البضاعة", "اجمالي الفاتورة", "اجمالي الحساب",
    "مجموع الفاتورة", "المجموع", "الرصيد الدفتري", "رصيد دفتري", "الحساب", "رصيد الحساب", "صافي الرصيد",
    "إجمالي الرصيد", "اجمالي الرصيد", "مستحقات", "المستحقات",
  ],
  dueDate: [
    "duedate", "due", "deadline", "paymentdate", "paydate", "expiry", "expdate", "maturitydate",
    "تاريخ الاستحقاق", "الاستحقاق", "تاريخ السداد", "موعد السداد", "ميعاد السداد",
    "تاريخ الدفع", "موعد الدفع", "ميعاد الدفع", "تاريخ الاستحقاق المتوقع", "تاريخ الانتهاء", "الاستحقاق المتوقع",
    "ميعاد الدفع المتوقع", "أجل السداد", "اجل السداد", "تاريخ الوعد", "ميعاد الوعد", "موعد الاستحقاق",
  ],
  issuedDate: [
    "issueddate", "issued", "date", "invoicedate", "billdate", "createddate", "transdate",
    "التاريخ", "تاريخ", "تاريخ الإصدار", "تاريخ الفاتورة", "تاريخ الاصدار", "تاريخ التحرير",
    "تاريخ المعاملة", "تاريخ الحركة", "تاريخ القيد", "تاريخ الفاتوره", "تاريخ المستند",
    "تاريخ العملية", "تاريخ البيع", "تاريخ الشراء", "تاريخ الارسال", "تاريخ الاذن", "تاريخ اليوم",
  ],
  reference: [
    "reference", "ref", "refno", "referenceno", "invoiceno", "invoicenumber",
    "invoice", "billno", "billnumber", "no", "number", "id", "code", "invoiceid",
    "المرجع", "رقم الفاتورة", "رقم الفاتوره", "رقم", "كود الفاتورة", "كود الفاتوره",
    "رقم السند", "رقم الاشعار", "رقم الإشعار", "كود العميل", "رقم العميل", "معرف العميل",
    "رقم الاذن", "رقم العملية", "مسلسل", "الكود", "كود", "رقم الوصل", "رقم المستند",
    "رقم المعاملة", "رقم القيد", "رقم الإذن", "رقم الحركة", "رقم الطلب", "رقم الايصال", "رقم الإيصال",
    "م", "م.", "ت", "ت.",
  ],
  description: [
    "description", "desc", "details", "item", "items", "service", "particulars",
    "الوصف", "البيان", "بيان", "التفاصيل", "شرح", "البند", "الصنف", "الخدمة", "ملاحظة البيان",
    "تفاصيل الفاتورة", "شرح القيد", "بيان العميل", "بيان الحساب", "بيان الفاتورة",
  ],
  notes: [
    "notes", "note", "comments", "comment", "remarks", "memo",
    "ملاحظات", "ملحوظات", "تعليق", "تعليقات", "ملاحظة", "تنبيه",
  ],
};

export function normalizeHeader(raw: unknown): string {
  return normalizeDigits(String(raw ?? ""))
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "") // remove Tashkeel / Harakat
    .replace(/\u0640/g, "") // remove Tatweel / Kashida
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, "") // remove zero-width & non-breaking spaces
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[#*?!~`'"’“”«»[\]{}()<>_\-.:：/\\|,\s]+/g, "");
}

const ALIAS_SETS = Object.fromEntries(
  IMPORT_FIELDS.map((f) => [f, new Set(HEADER_ALIASES[f].map(normalizeHeader))]),
) as unknown as Record<ImportField, ReadonlySet<string>>;

// Pre-sorted alias list with length descending so specific matches win over generic prefixes
interface AliasEntry { field: ImportField; alias: string }
const SORTED_ALIASES: AliasEntry[] = [];
for (const f of IMPORT_FIELDS) {
  for (const rawAlias of HEADER_ALIASES[f]) {
    const norm = normalizeHeader(rawAlias);
    if (norm.length >= 3) {
      SORTED_ALIASES.push({ field: f, alias: norm });
    }
  }
}
SORTED_ALIASES.sort((a, b) => b.alias.length - a.alias.length);

function matchField(cell: unknown): ImportField | null {
  const n = normalizeHeader(cell);
  if (!n) return null;
  // 1. Exact match
  for (const f of IMPORT_FIELDS) if (ALIAS_SETS[f].has(n)) return f;
  // 2. Longest substring containment match
  for (const { field, alias } of SORTED_ALIASES) {
    if (n.includes(alias)) return field;
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

function inferFieldFromData(grid: Grid, colIdx: number, startRow: number): "phone" | "amount" | "name" | null {
  let phoneCount = 0;
  let amountCount = 0;
  let nameCount = 0;
  let nonEmpty = 0;
  const sampleLimit = Math.min(grid.length, startRow + 10);
  for (let r = startRow; r < sampleLimit; r++) {
    const raw = grid[r]?.[colIdx];
    if (raw === null || raw === undefined || raw === "") continue;
    nonEmpty++;
    const s = normalizeDigits(String(raw)).trim();
    // Egyptian mobile phone
    if (/^(01[0125]\d{8}|\+201[0125]\d{8}|00201[0125]\d{8})$/.test(s.replace(/[\s\-()]/g, ""))) {
      phoneCount++;
      continue;
    }
    // Numeric amount
    if (typeof raw === "number" && !isNaN(raw)) {
      amountCount++;
      continue;
    }
    const cleanNum = s.replace(/EGP|egp|L\.?E\.?|جنيه|جنيها|ج\.م\.?|جم/gi, "").replace(/[, \s]/g, "");
    if (/^\d+(\.\d{1,2})?$/.test(cleanNum) && !/^(01[0125])/.test(cleanNum)) {
      amountCount++;
      continue;
    }
    // Text name
    if (/[\p{L}]/u.test(s) && !/^\d+$/.test(s)) {
      nameCount++;
    }
  }
  if (nonEmpty === 0) return null;
  if (phoneCount / nonEmpty >= 0.5) return "phone";
  if (amountCount / nonEmpty >= 0.5) return "amount";
  if (nameCount / nonEmpty >= 0.5) return "name";
  return null;
}

/** Scans the first rows for a header row matching at least the required-ish fields. */
export function detectHeaderRow(grid: Grid, maxScanRows = 25): { rowIndex: number; mapping: ColumnMapping } | null {
  let best: { rowIndex: number; mapping: ColumnMapping; score: number } | null = null;
  const limit = Math.min(grid.length, maxScanRows);

  for (let r = 0; r < limit; r++) {
    const row = grid[r] ?? [];
    const nonNullCells = row.filter((c) => c !== null && c !== undefined && String(c).trim() !== "");
    if (nonNullCells.length === 0) continue;

    // Filter out title/merged rows where all columns have identical text
    const uniqueValues = new Set(nonNullCells.map((c) => String(c).trim().toLowerCase()));
    if (uniqueValues.size <= 1) continue;

    const directMapping = suggestMapping(row);
    const directCount = Object.keys(directMapping).length;
    const directCoreCount = (directMapping.name !== undefined ? 1 : 0) +
      (directMapping.phone !== undefined ? 1 : 0) +
      (directMapping.amount !== undefined ? 1 : 0);

    const mapping = { ...directMapping };
    const mappedCols = new Set(Object.values(mapping));
    const unmappedCols: number[] = [];
    for (let c = 0; c < row.length; c++) {
      if (!mappedCols.has(c)) unmappedCols.push(c);
    }

    // Apply data inspection if the row already directly matched at least 1 header, or if early row
    let inferredCount = 0;
    if (r + 1 < grid.length && (directCount >= 1 || r <= 1)) {
      for (const required of REQUIRED_FIELDS) {
        if (mapping[required] === undefined) {
          for (const colIdx of unmappedCols) {
            if (inferFieldFromData(grid, colIdx, r + 1) === required) {
              mapping[required] = colIdx;
              mappedCols.add(colIdx);
              inferredCount++;
              break;
            }
          }
        }
      }
    }

    const hasCore = mapping.phone !== undefined && mapping.amount !== undefined && mapping.name !== undefined;

    // Scoring: direct matches have highest weight (1000s), inferred core matches second (500s)
    let score = 0;
    if (hasCore) {
      if (directCoreCount === 3) {
        score = 1000 + directCount * 10;
      } else {
        score = 500 + directCount * 10 + inferredCount * 2;
      }
    } else if (directCoreCount >= 2 && directCount >= 2) {
      score = 100 + directCount * 10;
    } else if (directCoreCount >= 1 && (directCoreCount + inferredCount >= 2)) {
      score = 50 + directCount * 5 + inferredCount * 2;
    } else if (directCount >= 2) {
      score = 30 + directCount * 5 + directCoreCount * 10;
    }

    if (score > (best?.score ?? 0)) {
      best = { rowIndex: r, mapping, score };
    }
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
      const cleanedAmount = cellText(amountRaw)
        .replace(/EGP|egp|L\.?E\.?|جنيه|جنيها|ج\.م\.?|جم/gi, "")
        .trim();
      amountMinor = parseEgp(cleanedAmount);
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

/** Reads the best sheet of an .xlsx/.xls buffer to a grid, forward-filling merged-cell values (F2 edge case). */
export function readWorkbookGrid(data: Uint8Array): WorkbookGrid {
  const wb = XLSX.read(data, { type: "array", cellDates: false });
  if (!wb.SheetNames || wb.SheetNames.length === 0) throw new Error("workbook has no sheets");

  let bestSheetName = wb.SheetNames[0]!;
  let bestGrid: Grid = [];
  let bestScore = -1;

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const candidateGrid = XLSX.utils.sheet_to_json<CellValue[]>(ws, { header: 1, raw: true, defval: null }) as Grid;
    if (candidateGrid.length === 0) continue;

    for (const merge of ws["!merges"] ?? []) {
      const value = candidateGrid[merge.s.r]?.[merge.s.c] ?? null;
      for (let r = merge.s.r; r <= merge.e.r; r++) {
        while ((candidateGrid[r]?.length ?? 0) <= merge.e.c) (candidateGrid[r] ??= []).push(null);
        for (let c = merge.s.c; c <= merge.e.c; c++) candidateGrid[r]![c] = value;
      }
    }

    const detected = detectHeaderRow(candidateGrid);
    const score = (detected ? 10000 : 0) + candidateGrid.length;
    if (score > bestScore) {
      bestScore = score;
      bestSheetName = sheetName;
      bestGrid = candidateGrid;
    }
  }

  // Fallback if all sheets were completely empty
  if (bestGrid.length === 0) {
    const ws = wb.Sheets[bestSheetName]!;
    bestGrid = XLSX.utils.sheet_to_json<CellValue[]>(ws, { header: 1, raw: true, defval: null }) as Grid;
  }

  return { grid: bestGrid, sheetName: bestSheetName };
}

/** Decodes CSV text handling UTF-16LE, UTF-8, and Windows-1256 (standard Egyptian Excel CSV export). */
export function decodeCsvBuffer(bytes: Uint8Array | Buffer): string {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  // 1. Check for UTF-16 LE BOM (FF FE)
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(buf);
  }
  // 2. Try strict UTF-8
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    // 3. Fallback to Windows-1256 (standard Egyptian / Arabic Windows ANSI export)
    try {
      return new TextDecoder("windows-1256").decode(buf);
    } catch {
      return buf.toString("utf8");
    }
  }
}

export function detectCsvDelimiter(text: string): string {
  const clean = text.replace(/^\uFEFF/, "");
  const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(0, 15);
  if (lines.length === 0) return ",";

  const candidates = [",", ";", "\t", "|"] as const;
  let bestDelim = ",";
  let bestScore = -1;

  for (const delim of candidates) {
    let consistentCols = -1;
    let isConsistent = true;
    let headerMatches = 0;
    let totalFields = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      let colCount = 1;
      let inQ = false;
      for (let j = 0; j < line.length; j++) {
        const c = line[j];
        if (c === '"') inQ = !inQ;
        else if (!inQ && c === delim) colCount++;
      }
      totalFields += colCount;
      if (i === 0) {
        consistentCols = colCount;
        const cells = line.split(delim).map((c) => c.replace(/^"|"$/g, "").trim());
        for (const cell of cells) {
          if (matchField(cell)) headerMatches++;
        }
      } else {
        if (colCount !== consistentCols) isConsistent = false;
      }
    }

    if (consistentCols <= 1) continue;

    let score = totalFields;
    if (isConsistent) score += 500;
    score += headerMatches * 1000;

    if (score > bestScore) {
      bestScore = score;
      bestDelim = delim;
    }
  }

  return bestDelim;
}

/** RFC-4180 CSV parser with auto-detected delimiter (supports comma, semicolon, tab, quoted fields, CRLF). */
export function parseCsvText(text: string, customDelimiter?: string): Grid {
  const delim = customDelimiter ?? detectCsvDelimiter(text);
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
    else if (ch === delim) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else field += ch;
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}
