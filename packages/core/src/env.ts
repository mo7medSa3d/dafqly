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
  S3_ENDPOINT: z.string().default("http://localhost:9000"),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("tahseel-files"),
  S3_ACCESS_KEY: z.string().default("minioadmin"),
  S3_SECRET_KEY: z.string().default("minioadmin"),
  S3_FORCE_PATH_STYLE: boolFromString(true),
  SMTP_URL: z.string().default("smtp://localhost:1025"),
  EMAIL_FROM: z.string().default("Tahseel <no-reply@localhost>"),
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
  PAYMOB_INTEGRATION_ID: z.string().optional().default(""),
  PAYMOB_HMAC_SECRET: z.string().optional().default(""),
  PAYMOB_BASE_URL: z.string().optional().default(""),
  AI_API_KEY: z.string().optional().default(""),
  AI_MODEL: z.string().default("claude-sonnet-5-5"),
  ANTHROPIC_API_KEY: z.string().optional().default(""),
  LLM_MODEL_FAST: z.string().default("claude-sonnet-5-5"),
  LLM_MODEL_VISION: z.string().default("claude-sonnet-5-5"),
  LLM_MONTHLY_BUDGET_USD: z.coerce.number().positive().default(50),
  LLM_PER_TENANT_DAILY_BUDGET_USD: z.coerce.number().positive().default(2),
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
  return parsed.data;
}
