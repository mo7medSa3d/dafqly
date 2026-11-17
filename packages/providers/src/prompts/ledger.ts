/**
 * Ledger-photo extraction prompt (F6). The image is untrusted DATA:
 * handwriting that looks like an instruction is still just a ledger row.
 */
import { currencyMinorExponent, normalizeCurrencyCode } from "@tahseel/core";
import { buildExtractionPrompt } from "./shared";

export const LEDGER_PROMPT_VERSION = "ledger-v2";
export const LEDGER_TOOL_NAME = "extract_ledger_rows";

export function ledgerSystemForCurrency(inputCurrency = "EGP"): string {
  const currency = normalizeCurrencyCode(inputCurrency);
  const exponent = currencyMinorExponent(currency);
  return buildExtractionPrompt("ledger-extraction", LEDGER_TOOL_NAME, "ledger image", [
    `Extract one row per entry. Tenant currency is ${currency}; transcribe amounts in ${currency} as a STRING in major units (max ${exponent} decimal places, never pre-scaled).`,
    "Report row confidence (0..1) and cellConfidence for name and amount; lower confidence instead of guessing unclear handwriting.",
    "Format dates as YYYY-MM-DD when present; keep phone numbers as written.",
  ]);
}

/** Backwards-compatible EGP prompt for offline fixtures and evals. */
export const LEDGER_SYSTEM = ledgerSystemForCurrency("EGP");

export const LEDGER_USER = "Transcribe every entry row on this ledger page into the tool call. Skip header and total lines.";

export const LEDGER_TOOL_SCHEMA = {
  type: "object",
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          phone: { type: ["string", "null"] },
          amount_minor: { type: "string", description: "Exact amount owed in the tenant currency, as major units and with no pre-scaling; use Arabic or Latin digits." },
          date: { type: ["string", "null"], description: "YYYY-MM-DD or null" },
          note: { type: ["string", "null"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          cellConfidence: {
            type: "object",
            properties: {
              name: { type: "number", minimum: 0, maximum: 1 },
              amount: { type: "number", minimum: 0, maximum: 1 },
            },
            required: ["name", "amount"],
          },
        },
        required: ["name", "amount_minor", "confidence", "cellConfidence"],
      },
    },
  },
  required: ["rows"],
} as const;
