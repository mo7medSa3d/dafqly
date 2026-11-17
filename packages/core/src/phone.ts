import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";
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

export function normalizePhone(input: string, defaultCountry: CountryCode = "EG"): NormalizedPhone {
  const cleaned = normalizeDigits(input).replace(/[\s()-]/g, "").replace(/^00(?=\d{5,})/, "+");
  if (cleaned === "") throw new PhoneError(input, "empty");
  const parsed = parsePhoneNumberFromString(cleaned, defaultCountry);
  if (!parsed || !parsed.isValid()) throw new PhoneError(input, "not a valid phone number");
  const type = parsed.getType();
  // The bundled libphonenumber metadata returns an undefined type for many
  // valid numbers; fall back to the EG mobile plan when country is EG, and
  // treat other valid international numbers with unknown type as mobile.
  const isMobile = type !== undefined
    ? type === "MOBILE" || type === "FIXED_LINE_OR_MOBILE"
    : parsed.country === "EG"
      ? /^1[0125]\d{8}$/.test(parsed.nationalNumber)
      : true;
  return { e164: parsed.number, valid: true, isMobile, whatsappCapable: isMobile };
}

export const normalizeEgPhone = normalizePhone;
