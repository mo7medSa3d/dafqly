import { formatCurrencyMinor, formatMoney, type SupportedCurrency } from "@tahseel/core";

const NUMBER_LOCALE = "en-US";

/** Format a numeric value with consistent Western/Latin digits (0-9) in both Arabic and English. */
export function formatNumber(
  value: number | bigint,
  _locale: string = "ar",
  options?: Intl.NumberFormatOptions,
): string {
  if (typeof value === "number" && !Number.isFinite(value)) return "0";
  return new Intl.NumberFormat(NUMBER_LOCALE, {
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

/** Format a minor-unit monetary amount without currency symbol using Western/Latin digits. */
export function formatCurrencyAmount(
  minor: bigint | number | string,
  currency: SupportedCurrency | string = "EGP",
): string {
  let b = 0n;
  if (typeof minor === "bigint") b = minor;
  else if (typeof minor === "number") b = Number.isFinite(minor) ? BigInt(Math.trunc(minor)) : 0n;
  else {
    const trimmed = String(minor ?? "").trim();
    b = /^-?\d+$/.test(trimmed) ? BigInt(trimmed) : 0n;
  }
  return formatCurrencyMinor(b, currency, { digits: "latin" });
}
