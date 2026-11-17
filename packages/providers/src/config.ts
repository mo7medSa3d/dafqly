import { PROVIDER_PRESETS, type UnifiedAiOptions } from "./unified-ai";

/**
 * Single-point AI configuration resolver.
 * Set `AI_PROVIDER` + `AI_API_KEY` (and optionally `AI_MODEL` / `AI_BASE_URL`)
 * in `.env` or directly in code. That single configuration powers every tenant.
 */
export interface AiEnvInput {
  AI_PROVIDER: string;
  AI_API_KEY?: string;
  AI_MODEL?: string;
  AI_BASE_URL?: string;
  /** Optional legacy fallbacks if AI_API_KEY is omitted. */
  GEMINI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  AI_MODEL_AGENT?: string;
  AI_MODEL_FAST?: string;
  AI_MODEL_VISION?: string;
}

export interface LlmProviderConfig {
  name?: string;
  kind: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  modelFast?: string;
  modelVision?: string;
  pricing?: { inputUsdPerM: number; outputUsdPerM: number };
}

const clean = (v: string | undefined): string | undefined => (v && v.trim() ? v.trim() : undefined);

/**
 * Resolves the single unified AI configuration from env/code inputs.
 * Priority: explicit `AI_API_KEY` -> provider-specific legacy key if set.
 */
export function resolveAiConfig(e: AiEnvInput): UnifiedAiOptions {
  const provider = e.AI_PROVIDER.trim().toLowerCase() || "gemini";
  const apiKey =
    clean(e.AI_API_KEY) ??
    (provider === "gemini" || provider === "google" ? clean(e.GEMINI_API_KEY) : undefined) ??
    (provider === "anthropic" || provider === "claude" ? clean(e.ANTHROPIC_API_KEY) : undefined) ??
    (provider === "openrouter" ? clean(e.OPENROUTER_API_KEY) : undefined) ??
    clean(e.GEMINI_API_KEY) ??
    clean(e.ANTHROPIC_API_KEY) ??
    clean(e.OPENROUTER_API_KEY);

  const model = clean(e.AI_MODEL) ?? clean(e.AI_MODEL_AGENT) ?? clean(e.AI_MODEL_FAST) ?? clean(e.AI_MODEL_VISION);
  const baseUrl = clean(e.AI_BASE_URL);
  return { provider, apiKey, model, baseUrl };
}

/** Backwards-compatible single-element config list for budget metering & status display. */
export function resolveLlmProviderConfigs(e: AiEnvInput): LlmProviderConfig[] {
  const cfg = resolveAiConfig(e);
  const preset = PROVIDER_PRESETS[cfg.provider];
  const resolvedModel = cfg.model ?? preset?.defaultModel;
  return [{
    name: cfg.provider,
    kind: cfg.provider,
    apiKey: cfg.apiKey,
    baseUrl: cfg.baseUrl ?? preset?.baseUrl,
    model: resolvedModel,
    modelFast: resolvedModel,
    modelVision: resolvedModel,
  }];
}

/** True when the configured AI provider has an API key or is a local endpoint (Ollama/LM Studio/local proxy). */
export function hasUsableLlmConfig(e: AiEnvInput): boolean {
  const cfg = resolveAiConfig(e);
  const preset = PROVIDER_PRESETS[cfg.provider];
  const baseUrl = cfg.baseUrl ?? preset?.baseUrl ?? "";
  if (!baseUrl) return false;
  const isLocal = /^(https?:\/\/)(localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal)/i.test(baseUrl);
  return Boolean(cfg.apiKey) || isLocal || preset?.requiresKey === false;
}

/** Model id used for budget metering and status display. */
export function primaryModelFor(configs: LlmProviderConfig[], _operation?: "agent" | "vision" | "fast"): string | undefined {
  const c = configs[0];
  return c?.model ?? c?.modelFast ?? c?.modelVision;
}
