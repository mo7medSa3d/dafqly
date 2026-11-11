import { normalizeDigits, toEasternDigits } from "./digits";

/** Money is integer minor units (piasters) in bigint. Never floats (BUILD_PLAN §1.1). */
export class MoneyParseError extends Error {
  constructor(input: string, reason: string) {
    super(`Invalid EGP amount "${input}": ${reason}`);
    this.name = "MoneyParseError";
  }
}

export function parseEgp(input: string): bigint {
  if (typeof input !== "string") throw new MoneyParseError(String(input), "not a string");
  let normalized = normalizeDigits(input)
    .trim()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/\s+/g, "");
  if (normalized === "") throw new MoneyParseError(input, "empty");

  if (/^\d{1,3}(\.\d{3})*,\d{1,2}$/.test(normalized)) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (/^\d+,\d{1,2}$/.test(normalized)) {
    normalized = normalized.replace(",", ".");
  } else {
    normalized = normalized.replace(/,/g, "");
  }

  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    if (/^\d+\.\d{3,}$/.test(normalized)) throw new MoneyParseError(input, "more than 2 decimal places");
    throw new MoneyParseError(input, "expected digits with at most 2 decimal places");
  }
  const [whole, frac = ""] = normalized.split(".");
  return BigInt(whole ?? "0") * 100n + BigInt((frac + "00").slice(0, 2));
}

export function formatEgp(minor: bigint, opts: { digits?: "latin" | "eastern" } = {}): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const whole = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (abs % 100n).toString().padStart(2, "0");
  const latin = `${negative ? "-" : ""}${whole}.${frac}`;
  return opts.digits === "eastern" ? toEasternDigits(latin) : latin;
}

export function sumMoney(values: Iterable<bigint>): bigint {
  let total = 0n;
  for (const v of values) total += v;
  return total;
}
