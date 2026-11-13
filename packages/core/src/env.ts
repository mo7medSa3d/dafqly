import { z } from "zod";

export class EnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvError";
  }
}

const boolFromString = (def: boolean) =>
  z.preprocess((v) => (v === undefined ? def : v === "true" || v === true), z.boolean());
const secret = (name: string) =>
  z.string().min(32, `${name} must be at least 32 chars`).refine((v) => !v.startsWith("change-me"), `${name} still has the placeholder value`);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().default("http://localhost:3000"),
  DEFAULT_TIMEZONE: z.string().default("Africa/Cairo"),
  DEFAULT_LOCALE: z.enum(["ar", "en"]).default("ar"),
  SESSION_SECRET: secret("SESSION_SECRET"),
  PHONE_HASH_PEPPER: secret("PHONE_HASH_PEPPER"),
  DRY_RUN_MESSAGING: boolFromString(true),
  RUN_SANDBOX_TESTS: z.preprocess((v) => v === "1" || v === true, z.boolean()).default(false),
  FEATURE_SHARED_BEHAVIOR: boolFromString(false),
  NEXT_PUBLIC_BRAND_FONT: z.enum(["on", "off"]).default("off"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required").refine((v) => v.startsWith("postgres://") || v.startsWith("postgresql://"), "DATABASE_URL must be a postgres URL"),
  APP_DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  S3_ENDPOINT: z.string().url().default("http://localhost:9000"),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("tahseel-files"),
  S3_ACCESS_KEY: z.string().default("minioadmin"),
  S3_SECRET_KEY: z.string().default("minioadmin"),
  S3_FORCE_PATH_STYLE: boolFromString(true),
  SMTP_URL: z.string().default("smtp://localhost:1025"),
  EMAIL_FROM: z.string().default("Tahseel <no-reply@localhost>"),
  // H5: email verification is OFF by default — it needs a real SMTP sender
  // (SMTP_URL above) and must stay off until one is configured; enabling it
  // without a sender fails sign-up loudly (EMAIL_NOT_CONFIGURED), never
  // silently. When on, tenant access requires a verified email.
  EMAIL_VERIFICATION_ENABLED: boolFromString(false),
  // L6: extra origins allowed to use Better Auth cookies, comma-separated.
  // APP_URL is always trusted; leave empty for same-origin-only.
  TRUSTED_ORIGINS: z.string().default(""),
  WHATSAPP_API_VERSION: z.string().optional().default(""),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional().default(""),
  WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().optional().default(""),
  WHATSAPP_ACCESS_TOKEN: z.string().optional().default(""),
  WHATSAPP_APP_SECRET: z.string().optional().default(""),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().optional().default(""),
  SMS_PROVIDER: z.string().optional().default(""),
  SMS_API_KEY: z.string().optional().default(""),
  SMS_SENDER_ID: z.string().optional().default(""),
  PAYMOB_API_KEY: z.string().optional().default(""),
  // ADR-019: Intention API keys — secret (sk_*, server-side only) creates
  // intentions and refunds; public (pk_*) builds the checkout URL. The API
  // key above is kept for the transaction-inquiry flow only.
  PAYMOB_SECRET_KEY: z.string().optional().default(""),
  PAYMOB_PUBLIC_KEY: z.string().optional().default(""),
  // Safety valve: in production the gateway refuses to mint links through
  // the FAKE provider unless this is explicitly set (e2e sandbox runs).
  PAYMOB_ALLOW_FAKE: boolFromString(false),
  // ADR-033 (Prompt 07): the e2e harness runs a production-mode build +
  // server with fake providers (fake LLM/storage, fake Paymob, dry-run
  // messaging) and no real S3/AI credentials — in this VM and in CI there
  // is no MinIO and no AI key at all. With this flag the production guard
  // below skips only the "no real provider configured" checks (HTTPS S3,
  // non-default S3 keys, AI key); the config-error checks (partial
  // WhatsApp, SMS without an adapter) still apply, and the flag never
  // reaches a real deployment because no production host sets it. It is
  // set only by apps/web/playwright.config.ts webServer env.
  E2E_FAKE_PROVIDERS: boolFromString(false),
  ALLOW_LOCAL_S3: boolFromString(false),
  PAYMOB_INTEGRATION_ID: z.string().optional().default(""),
  PAYMOB_HMAC_SECRET: z.string().optional().default(""),
  PAYMOB_BASE_URL: z.string().optional().default(""),
  AI_API_KEY: z.string().optional().default(""),
  AI_MODEL: z.string().default("gemini-3.8-flash"),
  GEMINI_MODEL_FAST: z.string().default("gemini-3.5-flash-lite"),
  GEMINI_MODEL_VISION: z.string().default("gemini-3.8-flash"),
  AI_PROVIDER: z.enum(["gemini", "anthropic"]).default("gemini"),
  GEMINI_API_KEY: z.string().optional().default(""),
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  LLM_MODEL_AGENT: z.string().default("claude-sonnet-5-5"),
  LLM_MODEL_FAST: z.string().default("claude-haiku-5-5"),
  LLM_MODEL_VISION: z.string().default("claude-sonnet-5-5"),
  AI_DAILY_TOKEN_LIMIT: z.coerce.number().int().positive().default(100_000),
  AI_GLOBAL_MONTHLY_USD_CAP: z.coerce.number().positive().max(1_000_000).default(50),
  AI_GLOBAL_REQUEST_RESERVE_USD: z.coerce.number().positive().max(25).default(1.5),
  PLATFORM_ADMIN_USER_IDS: z.string().default(""),
  SENTRY_DSN: z.string().optional().default(""),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type AppEnv = z.infer<typeof envSchema>;

/** Pure env validation: pass process.env (or a test fixture); throws EnvError listing every problem. Fails fast at boot. */
export function parseEnv(input: Record<string, string | undefined>): AppEnv {
  const parsed = envSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new EnvError(`Invalid environment: ${issues}`);
  }
  // ADR-006: the shared-behavior feature stays disabled until Egyptian-law
  // legal sign-off is recorded. Refuse to boot rather than silently enable it.
  if (parsed.data.FEATURE_SHARED_BEHAVIOR) {
    throw new EnvError("FEATURE_SHARED_BEHAVIOR=true is refused: the shared-behavior feature requires legal sign-off first (ADR-006)");
  }
  // Production must never silently fall back to local MinIO credentials or
  // a clear-text object-storage endpoint. This prevents starting a service
  // whose uploads appear successful in development but are not production-ready.
  if (parsed.data.NODE_ENV === "production") {
    const s3 = parsed.data;
    // ADR-033: the e2e sandbox (E2E_FAKE_PROVIDERS) runs production-mode
    // with fake providers and no real S3/AI credentials, so the three
    // "no real provider configured" checks are skipped there only. A real
    // production host never sets the flag and still fails closed here.
    if (!s3.E2E_FAKE_PROVIDERS && !s3.ALLOW_LOCAL_S3) {
      const s3Url = new URL(s3.S3_ENDPOINT);
      if (s3Url.protocol !== "https:" || s3Url.hostname === "localhost" || s3Url.hostname === "127.0.0.1") {
        throw new EnvError("Production requires S3_ENDPOINT to be an HTTPS object-storage endpoint (not localhost)");
      }
      if (s3.S3_ACCESS_KEY === "minioadmin" || s3.S3_SECRET_KEY === "minioadmin") {
        throw new EnvError("Production requires non-default S3_ACCESS_KEY and S3_SECRET_KEY values");
      }
    }
    const whatsappParts = [s3.WHATSAPP_API_VERSION, s3.WHATSAPP_PHONE_NUMBER_ID, s3.WHATSAPP_ACCESS_TOKEN];
    if (whatsappParts.some(Boolean) && !whatsappParts.every(Boolean)) {
      throw new EnvError("WhatsApp configuration is partial; set API_VERSION, PHONE_NUMBER_ID and ACCESS_TOKEN together");
    }
    if (!s3.DRY_RUN_MESSAGING && !whatsappParts.every(Boolean)) {
      throw new EnvError("Live messaging requires a fully configured WhatsApp Cloud API; SMS has no production adapter yet");
    }
    if (s3.SMS_PROVIDER || s3.SMS_API_KEY || s3.SMS_SENDER_ID) {
      throw new EnvError("SMS credentials were supplied but no verified SMS provider adapter is implemented; remove these settings until a provider is selected");
    }
    // ADR-033: skipped under E2E_FAKE_PROVIDERS — the sandbox uses the
    // deterministic fake LLM, so no real AI key exists there.
    const hasConfiguredAi = Boolean(s3.GEMINI_API_KEY || s3.ANTHROPIC_API_KEY || s3.AI_API_KEY);
    if (!hasConfiguredAi && !s3.E2E_FAKE_PROVIDERS) {
      throw new EnvError("Production requires GEMINI_API_KEY, ANTHROPIC_API_KEY, or AI_API_KEY with AI_PROVIDER configured; fake AI fallback is not allowed");
    }
  }
  return parsed.data;
}
