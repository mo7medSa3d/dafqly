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
  type LlmCallResult,
  type OcrLlmProvider,
  type ReplyContext,
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
  model?: string;
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
 * Supports Gemini 3.1 Flash Lite, Gemini 2.5 Flash, etc.
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
  }): Promise<LlmCallResult<T>> {
    const started = this.now();
    const model = this.opts.model ?? "gemini-3.1-flash-lite";
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
    return this.callTool({
      promptVersion: LEDGER_PROMPT_VERSION,
      system: LEDGER_SYSTEM,
      userText: LEDGER_USER,
      image: { data: image, mime },
      toolName: LEDGER_TOOL_NAME,
      toolDescription: "Return the ledger rows transcribed from the page image.",
      toolSchema: LEDGER_TOOL_SCHEMA,
      parse: parseLedgerExtraction,
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
    });
  }

  async generateText(prompt: string, systemInstruction?: string): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
    const model = this.opts.model ?? "gemini-3.1-flash-lite";
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
      text,
      inputTokens: body.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: body.usageMetadata?.candidatesTokenCount ?? 0,
    };
  }
}
