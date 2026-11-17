import {
  isOptOutText, normalizeDigits, parseLedgerExtraction, parseReceiptExtraction,
  parseChequeExtraction, resolveRelativeDate,
  type LedgerExtraction, type ReceiptExtraction, type ReplyClassification, type ChequeExtraction,
} from "@tahseel/core";
import { LEDGER_PROMPT_VERSION } from "./prompts/ledger";
import { RECEIPT_PROMPT_VERSION } from "./prompts/receipt";
import { CHEQUE_PROMPT_VERSION } from "./prompts/cheque";
import { REPLY_PROMPT_VERSION } from "./prompts/reply";

/**
 * OcrLlmProvider (BUILD_PLAN §3/§7 F6–F8, ADR-005/022): the ONLY way code in
 * this repo talks to an LLM. Every result passes through the core Zod
 * parsers — invalid model output becomes `data: null`, which callers route
 * to human review (hard rule 4). Each result carries model, prompt version,
 * token usage and latency so callers can write the usage_ledger row.
 *
 * Anthropic adapter: verified API shapes are recorded in ADR-022 (Messages
 * API, forced tool use for structured output). It is tested with mocked
 * fetch ONLY — no Anthropic API key exists in this environment, and no real
 * call is ever made from dev/CI/tests.
 */
export interface LlmCallResult<T> {
  data: T | null;
  model: string;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface ReplyContext {
  todayIso: string; // tenant-local YYYY-MM-DD
  timezone: string;
  dueOn?: string | null;
}

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface AgentToolExecution {
  name: string;
  arguments: Record<string, unknown>;
  result: unknown;
}

export interface AgentRunResult {
  text: string;
  toolExecutions: AgentToolExecution[];
  inputTokens: number;
  outputTokens: number;
  model: string;
  steps: number;
}

/**
 * Live progress of an agent run. Providers emit these ONLY when the caller
 * passes `onEvent`; without it they use the plain (non-streaming) request path.
 * `text_delta` is the model's own prose as it is generated (real token
 * streaming); `tool_start`/`tool_result` bracket every server-side tool call so
 * the UI can show what the assistant is actually doing.
 */
export type AgentEvent =
  | { type: "step"; step: number }
  | { type: "text_delta"; text: string; step: number }
  | { type: "tool_start"; id: string; name: string; arguments: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; ok: boolean; result: unknown };

export interface AgentRunInput {
  systemInstruction: string;
  messages: AgentMessage[];
  tools: AgentToolDefinition[];
  executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  maxSteps?: number;
  maxToolCalls?: number;
  /** Enables the streaming request path and receives live events. */
  onEvent?: (event: AgentEvent) => void;
  /** Client disconnect / user "stop" — aborts the provider request in flight. */
  signal?: AbortSignal;
  locale?: "ar" | "en" | string;
}

export function maxStepsFallbackText(locale?: string): string {
  if (locale === "en") {
    return "I could not complete the analysis within the tool step limit. Try breaking the question into smaller steps.";
  }
  if (locale === "ar") {
    return "لم أتمكن من إكمال التحليل ضمن حد خطوات الأدوات. جرّب تقسيم السؤال إلى خطوات أصغر.";
  }
  return "I could not complete the analysis within the tool step limit. Try breaking the question into smaller steps.\n\nلم أتمكن من إكمال التحليل ضمن حد خطوات الأدوات. جرّب تقسيم السؤال إلى خطوات أصغر.";
}

/** Shared by every adapter: run one tool call, emit events, never throw. */
export async function executeAgentToolCall(args: {
  id: string; name: string; toolArgs: Record<string, unknown>;
  allowed: ReadonlySet<string>; executed: number; maxToolCalls: number;
  executeTool: AgentRunInput["executeTool"]; onEvent?: AgentRunInput["onEvent"];
}): Promise<unknown> {
  args.onEvent?.({ type: "tool_start", id: args.id, name: args.name, arguments: args.toolArgs });
  let result: unknown;
  if (args.executed >= args.maxToolCalls) result = { error: "tool_call_limit_reached" };
  else if (!args.allowed.has(args.name)) result = { error: "tool_not_allowed" };
  else {
    try { result = await args.executeTool(args.name, args.toolArgs); }
    catch (err) {
      result = { error: "tool_execution_failed", detail: err instanceof Error ? err.message.slice(0, 200) : "unknown" };
    }
  }
  const ok = !(result && typeof result === "object" && typeof (result as { error?: unknown }).error === "string");
  args.onEvent?.({ type: "tool_result", id: args.id, name: args.name, ok, result });
  return result;
}

export interface OcrLlmProvider {
  extractLedgerPage(image: Uint8Array, mime: string, currency?: string): Promise<LlmCallResult<LedgerExtraction>>;
  extractReceipt(image: Uint8Array, mime: string): Promise<LlmCallResult<ReceiptExtraction>>;
  classifyReply(text: string, context: ReplyContext): Promise<LlmCallResult<ReplyClassification>>;
  /** F9: cheque photo -> fields for a merchant-reviewed pre-filled form (a claim, never a registration). */
  extractCheque(image: Uint8Array, mime: string): Promise<LlmCallResult<ChequeExtraction>>;
  generateText?(prompt: string, systemInstruction?: string): Promise<{ text: string; inputTokens: number; outputTokens: number; model?: string }>;
  /** Native multi-turn tool calling; tools are executed only by the server callback. */
  runAgent?(input: AgentRunInput): Promise<AgentRunResult>;
  /** Emits provider text deltas as they arrive; used for user-visible token streaming. */
  streamText?(prompt: string, systemInstruction: string | undefined, onToken: (delta: string) => void, signal?: AbortSignal): Promise<{ text: string; inputTokens: number; outputTokens: number; model?: string }>;
}

export class LlmNotConfiguredError extends Error {
  constructor() {
    super("LLM_NOT_CONFIGURED: AI_API_KEY is not set");
    this.name = "LlmNotConfiguredError";
  }
}


// --------------------------------------------------------------------- FAKE
/**
 * FAKE provider (deterministic, for tests and the eval harness — NOT a real
 * LLM and never presented as one):
 * - Images: synthetic dataset images are SVG text files whose text embeds a
 *   machine-readable payload line `TAHSEEL_SYNTHETIC_B64:<base64 JSON>`
 *   written by the dataset generator (packages/eval/scripts). The JSON holds
 *   the PERFECT reading plus an `errors` script describing which cells/fields
 *   the "reader" misreads and at what (low) confidence — the fake applies
 *   those labelled reading errors deterministically, which is exactly what
 *   the eval targets measure (accuracy + wrong-cell low-flag rate). An image
 *   without the payload yields `data: null` (routes to a human), like an
 *   unreadable photo.
 * - Replies: a rule-based Egyptian-dialect classifier (keyword/pattern
 *   tables + core's deterministic resolveRelativeDate for promised dates).
 *   It is the stand-in classifier the F8 eval scores, labelled as such.
 */
export const SYNTHETIC_MARKER = "TAHSEEL_SYNTHETIC_B64:";

interface SyntheticPayload {
  kind: "ledger" | "receipt" | "cheque";
  rows?: Record<string, unknown>[];
  extraction?: Record<string, unknown>;
  errors?: Record<string, Record<string, unknown>>;
}

function readSyntheticPayload(image: Uint8Array): SyntheticPayload | null {
  const text = new TextDecoder().decode(image);
  const at = text.indexOf(SYNTHETIC_MARKER);
  if (at < 0) return null;
  const rest = text.slice(at + SYNTHETIC_MARKER.length);
  const b64 = rest.match(/[A-Za-z0-9+/=]+/)?.[0];
  if (!b64) return null;
  try {
    return JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as SyntheticPayload;
  } catch {
    return null;
  }
}

const zeroUsage = { inputTokens: 0, outputTokens: 0, latencyMs: 0 };

export class FakeLlmProvider implements OcrLlmProvider {
  readonly modelFast = "fake-fast";
  readonly modelVision = "fake-vision";

  async extractLedgerPage(image: Uint8Array, _mime: string, currency = "EGP"): Promise<LlmCallResult<LedgerExtraction>> {
    const payload = readSyntheticPayload(image);
    if (!payload || payload.kind !== "ledger" || !payload.rows) {
      return { data: null, model: this.modelVision, promptVersion: LEDGER_PROMPT_VERSION, ...zeroUsage };
    }
    const rows = payload.rows.map((row, i) => {
      const err = payload.errors?.[String(i)] ?? {};
      const merged: Record<string, unknown> = { ...row, ...err };
      if (err.cellConfidence) {
        merged.cellConfidence = { ...((row.cellConfidence as object) ?? {}), ...(err.cellConfidence as object) };
      }
      return merged;
    });
    return {
      data: parseLedgerExtraction({ rows }, currency), model: this.modelVision,
      promptVersion: LEDGER_PROMPT_VERSION, ...zeroUsage,
    };
  }

  async extractReceipt(image: Uint8Array, _mime: string): Promise<LlmCallResult<ReceiptExtraction>> {
    const payload = readSyntheticPayload(image);
    if (!payload || payload.kind !== "receipt" || !payload.extraction) {
      return { data: null, model: this.modelVision, promptVersion: RECEIPT_PROMPT_VERSION, ...zeroUsage };
    }
    const merged = { ...payload.extraction, ...(payload.errors ?? {}) };
    return {
      data: parseReceiptExtraction(merged), model: this.modelVision,
      promptVersion: RECEIPT_PROMPT_VERSION, ...zeroUsage,
    };
  }

  async classifyReply(text: string, context: ReplyContext): Promise<LlmCallResult<ReplyClassification>> {
    const data = fakeClassifyReply(text, context);
    return { data, model: this.modelFast, promptVersion: REPLY_PROMPT_VERSION, ...zeroUsage };
  }

  /** FAKE: reads the synthetic payload's cheque extraction, like the other vision methods. */
  async extractCheque(image: Uint8Array, _mime: string): Promise<LlmCallResult<ChequeExtraction>> {
    const payload = readSyntheticPayload(image);
    if (!payload || payload.kind !== "cheque" || !payload.extraction) {
      return { data: null, model: this.modelVision, promptVersion: CHEQUE_PROMPT_VERSION, ...zeroUsage };
    }
    const merged = { ...payload.extraction, ...(payload.errors ?? {}) };
    return {
      data: parseChequeExtraction(merged), model: this.modelVision,
      promptVersion: CHEQUE_PROMPT_VERSION, ...zeroUsage,
    };
  }

  async generateText(_prompt: string, _systemInstruction?: string): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    return {
      text: `[تحليل الذكاء الاصطناعي]: تم فحص استفسارك ومطابقته مع دفاتر المنشأة. المستحقات والسيولة متابعة بدقة.`,
      inputTokens: 50,
      outputTokens: 50,
    };
  }
}

/**
 * FAKE rule-based Egyptian-dialect classifier (the eval's stand-in for the
 * LLM — see the class comment). Pattern order matters: opt-out first (the
 * keyword rule also runs before the LLM in production), then wrong_person,
 * already_paid, partial offers, dispute, extension, promise, question,
 * greeting; anything else is a low-confidence greeting_or_other, which the
 * core allowlist routes to the human inbox.
 */
export function fakeClassifyReply(text: string, context: ReplyContext): ReplyClassification {
  const t = normalizeDigits(text);
  const date = resolveRelativeDate(t, context.todayIso, context.timezone);
  const promised = date.ambiguous ? null : date.date;
  const conf = (c: number): number => (date.ambiguous ? Math.min(c, 0.5) : c);

  if (isOptOutText(t)) return { intent: "opt_out", confidence: 0.99, promised_date: null, amount_minor: null };
  // NB: no \b after Arabic words (JS \b is ASCII-only), and "دفعت" must not
  // fire on "دفعتين" (two instalments) nor "بعت" on "هبعت" (I will send).
  if (/الرقم\s*(ده\s*)?غلط|مش\s*(أنا|انا)|الشخص\s+ده\s+مش|وصلت\s*(ل)?لرقم\s+غلط/.test(t)) {
    return { intent: "wrong_person", confidence: 0.9, promised_date: null, amount_minor: null };
  }
  if (/دفعت(?!ين)|دافع|حوّلت|حولت|سددت|تم\s+التحويل|(^|\s)بعت\s*(لك\s*)?(التحويل|الفلوس)/.test(t)) {
    return { intent: "already_paid", confidence: 0.9, promised_date: null, amount_minor: null };
  }
  const amountMatch = t.match(/(\d[\d,]*)\s*(جنيه|ج\.م|ج\b)/);
  if (/جزء|نص\s+المبلغ|دفعة|قسط/.test(t) || (/هدفع|هبعت|هحوّل|هحول/.test(t) && amountMatch)) {
    return {
      intent: "partial_payment_offer", confidence: 0.87, promised_date: promised,
      amount_minor: amountMatch ? Math.round(Number(amountMatch[1]!.replace(/,/g, "")) * 100) : null,
    };
  }
  if (/مش\s+بتاعت|اعتراض|معترض|ماشتريتش|مش\s+ليا|الفاتورة\s+دي\s+غلط|الفاتورة\s+غلط|حاسب\s+غلط/.test(t)) {
    return { intent: "dispute", confidence: 0.9, promised_date: null, amount_minor: null };
  }
  if (/مهلة|أمهل|امهل|استنى\s+عليا|اصبر\s+عليا|محتاج\s+وقت|أجّل|اجل|تأجيل/.test(t)) {
    return { intent: "request_extension", confidence: conf(0.88), promised_date: promised, amount_minor: null };
  }
  if (/هدفع|هحوّل|هحول|هسدد|وعد|هبعت\s+الفلوس/.test(t)) {
    return { intent: "promise_to_pay", confidence: conf(0.92), promised_date: promised, amount_minor: null };
  }
  if (/سلام|صباح\s+الخير|مساء\s+الخير|اهلا|أهلا|ازيك|إزيك/.test(t)) {
    return { intent: "greeting_or_other", confidence: 0.9, promised_date: null, amount_minor: null };
  }
  if (/؟|\?|ليه|ازاي|إزاي|كام|امتى|إمتى|يعني\s+ايه/.test(t)) {
    return { intent: "question", confidence: 0.85, promised_date: null, amount_minor: null };
  }
  return { intent: "greeting_or_other", confidence: 0.5, promised_date: null, amount_minor: null };
}
