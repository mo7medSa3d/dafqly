import { parsePhoneNumberFromString } from "libphonenumber-js";
import { normalizeDigits } from "./digits";

export class PhoneError extends Error {
  constructor(input: string, reason: string) {
    super(`Invalid phone "${input}": ${reason}`);
    this.name = "PhoneError";
  }
}

/**
 * Mask a phone number for LOGS (BUILD_PLAN §8: no PII in logs). Keeps the
 * country code and the last two digits only: +201012345678 -> +20*****78.
 * Anything shorter than 6 chars is fully masked. Use everywhere a phone
 * could reach a log line (provider calls, webhook processing, worker jobs).
 */
export function maskPhone(input: string | null | undefined): string {
  if (!input) return "(none)";
  const digits = input.replace(/[^\d]/g, "");
  if (digits.length < 6) return "*****";
  return `+${digits.slice(0, 2)}*****${digits.slice(-2)}`;
}

export interface NormalizedPhone {
  e164: string;
  valid: boolean;
  isMobile: boolean;
  /** Landlines are rejected for WhatsApp (BUILD_PLAN §6). */
  whatsappCapable: boolean;
}

export function normalizeEgPhone(input: string): NormalizedPhone {
  const cleaned = normalizeDigits(input).replace(/[\s()-]/g, "");
  if (cleaned === "") throw new PhoneError(input, "empty");
  const parsed = parsePhoneNumberFromString(cleaned, "EG");
  if (!parsed || !parsed.isValid()) throw new PhoneError(input, "not a valid Egyptian number");
  const type = parsed.getType();
  // The bundled libphonenumber metadata returns an undefined type for many
  // valid EG numbers (found by the F2 golden fixtures in M1: every debtor
  // was being flagged not-WhatsApp-capable). When the type is unknown, fall
  // back to the Egyptian numbering plan: mobile NSNs are 10 digits starting
  // 10/11/12/15; landline NSNs start with the area code (2-9).
  const isMobile = type !== undefined
    ? type === "MOBILE" || type === "FIXED_LINE_OR_MOBILE"
    : /^1[0125]\d{8}$/.test(parsed.nationalNumber);
  return { e164: parsed.number, valid: true, isMobile, whatsappCapable: isMobile };
}
