import {
  AnthropicLlmProvider, DryRunMessagingProvider, FakeLlmProvider, FakeMessagingProvider, FakeStorageProvider,
  GeminiLlmProvider,
  NotConfiguredSmsProvider, WhatsAppCloudProvider, type OcrLlmProvider, type StorageProvider, type TextCapableProvider,
} from "@tahseel/providers";
import { planForInvoice, planForTenant, quotaExceededFromDb, type EngineDeps } from "@tahseel/reminders";
import { appDb, ownerDb } from "./db";
import { env } from "./env";

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
    : new FakeMessagingProvider();
  const whatsapp = e.DRY_RUN_MESSAGING ? new DryRunMessagingProvider(realWhatsapp) : realWhatsapp;
  const smsBase: TextCapableProvider = e.SMS_API_KEY ? new FakeMessagingProvider() : new NotConfiguredSmsProvider();
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
 * AI provider seam (F6/F7/F8, ADR-022): the real Anthropic adapter ONLY when
 * ANTHROPIC_API_KEY is configured; otherwise the deterministic FAKE provider
 * (labelled as such everywhere its results surface). Storage is the
 * in-process FAKE until an S3/MinIO adapter lands — one shared instance so
 * uploads stored by one request can be read by the next in dev/tests.
 */
export interface AiDeps { llm: OcrLlmProvider; storage: StorageProvider; usingFakeLlm: boolean }
let aiSingleton: AiDeps | null = null;
export function aiDeps(): AiDeps {
  if (aiSingleton) return aiSingleton;
  const e = env();
  const storage = new FakeStorageProvider();

  const geminiKey = e.GEMINI_API_KEY || (e.AI_PROVIDER === "gemini" ? e.AI_API_KEY : "");
  const anthropicKey = e.ANTHROPIC_API_KEY || (e.AI_PROVIDER === "anthropic" ? e.AI_API_KEY : "");
  const unifiedModel = e.AI_MODEL || (geminiKey ? "gemini-3.1-flash-lite" : "claude-sonnet-5-5");

  if (geminiKey || (e.AI_API_KEY && (unifiedModel.includes("gemini") || e.AI_API_KEY.startsWith("AQ.")))) {
    const key = geminiKey || e.AI_API_KEY;
    aiSingleton = {
      llm: new GeminiLlmProvider({ apiKey: key, model: unifiedModel }),
      storage,
      usingFakeLlm: false,
    };
  } else if (anthropicKey || e.AI_API_KEY) {
    const key = anthropicKey || e.AI_API_KEY;
    aiSingleton = {
      llm: new AnthropicLlmProvider({ apiKey: key, model: unifiedModel, modelFast: unifiedModel, modelVision: unifiedModel }),
      storage,
      usingFakeLlm: false,
    };
  } else {
    aiSingleton = { llm: new FakeLlmProvider(), storage, usingFakeLlm: true };
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
