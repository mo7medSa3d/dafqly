import {
  type ChequeExtraction,
  type LedgerExtraction,
  type ReceiptExtraction,
  type ReplyClassification,
  parseChequeExtraction,
  parseLedgerExtraction,
  parseReceiptExtraction,
  parseReplyClassification,
} from "@tahseel/core";
import { CHEQUE_PROMPT_VERSION, CHEQUE_SYSTEM, CHEQUE_TOOL_NAME, CHEQUE_TOOL_SCHEMA, CHEQUE_USER } from "./prompts/cheque";
import { LEDGER_PROMPT_VERSION, ledgerSystemForCurrency, LEDGER_TOOL_NAME, LEDGER_TOOL_SCHEMA, LEDGER_USER } from "./prompts/ledger";
import { RECEIPT_PROMPT_VERSION, RECEIPT_SYSTEM, RECEIPT_TOOL_NAME, RECEIPT_TOOL_SCHEMA, RECEIPT_USER } from "./prompts/receipt";
import { REPLY_PROMPT_VERSION, REPLY_SYSTEM, REPLY_TOOL_NAME, REPLY_TOOL_SCHEMA, replyUserText } from "./prompts/reply";
import {
  executeAgentToolCall,
  LlmNotConfiguredError,
  maxStepsFallbackText,
  type AgentRunInput,
  type AgentRunResult,
  type AgentToolDefinition,
  type AgentToolExecution,
  type LlmCallResult,
  type OcrLlmProvider,
  type ReplyContext,
} from "./llm";
import { combinedSignal, parseSseJson, readSseData } from "./sse";
import dns from "node:dns";

if (typeof dns !== "undefined" && typeof dns.setDefaultResultOrder === "function") {
  try {
    dns.setDefaultResultOrder("ipv4first");
  } catch {
    // Browser or edge runtime
  }
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface ProviderPreset {
  baseUrl: string;
  defaultModel: string;
  wireFormat: "openai" | "anthropic";
  requiresKey: boolean;
}

/**
 * Single registry of well-known AI providers.
 * You only provide `{ provider, apiKey }` (plus optional `model` / `baseUrl`)
 * and the unified client routes to the right endpoint automatically.
 */
export const PROVIDER_PRESETS: Readonly<Record<string, ProviderPreset>> = {
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.5-flash",
    wireFormat: "openai",
    requiresKey: true,
  },
  google: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.5-flash",
    wireFormat: "openai",
    requiresKey: true,
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    wireFormat: "openai",
    requiresKey: true,
  },
  anthropic: {
    baseUrl: "https://api.anthropic.com",
    defaultModel: "claude-sonnet-4-5",
    wireFormat: "anthropic",
    requiresKey: true,
  },
  claude: {
    baseUrl: "https://api.anthropic.com",
    defaultModel: "claude-sonnet-4-5",
    wireFormat: "anthropic",
    requiresKey: true,
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "google/gemini-2.5-flash",
    wireFormat: "openai",
    requiresKey: true,
  },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    wireFormat: "openai",
    requiresKey: true,
  },
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    wireFormat: "openai",
    requiresKey: true,
  },
  mistral: {
    baseUrl: "https://api.mistral.ai/v1",
    defaultModel: "mistral-small-latest",
    wireFormat: "openai",
    requiresKey: true,
  },
  xai: {
    baseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-3-mini",
    wireFormat: "openai",
    requiresKey: true,
  },
  together: {
    baseUrl: "https://api.together.xyz/v1",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    wireFormat: "openai",
    requiresKey: true,
  },
  ollama: {
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "llama3.2",
    wireFormat: "openai",
    requiresKey: false,
  },
  lmstudio: {
    baseUrl: "http://localhost:1234/v1",
    defaultModel: "local-model",
    wireFormat: "openai",
    requiresKey: false,
  },
};

export interface UnifiedAiOptions {
  /** Provider name: "gemini", "openai", "anthropic", "openrouter", "groq", "deepseek", "ollama", or any custom OpenAI-compatible name. */
  provider: string;
  /** Platform API key configured once in code/env (never per-tenant). */
  apiKey?: string;
  /** Optional model override; defaults to the provider's recommended model. */
  model?: string;
  /** Optional custom base URL for proxies or self-hosted servers. */
  baseUrl?: string;
  timeoutMs?: number;
  fetchFn?: FetchFn;
  now?: () => number;
}

const ANTHROPIC_API_VERSION = "2023-06-01";

interface NormalizedTurn {
  text: string;
  toolCalls: { id: string; name: string; args: Record<string, unknown> }[];
  inputTokens: number;
  outputTokens: number;
  /** Raw assistant content blocks (needed only when echoing back to Anthropic). */
  rawAnthropicContent?: unknown[];
}

/**
 * Unified AI Provider: one class, one interface, one API key + provider name.
 * Handles structured extraction (ledger, receipt, cheque, reply), streaming text,
 * and multi-step tool-calling agents across all major AI providers.
 */
export class UnifiedAiProvider implements OcrLlmProvider {
  readonly providerName: string;
  readonly model: string;
  private readonly wireFormat: "openai" | "anthropic";
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: FetchFn;
  private readonly now: () => number;

  constructor(opts: UnifiedAiOptions) {
    const key = opts.provider.trim().toLowerCase();
    const preset = PROVIDER_PRESETS[key];
    const baseUrl = (opts.baseUrl?.trim() || preset?.baseUrl || "").replace(/\/+$/, "");
    if (!baseUrl) {
      throw new Error(`Unknown AI provider "${opts.provider}". Use a built-in provider (gemini, openai, anthropic, openrouter, groq, deepseek, ollama) or set AI_BASE_URL.`);
    }
    const apiKey = opts.apiKey?.trim() ?? "";
    const isLocal = /^(https?:\/\/)(localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal)/i.test(baseUrl);
    if (!apiKey && !isLocal && (preset?.requiresKey ?? true)) {
      throw new LlmNotConfiguredError();
    }

    this.providerName = key;
    this.wireFormat = preset?.wireFormat ?? "openai";
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.model = opts.model?.trim() || preset?.defaultModel || "gpt-4o-mini";
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.fetchFn = opts.fetchFn ?? ((url, init) => fetch(url, init));
    this.now = opts.now ?? (() => Date.now());
  }

  private async request(
    system: string | undefined,
    messages: unknown[],
    options: {
      tools?: AgentToolDefinition[];
      forcedToolName?: string;
      maxTokens?: number;
      temperature?: number;
      stream?: boolean;
      onTextDelta?: (delta: string) => void;
      signal?: AbortSignal;
    } = {},
  ): Promise<NormalizedTurn> {
    if (this.wireFormat === "anthropic") {
      return this.requestAnthropic(system, messages, options);
    }
    return this.requestOpenAi(system, messages, options);
  }

  private async requestOpenAi(
    system: string | undefined,
    messages: unknown[],
    options: {
      tools?: AgentToolDefinition[];
      forcedToolName?: string;
      maxTokens?: number;
      temperature?: number;
      stream?: boolean;
      onTextDelta?: (delta: string) => void;
      signal?: AbortSignal;
    },
  ): Promise<NormalizedTurn> {
    const isOfficialOpenAi = this.baseUrl.includes("api.openai.com");
    const tokenKey = isOfficialOpenAi ? "max_completion_tokens" : "max_tokens";
    const supportsTemp = !isOfficialOpenAi || !/^(o[134]|gpt-5)/i.test(this.model);
    const supportsStreamUsage = isOfficialOpenAi || ["openrouter", "groq", "deepseek", "xai", "together"].includes(this.providerName);
    const fullMessages = system ? [{ role: "system", content: system }, ...messages] : messages;

    const body: Record<string, unknown> = {
      model: this.model,
      [tokenKey]: options.maxTokens ?? 1600,
      messages: fullMessages,
      ...(options.temperature !== undefined && supportsTemp ? { temperature: options.temperature } : {}),
      ...(options.stream ? { stream: true, ...(supportsStreamUsage ? { stream_options: { include_usage: true } } : {}) } : {}),
    };

    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.inputSchema },
      }));
      body.tool_choice = options.forcedToolName
        ? { type: "function", function: { name: options.forcedToolName } }
        : "auto";
    }

    const signal = combinedSignal(this.timeoutMs, options.signal);
    const res = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`${this.providerName} API error: HTTP ${res.status} ${detail.replace(/\s+/g, " ").slice(0, 200)}`.trim());
    }

    if (!options.stream) {
      const json = (await res.json()) as {
        choices?: { message?: { content?: string | null; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[] } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const msg = json.choices?.[0]?.message;
      const toolCalls = (msg?.tool_calls ?? []).map((tc, i) => {
        let parsed: Record<string, unknown> = {};
        try {
          const v = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {};
          if (v && typeof v === "object" && !Array.isArray(v)) parsed = v as Record<string, unknown>;
        } catch {
          parsed = {};
        }
        return { id: tc.id ?? `call_${i}`, name: tc.function?.name ?? "", args: parsed };
      }).filter((c) => c.name);

      return {
        text: (msg?.content ?? "").trim(),
        toolCalls,
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: json.usage?.completion_tokens ?? 0,
      };
    }

    let text = "";
    let inputTokens = 0;
    let outputTokens = 0;
    const rawCalls: { id: string; name: string; arguments: string }[] = [];

    for await (const data of readSseData(res, signal)) {
      const chunk = parseSseJson<{
        choices?: { delta?: { content?: string | null; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
        error?: { message?: string };
      }>(data);
      if (!chunk) continue;
      if (chunk.error) throw new Error(`${this.providerName} stream error: ${chunk.error.message ?? "unknown"}`);
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
        outputTokens = chunk.usage.completion_tokens ?? outputTokens;
      }
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) continue;
      if (delta.content) {
        text += delta.content;
        options.onTextDelta?.(delta.content);
      }
      for (const tc of delta.tool_calls ?? []) {
        const idx = tc.index ?? (tc.id ? rawCalls.length : Math.max(0, rawCalls.length - 1));
        if (idx < 0 || idx > 64) continue;
        const slot = (rawCalls[idx] ??= { id: "", name: "", arguments: "" });
        if (tc.id) slot.id = tc.id;
        if (tc.function?.name && tc.function.name !== slot.name) slot.name += tc.function.name;
        if (tc.function?.arguments) slot.arguments += tc.function.arguments;
      }
    }

    const toolCalls = rawCalls.filter(Boolean).map((c, i) => {
      let parsed: Record<string, unknown> = {};
      try {
        const v = c.arguments ? JSON.parse(c.arguments) : {};
        if (v && typeof v === "object" && !Array.isArray(v)) parsed = v as Record<string, unknown>;
      } catch {
        parsed = {};
      }
      return { id: c.id || `call_${i}`, name: c.name, args: parsed };
    }).filter((c) => c.name);

    return { text: text.trim(), toolCalls, inputTokens, outputTokens };
  }

  private async requestAnthropic(
    system: string | undefined,
    messages: unknown[],
    options: {
      tools?: AgentToolDefinition[];
      forcedToolName?: string;
      maxTokens?: number;
      temperature?: number;
      stream?: boolean;
      onTextDelta?: (delta: string) => void;
      signal?: AbortSignal;
    },
  ): Promise<NormalizedTurn> {
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: options.maxTokens ?? 1600,
      ...(system ? { system } : {}),
      messages,
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.stream ? { stream: true } : {}),
    };

    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));
      body.tool_choice = options.forcedToolName
        ? { type: "tool", name: options.forcedToolName }
        : { type: "auto" };
    }

    const signal = combinedSignal(this.timeoutMs, options.signal);
    const res = await this.fetchFn(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": ANTHROPIC_API_VERSION,
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`anthropic API error: HTTP ${res.status} ${detail.replace(/\s+/g, " ").slice(0, 200)}`.trim());
    }

    if (!options.stream) {
      const json = (await res.json()) as {
        content?: { type: string; id?: string; name?: string; input?: unknown; text?: string }[];
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const content = json.content ?? [];
      const text = content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n").trim();
      const toolCalls = content
        .filter((b) => b.type === "tool_use" && b.name)
        .map((b, i) => ({
          id: b.id ?? `call_${i}`,
          name: b.name!,
          args: b.input && typeof b.input === "object" && !Array.isArray(b.input) ? (b.input as Record<string, unknown>) : {},
        }));

      return {
        text,
        toolCalls,
        inputTokens: json.usage?.input_tokens ?? 0,
        outputTokens: json.usage?.output_tokens ?? 0,
        rawAnthropicContent: content.filter((b) => (b.type === "text" && Boolean(b.text)) || b.type === "tool_use"),
      };
    }

    type Block = { type: string; id?: string; name?: string; text?: string; input?: unknown; json?: string };
    const blocks: Block[] = [];
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const data of readSseData(res, signal)) {
      const event = parseSseJson<{
        type?: string;
        index?: number;
        content_block?: { type?: string; id?: string; name?: string; text?: string };
        delta?: { type?: string; text?: string; partial_json?: string };
        message?: { usage?: { input_tokens?: number } };
        usage?: { output_tokens?: number };
        error?: { message?: string };
      }>(data);
      if (!event) continue;
      if (event.type === "error") throw new Error(`anthropic stream error: ${event.error?.message ?? "unknown"}`);
      if (event.type === "message_start") inputTokens += event.message?.usage?.input_tokens ?? 0;
      else if (event.type === "content_block_start" && event.index !== undefined && event.content_block) {
        if (event.index < 0 || event.index > 64) continue;
        const b = event.content_block;
        blocks[event.index] = { type: b.type ?? "text", id: b.id, name: b.name, text: b.text ?? "", json: "" };
      } else if (event.type === "content_block_delta" && event.index !== undefined) {
        if (event.index < 0 || event.index > 64) continue;
        const block = blocks[event.index];
        if (!block) continue;
        if (event.delta?.type === "text_delta" && event.delta.text) {
          block.text = (block.text ?? "") + event.delta.text;
          options.onTextDelta?.(event.delta.text);
        } else if (event.delta?.type === "input_json_delta" && event.delta.partial_json) {
          block.json = (block.json ?? "") + event.delta.partial_json;
        }
      } else if (event.type === "content_block_stop" && event.index !== undefined) {
        if (event.index < 0 || event.index > 64) continue;
        const block = blocks[event.index];
        if (block?.type === "tool_use") {
          try { block.input = block.json ? JSON.parse(block.json) : {}; } catch { block.input = {}; }
        }
      } else if (event.type === "message_delta") {
        outputTokens = Math.max(outputTokens, event.usage?.output_tokens ?? 0);
      }
    }

    const content = blocks
      .filter((b): b is Block => Boolean(b) && (b.type === "tool_use" || (b.type === "text" && Boolean(b.text))))
      .map((b) =>
        b.type === "tool_use"
          ? { type: "tool_use", id: b.id, name: b.name, input: b.input ?? {} }
          : { type: "text", text: b.text ?? "" },
      );
    const text = blocks.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n").trim();
    const toolCalls = blocks
      .filter((b) => b.type === "tool_use" && Boolean(b.name))
      .map((b, i) => ({
        id: b.id ?? `call_${i}`,
        name: b.name!,
        args: b.input && typeof b.input === "object" && !Array.isArray(b.input) ? (b.input as Record<string, unknown>) : {},
      }));

    return { text, toolCalls, inputTokens, outputTokens, rawAnthropicContent: content };
  }

  private formatImageUserMessage(image: Uint8Array, mime: string, text: string) {
    const b64 = Buffer.from(image).toString("base64");
    const mediaType = mime === "image/jpg" ? "image/jpeg" : mime;
    if (this.wireFormat === "anthropic") {
      return {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
          { type: "text", text },
        ],
      };
    }
    return {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: `data:${mediaType};base64,${b64}` } },
        { type: "text", text },
      ],
    };
  }

  private async extractStructured<T>(args: {
    promptVersion: string;
    system: string;
    userText: string;
    image?: { data: Uint8Array; mime: string };
    toolName: string;
    toolDescription: string;
    toolSchema: Record<string, unknown>;
    parse: (input: unknown) => T | null;
  }): Promise<LlmCallResult<T>> {
    const started = this.now();
    const userMessage = args.image
      ? this.formatImageUserMessage(args.image.data, args.image.mime, args.userText)
      : { role: "user", content: args.userText };

    const turn = await this.request(args.system, [userMessage], {
      tools: [{ name: args.toolName, description: args.toolDescription, inputSchema: args.toolSchema }],
      forcedToolName: args.toolName,
      maxTokens: 4096,
    });

    const call = turn.toolCalls.find((c) => c.name === args.toolName);
    return {
      data: call ? args.parse(call.args) : null,
      model: this.model,
      promptVersion: args.promptVersion,
      inputTokens: turn.inputTokens,
      outputTokens: turn.outputTokens,
      latencyMs: Math.max(0, this.now() - started),
    };
  }

  extractLedgerPage(image: Uint8Array, mime: string, currency = "EGP"): Promise<LlmCallResult<LedgerExtraction>> {
    return this.extractStructured({
      promptVersion: LEDGER_PROMPT_VERSION,
      system: ledgerSystemForCurrency(currency),
      userText: LEDGER_USER,
      image: { data: image, mime },
      toolName: LEDGER_TOOL_NAME,
      toolDescription: "Return the ledger rows transcribed from the page image.",
      toolSchema: LEDGER_TOOL_SCHEMA,
      parse: (v) => parseLedgerExtraction(v, currency),
    });
  }

  extractReceipt(image: Uint8Array, mime: string): Promise<LlmCallResult<ReceiptExtraction>> {
    return this.extractStructured({
      promptVersion: RECEIPT_PROMPT_VERSION,
      system: RECEIPT_SYSTEM,
      userText: RECEIPT_USER,
      image: { data: image, mime },
      toolName: RECEIPT_TOOL_NAME,
      toolDescription: "Return the transfer receipt fields transcribed from the image.",
      toolSchema: RECEIPT_TOOL_SCHEMA,
      parse: parseReceiptExtraction,
    });
  }

  extractCheque(image: Uint8Array, mime: string): Promise<LlmCallResult<ChequeExtraction>> {
    return this.extractStructured({
      promptVersion: CHEQUE_PROMPT_VERSION,
      system: CHEQUE_SYSTEM,
      userText: CHEQUE_USER,
      image: { data: image, mime },
      toolName: CHEQUE_TOOL_NAME,
      toolDescription: "Return the cheque fields transcribed from the image.",
      toolSchema: CHEQUE_TOOL_SCHEMA,
      parse: parseChequeExtraction,
    });
  }

  classifyReply(text: string, context: ReplyContext): Promise<LlmCallResult<ReplyClassification>> {
    return this.extractStructured({
      promptVersion: REPLY_PROMPT_VERSION,
      system: REPLY_SYSTEM,
      userText: replyUserText(text, context),
      toolName: REPLY_TOOL_NAME,
      toolDescription: "Classify the customer reply into the closed intent set.",
      toolSchema: REPLY_TOOL_SCHEMA,
      parse: parseReplyClassification,
    });
  }

  async generateText(prompt: string, systemInstruction?: string): Promise<{ text: string; inputTokens: number; outputTokens: number; model: string }> {
    const turn = await this.request(systemInstruction, [{ role: "user", content: prompt }], { maxTokens: 1200 });
    return { text: turn.text, inputTokens: turn.inputTokens, outputTokens: turn.outputTokens, model: this.model };
  }

  async streamText(
    prompt: string,
    systemInstruction: string | undefined,
    onToken: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<{ text: string; inputTokens: number; outputTokens: number; model: string }> {
    const turn = await this.request(systemInstruction, [{ role: "user", content: prompt }], {
      maxTokens: 1600,
      stream: true,
      onTextDelta: onToken,
      signal,
    });
    return { text: turn.text, inputTokens: turn.inputTokens, outputTokens: turn.outputTokens, model: this.model };
  }

  async runAgent(input: AgentRunInput): Promise<AgentRunResult> {
    const messages: unknown[] = input.messages.filter((m) => m.content.trim().length > 0).map((m) => ({ role: m.role, content: m.content }));
    const allowed = new Set(input.tools.map((t) => t.name));
    const toolExecutions: AgentToolExecution[] = [];
    const maxSteps = Math.min(6, Math.max(1, input.maxSteps ?? 5));
    const maxToolCalls = Math.min(12, Math.max(1, input.maxToolCalls ?? 8));
    let inputTokens = 0;
    let outputTokens = 0;
    let finalText = "";

    for (let step = 0; step < maxSteps; step += 1) {
      if (input.signal?.aborted) throw input.signal.reason ?? new DOMException("Aborted", "AbortError");
      input.onEvent?.({ type: "step", step });
      const turn = await this.request(input.systemInstruction, messages, {
        tools: input.tools,
        temperature: 0.25,
        maxTokens: 1600,
        stream: Boolean(input.onEvent),
        onTextDelta: input.onEvent ? (text) => input.onEvent?.({ type: "text_delta", text, step }) : undefined,
        signal: input.signal,
      });

      inputTokens += turn.inputTokens;
      outputTokens += turn.outputTokens;
      if (turn.text) finalText = turn.text;

      if (turn.toolCalls.length === 0) {
        return { text: finalText, toolExecutions, inputTokens, outputTokens, model: this.model, steps: step + 1 };
      }

      if (this.wireFormat === "anthropic") {
        messages.push({ role: "assistant", content: turn.rawAnthropicContent ?? [] });
        const results: Record<string, unknown>[] = [];
        for (const call of turn.toolCalls) {
          if (input.signal?.aborted) throw input.signal.reason ?? new DOMException("Aborted", "AbortError");
          const result = await executeAgentToolCall({
            id: call.id,
            name: call.name,
            toolArgs: call.args,
            allowed,
            executed: toolExecutions.length,
            maxToolCalls,
            executeTool: input.executeTool,
            onEvent: input.onEvent,
          });
          toolExecutions.push({ name: call.name, arguments: call.args, result });
          results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(result) });
        }
        messages.push({ role: "user", content: results });
      } else {
        messages.push({
          role: "assistant",
          content: turn.text || null,
          tool_calls: turn.toolCalls.map((c) => ({
            id: c.id,
            type: "function",
            function: { name: c.name, arguments: JSON.stringify(c.args) },
          })),
        });
        for (const call of turn.toolCalls) {
          if (input.signal?.aborted) throw input.signal.reason ?? new DOMException("Aborted", "AbortError");
          const result = await executeAgentToolCall({
            id: call.id,
            name: call.name,
            toolArgs: call.args,
            allowed,
            executed: toolExecutions.length,
            maxToolCalls,
            executeTool: input.executeTool,
            onEvent: input.onEvent,
          });
          toolExecutions.push({ name: call.name, arguments: call.args, result });
          messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
        }
      }
    }

    return {
      text: finalText || maxStepsFallbackText(input.locale),
      toolExecutions,
      inputTokens,
      outputTokens,
      model: this.model,
      steps: maxSteps,
    };
  }
}

export function createAiProvider(opts: UnifiedAiOptions): OcrLlmProvider {
  return new UnifiedAiProvider(opts);
}
