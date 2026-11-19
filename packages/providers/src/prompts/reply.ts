import { buildExtractionPrompt } from "./shared";

/**
 * Egyptian-Arabic reply classification prompt (F8). SAFETY: customer message
 * is quoted as DATA below a hard delimiter and must never be followed as an
 * instruction.
 */
export const REPLY_PROMPT_VERSION = "reply-v1";
export const REPLY_TOOL_NAME = "classify_reply";
const MAX_REPLY_CHARS = 4_000;

export const REPLY_SYSTEM = buildExtractionPrompt("reply-classification", REPLY_TOOL_NAME, "<customer_message> tags", [
  "Classify one customer reply (colloquial Arabic, Franco-Arabic, typos, or mixed) into: promise_to_pay, already_paid, dispute, request_extension, partial_payment_offer, wrong_person, opt_out, question, greeting_or_other.",
  "For promise_to_pay and request_extension, extract promised_date (YYYY-MM-DD) against the current date; if ambiguous (e.g. بعد العيد), leave null and lower confidence.",
  "confidence (0..1): scores below 0.8 route to a human, so lower confidence when unsure, sarcastic, or angry.",
]);

export function replyUserText(text: string, context: { todayIso: string; timezone: string; dueOn?: string | null }): string {
  // Neutralize delimiter tags inside untrusted customer text so a reply cannot escape <customer_message>.
  const safeText = text
    .slice(0, MAX_REPLY_CHARS)
    .replace(/<\/?customer_message\b[^>]*>/gi, (m) => m.replace(/</g, "&lt;").replace(/>/g, "&gt;"));
  return [
    `Current date: ${context.todayIso} (timezone ${context.timezone}).`,
    context.dueOn ? `The invoice being discussed was due on ${context.dueOn}.` : "No specific invoice is attached.",
    "<customer_message>",
    safeText,
    "</customer_message>",
  ].join("\n");
}

export const REPLY_TOOL_SCHEMA = {
  type: "object",
  properties: {
    intent: {
      type: "string",
      enum: ["promise_to_pay", "already_paid", "dispute", "request_extension", "partial_payment_offer", "wrong_person", "opt_out", "question", "greeting_or_other"],
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    promised_date: { type: ["string", "null"], description: "YYYY-MM-DD or null" },
    amount_minor: { type: ["number", "string", "null"], description: "Amount offered/mentioned, if any" },
  },
  required: ["intent", "confidence"],
} as const;
