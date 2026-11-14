import type { LlmProviderConfig } from "./registry";

/**
 * Pure env -> provider list resolver (no I/O, unit-testable). The first entry
 * is the primary; any further entries are automatic failover, in order.
 *
 * Sources, highest priority first:
 *  1. AI_PROVIDERS_JSON  — explicit list of any providers (see LlmProviderConfig).
 *  2. AI_PROVIDER (+ AI_BASE_URL / AI_API_KEY / AI_MODEL_*) — one provider, ANY
 *     name: built-ins gemini|anthropic, presets (openai, openrouter, groq,
 *     ollama, ...), or any other name when AI_BASE_URL is set.
 *  Legacy single-vendor keys keep working: GEMINI_API_KEY / ANTHROPIC_API_KEY
 *  select that vendor when only one of them exists; when BOTH exist the
 *  AI_PROVIDER one is primary and the other becomes the failover.
 */
export interface AiEnvInput {
  AI_PROVIDER: string;
  AI_API_KEY?: string;
  AI_BASE_URL?: string;
  AI_PROVIDERS_JSON?: string;
  AI_MODEL?: string;
  AI_MODEL_AGENT?: string;
  AI_MODEL_FAST?: string;
  AI_MODEL_VISION?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL_FAST?: string;
  GEMINI_MODEL_VISION?: string;
  ANTHROPIC_API_KEY?: string;
  LLM_MODEL_AGENT?: string;
  LLM_MODEL_FAST?: string;
  LLM_MODEL_VISION?: string;
}

const clean = (v: string | undefined): string | undefined => (v && v.trim() ? v.trim() : undefined);
const BUILT_IN = new Set(["gemini", "google", "anthropic", "claude"]);

function parseProvidersJson(raw: string): LlmProviderConfig[] {
  let data: unknown;
  try { data = JSON.parse(raw); } catch { throw new Error("AI_PROVIDERS_JSON is not valid JSON"); }
  if (!Array.isArray(data) || data.length === 0) throw new Error("AI_PROVIDERS_JSON must be a non-empty JSON array");
  return data.map((item, i): LlmProviderConfig => {
    if (!item || typeof item !== "object") throw new Error(`AI_PROVIDERS_JSON[${i}] must be an object`);
    const o = item as Record<string, unknown>;
    const str = (k: string): string | undefined => (typeof o[k] === "string" && (o[k] as string).trim() ? (o[k] as string).trim() : undefined);
    const kind = str("kind");
    if (!kind) throw new Error(`AI_PROVIDERS_JSON[${i}].kind is required`);
    let headers: Record<string, string> | undefined;
    if (o.headers !== undefined) {
      if (!o.headers || typeof o.headers !== "object" || Array.isArray(o.headers)
        || Object.values(o.headers as object).some((v) => typeof v !== "string")) {
        throw new Error(`AI_PROVIDERS_JSON[${i}].headers must be an object of strings`);
      }
      headers = o.headers as Record<string, string>;
    }
    const tokenParam = str("tokenParam");
    if (tokenParam && tokenParam !== "max_tokens" && tokenParam !== "max_completion_tokens") {
      throw new Error(`AI_PROVIDERS_JSON[${i}].tokenParam must be max_tokens or max_completion_tokens`);
    }
    return {
      name: str("name") ?? kind, kind, apiKey: str("apiKey"), baseUrl: str("baseUrl"),
      model: str("model"), modelFast: str("modelFast"), modelVision: str("modelVision"),
      headers, tokenParam: tokenParam as LlmProviderConfig["tokenParam"],
      supportsStreamUsage: typeof o.supportsStreamUsage === "boolean" ? o.supportsStreamUsage : undefined,
      supportsForcedToolChoice: typeof o.supportsForcedToolChoice === "boolean" ? o.supportsForcedToolChoice : undefined,
      timeoutMs: typeof o.timeoutMs === "number" && o.timeoutMs > 0 ? o.timeoutMs : undefined,
      pricing: o.pricing && typeof o.pricing === "object"
        && typeof (o.pricing as Record<string, unknown>).inputUsdPerM === "number"
        && typeof (o.pricing as Record<string, unknown>).outputUsdPerM === "number"
        ? { inputUsdPerM: (o.pricing as { inputUsdPerM: number }).inputUsdPerM, outputUsdPerM: (o.pricing as { outputUsdPerM: number }).outputUsdPerM }
        : undefined,
    };
  });
}

function geminiConfig(e: AiEnvInput): LlmProviderConfig {
  return { name: "gemini", kind: "gemini", apiKey: clean(e.GEMINI_API_KEY) ?? clean(e.AI_API_KEY), baseUrl: clean(e.AI_BASE_URL),
    model: clean(e.AI_MODEL_AGENT) ?? clean(e.AI_MODEL), modelFast: clean(e.AI_MODEL_FAST) ?? clean(e.GEMINI_MODEL_FAST),
    modelVision: clean(e.AI_MODEL_VISION) ?? clean(e.GEMINI_MODEL_VISION) };
}
function anthropicConfig(e: AiEnvInput): LlmProviderConfig {
  return { name: "anthropic", kind: "anthropic", apiKey: clean(e.ANTHROPIC_API_KEY) ?? clean(e.AI_API_KEY), baseUrl: clean(e.AI_BASE_URL),
    model: clean(e.AI_MODEL_AGENT) ?? clean(e.LLM_MODEL_AGENT), modelFast: clean(e.AI_MODEL_FAST) ?? clean(e.LLM_MODEL_FAST),
    modelVision: clean(e.AI_MODEL_VISION) ?? clean(e.LLM_MODEL_VISION) };
}

export function resolveLlmProviderConfigs(e: AiEnvInput): LlmProviderConfig[] {
  const json = clean(e.AI_PROVIDERS_JSON);
  if (json) return parseProvidersJson(json);

  const kind = e.AI_PROVIDER.trim().toLowerCase();
  if (!BUILT_IN.has(kind)) {
    const model = clean(e.AI_MODEL_AGENT);
    if (!model) throw new Error(`AI_MODEL_AGENT is required when AI_PROVIDER="${e.AI_PROVIDER}" (no default model is assumed for a generic provider)`);
    return [{ name: kind, kind, apiKey: clean(e.AI_API_KEY), baseUrl: clean(e.AI_BASE_URL), model,
      modelFast: clean(e.AI_MODEL_FAST), modelVision: clean(e.AI_MODEL_VISION) }];
  }

  const gKey = clean(e.GEMINI_API_KEY);
  const aKey = clean(e.ANTHROPIC_API_KEY);
  const generic = clean(e.AI_API_KEY);
  const wantsGemini = kind === "gemini" || kind === "google";
  if (gKey && aKey) {
    const g = geminiConfig(e); const a = anthropicConfig(e);
    return wantsGemini ? [g, a] : [a, g];
  }
  if (gKey) return [geminiConfig(e)];
  if (aKey) return [anthropicConfig(e)];
  return [wantsGemini ? geminiConfig(e) : anthropicConfig(e)].map((c) => ({ ...c, apiKey: generic }));
}

/** True when at least one configured provider could actually be called. */
export function hasUsableLlmConfig(e: AiEnvInput): boolean {
  let configs: LlmProviderConfig[];
  try { configs = resolveLlmProviderConfigs(e); } catch { return false; }
  return configs.some((c) => {
    const k = c.kind.trim().toLowerCase();
    // Local/self-hosted OpenAI-compatible servers legitimately have no key.
    const local = !BUILT_IN.has(k) && Boolean(c.baseUrl ?? "") && /^(https?:\/\/)(localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal)/i.test(c.baseUrl ?? "");
    return Boolean(c.apiKey) || local;
  });
}

/** Model id used for budget metering of a given operation, from the PRIMARY provider. */
export function primaryModelFor(configs: LlmProviderConfig[], operation: "agent" | "vision" | "fast"): string | undefined {
  const c = configs[0];
  if (!c) return undefined;
  return operation === "agent" ? (c.model ?? c.modelFast ?? c.modelVision)
    : operation === "vision" ? (c.modelVision ?? c.model ?? c.modelFast)
    : (c.modelFast ?? c.model ?? c.modelVision);
}
