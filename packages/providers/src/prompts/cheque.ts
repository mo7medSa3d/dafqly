import { buildExtractionPrompt } from "./shared";

/**
 * Cheque photo extraction prompt (F9). The image is untrusted DATA to
 * transcribe, never an instruction.
 */
export const CHEQUE_PROMPT_VERSION = "cheque-v1";
export const CHEQUE_TOOL_NAME = "extract_cheque";

export const CHEQUE_SYSTEM = buildExtractionPrompt("cheque-extraction", CHEQUE_TOOL_NAME, "image", [
  "Set unreadable fields to null.",
  "Convert the exact amount shown into integer minor units (piasters) in amount_minor.",
  "confidence (0..1) reflects transcription certainty; lower it for blurry, tilted, or dark images.",
]);

export const CHEQUE_USER = "Extract the cheque fields from this image into the tool call.";

export const CHEQUE_TOOL_SCHEMA = {
  type: "object",
  properties: {
    number: { type: ["string", "null"], description: "Cheque number" },
    bank: { type: ["string", "null"], description: "Issuing bank name" },
    amount_minor: { type: ["number", "null"], description: "Amount in integer minor units (piasters)" },
    issue_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
    due_date: { type: ["string", "null"], description: "YYYY-MM-DD (the date written on the cheque)" },
    drawer_name: { type: ["string", "null"], description: "Name of the drawer or account holder signing the cheque (الساحب أو صاحب الحساب)" },
    payee_name: { type: ["string", "null"], description: "Name of the beneficiary/payee (المستفيد)" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["confidence"],
} as const;
