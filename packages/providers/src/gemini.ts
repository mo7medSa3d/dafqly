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
  LlmNotConfiguredError,
  type LlmCallResult,
  type OcrLlmProvider,
  type ReplyContext,
  type AgentRunInput,
  type AgentRunResult,
  executeAgentToolCall,
  maxStepsFallbackText,
} from "./llm";
import { combinedSignal, parseSseJson, readSseData } from "./sse";
import dns from "node:dns";

if (typeof dns !== "undefined" && typeof dns.setDefaultResultOrder === "function") {
  try {
    dns.setDefaultResultOrder("ipv4first");
  } catch {
    // Browser or edge worker runtime
  }
}

type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export interface GeminiOptions {
  apiKey: string;
  /** Model for multi-step workspace agent reasoning. */
  model?: string;
  modelFast?: string;
  modelVision?: string;
  fetchFn?: FetchFn;
  baseUrl?: string;
  timeoutMs?: number;
  now?: () => number;
}

interface GeminiApiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        functionCall?: {
          name: string;
          args?: Record<string, unknown>;
        };
      }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

type GeminiPart = NonNullable<NonNullable<NonNullable<GeminiApiResponse["candidates"]>[number]["content"]>["parts"]>[number];

/**
 * Normalizes JSON schema definitions to Google Gemini OpenAPI 3.0 schema rules:
 * - Flatten union type arrays `type: ["string", "null"]` -> `type: "string", nullable: true`
 * - Remove `null` from `enum` arrays and mark `nullable: true`
 */
export function cleanSchemaForGemini(schema: unknown, isPropertiesMap = false): unknown {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) {
    return schema.map((item) => cleanSchemaForGemini(item, false));
  }
  const obj = { ...(schema as Record<string, unknown>) };
  if (!isPropertiesMap) {
    delete obj.additionalProperties;
    delete obj.format;
    delete obj.default;
    delete obj.$schema;
    delete obj.exclusiveMinimum;
    delete obj.exclusiveMaximum;
    delete obj.patternProperties;
  }

  if (Array.isArray(obj.type)) {
    const rawTypes = obj.type as string[];
    const nonNull = rawTypes.filter((t) => t !== "null");
    obj.type = nonNull.includes("string") ? "string" : (nonNull[0] ?? "string");
    if (rawTypes.includes("null")) {
      obj.nullable = true;
    }
  }

  if (Array.isArray(obj.enum)) {
    const rawEnums = obj.enum as unknown[];
    const nonNullEnums = rawEnums.filter((e) => e !== null);
    obj.enum = nonNullEnums;
    if (rawEnums.includes(null)) {
      obj.nullable = true;
    }
  }

  for (const [key, val] of Object.entries(obj)) {
    if (val && typeof val === "object") {
      obj[key] = cleanSchemaForGemini(val, !isPropertiesMap && key === "properties");
    }
  }
  return obj;
}

/**
 * Google Gemini LLM Provider (Google GenAI API v1beta).
 * Supports Gemini 3.5 Flash Lite and other current Gemini models.
 * Uses native function-calling with mode=ANY for deterministic structured outputs.
 * Untrusted data is strictly parsed with core Zod parsers (Hard Rule #4).
 */
export class GeminiLlmProvider implements OcrLlmProvider {
  private readonly fetchFn: FetchFn;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(private readonly opts: GeminiOptions) {
    if (!opts.apiKey || !opts.apiKey.trim()) {
      throw new LlmNotConfiguredError();
    }
    this.fetchFn = opts.fetchFn ?? ((url, init) => fetch(url, init));
    this.baseUrl = (opts.baseUrl ?? "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.now = opts.now ?? (() => Date.now());
  }

  private async callTool<T>(args: {
    promptVersion: string;
    system: string;
    userText: string;
    image?: { data: Uint8Array; mime: string };
    toolName: string;
    toolDescription: string;
    toolSchema: unknown;
    parse: (input: unknown) => T | null;
    model?: string;
  }): Promise<LlmCallResult<T>> {
    const started = this.now();
    const model = args.model ?? this.opts.modelVision ?? this.opts.modelFast ?? this.opts.model ?? "gemini-3.5-flash-lite";
    const endpoint = `${this.baseUrl}/v1beta/models/${model}:generateContent?key=${encodeURIComponent(this.opts.apiKey)}`;

    const parts: Array<Record<string, unknown>> = [];
    if (args.image) {
      parts.push({
        inlineData: {
          mimeType: args.image.mime,
          data: Buffer.from(args.image.data).toString("base64"),
        },
      });
    }
    parts.push({ text: args.userText });

    const payload = {
      systemInstruction: args.system ? { parts: [{ text: args.system }] } : undefined,
      contents: [{ role: "user", parts }],
      tools: [
        {
          functionDeclarations: [
            {
              name: args.toolName,
              description: args.toolDescription,
              parameters: cleanSchemaForGemini(args.toolSchema),
            },
          ],
        },
      ],
      toolConfig: {
        functionCallingConfig: {
          mode: "ANY",
          allowedFunctionNames: [args.toolName],
        },
      },
    };

    const res = await this.fetchFn(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Gemini API error: HTTP ${res.status} ${errText}`);
    }

    const body = (await res.json()) as GeminiApiResponse;
    const partsArray = body.candidates?.[0]?.content?.parts ?? [];
    const fnCallPart = partsArray.find((p) => p.functionCall && p.functionCall.name === args.toolName);
    const toolArgs = fnCallPart?.functionCall?.args;

    return {
      data: toolArgs ? args.parse(toolArgs) : null,
      model,
      promptVersion: args.promptVersion,
      inputTokens: body.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0,
      latencyMs: Math.max(0, this.now() - started),
    };
  }

  async extractLedgerPage(image: Uint8Array, mime: string, currency = "EGP"): Promise<LlmCallResult<LedgerExtraction>> {
    return this.callTool({
      promptVersion: LEDGER_PROMPT_VERSION,
      system: ledgerSystemForCurrency(currency),
      userText: LEDGER_USER,
      image: { data: image, mime },
      toolName: LEDGER_TOOL_NAME,
      toolDescription: "Return the ledger rows transcribed from the page image.",
      toolSchema: LEDGER_TOOL_SCHEMA,
      parse: (value) => parseLedgerExtraction(value, currency),
      model: this.opts.modelVision,
    });
  }

  async extractReceipt(image: Uint8Array, mime: string): Promise<LlmCallResult<ReceiptExtraction>> {
    return this.callTool({
      promptVersion: RECEIPT_PROMPT_VERSION,
      system: RECEIPT_SYSTEM,
      userText: RECEIPT_USER,
      image: { data: image, mime },
      toolName: RECEIPT_TOOL_NAME,
      toolDescription: "Return the transfer receipt fields transcribed from the image.",
      toolSchema: RECEIPT_TOOL_SCHEMA,
      parse: parseReceiptExtraction,
      model: this.opts.modelVision,
    });
  }

  async classifyReply(text: string, context: ReplyContext): Promise<LlmCallResult<ReplyClassification>> {
    return this.callTool({
      promptVersion: REPLY_PROMPT_VERSION,
      system: REPLY_SYSTEM,
      userText: replyUserText(text, context),
      toolName: REPLY_TOOL_NAME,
      toolDescription: "Classify the customer reply into the closed intent set.",
      toolSchema: REPLY_TOOL_SCHEMA,
      parse: parseReplyClassification,
      model: this.opts.modelFast,
    });
  }

  async extractCheque(image: Uint8Array, mime: string): Promise<LlmCallResult<ChequeExtraction>> {
    return this.callTool({
      promptVersion: CHEQUE_PROMPT_VERSION,
      system: CHEQUE_SYSTEM,
      userText: CHEQUE_USER,
      image: { data: image, mime },
      toolName: CHEQUE_TOOL_NAME,
      toolDescription: "Return the cheque fields transcribed from the image.",
      toolSchema: CHEQUE_TOOL_SCHEMA,
      parse: parseChequeExtraction,
      model: this.opts.modelVision,
    });
  }

  /** One generateContent round trip; streams (SSE) when `onEvent` is set. */
  private async agentStep(args: {
    model: string; input: AgentRunInput; contents: Record<string, unknown>[]; step: number;
  }): Promise<{ parts: GeminiPart[]; hasContent: boolean; inputTokens: number; outputTokens: number }> {
    const { input } = args;
    const streaming = Boolean(input.onEvent);
    const method = streaming ? "streamGenerateContent?alt=sse&" : "generateContent?";
    const endpoint = `${this.baseUrl}/v1beta/models/${args.model}:${method}key=${encodeURIComponent(this.opts.apiKey)}`;
    const res = await this.fetchFn(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: input.systemInstruction }] },
        contents: args.contents,
        tools: [{ functionDeclarations: input.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: cleanSchemaForGemini(tool.inputSchema),
        })) }],
        toolConfig: { functionCallingConfig: { mode: "AUTO" } },
        generationConfig: { temperature: 0.25, maxOutputTokens: 1400 },
      }),
      signal: combinedSignal(this.timeoutMs, input.signal),
    });
    if (!res.ok) throw new Error(`Gemini Agent API error: HTTP ${res.status}`);
    if (!streaming) {
      const body = (await res.json()) as GeminiApiResponse;
      const content = body.candidates?.[0]?.content;
      return {
        parts: content?.parts ?? [], hasContent: Boolean(content),
        inputTokens: body.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0,
      };
    }
    // Streaming: chunks carry incremental parts. Text is forwarded live;
    // functionCall parts (and any thought signatures) are kept verbatim so the
    // model turn can be echoed back unchanged.
    const parts: GeminiPart[] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    let hasContent = false;
    for await (const data of readSseData(res, input.signal)) {
      const chunk = parseSseJson<GeminiApiResponse>(data);
      if (!chunk) continue;
      inputTokens = Math.max(inputTokens, chunk.usageMetadata?.promptTokenCount ?? 0);
      outputTokens = Math.max(outputTokens, chunk.usageMetadata?.candidatesTokenCount ?? 0);
      const content = chunk.candidates?.[0]?.content;
      if (!content) continue;
      hasContent = true;
      for (const part of content.parts ?? []) {
        const last = parts[parts.length - 1] as { text?: string; functionCall?: unknown } | undefined;
        const extras = Object.keys(part).filter((k) => k !== "text");
        if (typeof part.text === "string" && part.text && extras.length === 0 && last && typeof last.text === "string" && !last.functionCall && Object.keys(last).length === 1) {
          last.text += part.text;
        } else {
          parts.push(part);
        }
        if (typeof part.text === "string" && part.text) input.onEvent?.({ type: "text_delta", text: part.text, step: args.step });
      }
    }
    return { parts, hasContent, inputTokens, outputTokens };
  }

  async runAgent(input: AgentRunInput): Promise<AgentRunResult> {
    const model = this.opts.model ?? "gemini-3.8-flash";
    const contents: Record<string, unknown>[] = input.messages.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));
    const allowed = new Set(input.tools.map((tool) => tool.name));
    const toolExecutions: AgentRunResult["toolExecutions"] = [];
    const maxSteps = Math.min(5, Math.max(1, input.maxSteps ?? 4));
    const maxToolCalls = Math.min(10, Math.max(1, input.maxToolCalls ?? 8));
    let inputTokens = 0;
    let outputTokens = 0;
    let finalText = "";

    for (let step = 0; step < maxSteps; step += 1) {
      input.onEvent?.({ type: "step", step });
      const turn = await this.agentStep({ model, input, contents, step });
      inputTokens += turn.inputTokens;
      outputTokens += turn.outputTokens;
      const parts = turn.parts;
      finalText = parts.map((part) => part.text ?? "").filter(Boolean).join("\n").trim();
      const functionCalls = parts.map((part) => part.functionCall).filter((call): call is NonNullable<typeof call> => Boolean(call));
      if (functionCalls.length === 0) {
        return { text: finalText, toolExecutions, inputTokens, outputTokens, model, steps: step + 1 };
      }

      // Gemini requires the model's function-call turn to be echoed before
      // the corresponding functionResponse turn.
      if (turn.hasContent) contents.push({ role: "model", parts });
      const responses: Record<string, unknown>[] = [];
      for (const call of functionCalls) {
        const args = call.args && typeof call.args === "object" ? call.args : {};
        const result = await executeAgentToolCall({
          id: `${step}-${toolExecutions.length}`, name: call.name, toolArgs: args,
          allowed, executed: toolExecutions.length, maxToolCalls, executeTool: input.executeTool, onEvent: input.onEvent,
        });
        toolExecutions.push({ name: call.name, arguments: args, result });
        // Return a response for every function call in the model turn; an
        // omitted functionResponse leaves Gemini with an invalid turn.
        responses.push({ functionResponse: { name: call.name, response: { result } } });
      }
      if (responses.length === 0) break;
      contents.push({ role: "user", parts: responses });
    }

    return {
      text: finalText || maxStepsFallbackText(input.locale),
      toolExecutions, inputTokens, outputTokens, model, steps: maxSteps,
    };
  }

  async streamText(prompt: string, systemInstruction: string | undefined, onToken: (delta: string) => void, signal?: AbortSignal): Promise<{ text: string; inputTokens: number; outputTokens: number; model: string }> {
    const model = this.opts.modelFast ?? this.opts.model ?? "gemini-3.5-flash-lite";
    const endpoint = `${this.baseUrl}/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(this.opts.apiKey)}`;
    const res = await this.fetchFn(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.25, maxOutputTokens: 1400 },
      }), signal: combinedSignal(this.timeoutMs, signal),
    });
    if (!res.ok || !res.body) throw new Error(`Gemini streaming error: HTTP ${res.status}`);
    let text = ""; let inputTokens = 0; let outputTokens = 0;
    for await (const data of readSseData(res, signal)) {
      const event = parseSseJson<GeminiApiResponse>(data);
      if (!event) continue;
      const delta = event.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
      if (delta) { text += delta; onToken(delta); }
      inputTokens = Math.max(inputTokens, event.usageMetadata?.promptTokenCount ?? 0);
      outputTokens = Math.max(outputTokens, event.usageMetadata?.candidatesTokenCount ?? 0);
    }
    return { text, inputTokens, outputTokens, model };
  }

  async generateText(prompt: string, systemInstruction?: string): Promise<{ text: string; inputTokens: number; outputTokens: number; model: string }> {
    const model = this.opts.modelFast ?? this.opts.model ?? "gemini-3.5-flash-lite";
    const endpoint = `${this.baseUrl}/v1beta/models/${model}:generateContent?key=${encodeURIComponent(this.opts.apiKey)}`;
    const payload = {
      systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    };
    const res = await this.fetchFn(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Gemini API error: HTTP ${res.status} ${errText}`);
    }
    const body = (await res.json()) as GeminiApiResponse;
    const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    return {
      text, model,
      inputTokens: body.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0,
    };
  }
}
