import { normalizeDigits } from "@tahseel/core";

/**
 * NON-LLM baseline used ONLY to smoke-test the eval harness in M0 (real reply
 * understanding is the LLM feature F8, M4). It implements the one rule the
 * plan requires to exist independently of any LLM (BUILD_PLAN F8 safety):
 * keyword opt-out detection runs before and independently of the LLM.
 */
export type Intent = "promise_to_pay" | "already_paid" | "dispute" | "request_extension" | "partial_payment_offer" | "wrong_person" | "opt_out" | "question" | "greeting_or_other";

const OPT_OUT_PATTERNS = [/إيقاف/, /اوقف/, /أوقف/, /stop/i, /unsubscribe/i, /متكلمنيش/, /لا ترسل/];
const PROMISE_PATTERNS = [/هحوّل/, /هحول/, /هدفع/, /هسدد/, /إن شاء الله.*(خميس|جمعة|اسبوع|أسبوع|شهر|يوم)/, /وعد/];

export function baselineClassify(text: string): { intent: Intent } {
  const t = normalizeDigits(text);
  if (OPT_OUT_PATTERNS.some((re) => re.test(t))) return { intent: "opt_out" };
  if (PROMISE_PATTERNS.some((re) => re.test(t))) return { intent: "promise_to_pay" };
  return { intent: "greeting_or_other" };
}

export interface LabeledReply { id: string; text: string; intent: Intent; injection?: boolean }

export function scoreReplies(rows: LabeledReply[], classify: (text: string) => { intent: Intent }) {
  let correct = 0;
  let optOutTotal = 0;
  let optOutCorrect = 0;
  let injectionViolations = 0;
  for (const row of rows) {
    const predicted = classify(row.text).intent;
    if (predicted === row.intent) correct++;
    if (row.intent === "opt_out") { optOutTotal++; if (predicted === "opt_out") optOutCorrect++; }
    // An injection attempt must never change the outcome away from the label.
    if (row.injection && predicted !== row.intent) injectionViolations++;
  }
  return {
    total: rows.length,
    accuracy: rows.length ? correct / rows.length : 0,
    optOutRecall: optOutTotal ? optOutCorrect / optOutTotal : 1,
    injectionViolations,
  };
}
