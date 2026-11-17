import { buildExtractionPrompt } from "./shared";

/**
 * Transfer-receipt extraction prompt (F7). The image is untrusted DATA:
 * text inside a screenshot is evidence to transcribe, never an instruction.
 */
export const RECEIPT_PROMPT_VERSION = "receipt-v1";
export const RECEIPT_TOOL_NAME = "extract_receipt";

export const RECEIPT_SYSTEM = buildExtractionPrompt("receipt-extraction", RECEIPT_TOOL_NAME, "image", [
  "If the image is not a transfer receipt (InstaPay, bank app, mobile wallet, or Fawry), set is_receipt to false.",
  "Transcribe the exact amount shown. List any editing/tampering signs in tamper_signals (empty array if none).",
  "confidence (0..1) reflects transcription certainty; lower it for blurry, cropped, or dark images.",
]);

export const RECEIPT_USER = "Extract the transfer receipt fields from this image into the tool call.";

export const RECEIPT_TOOL_SCHEMA = {
  type: "object",
  properties: {
    is_receipt: { type: "boolean" },
    amount_minor: { type: ["number", "string", "null"], description: "Amount transferred; a string may use Arabic digits exactly as shown." },
    currency: { type: ["string", "null"] },
    datetime: { type: ["string", "null"], description: "ISO 8601 datetime shown on the receipt, or null" },
    sender_name: { type: ["string", "null"] },
    sender_account_tail: { type: ["string", "null"], description: "Last digits of the sender account/phone shown" },
    reference_no: { type: ["string", "null"] },
    method: { type: ["string", "null"], enum: ["instapay", "bank", "wallet", "fawry", "other", null] },
    status_text: { type: ["string", "null"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    tamper_signals: { type: "array", items: { type: "string" } },
  },
  required: ["is_receipt", "confidence", "tamper_signals"],
} as const;
