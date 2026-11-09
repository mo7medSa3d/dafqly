import { defineConfig } from "@playwright/test";

// E2E (BUILD_PLAN §9): Arabic RTL, mobile viewport. The root `pnpm test:e2e`
// script runs db:migrate + db:seed before this, so the seeded demo user
// exists. The web server is built and started by Playwright itself.
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://localhost:3000",
    viewport: { width: 390, height: 844 }, // mobile-first (BRAND §8)
    locale: "ar-EG",
  },
  webServer: {
    command: "pnpm build && pnpm start",
    url: "http://localhost:3000/healthz",
    timeout: 300_000,
    reuseExistingServer: false,
    env: {
      NODE_ENV: "production",
      WHATSAPP_APP_SECRET: "e2e-app-secret-for-tests-only-0123456789",
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: "e2e-verify-token",
      PAYMOB_HMAC_SECRET: "e2e-paymob-hmac-secret-for-tests-only",
      // The e2e server runs in production mode with no real Paymob keys, so
      // the gateway uses the FAKE provider — explicitly allowed here only.
      PAYMOB_ALLOW_FAKE: "true",
    },
  },
});
