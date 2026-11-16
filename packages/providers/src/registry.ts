import { AnthropicLlmProvider, type AgentRunInput, type AgentRunResult, type LlmCallResult, type OcrLlmProvider, type ReplyContext } from "./llm";
import { GeminiLlmProvider } from "./gemini";
import { OpenAiCompatibleLlmProvider, OPENAI_DEFAULT_BASE_URL } from "./openai-compatible";
import type { ChequeExtraction, LedgerExtraction, ReceiptExtraction, ReplyClassification } from "@tahseel/core";

/**
 * Provider registry: the application never names a vendor. A deployment
 * describes one or more providers as data (`LlmProviderConfig`), and the
 * factory below builds the adapter. Adding a vendor is one of:
 *   1. any OpenAI-compatible service  -> kind "openai-compatible" + baseUrl
 *      (or a preset name below) — no code change at all;
 *   2. a vendor with its own wire format -> `registerLlmProviderKind(...)`.
 */
export interface LlmProviderConfig {
  /** Label for logs/telemetry. Defaults to `kind`. */
  name?: string;
  /** "gemini" | "anthropic" | "openai-compatible" | a preset | a registered kind. */
  kind: string;
  apiKey?: string;
  baseUrl?: string;
  /** Agent (multi-step reasoning) model. */
  model?: string;
  modelFast?: string;
  modelVision?: string;
  headers?: Record<string, string>;
  tokenParam?: "max_tokens" | "max_completion_tokens";
  supportsStreamUsage?: boolean;
  supportsForcedToolChoice?: boolean;
  timeoutMs?: number;
  /** USD per million tokens — used only for the platform spend cap when the model id is not in the built-in table. */
  pricing?: { inputUsdPerM: number; outputUsdPerM: number };
}

export type LlmProviderFactory = (config: LlmProviderConfig) => OcrLlmProvider;
const customKinds = new Map<string, LlmProviderFactory>();

export function registerLlmProviderKind(kind: string, factory: LlmProviderFactory): void {
  customKinds.set(kind.trim().toLowerCase(), factory);
}

/**
 * Convenience base URLs for well-known OpenAI-compatible services. These are
 * defaults only: `baseUrl` in the config always wins, so a changed endpoint
 * never needs a code change. (Not individually re-verified; see DECISIONS.)
 */
export const OPENAI_COMPATIBLE_PRESETS: Readonly<Record<string, string>> = {
  openai: OPENAI_DEFAULT_BASE_URL,
  openrouter: "https://openrouter.ai/api/v1",
  groq: "https://api.groq.com/openai/v1",
  together: "https://api.together.xyz/v1",
  deepseek: "https://api.deepseek.com/v1",
  mistral: "https://api.mistral.ai/v1",
  xai: "https://api.x.ai/v1",
  ollama: "http://localhost:11434/v1",
  lmstudio: "http://localhost:1234/v1",
};

export function createLlmProvider(config: LlmProviderConfig): OcrLlmProvider {
  const kind = config.kind.trim().toLowerCase();
  const custom = customKinds.get(kind);
  if (custom) return custom(config);
  if (kind === "gemini" || kind === "google") {
    return new GeminiLlmProvider({
      apiKey: config.apiKey ?? "", model: config.model, modelFast: config.modelFast, modelVision: config.modelVision,
      baseUrl: config.baseUrl || undefined, timeoutMs: config.timeoutMs,
    });
  }
  if (kind === "anthropic" || kind === "claude") {
    return new AnthropicLlmProvider({
      apiKey: config.apiKey ?? "", modelAgent: config.model, modelFast: config.modelFast, modelVision: config.modelVision,
      baseUrl: config.baseUrl || undefined, timeoutMs: config.timeoutMs,
    });
  }
  const baseUrl = config.baseUrl?.trim() || OPENAI_COMPATIBLE_PRESETS[kind];
  if (!baseUrl) {
    throw new Error(`Unknown AI provider "${config.kind}": set a base URL (AI_BASE_URL) to use it as an OpenAI-compatible service, or choose a built-in/preset provider`);
  }
  return new OpenAiCompatibleLlmProvider({
    name: config.name ?? kind, apiKey: config.apiKey, baseUrl, model: config.model, modelFast: config.modelFast,
    modelVision: config.modelVision, headers: config.headers, tokenParam: config.tokenParam,
    supportsStreamUsage: config.supportsStreamUsage, supportsForcedToolChoice: config.supportsForcedToolChoice,
    timeoutMs: config.timeoutMs,
  });
}

// ------------------------------------------------------------------ FAILOVER
export interface FailoverMember { name: string; provider: OcrLlmProvider }
export interface FailoverOptions {
  /** Called when a member fails and the next one is tried (log it; never include prompts). */
  onFailover?: (info: { from: string; to: string; error: string }) => void;
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 200);

/**
 * Tries members in order. Failover is deliberately conservative:
 *  - never after the caller aborted;
 *  - for the agent loop, never once ANY tool has run or ANY text/tool event has
 *    been emitted, because replaying would duplicate tool side effects
 *    (e.g. pending-approval proposals) and double-print streamed text.
 */
export class FailoverLlmProvider implements OcrLlmProvider {
  constructor(private readonly members: FailoverMember[], private readonly opts: FailoverOptions = {}) {
    if (members.length === 0) throw new Error("FailoverLlmProvider needs at least one provider");
  }

  get names(): string[] { return this.members.map((m) => m.name); }

  private async each<T>(call: (p: OcrLlmProvider) => Promise<T> | undefined, canRetry: () => boolean = () => true, signal?: AbortSignal): Promise<T> {
    let lastError: unknown;
    for (let i = 0; i < this.members.length; i += 1) {
      const member = this.members[i]!;
      try {
        const pending = call(member.provider);
        if (!pending) continue; // member lacks this capability
        return await pending;
      } catch (error) {
        lastError = error;
        const next = this.members[i + 1];
        if (!next || signal?.aborted || !canRetry()) throw error;
        this.opts.onFailover?.({ from: member.name, to: next.name, error: errText(error) });
      }
    }
    throw lastError ?? new Error("No configured AI provider supports this operation");
  }

  extractLedgerPage(image: Uint8Array, mime: string, currency = "EGP"): Promise<LlmCallResult<LedgerExtraction>> { return this.each((p) => p.extractLedgerPage(image, mime, currency)); }
  extractReceipt(image: Uint8Array, mime: string): Promise<LlmCallResult<ReceiptExtraction>> { return this.each((p) => p.extractReceipt(image, mime)); }
  extractCheque(image: Uint8Array, mime: string): Promise<LlmCallResult<ChequeExtraction>> { return this.each((p) => p.extractCheque(image, mime)); }
  classifyReply(text: string, context: ReplyContext): Promise<LlmCallResult<ReplyClassification>> { return this.each((p) => p.classifyReply(text, context)); }
  generateText(prompt: string, system?: string) { return this.each((p) => p.generateText?.(prompt, system)); }

  streamText(prompt: string, system: string | undefined, onToken: (delta: string) => void, signal?: AbortSignal) {
    let emitted = false;
    return this.each((p) => p.streamText?.(prompt, system, (d) => { emitted = true; onToken(d); }, signal), () => !emitted, signal);
  }

  runAgent(input: AgentRunInput): Promise<AgentRunResult> {
    let sideEffects = false;
    const guarded: AgentRunInput = {
      ...input,
      executeTool: async (name, args) => { sideEffects = true; return input.executeTool(name, args); },
      onEvent: input.onEvent ? (event) => { if (event.type !== "step") sideEffects = true; input.onEvent!(event); } : undefined,
    };
    return this.each((p) => p.runAgent?.(guarded), () => !sideEffects, input.signal);
  }
}
