import { describe, it, expect } from "vitest";
import { parseEnv, EnvError } from "./env";

const base = {
  DATABASE_URL: "postgres://tahseel:tahseel@localhost:5432/tahseel",
  SESSION_SECRET: "x".repeat(32),
  PHONE_HASH_PEPPER: "y".repeat(32),
};
describe("parseEnv", () => {
  it("applies safe defaults: dry-run on, shared-behavior off, brand font off", () => {
    const env = parseEnv({ ...base });
    expect(env.DRY_RUN_MESSAGING).toBe(true);
    expect(env.FEATURE_SHARED_BEHAVIOR).toBe(false);
    expect(env.NEXT_PUBLIC_BRAND_FONT).toBe("off");
    expect(env.DEFAULT_TIMEZONE).toBe("Africa/Cairo");
    expect(env.DEFAULT_LOCALE).toBe("ar");
    expect(env.RUN_SANDBOX_TESTS).toBe(false);
    expect(env.AI_DAILY_TOKEN_LIMIT).toBe(100_000);
    expect(env.AI_MODEL).toBe("gemini-3.8-flash");
    expect(env.GEMINI_MODEL_FAST).toBe("gemini-3.5-flash-lite");
    expect(env.LLM_MODEL_AGENT).toBe("claude-sonnet-5-5");
    expect(env.LLM_MODEL_FAST).toBe("claude-haiku-5-5");
  });
  it("fails fast on missing DB URL and placeholder secrets", () => {
    expect(() => parseEnv({ ...base, DATABASE_URL: undefined })).toThrow(EnvError);
    expect(() => parseEnv({ ...base, SESSION_SECRET: "change-me-32+chars-random" })).toThrow(EnvError);
    expect(() => parseEnv({ ...base, SESSION_SECRET: "short" })).toThrow(EnvError);
  });
  it("refuses to boot with the shared-behavior flag on (ADR-006, legal sign-off pending)", () => {
    expect(() => parseEnv({ ...base, FEATURE_SHARED_BEHAVIOR: "true" })).toThrow(/shared.behavior|legal/i);
  });
  it("parses explicit messaging booleans", () => {
    const env = parseEnv({ ...base, DRY_RUN_MESSAGING: "false" });
    expect(env.DRY_RUN_MESSAGING).toBe(false);
  });
  it("rejects insecure or placeholder object storage configuration in production", () => {
    expect(() => parseEnv({ ...base, NODE_ENV: "production" })).toThrow(/HTTPS object-storage/i);
    expect(() => parseEnv({ ...base, NODE_ENV: "production", S3_ENDPOINT: "https://objects.example.com" })).toThrow(/non-default S3/i);
  });
  it("ADR-033: E2E_FAKE_PROVIDERS lets the production-mode e2e sandbox boot without real S3/AI, and only there", () => {
    // Without the flag the guard still fails closed (pinned by the test
    // above); with it, localhost S3 + default keys + no AI key parse.
    const env = parseEnv({ ...base, NODE_ENV: "production", E2E_FAKE_PROVIDERS: "true" });
    expect(env.E2E_FAKE_PROVIDERS).toBe(true);
    expect(env.S3_ENDPOINT).toBe("http://localhost:9000");
    // The flag does NOT relax the config-error checks: a partial WhatsApp
    // config still refuses to boot even in the sandbox.
    expect(() => parseEnv({
      ...base, NODE_ENV: "production", E2E_FAKE_PROVIDERS: "true",
      WHATSAPP_API_VERSION: "v24.0", WHATSAPP_PHONE_NUMBER_ID: "123",
    })).toThrow(/WhatsApp configuration is partial/i);
  });
  it("requires complete WhatsApp config for production live messaging and refuses unimplemented SMS", () => {
    const secure = {
      ...base, NODE_ENV: "production", S3_ENDPOINT: "https://objects.example.com",
      S3_ACCESS_KEY: "prod-access-key", S3_SECRET_KEY: "prod-secret-key", DRY_RUN_MESSAGING: "false",
      GEMINI_API_KEY: "production-gemini-key",
    };
    expect(() => parseEnv(secure)).toThrow(/Live messaging requires/i);
    expect(() => parseEnv({ ...secure, WHATSAPP_API_VERSION: "v24.0", WHATSAPP_PHONE_NUMBER_ID: "123", WHATSAPP_ACCESS_TOKEN: "token", SMS_PROVIDER: "provider-x" })).toThrow(/no verified SMS provider/i);
    expect(parseEnv({ ...secure, DRY_RUN_MESSAGING: "true" }).DRY_RUN_MESSAGING).toBe(true);
    // The AI guard is only reachable once the earlier live-messaging guard
    // passes, so this assertion needs a fully configured WhatsApp setup.
    expect(() => parseEnv({ ...secure, GEMINI_API_KEY: "", AI_API_KEY: "", WHATSAPP_API_VERSION: "v24.0", WHATSAPP_PHONE_NUMBER_ID: "123", WHATSAPP_ACCESS_TOKEN: "token" })).toThrow(/Production requires .* AI_API_KEY/i);
  });
  it("only allows the supported AI provider identifiers", () => {
    expect(() => parseEnv({ ...base, AI_PROVIDER: "fake" })).toThrow(/AI_PROVIDER/i);
  });
});
