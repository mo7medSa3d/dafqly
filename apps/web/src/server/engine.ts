import {
  AnthropicLlmProvider, DryRunMessagingProvider, FakeLlmProvider, FakeStorageProvider,
  GeminiLlmProvider, NotConfiguredMessagingProvider, NotConfiguredSmsProvider, S3CompatibleStorageProvider,
  WhatsAppCloudProvider, type OcrLlmProvider, type StorageProvider, type TextCapableProvider,
} from "@tahseel/providers";
import { planForInvoice, planForTenant, quotaExceededFromDb, type EngineDeps } from "@tahseel/reminders";
import { appDb, ownerDb } from "./db";
import { env } from "./env";
import { budgetedLlmProvider } from "./ai-budget";

/**
 * Engine wiring for the web process (ADR-016): the same engine the worker
 * runs. Providers follow the environment — the real WhatsApp adapter only
 * when a token is configured, and EVERYTHING is wrapped in dry-run while
 * DRY_RUN_MESSAGING=true (the safe default), so a web request can never
 * send a real message in dev/CI.
 */
export function engineDeps(): EngineDeps {
  const e = env();
  const realWhatsapp: TextCapableProvider = e.WHATSAPP_ACCESS_TOKEN
    ? new WhatsAppCloudProvider({
        apiVersion: e.WHATSAPP_API_VERSION, phoneNumberId: e.WHATSAPP_PHONE_NUMBER_ID,
        accessToken: e.WHATSAPP_ACCESS_TOKEN,
      })
    : new NotConfiguredMessagingProvider("whatsapp");
  const whatsapp = e.DRY_RUN_MESSAGING ? new DryRunMessagingProvider(realWhatsapp) : realWhatsapp;
  const smsBase: TextCapableProvider = new NotConfiguredSmsProvider(); // SMS vendor is deliberately not guessed; configure a verified adapter first.
  const sms = e.DRY_RUN_MESSAGING ? new DryRunMessagingProvider(smsBase) : smsBase;
  const app = appDb();
  return {
    app, owner: ownerDb(), providers: { whatsapp, sms }, appUrl: e.APP_URL,
    // F13: block sends when the tenant is at/over its monthly quota.
    quotaExceeded: (tenantId: string) => quotaExceededFromDb(app, tenantId, new Date()),
  };
}

/**
 * Best-effort re-planning hooks (BUILD_PLAN §7-F4: the planner re-runs on
 * invoice/payment change). A planning failure must never fail the ledger
 * write that triggered it — the nightly planner (worker) is the backstop —
 * so errors are logged and swallowed here, and only here.
 */
export function replanLater(tenantId: string, invoiceId: string): void {
  void planForInvoice(engineDeps(), tenantId, invoiceId, new Date()).catch((err) => {
    console.error("[replan] invoice planning failed", { tenantId, invoiceId, err });
  });
}

/**
 * AI provider seam (F6/F7/F8, ADR-022): real Gemini/Anthropic when configured;
 * otherwise a clearly marked deterministic FAKE for dev/test. Uploaded bytes use
 * private S3-compatible storage (MinIO locally, S3-compatible in production).
 */
export interface AiDeps { llm: OcrLlmProvider; storage: StorageProvider; usingFakeLlm: boolean }
let aiSingleton: AiDeps | null = null;
export function aiDeps(): AiDeps {
  if (aiSingleton) return aiSingleton;
  const e = env();
  // Never make real provider calls from unit/integration tests unless an
  // explicitly enabled sandbox suite opts in. Test storage remains isolated.
  // ADR-033: the e2e server runs production-mode with E2E_FAKE_PROVIDERS —
  // same fake LLM + fake storage, because the sandbox has no MinIO and no
  // AI key (the e2e specs depend on the deterministic fake, e.g. m4's
  // synthetic ledger-photo extraction).
  if ((e.NODE_ENV === "test" || e.E2E_FAKE_PROVIDERS) && !e.RUN_SANDBOX_TESTS) {
    aiSingleton = { llm: new FakeLlmProvider(), storage: new FakeStorageProvider(), usingFakeLlm: true };
    return aiSingleton;
  }
  const storage = new S3CompatibleStorageProvider({
    endpoint: e.S3_ENDPOINT, region: e.S3_REGION, bucket: e.S3_BUCKET,
    accessKey: e.S3_ACCESS_KEY, secretKey: e.S3_SECRET_KEY, forcePathStyle: e.S3_FORCE_PATH_STYLE,
  });

  const hasBothDedicatedKeys = Boolean(e.GEMINI_API_KEY && e.ANTHROPIC_API_KEY);
  const selectedProvider = hasBothDedicatedKeys
    ? e.AI_PROVIDER
    : e.GEMINI_API_KEY ? "gemini" : e.ANTHROPIC_API_KEY ? "anthropic" : e.AI_PROVIDER;
  const selectedKey = selectedProvider === "gemini"
    ? (e.GEMINI_API_KEY || e.AI_API_KEY)
    : (e.ANTHROPIC_API_KEY || e.AI_API_KEY);

  if (selectedKey && selectedProvider === "gemini") {
    aiSingleton = {
      llm: new GeminiLlmProvider({
        apiKey: selectedKey, model: e.AI_MODEL,
        modelFast: e.GEMINI_MODEL_FAST, modelVision: e.GEMINI_MODEL_VISION,
      }),
      storage,
      usingFakeLlm: false,
    };
  } else if (selectedKey && selectedProvider === "anthropic") {
    aiSingleton = {
      llm: new AnthropicLlmProvider({
        apiKey: selectedKey,
        modelAgent: e.LLM_MODEL_AGENT,
        modelFast: e.LLM_MODEL_FAST,
        modelVision: e.LLM_MODEL_VISION,
      }),
      storage,
      usingFakeLlm: false,
    };
  } else {
    aiSingleton = { llm: new FakeLlmProvider(), storage, usingFakeLlm: true };
  }
  if (!aiSingleton.usingFakeLlm) {
    aiSingleton = { ...aiSingleton, llm: budgetedLlmProvider(aiSingleton.llm) };
  }
  return aiSingleton;
}

/** Test seam: replace the AI singletons (integration suites inject their own fakes). */
export function setAiDepsForTests(deps: AiDeps | null): void {
  aiSingleton = deps;
}

export function replanTenantLater(tenantId: string): void {
  void planForTenant(engineDeps(), tenantId, new Date()).catch((err) => {
    console.error("[replan] tenant planning failed", { tenantId, err });
  });
}
