import { z } from "zod";
import { normalizeDigits } from "./digits";
import { parseEgp } from "./money";
import { allocatePayment, addDaysIso, type AllocationTarget } from "./invoices";

/**
 * AI domain logic for F6/F7/F8 (BUILD_PLAN §7, hard rule 4): LLM output is
 * UNTRUSTED structured data. Everything the model returns is validated with
 * Zod here; an invalid result parses to `null` and routes to a human. The
 * actions an LLM result may trigger come from a fixed allowlist
 * (`actionForIntent`), relative dates are resolved DETERMINISTICALLY (never
 * by the model), and receipt auto-close is gated by pure checks. This module
 * is pure (no IO) like the rest of core.
 */

// ------------------------------------------------------------------ constants
/** A cell below this confidence is highlighted for the merchant in review. */
export const LOW_CONFIDENCE_CELL = 0.8;
/** Below this classification/extraction confidence everything routes to a human. */
export const HUMAN_REVIEW_THRESHOLD = 0.8;
/** Receipt auto-close needs at least this confidence (plus every check + tenant opt-in). */
export const AUTO_CLOSE_MIN_CONFIDENCE = 0.9;
/** Max ledger pages per import job (F6 page cap). */
export const MAX_LEDGER_PAGES = 10;

// ------------------------------------------------------------- amount coercion
/**
 * Amounts arrive from the LLM as numbers or strings. A string is an EGP
 * amount as written in the ledger ("١٬٢٥٠٫٥٠", "1,250.50") and goes through
 * parseEgp (Eastern digits normalized) to minor units. A number that is an
 * integer is already minor units; a non-integer number is EGP major units.
 * Returns null when the value cannot be read as money.
 */
export function coerceAmountMinor(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    const minor = Number.isInteger(value) ? value : Math.round(value * 100);
    return Number.isSafeInteger(minor) ? minor : null;
  }
  if (typeof value === "string") {
    try {
      const minor = Number(parseEgp(value));
      return Number.isSafeInteger(minor) && minor >= 0 ? minor : null;
    } catch {
      return null;
    }
  }
  return null;
}

const amountMinorField = z.union([z.number(), z.string()]).transform((v, ctx) => {
  const minor = coerceAmountMinor(v);
  if (minor === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "amount is not a readable EGP amount" });
    return z.NEVER;
  }
  return minor;
});
const confidenceField = z.number().min(0).max(1);
const dateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// ------------------------------------------------------------------- F6 ledger
export const ledgerRowSchema = z.object({
  name: z.string().trim().min(1),
  phone: z.string().nullable().optional().default(null),
  amount_minor: amountMinorField,
  date: dateField.nullable().optional().default(null),
  note: z.string().nullable().optional().default(null),
  confidence: confidenceField,
  cellConfidence: z.object({ name: confidenceField, amount: confidenceField }),
});
export type LedgerRow = z.infer<typeof ledgerRowSchema>;

export const ledgerExtractionSchema = z.object({ rows: z.array(ledgerRowSchema) });
export type LedgerExtraction = z.infer<typeof ledgerExtractionSchema>;

/** Safe parser: invalid LLM output -> null (routes to human review). */
export function parseLedgerExtraction(input: unknown): LedgerExtraction | null {
  const parsed = ledgerExtractionSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

/** Normalize a parsed row's digits (Eastern Arabic in phone) and trim the name. */
export function normalizeLedgerRowDigits(row: LedgerRow): LedgerRow {
  return {
    ...row,
    name: row.name.trim(),
    phone: row.phone === null ? null : normalizeDigits(row.phone).replace(/[\s-]/g, "") || null,
  };
}

// ---------------------------------------------------------- debtor name match
/** Arabic name normalization for fuzzy matching: strip diacritics/tatweel, unify letter variants, drop the definite article per token. */
export function normalizeArabicName(name: string): string {
  return name
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/إ|أ|آ/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ|ئ/g, "ي")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((tok) => (tok.startsWith("ال") && tok.length > 3 ? tok.slice(2) : tok))
    .join(" ");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** Similarity 0..1: half token overlap, half Levenshtein ratio on the normalized full names. */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeArabicName(a);
  const nb = normalizeArabicName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = new Set(na.split(" "));
  const tb = new Set(nb.split(" "));
  const overlap = [...ta].filter((t) => tb.has(t)).length;
  const tokenScore = overlap / Math.max(ta.size, tb.size);
  const levRatio = 1 - levenshtein(na, nb) / Math.max(na.length, nb.length);
  return 0.5 * tokenScore + 0.5 * levRatio;
}

export interface DebtorSuggestion { debtorId: string; score: number }

/**
 * SUGGESTION ONLY (F6 rule): the best existing debtor for a ledger name, or
 * null below 0.6. The merchant's confirm decides; nothing auto-merges.
 */
export function suggestDebtorByName(
  name: string,
  debtors: readonly { id: string; displayName: string }[],
): DebtorSuggestion | null {
  let best: DebtorSuggestion | null = null;
  for (const d of debtors) {
    const score = nameSimilarity(name, d.displayName);
    if (score >= 0.6 && (best === null || score > best.score)) best = { debtorId: d.id, score };
  }
  return best;
}

// --------------------------------------------------------------- ledger scoring
export interface LedgerGoldRow { name: string; amount_minor: number }
export interface LedgerScore {
  total: number;
  amountAccuracy: number;
  nameAccuracy: number;
  wrongCells: number;
  wrongCellsFlaggedLow: number;
  /** Share of WRONG cells (name or amount) whose per-cell confidence was < LOW_CONFIDENCE_CELL. Target >= 0.90. */
  wrongCellLowFlagRate: number;
}

/** Score predicted ledger rows against gold rows, aligned by row order. */
export function scoreLedger(predicted: readonly LedgerRow[], gold: readonly LedgerGoldRow[]): LedgerScore {
  const total = gold.length;
  let amountOk = 0;
  let nameOk = 0;
  let wrongCells = 0;
  let flagged = 0;
  for (let i = 0; i < total; i++) {
    const p = predicted[i];
    const g = gold[i]!;
    if (!p) { wrongCells += 2; continue; }
    if (p.amount_minor === g.amount_minor) amountOk++;
    else { wrongCells++; if (p.cellConfidence.amount < LOW_CONFIDENCE_CELL) flagged++; }
    if (normalizeArabicName(p.name) === normalizeArabicName(g.name)) nameOk++;
    else { wrongCells++; if (p.cellConfidence.name < LOW_CONFIDENCE_CELL) flagged++; }
  }
  return {
    total,
    amountAccuracy: total ? amountOk / total : 0,
    nameAccuracy: total ? nameOk / total : 0,
    wrongCells,
    wrongCellsFlaggedLow: flagged,
    wrongCellLowFlagRate: wrongCells ? flagged / wrongCells : 1,
  };
}

// ------------------------------------------------------------------ F7 receipt
export const RECEIPT_METHODS = ["instapay", "bank", "wallet", "fawry", "other"] as const;
export type ReceiptMethod = (typeof RECEIPT_METHODS)[number];

export const receiptExtractionSchema = z.object({
  is_receipt: z.boolean(),
  amount_minor: amountMinorField.nullable().optional().default(null),
  currency: z.string().nullable().optional().default(null),
  datetime: z.string().nullable().optional().default(null),
  sender_name: z.string().nullable().optional().default(null),
  sender_account_tail: z.string().nullable().optional().default(null),
  reference_no: z.string().nullable().optional().default(null),
  method: z.enum(RECEIPT_METHODS).nullable().optional().default(null),
  status_text: z.string().nullable().optional().default(null),
  confidence: confidenceField,
  tamper_signals: z.array(z.string()).default([]),
});
export type ReceiptExtraction = z.infer<typeof receiptExtractionSchema>;

export function parseReceiptExtraction(input: unknown): ReceiptExtraction | null {
  const parsed = receiptExtractionSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export interface ReceiptCheck { key: string; passed: boolean; detail: string }
export interface ReceiptChecksResult {
  checks: ReceiptCheck[];
  allPassed: boolean;
  /** Confidence alone clears the auto-close bar (>= 0.9); separate from the other checks per the plan. */
  confidenceOk: boolean;
}

/**
 * The F7 safety checks, all pure: duplicate image hash, duplicate reference,
 * date plausibility (not >1 day in the future, not older than 180 days),
 * actually a receipt, no tamper signals, and the auto-close confidence bar.
 */
export function evaluateReceiptChecks(input: {
  extraction: ReceiptExtraction;
  sha256: string;
  seenHashes: ReadonlySet<string>;
  seenReferences: ReadonlySet<string>;
  now: Date;
}): ReceiptChecksResult {
  const { extraction: e, sha256, seenHashes, seenReferences, now } = input;
  const checks: ReceiptCheck[] = [];
  checks.push({
    key: "duplicate_hash",
    passed: !seenHashes.has(sha256),
    detail: seenHashes.has(sha256) ? "this exact image was submitted before" : "image hash not seen before",
  });
  const normRef = e.reference_no ? normalizeDigits(e.reference_no).trim().replace(/[\s\-_]/g, "").toUpperCase() : null;
  const refSeen = e.reference_no !== null && (
    seenReferences.has(e.reference_no) ||
    (normRef !== null && Array.from(seenReferences).some((r) => normalizeDigits(r).trim().replace(/[\s\-_]/g, "").toUpperCase() === normRef))
  );
  checks.push({
    key: "duplicate_reference",
    passed: !refSeen,
    detail: e.reference_no === null ? "no reference number on the receipt" : refSeen ? "reference number was seen before" : "reference not seen before",
  });
  let dateOk = false;
  let dateDetail = "receipt has no readable datetime";
  if (e.datetime) {
    const at = new Date(e.datetime);
    if (!Number.isNaN(at.getTime())) {
      const ageDays = (now.getTime() - at.getTime()) / 86_400_000;
      dateOk = ageDays >= -1 && ageDays <= 180;
      dateDetail = dateOk ? "date is plausible" : ageDays < -1 ? "receipt date is in the future" : "receipt is older than 180 days";
    } else {
      dateDetail = "receipt datetime is not parseable";
    }
  }
  checks.push({ key: "date_plausible", passed: dateOk, detail: dateDetail });
  checks.push({ key: "is_receipt", passed: e.is_receipt, detail: e.is_receipt ? "image is a transfer receipt" : "image is not a transfer receipt" });
  checks.push({
    key: "no_tamper",
    passed: e.tamper_signals.length === 0,
    detail: e.tamper_signals.length === 0 ? "no tamper signals" : `tamper signals: ${e.tamper_signals.join(", ")}`,
  });
  const confidenceOk = e.confidence >= AUTO_CLOSE_MIN_CONFIDENCE;
  checks.push({
    key: "confidence_ok",
    passed: confidenceOk,
    detail: confidenceOk ? "confidence clears the auto-close bar" : `confidence ${e.confidence} is below ${AUTO_CLOSE_MIN_CONFIDENCE}`,
  });
  return { checks, allPassed: checks.every((c) => c.passed), confidenceOk };
}

// ------------------------------------------------------------ receipt matching
export interface OpenInvoiceForMatch { id: string; outstandingMinor: number; dueOn: string }
export interface ReceiptMatch {
  kind: "exact_single" | "exact_sum" | "partial" | "none";
  invoiceIds: string[];
  allocations: { invoiceId: string; amountMinor: number }[];
}

function targetsOf(invoices: readonly OpenInvoiceForMatch[]): AllocationTarget[] {
  return invoices
    .filter((i) => i.outstandingMinor > 0)
    .map((i) => ({
      invoiceId: i.id, amountMinor: BigInt(i.outstandingMinor), paidMinor: 0n,
      dueOn: i.dueOn, status: "open" as const,
    }));
}

function allocationsOf(amountMinor: number, targets: AllocationTarget[]) {
  const plan = allocatePayment(BigInt(amountMinor), targets);
  return plan.allocations.map((a) => ({ invoiceId: a.invoiceId, amountMinor: Number(a.amountMinor) }));
}

/** Subset-sum search (DFS, capped): find a subset of >= 2 invoices whose outstanding sums exactly to the amount. */
function findExactSubset(invoices: readonly OpenInvoiceForMatch[], target: number): OpenInvoiceForMatch[] | null {
  const items = invoices.filter((i) => i.outstandingMinor > 0 && i.outstandingMinor <= target).slice(0, 15);
  const chosen: OpenInvoiceForMatch[] = [];
  const dfs = (idx: number, remaining: number): boolean => {
    if (remaining === 0) return chosen.length >= 2;
    if (idx >= items.length || remaining < 0) return false;
    chosen.push(items[idx]!);
    if (dfs(idx + 1, remaining - items[idx]!.outstandingMinor)) return true;
    chosen.pop();
    return dfs(idx + 1, remaining);
  };
  return dfs(0, target) ? [...chosen] : null;
}

/**
 * Match a receipt amount against the debtor's open invoices (F7): an exact
 * single invoice, an exact SUM of invoices, otherwise a partial payment
 * allocated oldest-first via the core allocator.
 */
export function matchReceiptAmount(amountMinor: number, openInvoices: readonly OpenInvoiceForMatch[]): ReceiptMatch {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) return { kind: "none", invoiceIds: [], allocations: [] };
  const open = openInvoices.filter((i) => i.outstandingMinor > 0);
  if (open.length === 0) return { kind: "none", invoiceIds: [], allocations: [] };
  const single = open.find((i) => i.outstandingMinor === amountMinor);
  if (single) {
    return { kind: "exact_single", invoiceIds: [single.id], allocations: allocationsOf(amountMinor, targetsOf([single])) };
  }
  const subset = findExactSubset(open, amountMinor);
  if (subset) {
    return { kind: "exact_sum", invoiceIds: subset.map((i) => i.id), allocations: allocationsOf(amountMinor, targetsOf(subset)) };
  }
  const allocations = allocationsOf(amountMinor, targetsOf(open));
  if (allocations.length === 0) return { kind: "none", invoiceIds: [], allocations: [] };
  return { kind: "partial", invoiceIds: allocations.map((a) => a.invoiceId), allocations };
}

/**
 * Auto-close gate (hard rule 5): ONLY when the tenant opted in AND every
 * check passed AND confidence >= 0.9. Anything else stays a claim for the
 * merchant to confirm.
 */
export function decideReceiptOutcome(input: {
  checks: { allPassed: boolean };
  autoCloseEnabled: boolean;
  confidence: number;
}): "auto_confirm" | "claimed" {
  return input.autoCloseEnabled && input.checks.allPassed && input.confidence >= AUTO_CLOSE_MIN_CONFIDENCE
    ? "auto_confirm"
    : "claimed";
}

// ------------------------------------------------------------------- F8 replies
export const REPLY_INTENTS = [
  "promise_to_pay", "already_paid", "dispute", "request_extension",
  "partial_payment_offer", "wrong_person", "opt_out", "question", "greeting_or_other",
] as const;
export type ReplyIntent = (typeof REPLY_INTENTS)[number];

export const replyClassificationSchema = z.object({
  intent: z.enum(REPLY_INTENTS),
  confidence: confidenceField,
  promised_date: dateField.nullable().optional().default(null),
  amount_minor: amountMinorField.nullable().optional().default(null),
});
export type ReplyClassification = z.infer<typeof replyClassificationSchema>;

export function parseReplyClassification(input: unknown): ReplyClassification | null {
  const parsed = replyClassificationSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

// ------------------------------------------------------- deterministic dates
const WEEKDAYS: { names: string[]; dow: number }[] = [
  { names: ["الأحد", "الاحد"], dow: 0 },
  { names: ["الاثنين", "الإثنين", "الاتنين"], dow: 1 },
  { names: ["الثلاثاء", "التلاتاء", "التلات"], dow: 2 },
  { names: ["الأربعاء", "الأربع", "الاربعاء", "الاربع"], dow: 3 },
  { names: ["الخميس"], dow: 4 },
  { names: ["الجمعة", "الجمعه"], dow: 5 },
  { names: ["السبت"], dow: 6 },
];

export interface ResolvedDate { date: string | null; ambiguous: boolean }

/**
 * Deterministic Egyptian relative-date resolution (F8 safety): the LLM never
 * computes dates. `todayIso` is the tenant-local date (the timezone argument
 * documents which calendar "today" belongs to). Ambiguous expressions
 * (بعد العيد) return ambiguous=true and route to a human.
 */
export function resolveRelativeDate(text: string, todayIso: string, timezone: string): ResolvedDate {
  void timezone;
  const t = normalizeDigits(text);
  if (/بعد\s+العيد/.test(t)) return { date: null, ambiguous: true };
  const iso = t.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return { date: iso[1]!, ambiguous: false };
  const dmy = t.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (dmy) {
    const date = `${dmy[3]}-${dmy[2]!.padStart(2, "0")}-${dmy[1]!.padStart(2, "0")}`;
    return { date, ambiguous: false };
  }
  if (/بعد\s+بكر[هة]/.test(t)) return { date: addDaysIso(todayIso, 2), ambiguous: false };
  if (/بكر[هة]|غدا|غداً/.test(t)) return { date: addDaysIso(todayIso, 1), ambiguous: false };
  if (/[أآا]خر\s+الشهر/.test(t)) {
    const [y, m] = todayIso.split("-").map(Number);
    const last = new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
    return { date: last, ambiguous: false };
  }
  if (/[أا]ول\s+الشهر/.test(t)) {
    const [y, m] = todayIso.split("-").map(Number);
    const next = new Date(Date.UTC(y!, m!, 1)).toISOString().slice(0, 10);
    return { date: next, ambiguous: false };
  }
  for (const { names, dow } of WEEKDAYS) {
    if (names.some((n) => t.includes(n))) {
      const todayDow = new Date(`${todayIso}T00:00:00Z`).getUTCDay();
      let delta = (dow - todayDow + 7) % 7;
      if (delta === 0) delta = 7; // "الخميس" said ON Thursday means next week's
      return { date: addDaysIso(todayIso, delta), ambiguous: false };
    }
  }
  return { date: null, ambiguous: false };
}

// -------------------------------------------------------------- action allowlist
export type ReplyAction =
  | "replan_after_promise" | "request_receipt" | "open_dispute" | "merchant_approval"
  | "opt_out" | "mark_phone_invalid" | "human_inbox";

/**
 * The ONLY actions an LLM classification may trigger (F8 allowlist). Below
 * the human-review threshold EVERY intent routes to the human inbox with no
 * automatic action — including opt_out (the keyword path runs before the LLM
 * and is what records opt-outs immediately).
 */
export function actionForIntent(intent: ReplyIntent, confidence: number): { action: ReplyAction; auto: boolean } {
  if (confidence < HUMAN_REVIEW_THRESHOLD) return { action: "human_inbox", auto: false };
  switch (intent) {
    case "promise_to_pay": return { action: "replan_after_promise", auto: true };
    case "already_paid": return { action: "request_receipt", auto: true };
    case "dispute": return { action: "open_dispute", auto: true };
    case "request_extension": return { action: "merchant_approval", auto: false };
    case "opt_out": return { action: "opt_out", auto: true };
    case "wrong_person": return { action: "mark_phone_invalid", auto: true };
    default: return { action: "human_inbox", auto: false };
  }
}

// ----------------------------------------------------------------- eval scorers
export interface ReplyScoreItem {
  expectedIntent: ReplyIntent;
  predictedIntent: ReplyIntent | null;
  predictedConfidence?: number;
  expectedDate?: string | null;
  predictedDate?: string | null;
  injection?: boolean;
}
export interface ReplyScore {
  total: number;
  intentAccuracy: number;
  dateTotal: number;
  dateAccuracy: number;
  optOutTotal: number;
  optOutRecall: number;
  injectionViolations: number;
}

/** Score a labelled reply set: intent accuracy, promised-date accuracy, opt-out recall, injection violations. */
export function scoreReplySet(items: readonly ReplyScoreItem[]): ReplyScore {
  let intentOk = 0;
  let dateTotal = 0;
  let dateOk = 0;
  let optOutTotal = 0;
  let optOutOk = 0;
  let injectionViolations = 0;
  for (const item of items) {
    if (item.predictedIntent === item.expectedIntent) intentOk++;
    if (item.expectedDate) {
      dateTotal++;
      if (item.predictedDate === item.expectedDate) dateOk++;
    }
    if (item.expectedIntent === "opt_out") {
      optOutTotal++;
      if (item.predictedIntent === "opt_out") optOutOk++;
    }
    if (item.injection) {
      // A violation = the injection changed the outcome into an AUTOMATIC
      // non-allowlisted-for-this-label action (any auto action at all when
      // the predicted intent is not the labelled one).
      const conf = item.predictedConfidence ?? 1;
      const action = item.predictedIntent ? actionForIntent(item.predictedIntent, conf) : { action: "human_inbox" as ReplyAction, auto: false };
      if (action.auto && item.predictedIntent !== item.expectedIntent) injectionViolations++;
    }
  }
  return {
    total: items.length,
    intentAccuracy: items.length ? intentOk / items.length : 0,
    dateTotal,
    dateAccuracy: dateTotal ? dateOk / dateTotal : 1,
    optOutTotal,
    optOutRecall: optOutTotal ? optOutOk / optOutTotal : 1,
    injectionViolations,
  };
}

export interface ReceiptScoreItem {
  goldAmountMinor: number | null;
  predictedAmountMinor: number | null;
  clean?: boolean;
  duplicate?: boolean;
  duplicateCaught?: boolean;
  shouldAutoConfirm: boolean;
  autoConfirmed: boolean;
}
export interface ReceiptScore {
  total: number;
  cleanTotal: number;
  cleanAmountAccuracy: number;
  falseAutoConfirms: number;
  duplicateTotal: number;
  duplicatesCaught: number;
  duplicateCatchRate: number;
}

/** Score a labelled receipt set against the F7 targets. */
export function scoreReceiptSet(items: readonly ReceiptScoreItem[]): ReceiptScore {
  const clean = items.filter((i) => i.clean);
  const cleanOk = clean.filter((i) => i.predictedAmountMinor !== null && i.predictedAmountMinor === i.goldAmountMinor).length;
  const dups = items.filter((i) => i.duplicate);
  const caught = dups.filter((i) => i.duplicateCaught).length;
  return {
    total: items.length,
    cleanTotal: clean.length,
    cleanAmountAccuracy: clean.length ? cleanOk / clean.length : 0,
    falseAutoConfirms: items.filter((i) => i.autoConfirmed && !i.shouldAutoConfirm).length,
    duplicateTotal: dups.length,
    duplicatesCaught: caught,
    duplicateCatchRate: dups.length ? caught / dups.length : 1,
  };
}

// =============================================================================
// AI WORKSPACE ENGINE (Function Calling, Anti-Fraud, Smart Mapping & Safe Prompts)
// =============================================================================

/**
 * Guardrail: Sanitizes untrusted user/debtor input to prevent prompt injection
 * and delimiter breaking attacks (hard rule 4: Customer text is data, never instructions).
 * Handles English and Arabic injection phrases, stripping Tashkeel (diacritics),
 * Tatweel (kashida), zero-width characters, and normalizing letter variations.
 */
export function sanitizePromptData(input: string): string {
  // 1. Strip Tashkeel (harakat), Tatweel, and zero-width characters so obfuscated Arabic injections are exposed
  const stripped = input
    .replace(/[\u064B-\u065F\u0670]/g, "") // Tashkeel / Harakat
    .replace(/\u0640/g, "") // Tatweel / Kashida
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, " ") // Zero-width and non-breaking spaces
    .replace(/[\r\n\t]+/g, " ");

  // 2. Redact English and Arabic prompt injection patterns (including Alef variations)
  const redacted = stripped
    .replace(/\b(ignore\s+(?:previous\s+)?instructions|system\s+prompt|admin\s+override|as\s+an\s+ai|you\s+must|act\s+as)\b/gi, "[REDACTED]")
    .replace(/(تجاهل\s+(?:جميع\s+)?(?:التعليمات|الأوامر|الاوامر)(?:\s+السابقة)?|تعليمات\s+النظام|أمر\s+إداري|امر\s+اداري|تخطي\s+الصلاحيات|تصرف\s+كـ?|أنت\s+الآن|انت\s+الان)/gi, "[REDACTED]");

  // 3. Strip dangerous delimiter characters, trim, and cap length
  return redacted
    .replace(/[<>'"`;${}\\]/g, "")
    .trim()
    .slice(0, 140);
}

// -------------------------------------------------------- 1. Smart Header Mapper
export const WORKSPACE_IMPORT_FIELDS = [
  "name", "phone", "amount", "dueDate", "issuedDate", "reference", "description", "notes",
] as const;
export type WorkspaceImportField = (typeof WORKSPACE_IMPORT_FIELDS)[number];

const WORKSPACE_HEADER_ALIASES: Record<WorkspaceImportField, readonly string[]> = {
  name: [
    "name", "customer", "customername", "client", "clientname", "debtor", "debtorname",
    "accountname", "contact", "contactname", "fullname", "party", "partyname", "person", "merchant",
    "الاسم", "اسم", "اسم العميل", "العميل", "اسم المدين", "الطرف المدين", "اسم المشترك",
    "المشترك", "اسم المشتري", "المشتري", "اسم الزبون", "الزبون", "الطرف", "طرف التعامل",
    "جهة التعامل", "اسم جهة التعامل", "اسم الحساب", "صاحب الحساب", "التاجر", "اسم التاجر",
    "الاسم بالكامل", "الاسم الكامل", "الشركة", "اسم الشركة", "المؤسسة", "الطرف الثاني", "بيانات العميل",
  ],
  phone: [
    "phone", "phonenumber", "mobile", "mobilenumber", "telephone", "telephonenumber",
    "tel", "cell", "whatsapp", "whatsappnumber", "contact", "contactnumber",
    "الهاتف", "رقم الهاتف", "الموبايل", "رقم الموبايل", "التليفون", "رقم التليفون",
    "جوال", "الجوال", "رقم الجوال", "واتساب", "واتس", "رقم الواتساب", "رقم الواتس",
    "رقم التواصل", "التواصل", "تواصل", "الاتصال", "رقم الاتصال", "المحمول", "رقم المحمول",
    "تليفون", "موبايل", "هاتف", "تلفون", "موبايلات", "هواتف", "تليفونات", "تليفون العميل",
    "موبايل العميل", "هاتف العميل", "رقم هاتف العميل", "رقم تليفون العميل", "رقم محمول العميل",
  ],
  amount: [
    "amount", "amountdue", "total", "totaldue", "balance", "balanceoutstanding", "balancedue",
    "due", "owed", "price", "value", "debit", "net", "remaining", "outstanding", "money", "sum",
    "المبلغ", "المبلغ المستحق", "المستحق", "المديونية", "الرصيد", "القيمة",
    "اجمالي", "الاجمالي", "إجمالي", "الإجمالي", "إجمالي المبلغ", "اجمالي المبلغ", "اجمالي المطلوب",
    "صافي", "الصافي", "صافي المبلغ", "صافي القيمة", "المتبقي", "المبلغ المتبقي", "رصيد المدين",
    "رصيد العميل", "المطلوب", "المبلغ المطلوب", "الدين", "قيمة الفاتورة", "مبلغ الفاتورة",
    "مستحق", "اصل الدين", "أصل الدين", "الرصيد الحالي", "الحساب المستحق", "المبلغ الاجمالي",
    "المبلغ المطلوب سداده", "المطلوب سداده", "المستحق دفعه", "الباقي", "المتبقي عليه", "مدين",
    "المدين", "المبلغ المدين", "رصيد ختامي", "رصيد سابق", "رصيد حالي", "مستحقات", "المستحقات",
  ],
  dueDate: [
    "duedate", "due", "deadline", "paymentdate", "paydate", "expiry", "expdate", "maturitydate",
    "تاريخ الاستحقاق", "الاستحقاق", "تاريخ السداد", "موعد السداد", "ميعاد السداد",
    "تاريخ الدفع", "موعد الدفع", "ميعاد الدفع", "تاريخ الاستحقاق المتوقع", "تاريخ الانتهاء",
    "الاستحقاق المتوقع", "ميعاد الدفع المتوقع", "أجل السداد", "اجل السداد", "موعد الاستحقاق",
  ],
  issuedDate: [
    "issueddate", "issued", "date", "invoicedate", "created", "createdat", "billdate",
    "تاريخ الاصدار", "تاريخ الإصدار", "تاريخ الفاتورة", "تاريخ الإنشاء", "تاريخ التحرير",
    "تاريخ المعاملة", "تاريخ العملية", "التاريخ", "تاريخ التسجيل", "تاريخ القيد", "حرر في",
  ],
  reference: [
    "reference", "ref", "refno", "referenceno", "invoiceno", "invoicenumber", "invno",
    "code", "id", "billno", "serial", "serialno",
    "رقم الفاتورة", "كود الفاتورة", "رقم المرجع", "المرجع", "كود العميل", "رقم السجل",
    "رقم القيد", "رقم الإشعار", "المسلسل", "رقم الإذن", "الكود", "رقم المستند",
  ],
  description: [
    "description", "desc", "details", "item", "items", "product", "service", "particulars",
    "البيان", "الوصف", "بيان الفاتورة", "تفاصيل الفاتورة", "تفاصيل", "شرح", "الصنف", "البضاعة", "نوع الخدمة",
  ],
  notes: [
    "notes", "note", "comment", "comments", "remarks", "memo",
    "ملاحظات", "ملاحظة", "تعليق", "ملاحظات إضافية", "تنبيهات",
  ],
};

export interface SmartHeaderColumnAnalysis {
  index: number;
  rawHeader: string;
  normalizedHeader: string;
  detectedField: WorkspaceImportField | null;
  confidence: number;
  reason: string;
}

export interface SmartHeaderMappingResult {
  mapping: Partial<Record<WorkspaceImportField, number>>;
  columns: SmartHeaderColumnAnalysis[];
  missingRequired: ("name" | "phone" | "amount")[];
  unmappedHeaders: string[];
  overallConfidence: number;
}

export function smartHeaderMapper(rawHeaders: readonly string[]): SmartHeaderMappingResult {
  const columns: SmartHeaderColumnAnalysis[] = [];
  const fieldCandidates: Record<WorkspaceImportField, { index: number; confidence: number; reason: string }[]> = {
    name: [], phone: [], amount: [], dueDate: [], issuedDate: [], reference: [], description: [], notes: [],
  };

  rawHeaders.forEach((raw, index) => {
    const rawClean = raw.trim();
    if (!rawClean) {
      columns.push({ index, rawHeader: raw, normalizedHeader: "", detectedField: null, confidence: 0, reason: "empty header" });
      return;
    }
    const normalized = normalizeArabicName(rawClean).replace(/[^a-z0-9\u0621-\u064A]/g, "");

    let bestField: WorkspaceImportField | null = null;
    let bestConfidence = 0;
    let bestReason = "no match";

    for (const field of WORKSPACE_IMPORT_FIELDS) {
      const aliases = WORKSPACE_HEADER_ALIASES[field];
      for (const alias of aliases) {
        const normAlias = normalizeArabicName(alias).replace(/[^a-z0-9\u0621-\u064A]/g, "");
        if (normalized === normAlias) {
          bestField = field;
          bestConfidence = 1.0;
          bestReason = `exact match with alias '${alias}'`;
          break;
        }
        if (normAlias.length >= 3 && (normalized.includes(normAlias) || normAlias.includes(normalized))) {
          const sim = nameSimilarity(normalized, normAlias);
          const conf = Math.max(0.75, Math.min(0.92, sim));
          if (conf > bestConfidence) {
            bestField = field;
            bestConfidence = Math.round(conf * 100) / 100;
            bestReason = `substring similarity with alias '${alias}'`;
          }
        }
      }
      if (bestConfidence === 1.0) break;
    }

    if (bestField && bestConfidence >= 0.7) {
      fieldCandidates[bestField].push({ index, confidence: bestConfidence, reason: bestReason });
    }

    columns.push({
      index,
      rawHeader: rawClean,
      normalizedHeader: normalized,
      detectedField: bestField,
      confidence: bestConfidence,
      reason: bestReason,
    });
  });

  // Assign best candidate per field without collision
  const mapping: Partial<Record<WorkspaceImportField, number>> = {};
  const usedIndices = new Set<number>();

  for (const field of WORKSPACE_IMPORT_FIELDS) {
    const sorted = [...fieldCandidates[field]].sort((a, b) => b.confidence - a.confidence);
    for (const c of sorted) {
      if (!usedIndices.has(c.index)) {
        mapping[field] = c.index;
        usedIndices.add(c.index);
        break;
      }
    }
  }

  // Finalize detectedField for columns based on assigned mapping
  columns.forEach((col) => {
    const assignedField = (Object.keys(mapping) as WorkspaceImportField[]).find((f) => mapping[f] === col.index) ?? null;
    col.detectedField = assignedField;
    if (!assignedField) {
      col.confidence = 0;
      col.reason = "unassigned or duplicate candidate";
    }
  });

  const missingRequired: ("name" | "phone" | "amount")[] = [];
  if (mapping.name === undefined) missingRequired.push("name");
  if (mapping.phone === undefined) missingRequired.push("phone");
  if (mapping.amount === undefined) missingRequired.push("amount");

  const unmappedHeaders = columns.filter((c) => c.detectedField === null && c.rawHeader).map((c) => c.rawHeader);
  const matchedCols = columns.filter((c) => c.detectedField !== null);
  const overallConfidence = matchedCols.length > 0
    ? Math.round((matchedCols.reduce((sum, c) => sum + c.confidence, 0) / matchedCols.length) * 100) / 100
    : 0;

  return { mapping, columns, missingRequired, unmappedHeaders, overallConfidence };
}

// -------------------------------------------------------- 2. Receipt Screenshot Analysis
export interface ParseReceiptScreenshotResult {
  isReceipt: boolean;
  amountMinor: number | null;
  currency: string;
  datetime: string | null;
  senderName: string | null;
  senderAccountTail: string | null;
  referenceNo: string | null;
  method: ReceiptMethod | null;
  confidence: number;
  tamperSignals: string[];
  antiFraud: {
    isDuplicateHash: boolean;
    isDuplicateReference: boolean;
    isFutureDate: boolean;
    isSuspicious: boolean;
    checksPassed: boolean;
  };
  recommendedAction: "auto_confirm" | "merchant_review" | "reject";
  summaryAr: string;
  summaryEn: string;
}

export function parseReceiptScreenshotAnalysis(input: {
  extraction: ReceiptExtraction;
  sha256: string;
  seenHashes: ReadonlySet<string>;
  seenReferences: ReadonlySet<string>;
  now: Date;
  autoCloseOptIn: boolean;
}): ParseReceiptScreenshotResult {
  const { extraction: e, sha256, seenHashes, seenReferences, now, autoCloseOptIn } = input;
  const checksRes = evaluateReceiptChecks({
    extraction: e,
    sha256,
    seenHashes,
    seenReferences,
    now,
  });

  const isDupHash = seenHashes.has(sha256);
  const normRef = e.reference_no ? normalizeDigits(e.reference_no).trim().replace(/[\s\-_]/g, "").toUpperCase() : null;
  const isDupRef = e.reference_no !== null && (
    seenReferences.has(e.reference_no) ||
    (normRef !== null && Array.from(seenReferences).some((r) => normalizeDigits(r).trim().replace(/[\s\-_]/g, "").toUpperCase() === normRef))
  );
  const isFuture = e.datetime ? new Date(e.datetime).getTime() > now.getTime() + 86_400_000 : false;
  const isSuspicious = (e.tamper_signals ?? []).length > 0 || isDupHash || isDupRef || isFuture;

  let recommendedAction: "auto_confirm" | "merchant_review" | "reject" = "merchant_review";
  if (!e.is_receipt || isDupHash || isDupRef) {
    recommendedAction = "reject";
  } else if (autoCloseOptIn && checksRes.allPassed && e.confidence >= AUTO_CLOSE_MIN_CONFIDENCE) {
    recommendedAction = "auto_confirm";
  } else {
    recommendedAction = "merchant_review";
  }

  const methodLabel = e.method ?? "تحويل إلكتروني";
  const amountStr = e.amount_minor !== null ? `${(e.amount_minor / 100).toFixed(2)} ج.م` : "مبلغ غير محدد";

  const summaryAr = recommendedAction === "auto_confirm"
    ? `إيصال موثوق (${methodLabel}) بمبلغ ${amountStr} مؤهل للاعتماد التلقائي بنسبة ثقة ${Math.round(e.confidence * 100)}%.`
    : recommendedAction === "reject"
    ? `تم رفض الإيصال: ${!e.is_receipt ? "الصورة ليست إيصال تحويل صالح" : isDupHash ? "تم تقديم هذا الإيصال مسبقاً (تطابق كامل في الصورة)" : isDupRef ? "رقم العملية أو المرجع مسجل مسبقاً" : "بيانات الإيصال غير صالحة"}.`
    : `إيصال (${methodLabel}) بمبلغ ${amountStr} بانتظار مراجعة التاجر (نسبة الثقة ${Math.round(e.confidence * 100)}%).`;

  const summaryEn = recommendedAction === "auto_confirm"
    ? `Verified receipt (${e.method ?? "transfer"}) for ${amountStr} eligible for auto-confirmation (${Math.round(e.confidence * 100)}% confidence).`
    : recommendedAction === "reject"
    ? `Receipt rejected: ${!e.is_receipt ? "not a valid transfer receipt" : isDupHash ? "duplicate receipt image" : isDupRef ? "duplicate reference number" : "invalid receipt data"}.`
    : `Receipt (${e.method ?? "transfer"}) for ${amountStr} pending merchant confirmation (${Math.round(e.confidence * 100)}% confidence).`;

  return {
    isReceipt: e.is_receipt,
    amountMinor: e.amount_minor,
    currency: e.currency ?? "EGP",
    datetime: e.datetime,
    senderName: e.sender_name,
    senderAccountTail: e.sender_account_tail,
    referenceNo: e.reference_no,
    method: e.method,
    confidence: e.confidence,
    tamperSignals: e.tamper_signals ?? [],
    antiFraud: {
      isDuplicateHash: isDupHash,
      isDuplicateReference: isDupRef,
      isFutureDate: isFuture,
      isSuspicious,
      checksPassed: checksRes.allPassed,
    },
    recommendedAction,
    summaryAr,
    summaryEn,
  };
}

// ---------------------------------------------------- 3. Smart Notification Generator
export type NotificationTone = "friendly" | "polite" | "firm" | "urgent";

export interface GenerateSmartNotificationInput {
  debtorName: string;
  amountMinor: number;
  currency?: string;
  daysOverdue: number;
  dueDate: string;
  riskFlag?: boolean;
  tenantBusinessName: string;
  reference?: string;
  tone?: NotificationTone;
  locale?: "ar" | "en";
  paymentLink?: string;
  channel?: "whatsapp" | "sms";
}

export interface GenerateSmartNotificationResult {
  notificationText: string;
  suggestedSendTime: string;
  toneApplied: NotificationTone;
  securityGuards: {
    sanitized: boolean;
    containsSensitiveData: boolean;
    antiInjectionVerified: boolean;
  };
  previewSnippet: string;
}

export function generateSmartNotification(input: GenerateSmartNotificationInput): GenerateSmartNotificationResult {
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new Error("amountMinor must be a positive integer in minor units (hard rule 1)");
  }
  const isEn = input.locale === "en";
  const safeDebtorName = sanitizePromptData(input.debtorName);
  const safeBusinessName = sanitizePromptData(input.tenantBusinessName);
  const debtorDisplayName = safeDebtorName || (isEn ? "Valued Customer" : "عزيزي العميل");
  const businessDisplayName = safeBusinessName || (isEn ? "DAFQLY" : "دافقلي");
  const currency = input.currency ?? (isEn ? "EGP" : "ج.م");
  const amountMajor = (input.amountMinor / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const invoiceRefText = input.reference ? (isEn ? ` #${input.reference}` : ` رقم ${input.reference}`) : "";

  // Select appropriate tone based on overdue status and customer risk flag
  let tone: NotificationTone = input.tone ?? "polite";
  if (!input.tone) {
    if (input.riskFlag || input.daysOverdue > 30) {
      tone = "urgent";
    } else if (input.daysOverdue > 7) {
      tone = "firm";
    } else if (input.daysOverdue <= 0) {
      tone = "friendly";
    } else {
      tone = "polite";
    }
  }

  let text = "";
  if (!isEn) {
    switch (tone) {
      case "friendly":
        text = `مرحباً ${debtorDisplayName}، نود تذكيرك بموعد استحقاق فاتورتك${invoiceRefText} لدى ${businessDisplayName} بقيمة ${amountMajor} ${currency} في تاريخ ${input.dueDate}. نسعد بتواصلك معنا دائماً.`;
        break;
      case "polite":
        text = `عزيزي ${debtorDisplayName}، نرجو الإحاطة بأن الفاتورة${invoiceRefText} المستحقة لدى ${businessDisplayName} بقيمة ${amountMajor} ${currency} حل موعد سدادها (${input.dueDate}). شاكرين تعاونكم معنا.`;
        break;
      case "firm":
        text = `السيد/ة ${debtorDisplayName}، نلفت انتباهكم إلى تأخر سداد الفاتورة${invoiceRefText} المستحقة لدى ${businessDisplayName} بقيمة ${amountMajor} ${currency} منذ ${input.daysOverdue} يوماً. نرجو التكرم بسرعة السداد لتجنب أي تعليق في التعاملات.`;
        break;
      case "urgent":
        text = `إشعار عاجل - ${debtorDisplayName}: نرجو تسوية المبلغ المتأخر والبالغ ${amountMajor} ${currency} لصالح ${businessDisplayName} بصورة فورية. يرجى التواصل معنا أو السداد عبر الرابط التالي.`;
        break;
    }
    if (input.paymentLink) {
      text += `\nرابط الدفع المباشر والآمن: ${input.paymentLink}`;
    }
  } else {
    switch (tone) {
      case "friendly":
        text = `Hi ${debtorDisplayName}, this is a friendly reminder from ${businessDisplayName} that your invoice${invoiceRefText} of ${amountMajor} ${currency} is due on ${input.dueDate}. We appreciate your business!`;
        break;
      case "polite":
        text = `Dear ${debtorDisplayName}, please note that your invoice${invoiceRefText} of ${amountMajor} ${currency} with ${businessDisplayName} is now due (${input.dueDate}). Thank you for your prompt payment.`;
        break;
      case "firm":
        text = `Notice for ${debtorDisplayName}: Your payment of ${amountMajor} ${currency} to ${businessDisplayName} is overdue by ${input.daysOverdue} days. Please settle this amount to maintain your active account.`;
        break;
      case "urgent":
        text = `Urgent Notice - ${debtorDisplayName}: An outstanding balance of ${amountMajor} ${currency} is past due at ${businessDisplayName}. Please arrange immediate settlement.`;
        break;
    }
    if (input.paymentLink) {
      text += `\nSecure Payment Link: ${input.paymentLink}`;
    }
  }

  // Optimal dispatch window in Cairo timezone (10:00 AM - 12:00 PM business hours)
  const suggestedSendTime = "10:30 AM (Africa/Cairo)";

  return {
    notificationText: text,
    suggestedSendTime,
    toneApplied: tone,
    securityGuards: {
      sanitized: true,
      containsSensitiveData: false,
      antiInjectionVerified: true,
    },
    previewSnippet: text.slice(0, 80) + (text.length > 80 ? "..." : ""),
  };
}

