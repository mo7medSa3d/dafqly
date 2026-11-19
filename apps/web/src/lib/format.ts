import { formatCurrencyMinor, formatMoney, type SupportedCurrency } from "@tahseel/core";

const NUMBER_LOCALE = "en-US";
const MAX_FORMATTER_CACHE = 64;

const DEFAULT_NUMBER_FMT = new Intl.NumberFormat(NUMBER_LOCALE, { numberingSystem: "latn" });
const numberFormatterCache = new Map<string, Intl.NumberFormat>();
const dateTimeFormatterCache = new Map<string, Intl.DateTimeFormat>();

function buildCacheKey(locale: string, options?: Record<string, unknown>): string {
  if (!options) return locale;
  const keys = Object.keys(options).sort();
  let key = locale;
  for (const k of keys) {
    const v = options[k];
    if (v !== undefined) key += `|${k}=${String(v)}`;
  }
  return key;
}

function getOrCreate<T>(cache: Map<string, T>, key: string, create: () => T): T {
  const cached = cache.get(key);
  if (cached) return cached;
  if (cache.size >= MAX_FORMATTER_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  const created = create();
  cache.set(key, created);
  return created;
}

/** Return a cached Intl.NumberFormat instance (bounded FIFO cache). */
export function getNumberFormatter(
  locale: string = NUMBER_LOCALE,
  options?: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  const key = buildCacheKey(locale, options as Record<string, unknown> | undefined);
  return getOrCreate(numberFormatterCache, key, () => new Intl.NumberFormat(locale, options));
}

/** Return a cached Intl.DateTimeFormat instance (bounded FIFO cache). */
export function getDateTimeFormatter(
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = buildCacheKey(locale, options as Record<string, unknown> | undefined);
  return getOrCreate(dateTimeFormatterCache, key, () => new Intl.DateTimeFormat(locale, options));
}

/** Format a date/timestamp using a cached Intl.DateTimeFormat instance. */
export function formatDateTime(
  value: Date | number,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  return getDateTimeFormatter(locale, options).format(value);
}

/** Format a numeric value with consistent Western/Latin digits (0-9) in both Arabic and English. */
export function formatNumber(
  value: number | bigint,
  _locale: string = "ar",
  options?: Intl.NumberFormatOptions,
): string {
  if (typeof value === "number" && !Number.isFinite(value)) return "0";
  if (!options) return DEFAULT_NUMBER_FMT.format(value);
  return getNumberFormatter(NUMBER_LOCALE, {
    ...options,
    numberingSystem: "latn",
  }).format(value);
}

/** Format an integer count with consistent Western/Latin digits (0-9). */
export function formatCount(count: number | bigint, locale: string = "ar"): string {
  return formatNumber(count, locale, { maximumFractionDigits: 0 });
}

/** Format a 0..1 fraction as a percentage (e.g. 0.583 -> "58.3%") with Western/Latin digits. */
export function formatPercent(fraction: number, locale: string = "ar", fractionDigits = 1): string {
  const safe = Number.isFinite(fraction) ? fraction : 0;
  const pct = formatNumber(safe * 100, locale, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
  return `${pct}%`;
}

/** Format a minor-unit monetary amount with currency symbol using Western/Latin digits. */
export function formatCurrency(
  minor: bigint | number | string,
  currency: SupportedCurrency | string = "EGP",
  locale: string = "ar",
): string {
  return formatMoney(minor, currency, { locale, digits: "latin" });
}

/** Safely convert a minor-unit value to bigint without throwing on floats, NaN, or malformed strings. */
export function toSafeBigInt(minor: bigint | number | string | null | undefined): bigint {
  if (typeof minor === "bigint") return minor;
  if (typeof minor === "number") return Number.isFinite(minor) ? BigInt(Math.trunc(minor)) : 0n;
  const trimmed = String(minor ?? "").trim();
  return /^-?\d+$/.test(trimmed) ? BigInt(trimmed) : 0n;
}

/** Format a minor-unit monetary amount without currency symbol using Western/Latin digits. */
export function formatCurrencyAmount(
  minor: bigint | number | string,
  currency: SupportedCurrency | string = "EGP",
): string {
  return formatCurrencyMinor(toSafeBigInt(minor), currency, { digits: "latin" });
}
