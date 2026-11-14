import {
  type ChequeExtraction, type LedgerExtraction, type ReceiptExtraction, type ReplyClassification,
  parseChequeExtraction, parseLedgerExtraction, parseReceiptExtraction, parseReplyClassification,
} from "@tahseel/core";
import { CHEQUE_PROMPT_VERSION, CHEQUE_SYSTEM, CHEQUE_TOOL_NAME, CHEQUE_TOOL_SCHEMA, CHEQUE_USER } from "./prompts/cheque";
import { LEDGER_PROMPT_VERSION, LEDGER_SYSTEM, LEDGER_TOOL_NAME, LEDGER_TOOL_SCHEMA, LEDGER_USER } from "./prompts/ledger";
import { RECEIPT_PROMPT_VERSION, RECEIPT_SYSTEM, RECEIPT_TOOL_NAME, RECEIPT_TOOL_SCHEMA, RECEIPT_USER } from "./prompts/receipt";
import { REPLY_PROMPT_VERSION, REPLY_SYSTEM, REPLY_TOOL_NAME, REPLY_TOOL_SCHEMA, replyUserText } from "./prompts/reply";
import {
  executeAgentToolCall, LlmNotConfiguredError,
  type AgentRunInput, type AgentRunResult, type AgentToolExecution, type LlmCallResult, type OcrLlmProvider, type ReplyContext,
} from "./llm";
import { combinedSignal, parseSseJson, readSseData } from "./sse";

/**
 * Provider-agnostic adapter for ANY service that speaks the OpenAI
 * Chat-Completions wire format: OpenAI, OpenRouter, Groq, Together, DeepSeek,
 * Mistral, xAI, Fireworks, Azure-OpenAI-compatible gateways, and local servers
 * (Ollama, LM Studio, vLLM, llama.cpp). Nothing here is tied to one vendor —
 * the base URL, key, models and extra headers are all configuration.
 *
 * Wire shapes (tools[].function, tool_choice, delta.tool_calls[index],
 * stream_options.include_usage, max_completion_tokens vs legacy max_tokens)
 * were checked against current Chat-Completions references on 2026-11-14.
 * Model output is untrusted: structured results still pass the core Zod
 * parsers, and tool arguments are validated by the server callback.
 * Tested with mocked fetch only — no live call is made from dev/CI.
 */
type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface OpenAiCompatibleOptions {
  /** Display/diagnostic name, e.g. "openrouter". Not sent anywhere. */
  name?: string;
  /** Optional: local servers (Ollama, LM Studio) need no key. */
  apiKey?: string;
  /** Includes the version prefix, e.g. https://api.openai.com/v1 */
  baseUrl?: string;
  /** Model for the multi-step workspace agent. */
  model?: string;
  modelFast?: string;
  modelVision?: string;
  /** Extra static headers (OpenRouter attribution, gateway tenant ids, ...). */
  headers?: Record<string, string>;
  /** Which token-limit field the server expects. Auto: official OpenAI host -> max_completion_tokens. */
  tokenParam?: "max_tokens" | "max_completion_tokens";
  /** Set false for servers that reject `stream_options`. */
  supportsStreamUsage?: boolean;
  /** Set false for models/servers that reject `tool_choice: {function}` forcing. */
  supportsForcedToolChoice?: boolean;
  fetchFn?: FetchFn;
  timeoutMs?: number;
  now?: () => number;
}

interface ChatCompletion {
  choices?: { message?: { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}
interface ChatChunk {
  choices?: { delta?: { content?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  error?: { message?: string };
}
type ToolCall = { id: string; name: string; arguments: string };

export const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";

export class OpenAiCompatibleLlmProvider implements OcrLlmProvider {
  private readonly fetchFn: FetchFn;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly tokenParam: "max_tokens" | "max_completion_tokens";
  readonly name: string;

  constructor(private readonly opts: OpenAiCompatibleOptions) {
    this.baseUrl = (opts.baseUrl?.trim() || OPENAI_DEFAULT_BASE_URL).replace(/\/+$/, "");
    const isOfficialOpenAi = this.baseUrl.includes("api.openai.com");
    // A remote host without a key can never work; local/self-hosted may omit it.
    if (!opts.apiKey?.trim() && isOfficialOpenAi) throw new LlmNotConfiguredError();
    if (!opts.model && !opts.modelFast && !opts.modelVision) {
      throw new Error("LLM_NOT_CONFIGURED: AI_MODEL is required for an OpenAI-compatible provider");
    }
    this.name = opts.name ?? "openai-compatible";
    this.fetchFn = opts.fetchFn ?? ((url, init) => fetch(url, init));
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.now = opts.now ?? (() => Date.now());
    this.tokenParam = opts.tokenParam ?? (isOfficialOpenAi ? "max_completion_tokens" : "max_tokens");
  }

  private get agentModel(): string { return (this.opts.model ?? this.opts.modelFast ?? this.opts.modelVision)!; }
  private get fastModel(): string { return (this.opts.modelFast ?? this.opts.model ?? this.opts.modelVision)!; }
  private get visionModel(): string { return (this.opts.modelVision ?? this.opts.model ?? this.opts.modelFast)!; }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      ...(this.opts.apiKey?.trim() ? { authorization: `Bearer ${this.opts.apiKey.trim()}` } : {}),
      ...(this.opts.headers ?? {}),
    };
  }

  private async post(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    const res = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
      method: "POST", headers: this.headers(), body: JSON.stringify(body),
      signal: combinedSignal(this.timeoutMs, signal),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      // Status + short provider message only; never the request (it can hold ledger data).
      throw new Error(`${this.name} API error: HTTP ${res.status} ${detail.replace(/\s+/g, " ").slice(0, 200)}`.trim());
    }
    return res;
  }

  private async callTool<T>(args: {
    model: string; promptVersion: string; system: string; userText: string;
    image?: { data: Uint8Array; mime: string };
    toolName: string; toolDescription: string; toolSchema: unknown; parse: (input: unknown) => T | null;
  }): Promise<LlmCallResult<T>> {
    const started = this.now();
    const userContent: unknown = args.image
      ? [
          { type: "image_url", image_url: { url: `data:${args.image.mime};base64,${Buffer.from(args.image.data).toString("base64")}` } },
          { type: "text", text: args.userText },
        ]
      : args.userText;
    const forced = this.opts.supportsForcedToolChoice !== false;
    const res = await this.post({
      model: args.model,
      [this.tokenParam]: 4096,
      messages: [{ role: "system", content: args.system }, { role: "user", content: userContent }],
      tools: [{ type: "function", function: { name: args.toolName, description: args.toolDescription, parameters: args.toolSchema } }],
      tool_choice: forced ? { type: "function", function: { name: args.toolName } } : "required",
    });
    const body = (await res.json()) as ChatCompletion;
    const call = body.choices?.[0]?.message?.tool_calls?.find((c) => c.function?.name === args.toolName);
    let parsedArgs: unknown = null;
    try { parsedArgs = call?.function?.arguments ? JSON.parse(call.function.arguments) : null; } catch { parsedArgs = null; }
    return {
      // Untrusted: a malformed/absent tool call yields null -> human review.
      data: parsedArgs ? args.parse(parsedArgs) : null,
      model: args.model, promptVersion: args.promptVersion,
      inputTokens: body.usage?.prompt_tokens ?? 0, outputTokens: body.usage?.completion_tokens ?? 0,
      latencyMs: Math.max(0, this.now() - started),
    };
  }

  extractLedgerPage(image: Uint8Array, mime: string): Promise<LlmCallResult<LedgerExtraction>> {
    return this.callTool({ model: this.visionModel, promptVersion: LEDGER_PROMPT_VERSION, system: LEDGER_SYSTEM, userText: LEDGER_USER, image: { data: image, mime }, toolName: LEDGER_TOOL_NAME, toolDescription: "Return the ledger rows transcribed from the page image.", toolSchema: LEDGER_TOOL_SCHEMA, parse: parseLedgerExtraction });
  }
  extractReceipt(image: Uint8Array, mime: string): Promise<LlmCallResult<ReceiptExtraction>> {
    return this.callTool({ model: this.visionModel, promptVersion: RECEIPT_PROMPT_VERSION, system: RECEIPT_SYSTEM, userText: RECEIPT_USER, image: { data: image, mime }, toolName: RECEIPT_TOOL_NAME, toolDescription: "Return the transfer receipt fields transcribed from the image.", toolSchema: RECEIPT_TOOL_SCHEMA, parse: parseReceiptExtraction });
  }
  extractCheque(image: Uint8Array, mime: string): Promise<LlmCallResult<ChequeExtraction>> {
    return this.callTool({ model: this.visionModel, promptVersion: CHEQUE_PROMPT_VERSION, system: CHEQUE_SYSTEM, userText: CHEQUE_USER, image: { data: image, mime }, toolName: CHEQUE_TOOL_NAME, toolDescription: "Return the cheque fields transcribed from the image.", toolSchema: CHEQUE_TOOL_SCHEMA, parse: parseChequeExtraction });
  }
  classifyReply(text: string, context: ReplyContext): Promise<LlmCallResult<ReplyClassification>> {
    return this.callTool({ model: this.fastModel, promptVersion: REPLY_PROMPT_VERSION, system: REPLY_SYSTEM, userText: replyUserText(text, context), toolName: REPLY_TOOL_NAME, toolDescription: "Classify the customer reply into the closed intent set.", toolSchema: REPLY_TOOL_SCHEMA, parse: parseReplyClassification });
  }

  async generateText(prompt: string, systemInstruction?: string): Promise<{ text: string; inputTokens: number; outputTokens: number; model: string }> {
    const model = this.fastModel;
    const res = await this.post({
      model, [this.tokenParam]: 1024,
      messages: [...(systemInstruction ? [{ role: "system", content: systemInstruction }] : []), { role: "user", content: prompt }],
    });
    const body = (await res.json()) as ChatCompletion;
    return {
      text: (body.choices?.[0]?.message?.content ?? "").trim(), model,
      inputTokens: body.usage?.prompt_tokens ?? 0, outputTokens: body.usage?.completion_tokens ?? 0,
    };
  }

  async streamText(prompt: string, systemInstruction: string | undefined, onToken: (delta: string) => void): Promise<{ text: string; inputTokens: number; outputTokens: number; model: string }> {
    const model = this.fastModel;
    const res = await this.post({
      model, [this.tokenParam]: 1400, stream: true,
      ...(this.opts.supportsStreamUsage === false ? {} : { stream_options: { include_usage: true } }),
      messages: [...(systemInstruction ? [{ role: "system", content: systemInstruction }] : []), { role: "user", content: prompt }],
    });
    let text = ""; let inputTokens = 0; let outputTokens = 0;
    for await (const data of readSseData(res)) {
      const chunk = parseSseJson<ChatChunk>(data);
      if (!chunk) continue;
      if (chunk.error) throw new Error(`${this.name} stream error: ${chunk.error.message ?? "unknown"}`);
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) { text += delta; onToken(delta); }
      if (chunk.usage) { inputTokens = chunk.usage.prompt_tokens ?? inputTokens; outputTokens = chunk.usage.completion_tokens ?? outputTokens; }
    }
    return { text, inputTokens, outputTokens, model };
  }

  /** One round trip; streams when `onEvent` is set. Returns text + any tool calls. */
  private async agentStep(args: {
    messages: unknown[]; tools: AgentRunInput["tools"]; step: number; onEvent?: AgentRunInput["onEvent"]; signal?: AbortSignal;
  }): Promise<{ text: string; toolCalls: ToolCall[]; inputTokens: number; outputTokens: number }> {
    const streaming = Boolean(args.onEvent);
    const res = await this.post({
      model: this.agentModel, [this.tokenParam]: 1400, temperature: 0.25,
      messages: args.messages,
      tools: args.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } })),
      tool_choice: "auto",
      ...(streaming ? { stream: true, ...(this.opts.supportsStreamUsage === false ? {} : { stream_options: { include_usage: true } }) } : {}),
    }, args.signal);
    if (!streaming) {
      const body = (await res.json()) as ChatCompletion;
      const msg = body.choices?.[0]?.message;
      return {
        text: (msg?.content ?? "").trim(),
        toolCalls: (msg?.tool_calls ?? []).map((c, i) => ({ id: c.id ?? `call_${args.step}_${i}`, name: c.function?.name ?? "", arguments: c.function?.arguments ?? "" })),
        inputTokens: body.usage?.prompt_tokens ?? 0, outputTokens: body.usage?.completion_tokens ?? 0,
      };
    }
    let text = ""; let inputTokens = 0; let outputTokens = 0;
    const calls: ToolCall[] = [];
    for await (const data of readSseData(res, args.signal)) {
      const chunk = parseSseJson<ChatChunk>(data);
      if (!chunk) continue;
      if (chunk.error) throw new Error(`${this.name} stream error: ${chunk.error.message ?? "unknown"}`);
      if (chunk.usage) { inputTokens = chunk.usage.prompt_tokens ?? inputTokens; outputTokens = chunk.usage.completion_tokens ?? outputTokens; }
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.content) { text += delta.content; args.onEvent?.({ type: "text_delta", text: delta.content, step: args.step }); }
      for (const tc of delta.tool_calls ?? []) {
        const index = tc.index ?? 0;
        const slot = (calls[index] ??= { id: "", name: "", arguments: "" });
        if (tc.id) slot.id = tc.id;
        if (tc.function?.name) slot.name += tc.function.name;
        if (tc.function?.arguments) slot.arguments += tc.function.arguments;
      }
    }
    return { text: text.trim(), toolCalls: calls.filter(Boolean).map((c, i) => ({ ...c, id: c.id || `call_${args.step}_${i}` })), inputTokens, outputTokens };
  }

  async runAgent(input: AgentRunInput): Promise<AgentRunResult> {
    const model = this.agentModel;
    const messages: Record<string, unknown>[] = [
      { role: "system", content: input.systemInstruction },
      ...input.messages.map((m) => ({ role: m.role, content: m.content })),
    ];
    const allowed = new Set(input.tools.map((t) => t.name));
    const toolExecutions: AgentToolExecution[] = [];
    const maxSteps = Math.min(5, Math.max(1, input.maxSteps ?? 4));
    const maxToolCalls = Math.min(10, Math.max(1, input.maxToolCalls ?? 8));
    let inputTokens = 0; let outputTokens = 0; let finalText = "";

    for (let step = 0; step < maxSteps; step += 1) {
      input.onEvent?.({ type: "step", step });
      const turn = await this.agentStep({ messages, tools: input.tools, step, onEvent: input.onEvent, signal: input.signal });
      inputTokens += turn.inputTokens; outputTokens += turn.outputTokens;
      finalText = turn.text;
      const calls = turn.toolCalls.filter((c) => c.name);
      if (calls.length === 0) return { text: finalText, toolExecutions, inputTokens, outputTokens, model, steps: step + 1 };

      // The assistant turn with its tool_calls must precede the tool results.
      messages.push({
        role: "assistant", content: turn.text || null,
        tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments || "{}" } })),
      });
      for (const call of calls) {
        let parsed: unknown = {};
        try { parsed = call.arguments ? JSON.parse(call.arguments) : {}; } catch { parsed = {}; }
        const args = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
        const result = await executeAgentToolCall({
          id: call.id, name: call.name, toolArgs: args, allowed, executed: toolExecutions.length,
          maxToolCalls, executeTool: input.executeTool, onEvent: input.onEvent,
        });
        toolExecutions.push({ name: call.name, arguments: args, result });
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }
    return {
      text: finalText || "لم أتمكن من إكمال التحليل ضمن حد خطوات الأدوات. جرّب تقسيم السؤال إلى خطوات أصغر.",
      toolExecutions, inputTokens, outputTokens, model, steps: maxSteps,
    };
  }
}
