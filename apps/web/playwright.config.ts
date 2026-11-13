import { defineConfig } from "@playwright/test";
import "./src/server/load-env";

// E2E (BUILD_PLAN §9): Arabic RTL, mobile viewport. The root `pnpm test:e2e`
// script runs db:migrate + db:seed before this, so the seeded demo user
// exists. The web server is built and started by Playwright itself.
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://localhost:3000",
    viewport: { width: 390, height: 844 }, // mobile-first (BRAND §8)
    locale: "ar-EG",
    ...(process.env.CI ? {} : { channel: "chrome" }),
  },
  webServer: {
    command: "pnpm build && pnpm start",
    url: "http://localhost:3000/healthz",
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    env: {
      NODE_ENV: "production",
      DATABASE_URL: process.env.DATABASE_URL ?? "",
      APP_DATABASE_URL: process.env.APP_DATABASE_URL ?? "",
      NEXT_PUBLIC_BRAND_FONT: "on",
      WHATSAPP_APP_SECRET: "e2e-app-secret-for-tests-only-0123456789",
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: "e2e-verify-token",
      PAYMOB_HMAC_SECRET: "e2e-paymob-hmac-secret-for-tests-only",
      // The e2e server runs in production mode with no real Paymob keys, so
      // the gateway uses the FAKE provider — explicitly allowed here only.
      // ADR-033: the e2e server runs in production mode with fake providers
      // and no real S3/AI credentials (no MinIO and no AI key in this VM or
      // in CI). E2E_FAKE_PROVIDERS lets the production env guard skip only
      // the "no real provider configured" checks, and aiDeps() use the
      // deterministic fake LLM + fake storage. Test-only secrets below
      // (>=32 chars, never "change-me"); the sandbox DB and its data are
      // local throwaway fixtures, never production data.
      E2E_FAKE_PROVIDERS: "true",
      SESSION_SECRET: "e2e-test-session-secret-0123456789abcdef",
      PHONE_HASH_PEPPER: "e2e-test-phone-hash-pepper-0123456789ab",
      PAYMOB_ALLOW_FAKE: "true",
    },
  },
});
