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
  });
  it("fails fast on missing DB URL and placeholder secrets", () => {
    expect(() => parseEnv({ ...base, DATABASE_URL: undefined })).toThrow(EnvError);
    expect(() => parseEnv({ ...base, SESSION_SECRET: "change-me-32+chars-random" })).toThrow(EnvError);
    expect(() => parseEnv({ ...base, SESSION_SECRET: "short" })).toThrow(EnvError);
  });
  it("refuses to boot with the shared-behavior flag on (ADR-006, legal sign-off pending)", () => {
    expect(() => parseEnv({ ...base, FEATURE_SHARED_BEHAVIOR: "true" })).toThrow(/shared.behavior|legal/i);
  });
  it("parses explicit booleans and budgets", () => {
    const env = parseEnv({ ...base, DRY_RUN_MESSAGING: "false", LLM_MONTHLY_BUDGET_USD: "25" });
    expect(env.DRY_RUN_MESSAGING).toBe(false);
    expect(env.LLM_MONTHLY_BUDGET_USD).toBe(25);
  });
});
