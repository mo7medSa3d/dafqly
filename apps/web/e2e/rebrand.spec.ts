import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

const shotsDir = "e2e/screenshots";

// Deterministic brand-evidence screenshots: no reveal animation mid-capture.
test.use({ reducedMotion: "reduce" });
mkdirSync(shotsDir, { recursive: true });

test("DAFQLY landing renders for logged-out visitors with CTAs", async ({ page }) => {
  await page.goto("/ar");
  await expect(page.getByTestId("landing-cta-signup")).toBeVisible();
  await expect(page.getByTestId("landing-cta-login")).toBeVisible();
  await page.screenshot({ path: `${shotsDir}/dafqly-landing-light.png` });
  await page.getByTestId("landing-cta-login").click();
  await expect(page).toHaveURL(/\/ar\/login/);
});

test("DAFQLY landing + login + dashboard screenshots (dark/mobile)", async ({ page, browser }) => {
  await page.goto("/en");
  await expect(page.getByTestId("landing-cta-signup")).toBeVisible();
  await page.screenshot({ path: `${shotsDir}/dafqly-landing-en-light.png` });

  const dark = await browser.newContext({ colorScheme: "dark", viewport: { width: 390, height: 844 }, locale: "ar-EG", reducedMotion: "reduce" });
  const dp = await dark.newPage();
  await dp.goto("/ar");
  await dp.screenshot({ path: `${shotsDir}/dafqly-landing-dark.png` });
  await dp.goto("/ar/login");
  await dp.screenshot({ path: `${shotsDir}/dafqly-login-dark.png` });
  await dp.getByTestId("auth-email").fill("demo@tahseel.test");
  await dp.getByTestId("auth-password").fill("demo-password-123");
  await dp.getByTestId("auth-submit").click();
  await expect(dp).toHaveURL(/\/ar\/dashboard/);
  await dp.screenshot({ path: `${shotsDir}/dafqly-dashboard-dark.png` });
  await dark.close();

  await page.goto("/ar/login");
  await page.screenshot({ path: `${shotsDir}/dafqly-login-light.png` });
  await page.getByTestId("auth-email").fill("demo@tahseel.test");
  await page.getByTestId("auth-password").fill("demo-password-123");
  await page.getByTestId("auth-submit").click();
  await expect(page).toHaveURL(/\/ar\/dashboard/);
  await page.screenshot({ path: `${shotsDir}/dafqly-dashboard-light.png` });
});
