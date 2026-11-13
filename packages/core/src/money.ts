import { normalizeDigits, toEasternDigits } from "./digits";
import { AppError } from "./errors";

/**
 * Money is integer minor units in bigint. Never floats (BUILD_PLAN §1.1).
 *
 * The minor unit is PER CURRENCY (ISO 4217 exponents): most currencies use
 * 2 decimals, KWD uses 3 (1 KWD = 1000 fils), JPY uses 0. Before this fix
 * every currency was parsed/formatted ÷100, so a 1.234 KWD amount was
 * un-enterable and any KWD amount was 10× wrong. All parsing/formatting
 * must go through `parseMoney`/`formatMoney` with the currency; `parseEgp`/
 * `formatEgp` remain as the EGP (exponent 2) entry points.
 */
/**
 * F-06: a parse failure is an AppError (code INVALID_AMOUNT, HTTP 400),
 * not a bare Error — so every layer that already maps AppError (the tRPC
 * errorFormatter, the route's responseMeta, toApiErrorBody) treats an
 * unreadable amount as a client input error instead of a 500, at every
 * parseMoney call site, present and future. This is the same code the
 * ledger-photo import already threw by hand.
 */
export class MoneyParseError extends AppError {
  constructor(input: string, reason: string, currency: string = "EGP") {
    super("INVALID_AMOUNT", `Invalid ${currency} amount "${input}": ${reason}`, 400);
    this.name = "MoneyParseError";
  }
}

export type SupportedCurrency = "EGP" | "SAR" | "USD" | "AED" | "EUR" | "KWD" | "JPY";

/** ISO 4217 minor-unit exponents. */
export const CURRENCY_MINOR_EXPONENT: Record<SupportedCurrency, 0 | 2 | 3> = {
  EGP: 2,
  SAR: 2,
  USD: 2,
  AED: 2,
  EUR: 2,
  KWD: 3,
  JPY: 0,
};

const SUPPORTED_CURRENCIES: readonly string[] = ["EGP", "SAR", "USD", "AED", "EUR", "KWD", "JPY"];

/** Narrow a stored/free-text currency code to a supported one (F-06): an
 * unknown or empty code falls back to EGP rather than throwing, matching
 * the DB CHECK constraints that only admit these seven codes. */
export function normalizeCurrencyCode(currency: string | null | undefined): SupportedCurrency {
  const norm = (currency ?? "").toUpperCase();
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(norm) ? (norm as SupportedCurrency) : "EGP";
}

export function currencyMinorExponent(currency: string): 0 | 2 | 3 {
  const norm = (currency || "EGP").toUpperCase() as SupportedCurrency;
  // Unknown codes fall back to 2 (legacy behaviour); input boundaries
  // (tenant settings, invoice create) validate against SupportedCurrency,
  // so an unknown code reaching here is a stored-data problem, not input.
  return CURRENCY_MINOR_EXPONENT[norm] ?? 2;
}

export function parseMoney(input: string, currency: SupportedCurrency | string = "EGP"): bigint {
  const code = (currency || "EGP").toUpperCase();
  const exponent = currencyMinorExponent(code);
  const scale = 10n ** BigInt(exponent);
  if (typeof input !== "string") throw new MoneyParseError(String(input), "not a string", code);
  let normalized = normalizeDigits(input)
    .trim()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/\s+/g, "");
  if (normalized === "") throw new MoneyParseError(input, "empty", code);

  if (exponent === 0) {
    // No fractional part exists for zero-decimal currencies: separators
    // are thousands groups (exactly 3 digits) only — "500.5" is a decimal
    // and must be rejected, not silently read as 5005.
    if (!/^\d+$/.test(normalized) && !/^\d{1,3}([,.]\d{3})+$/.test(normalized)) {
      throw new MoneyParseError(input, "expected whole digits (no decimal places)", code);
    }
    return BigInt(normalized.replace(/[,.]/g, ""));
  }

  const grouped = new RegExp(`^\\d{1,3}(\\.\\d{3})*,\\d{1,${exponent}}$`);
  const commaDecimal = new RegExp(`^\\d+,\\d{1,${exponent}}$`);
  if (grouped.test(normalized)) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (commaDecimal.test(normalized)) {
    normalized = normalized.replace(",", ".");
  } else {
    normalized = normalized.replace(/,/g, "");
  }

  const decimalPattern = new RegExp(`^\\d+(\\.\\d{1,${exponent}})?$`);
  if (!decimalPattern.test(normalized)) {
    const tooMany = new RegExp(`^\\d+\\.\\d{${exponent + 1},}$`);
    if (tooMany.test(normalized)) throw new MoneyParseError(input, `more than ${exponent} decimal places`, code);
    throw new MoneyParseError(input, `expected digits with at most ${exponent} decimal places`, code);
  }
  const [whole, frac = ""] = normalized.split(".");
  return BigInt(whole ?? "0") * scale + BigInt((frac + "0".repeat(exponent)).slice(0, exponent));
}

/** EGP entry point (exponent 2). Kept for the many EGP call sites. */
export function parseEgp(input: string): bigint {
  return parseMoney(input, "EGP");
}

export function formatCurrencyMinor(
  minor: bigint,
  currency: SupportedCurrency | string = "EGP",
  opts: { digits?: "latin" | "eastern" } = {}
): string {
  const exponent = currencyMinorExponent(currency);
  const scale = 10n ** BigInt(exponent);
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = (abs / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const latin =
    exponent === 0
      ? `${negative ? "-" : ""}${whole}`
      : `${negative ? "-" : ""}${whole}.${(abs % scale).toString().padStart(exponent, "0")}`;
  return opts.digits === "eastern" ? toEasternDigits(latin) : latin;
}

/** EGP entry point (exponent 2). Kept for the many EGP call sites. */
export function formatEgp(minor: bigint, opts: { digits?: "latin" | "eastern" } = {}): string {
  return formatCurrencyMinor(minor, "EGP", opts);
}

export const CURRENCY_SYMBOLS: Record<string, { ar: string; en: string }> = {
  EGP: { ar: "ج.م", en: "EGP" },
  SAR: { ar: "ر.س", en: "SAR" },
  USD: { ar: "$", en: "$" },
  AED: { ar: "د.إ", en: "AED" },
  EUR: { ar: "€", en: "EUR" },
  KWD: { ar: "د.ك", en: "KWD" },
  JPY: { ar: "¥", en: "¥" },
};

export function getCurrencySymbol(currency: string = "EGP", locale: string = "ar"): string {
  const norm = (currency || "EGP").toUpperCase();
  const entry = CURRENCY_SYMBOLS[norm];
  if (!entry) return currency;
  return locale === "en" ? entry.en : entry.ar;
}

export function formatMoney(
  minor: bigint | number | string,
  currency: string = "EGP",
  opts: { locale?: string; digits?: "latin" | "eastern" } = {}
): string {
  const b = typeof minor === "bigint" ? minor : BigInt(String(minor || "0"));
  const num = formatCurrencyMinor(b, currency, { digits: opts.digits });
  const sym = getCurrencySymbol(currency, opts.locale ?? "ar");
  return opts.locale === "en" ? `${sym} ${num}` : `${num} ${sym}`;
}

export function sumMoney(values: Iterable<bigint>): bigint {
  let total = 0n;
  for (const v of values) total += v;
  return total;
}
