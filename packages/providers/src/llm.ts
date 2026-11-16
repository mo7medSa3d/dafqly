import {
  isOptOutText, normalizeDigits, parseReplyClassification, parseLedgerExtraction, parseReceiptExtraction,
  parseChequeExtraction, resolveRelativeDate,
  type LedgerExtraction, type ReceiptExtraction, type ReplyClassification, type ChequeExtraction,
} from "@tahseel/core";
import { LEDGER_PROMPT_VERSION, ledgerSystemForCurrency, LEDGER_TOOL_NAME, LEDGER_TOOL_SCHEMA, LEDGER_USER } from "./prompts/ledger";
import { RECEIPT_PROMPT_VERSION, RECEIPT_SYSTEM, RECEIPT_TOOL_NAME, RECEIPT_TOOL_SCHEMA, RECEIPT_USER } from "./prompts/receipt";
import { CHEQUE_PROMPT_VERSION, CHEQUE_SYSTEM, CHEQUE_TOOL_NAME, CHEQUE_TOOL_SCHEMA, CHEQUE_USER } from "./prompts/cheque";
import { REPLY_PROMPT_VERSION, REPLY_SYSTEM, REPLY_TOOL_NAME, REPLY_TOOL_SCHEMA, replyUserText } from "./prompts/reply";
import { combinedSignal, parseSseJson, readSseData } from "./sse";

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
    super("LLM_NOT_CONFIGURED: ANTHROPIC_API_KEY is not set");
    this.name = "LlmNotConfiguredError";
  }
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

/** Current Anthropic Messages API version recommended by the official docs. */
const ANTHROPIC_API_VERSION = "2026-10-21";

export interface AnthropicOptions {
  apiKey: string;
  /** Model for multi-step workspace agent reasoning. */
  modelAgent?: string;
  /** Optional shared model override for backwards compatibility. */
  model?: string;
  modelFast?: string;
  modelVision?: string;
  fetchFn?: FetchFn;
  baseUrl?: string;
  timeoutMs?: number;
  now?: () => number;
}

interface AnthropicResponse {
  content?: { type: string; id?: string; name?: string; input?: unknown; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

export class AnthropicLlmProvider implements OcrLlmProvider {
  private readonly fetchFn: FetchFn;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(private readonly opts: AnthropicOptions) {
    if (!opts.apiKey) throw new LlmNotConfiguredError();
    this.fetchFn = opts.fetchFn ?? ((url, init) => fetch(url, init));
    this.baseUrl = opts.baseUrl ?? "https://api.anthropic.com";
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.now = opts.now ?? (() => Date.now());
  }

  private async callTool<T>(args: {
    model: string; promptVersion: string; system: string;
    content: unknown[]; toolName: string; toolDescription: string; toolSchema: unknown;
    parse: (input: unknown) => T | null;
  }): Promise<LlmCallResult<T>> {
    const started = this.now();
    const res = await this.fetchFn(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.opts.apiKey,
        "anthropic-version": ANTHROPIC_API_VERSION,
      },
      body: JSON.stringify({
        model: args.model,
        max_tokens: 4096,
        system: args.system,
        messages: [{ role: "user", content: args.content }],
        tools: [{ name: args.toolName, description: args.toolDescription, input_schema: args.toolSchema }],
        tool_choice: { type: "tool", name: args.toolName },
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`Anthropic API error: HTTP ${res.status}`);
    const body = (await res.json()) as AnthropicResponse;
    const toolUse = (body.content ?? []).find((b) => b.type === "tool_use" && b.name === args.toolName);
    return {
      // Forced tool use per ADR-022; the tool input is STILL untrusted and
      // Zod-parsed — a malformed tool input yields null, never a throw.
      data: toolUse ? args.parse(toolUse.input) : null,
      model: args.model,
      promptVersion: args.promptVersion,
      inputTokens: body.usage?.input_tokens ?? 0,
      outputTokens: body.usage?.output_tokens ?? 0,
      latencyMs: Math.max(0, this.now() - started),
    };
  }

  private imageBlock(image: Uint8Array, mime: string) {
    return {
      type: "image",
      source: { type: "base64", media_type: mime, data: Buffer.from(image).toString("base64") },
    };
  }

  async extractLedgerPage(image: Uint8Array, mime: string, currency = "EGP"): Promise<LlmCallResult<LedgerExtraction>> {
    return this.callTool({
      model: this.opts.model ?? this.opts.modelVision ?? this.opts.modelFast ?? "claude-sonnet-5-5", promptVersion: LEDGER_PROMPT_VERSION, system: ledgerSystemForCurrency(currency),
      content: [this.imageBlock(image, mime), { type: "text", text: LEDGER_USER }],
      toolName: LEDGER_TOOL_NAME, toolDescription: "Return the ledger rows transcribed from the page image.",
      toolSchema: LEDGER_TOOL_SCHEMA, parse: (value) => parseLedgerExtraction(value, currency),
    });
  }

  async extractReceipt(image: Uint8Array, mime: string): Promise<LlmCallResult<ReceiptExtraction>> {
    return this.callTool({
      model: this.opts.model ?? this.opts.modelVision ?? this.opts.modelFast ?? "claude-sonnet-5-5", promptVersion: RECEIPT_PROMPT_VERSION, system: RECEIPT_SYSTEM,
      content: [this.imageBlock(image, mime), { type: "text", text: RECEIPT_USER }],
      toolName: RECEIPT_TOOL_NAME, toolDescription: "Return the transfer receipt fields transcribed from the image.",
      toolSchema: RECEIPT_TOOL_SCHEMA, parse: parseReceiptExtraction,
    });
  }

  async classifyReply(text: string, context: ReplyContext): Promise<LlmCallResult<ReplyClassification>> {
    return this.callTool({
      model: this.opts.model ?? this.opts.modelFast ?? this.opts.modelVision ?? "claude-sonnet-5-5", promptVersion: REPLY_PROMPT_VERSION, system: REPLY_SYSTEM,
      content: [{ type: "text", text: replyUserText(text, context) }],
      toolName: REPLY_TOOL_NAME, toolDescription: "Classify the customer reply into the closed intent set.",
      toolSchema: REPLY_TOOL_SCHEMA, parse: parseReplyClassification,
    });
  }

  async extractCheque(image: Uint8Array, mime: string): Promise<LlmCallResult<ChequeExtraction>> {
    return this.callTool({
      model: this.opts.model ?? this.opts.modelVision ?? this.opts.modelFast ?? "claude-sonnet-5-5", promptVersion: CHEQUE_PROMPT_VERSION, system: CHEQUE_SYSTEM,
      content: [this.imageBlock(image, mime), { type: "text", text: CHEQUE_USER }],
      toolName: CHEQUE_TOOL_NAME, toolDescription: "Return the cheque fields transcribed from the image.",
      toolSchema: CHEQUE_TOOL_SCHEMA, parse: parseChequeExtraction,
    });
  }

  /**
   * One Messages-API round trip. With `onEvent` it uses `stream: true` and
   * forwards text deltas as they arrive (tool_use input arrives as
   * `input_json_delta` fragments and is parsed once the block closes);
   * without it, the plain JSON path is used.
   */
  private async agentStep(args: {
    model: string; system: string; messages: unknown[]; tools: AgentToolDefinition[];
    step: number; onEvent?: AgentRunInput["onEvent"]; signal?: AbortSignal;
  }): Promise<{ content: NonNullable<AnthropicResponse["content"]>; inputTokens: number; outputTokens: number }> {
    const streaming = Boolean(args.onEvent);
    const res = await this.fetchFn(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.opts.apiKey,
        "anthropic-version": ANTHROPIC_API_VERSION,
      },
      body: JSON.stringify({
        model: args.model,
        max_tokens: 1400,
        system: args.system,
        messages: args.messages,
        ...(streaming ? { stream: true } : {}),
        tools: args.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema })),
        tool_choice: { type: "auto" },
      }),
      signal: combinedSignal(this.timeoutMs, args.signal),
    });
    if (!res.ok) throw new Error(`Anthropic Agent API error: HTTP ${res.status}`);
    if (!streaming) {
      const body = (await res.json()) as AnthropicResponse;
      return { content: body.content ?? [], inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0 };
    }

    type Block = { type: string; id?: string; name?: string; text?: string; input?: unknown; json?: string };
    const blocks: Block[] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    for await (const data of readSseData(res, args.signal)) {
      const event = parseSseJson<{
        type?: string; index?: number;
        content_block?: { type?: string; id?: string; name?: string; text?: string };
        delta?: { type?: string; text?: string; partial_json?: string };
        message?: { usage?: { input_tokens?: number } };
        usage?: { output_tokens?: number };
        error?: { message?: string };
      }>(data);
      if (!event) continue;
      if (event.type === "error") throw new Error(`Anthropic stream error: ${event.error?.message ?? "unknown"}`);
      if (event.type === "message_start") inputTokens += event.message?.usage?.input_tokens ?? 0;
      else if (event.type === "content_block_start" && event.index !== undefined && event.content_block) {
        const b = event.content_block;
        blocks[event.index] = { type: b.type ?? "text", id: b.id, name: b.name, text: b.text ?? "", json: "" };
      } else if (event.type === "content_block_delta" && event.index !== undefined) {
        const block = blocks[event.index];
        if (!block) continue;
        if (event.delta?.type === "text_delta" && event.delta.text) {
          block.text = (block.text ?? "") + event.delta.text;
          args.onEvent?.({ type: "text_delta", text: event.delta.text, step: args.step });
        } else if (event.delta?.type === "input_json_delta" && event.delta.partial_json) {
          block.json = (block.json ?? "") + event.delta.partial_json;
        }
      } else if (event.type === "content_block_stop" && event.index !== undefined) {
        const block = blocks[event.index];
        if (block?.type === "tool_use") {
          try { block.input = block.json ? JSON.parse(block.json) : {}; } catch { block.input = {}; }
        }
      } else if (event.type === "message_delta") outputTokens += event.usage?.output_tokens ?? 0;
    }
    const content = blocks.filter(Boolean).map((b) => b.type === "tool_use"
      ? { type: "tool_use", id: b.id, name: b.name, input: b.input ?? {} }
      : { type: b.type, text: b.text ?? "" });
    return { content, inputTokens, outputTokens };
  }

  async runAgent(input: AgentRunInput): Promise<AgentRunResult> {
    const model = this.opts.modelAgent ?? this.opts.model ?? this.opts.modelFast ?? "claude-sonnet-5-5";
    const messages: { role: "user" | "assistant"; content: unknown }[] = input.messages.map((m) => ({ role: m.role, content: m.content }));
    const allowed = new Set(input.tools.map((tool) => tool.name));
    const toolExecutions: AgentToolExecution[] = [];
    const maxSteps = Math.min(5, Math.max(1, input.maxSteps ?? 4));
    const maxToolCalls = Math.min(10, Math.max(1, input.maxToolCalls ?? 8));
    let inputTokens = 0;
    let outputTokens = 0;
    let finalText = "";

    for (let step = 0; step < maxSteps; step += 1) {
      input.onEvent?.({ type: "step", step });
      const turn = await this.agentStep({
        model, system: input.systemInstruction, messages, tools: input.tools,
        step, onEvent: input.onEvent, signal: input.signal,
      });
      inputTokens += turn.inputTokens;
      outputTokens += turn.outputTokens;
      const content = turn.content;
      finalText = content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n").trim();
      const toolUses = content.filter((part) => part.type === "tool_use");
      if (toolUses.length === 0) {
        return { text: finalText, toolExecutions, inputTokens, outputTokens, model, steps: step + 1 };
      }

      // The full assistant content (including opaque tool-use ids) must be
      // echoed back exactly before the corresponding tool_result blocks.
      const normalizedContent = content.map((part, idx) =>
        part.type === "tool_use" && !part.id ? { ...part, id: `${step}-${toolExecutions.length + idx}` } : part,
      );
      messages.push({ role: "assistant", content: normalizedContent });
      const results: Record<string, unknown>[] = [];
      for (const toolUse of normalizedContent.filter((part) => part.type === "tool_use")) {
        const args = toolUse.input && typeof toolUse.input === "object" && !Array.isArray(toolUse.input)
          ? toolUse.input as Record<string, unknown> : {};
        const toolUseId = toolUse.id!;
        const result = await executeAgentToolCall({
          id: toolUseId, name: toolUse.name ?? "unknown", toolArgs: args,
          allowed, executed: toolExecutions.length, maxToolCalls, executeTool: input.executeTool, onEvent: input.onEvent,
        });
        toolExecutions.push({ name: toolUse.name ?? "unknown", arguments: args, result });
        // Anthropic requires one tool_result per tool_use id, even when the
        // application rejects execution because its budget is exhausted.
        results.push({ type: "tool_result", tool_use_id: toolUseId, content: JSON.stringify(result) });
      }
      if (results.length === 0) break;
      messages.push({ role: "user", content: results });
    }

    return {
      text: finalText || maxStepsFallbackText(input.locale),
      toolExecutions, inputTokens, outputTokens, model, steps: maxSteps,
    };
  }

  async streamText(prompt: string, systemInstruction: string | undefined, onToken: (delta: string) => void, signal?: AbortSignal): Promise<{ text: string; inputTokens: number; outputTokens: number; model: string }> {
    const model = this.opts.modelFast ?? this.opts.model ?? "claude-haiku-5-5";
    const res = await this.fetchFn(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.opts.apiKey, "anthropic-version": ANTHROPIC_API_VERSION },
      body: JSON.stringify({ model, max_tokens: 1400, stream: true, system: systemInstruction, messages: [{ role: "user", content: prompt }] }),
      signal: combinedSignal(this.timeoutMs, signal),
    });
    if (!res.ok || !res.body) throw new Error(`Anthropic streaming error: HTTP ${res.status}`);
    let text = "";
    let inputTokens = 0;
    let outputTokens = 0;
    for await (const data of readSseData(res, signal)) {
      const event = parseSseJson<{
        type?: string;
        delta?: { type?: string; text?: string };
        message?: { usage?: { input_tokens?: number } };
        usage?: { output_tokens?: number };
        error?: { message?: string };
      }>(data);
      if (!event) continue;
      if (event.type === "error") throw new Error(`Anthropic stream error: ${event.error?.message ?? "unknown"}`);
      if (event.type === "message_start") inputTokens += event.message?.usage?.input_tokens ?? 0;
      if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
        text += event.delta.text; onToken(event.delta.text);
      }
      if (event.type === "message_delta") outputTokens += event.usage?.output_tokens ?? 0;
    }
    return { text, inputTokens, outputTokens, model };
  }

  async generateText(prompt: string, systemInstruction?: string): Promise<{ text: string; inputTokens: number; outputTokens: number; model: string }> {
    const model = this.opts.modelFast ?? this.opts.model ?? "claude-haiku-5-5";
    const endpoint = `${this.baseUrl}/v1/messages`;
    const payload = {
      model,
      max_tokens: 1024,
      system: systemInstruction,
      messages: [{ role: "user", content: prompt }],
    };
    const res = await this.fetchFn(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.opts.apiKey,
        "anthropic-version": ANTHROPIC_API_VERSION,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Anthropic API error: HTTP ${res.status} ${errText}`);
    }
    const body = (await res.json()) as { content?: Array<{ type?: string; text?: string }>; usage?: { input_tokens?: number; output_tokens?: number } };
    const text = body.content?.find((b) => b.type === "text" && typeof b.text === "string")?.text ?? body.content?.[0]?.text ?? "";
    return {
      text, model,
      inputTokens: body.usage?.input_tokens ?? 0,
      outputTokens: body.usage?.output_tokens ?? 0,
    };
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
