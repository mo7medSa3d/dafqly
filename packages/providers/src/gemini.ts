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
import { LEDGER_PROMPT_VERSION, LEDGER_SYSTEM, LEDGER_TOOL_NAME, LEDGER_TOOL_SCHEMA, LEDGER_USER } from "./prompts/ledger";
import { RECEIPT_PROMPT_VERSION, RECEIPT_SYSTEM, RECEIPT_TOOL_NAME, RECEIPT_TOOL_SCHEMA, RECEIPT_USER } from "./prompts/receipt";
import { REPLY_PROMPT_VERSION, REPLY_SYSTEM, REPLY_TOOL_NAME, REPLY_TOOL_SCHEMA, replyUserText } from "./prompts/reply";
import {
  LlmNotConfiguredError,
  readSyntheticPayload,
  type LlmCallResult,
  type OcrLlmProvider,
  type ReplyContext,
  type AgentRunInput,
  type AgentRunResult,
} from "./llm";
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
        thoughtSignature?: string;
        functionCall?: {
          name: string;
          id?: string;
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

/**
 * Normalizes JSON schema definitions to Google Gemini OpenAPI 3.0 schema rules:
 * - Flatten union type arrays `type: ["string", "null"]` -> `type: "string", nullable: true`
 * - Remove `null` from `enum` arrays and mark `nullable: true`
 */
export function cleanSchemaForGemini(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) {
    return schema.map(cleanSchemaForGemini);
  }
  const obj = { ...(schema as Record<string, unknown>) };

  // Gemini API does not allow additionalProperties, $schema, definitions or $ref in tool parameter schemas
  delete obj.additionalProperties;
  delete obj.$schema;
  delete obj.definitions;
  delete obj.$ref;

  if (Array.isArray(obj.type)) {
    const rawTypes = obj.type as string[];
    const nonNull = rawTypes.filter((t) => t !== "null");
    obj.type = nonNull[0] ?? "string";
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
      obj[key] = cleanSchemaForGemini(val);
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

  async extractLedgerPage(image: Uint8Array, mime: string): Promise<LlmCallResult<LedgerExtraction>> {
    const payload = readSyntheticPayload(image);
    if (payload && payload.kind === "ledger" && payload.rows) {
      const rows = payload.rows.map((row, i) => {
        const err = payload.errors?.[String(i)] ?? {};
        const merged: Record<string, unknown> = { ...row, ...err };
        if (err.cellConfidence) {
          merged.cellConfidence = { ...((row.cellConfidence as object) ?? {}), ...(err.cellConfidence as object) };
        }
        return merged;
      });
      return {
        data: parseLedgerExtraction({ rows }),
        model: this.opts.modelVision ?? "gemini-3.1-flash-lite",
        promptVersion: LEDGER_PROMPT_VERSION,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
      };
    }
    return this.callTool({
      promptVersion: LEDGER_PROMPT_VERSION,
      system: LEDGER_SYSTEM,
      userText: LEDGER_USER,
      image: { data: image, mime },
      toolName: LEDGER_TOOL_NAME,
      toolDescription: "Return the ledger rows transcribed from the page image.",
      toolSchema: LEDGER_TOOL_SCHEMA,
      parse: parseLedgerExtraction,
      model: this.opts.modelVision,
    });
  }

  async extractReceipt(image: Uint8Array, mime: string): Promise<LlmCallResult<ReceiptExtraction>> {
    const payload = readSyntheticPayload(image);
    if (payload && payload.kind === "receipt" && payload.extraction) {
      const merged = { ...payload.extraction, ...(payload.errors ?? {}) };
      return {
        data: parseReceiptExtraction(merged),
        model: this.opts.modelVision ?? "gemini-3.1-flash-lite",
        promptVersion: RECEIPT_PROMPT_VERSION,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
      };
    }
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
    const payload = readSyntheticPayload(image);
    if (payload && payload.kind === "cheque" && payload.extraction) {
      const merged = { ...payload.extraction, ...(payload.errors ?? {}) };
      return {
        data: parseChequeExtraction(merged),
        model: this.opts.modelVision ?? "gemini-3.1-flash-lite",
        promptVersion: CHEQUE_PROMPT_VERSION,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: 0,
      };
    }
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

  async runAgent(input: AgentRunInput): Promise<AgentRunResult> {
    const model = this.opts.model ?? "gemini-3.1-flash-lite";
    const endpoint = `${this.baseUrl}/v1beta/models/${model}:generateContent?key=${encodeURIComponent(this.opts.apiKey)}`;
    const contents: Record<string, unknown>[] = input.messages.map((message) => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }],
    }));
    const allowed = new Map(input.tools.map((tool) => [tool.name, tool]));
    const toolExecutions: AgentRunResult["toolExecutions"] = [];
    const maxSteps = Math.min(5, Math.max(1, input.maxSteps ?? 4));
    const maxToolCalls = Math.min(10, Math.max(1, input.maxToolCalls ?? 8));
    let inputTokens = 0;
    let outputTokens = 0;
    let finalText = "";

    for (let step = 0; step < maxSteps; step += 1) {
      let res: Response | null = null;
      let lastErrText = "";
      for (let attempt = 0; attempt < 3; attempt += 1) {
        res = await this.fetchFn(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: input.systemInstruction }] },
            contents,
            tools: [{ functionDeclarations: input.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parameters: cleanSchemaForGemini(tool.inputSchema),
            })) }],
            toolConfig: { functionCallingConfig: { mode: "AUTO" } },
            generationConfig: { temperature: 0.25, maxOutputTokens: 1400 },
          }),
          signal: AbortSignal.timeout(Math.min(20_000, this.timeoutMs)),
        });
        if (res.ok) break;
        if (res.status === 503 || res.status === 429) {
          lastErrText = await res.text().catch(() => "");
          await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
          continue;
        }
        const errBody = await res.text().catch(() => "");
        throw new Error(`Gemini Agent API error: HTTP ${res.status}: ${errBody}`);
      }
      if (!res || !res.ok) {
        throw new Error(`Gemini Agent API error: HTTP ${res?.status ?? 503}: ${lastErrText}`);
      }
      const body = (await res.json()) as GeminiApiResponse;
      inputTokens += body.usageMetadata?.promptTokenCount ?? 0;
      outputTokens += body.usageMetadata?.candidatesTokenCount ?? 0;
      const candidate = body.candidates?.[0]?.content;
      const parts = candidate?.parts ?? [];
      finalText = parts.map((part) => part.text ?? "").filter(Boolean).join("\n").trim();
      const functionCalls = parts.map((part) => part.functionCall).filter((call): call is NonNullable<typeof call> => Boolean(call));
      if (functionCalls.length === 0) {
        return { text: finalText, toolExecutions, inputTokens, outputTokens, model, steps: step + 1 };
      }

      // Gemini requires the model's function-call turn to be echoed before
      // the corresponding functionResponse turn.
      if (candidate) contents.push({ role: "model", parts });
      const responses: Record<string, unknown>[] = [];
      for (const call of functionCalls) {
        const args = call.args && typeof call.args === "object" ? call.args : {};
        let result: unknown;
        if (toolExecutions.length >= maxToolCalls) {
          result = { error: "tool_call_limit_reached" };
        } else {
          try {
            result = allowed.has(call.name) ? await input.executeTool(call.name, args) : { error: "tool_not_allowed" };
          } catch {
            result = { error: "tool_execution_failed" };
          }
        }
        toolExecutions.push({ name: call.name, arguments: args, result });
        // Return a response for every function call in the model turn; an
        // omitted functionResponse leaves Gemini with an invalid turn.
        responses.push({
          functionResponse: {
            name: call.name,
            ...(call.id ? { id: call.id } : {}),
            response: { result },
          },
        });
      }
      if (responses.length === 0) break;
      contents.push({ role: "user", parts: responses });
    }

    return {
      text: finalText || "لم أتمكن من إكمال التحليل ضمن حد خطوات الأدوات. جرّب تقسيم السؤال إلى خطوات أصغر.",
      toolExecutions, inputTokens, outputTokens, model, steps: maxSteps,
    };
  }

  async streamText(prompt: string, systemInstruction: string | undefined, onToken: (delta: string) => void): Promise<{ text: string; inputTokens: number; outputTokens: number; model: string }> {
    const model = this.opts.modelFast ?? this.opts.model ?? "gemini-3.1-flash-lite";
    const endpoint = `${this.baseUrl}/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(this.opts.apiKey)}`;
    const res = await this.fetchFn(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.25, maxOutputTokens: 1400 },
      }), signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok || !res.body) throw new Error(`Gemini streaming error: HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = ""; let text = ""; let inputTokens = 0; let outputTokens = 0;
    const consume = (block: string) => {
      const data = block.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
      if (!data || data === "[DONE]") return;
      let event: GeminiApiResponse;
      try {
        event = JSON.parse(data) as GeminiApiResponse;
      } catch {
        return;
      }
      const delta = event.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
      if (delta) { text += delta; onToken(delta); }
      inputTokens = Math.max(inputTokens, event.usageMetadata?.promptTokenCount ?? 0);
      outputTokens = Math.max(outputTokens, event.usageMetadata?.candidatesTokenCount ?? 0);
    };
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r/g, "");
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) { consume(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2); boundary = buffer.indexOf("\n\n"); }
      }
      if (buffer.trim()) consume(buffer);
    } finally { reader.releaseLock(); }
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
