import type { OcrLlmProvider } from "./llm";
import { createAiProvider, PROVIDER_PRESETS } from "./unified-ai";
import type { LlmProviderConfig } from "./config";

export type { LlmProviderConfig } from "./config";
export { PROVIDER_PRESETS };

/**
 * Single factory for building the unified AI provider from config.
 */
export function createLlmProvider(config: LlmProviderConfig): OcrLlmProvider {
  return createAiProvider({
    provider: config.kind,
    apiKey: config.apiKey,
    model: config.model ?? config.modelFast ?? config.modelVision,
    baseUrl: config.baseUrl,
  });
}
