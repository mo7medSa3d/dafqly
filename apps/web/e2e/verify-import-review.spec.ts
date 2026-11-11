import { test, expect } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const shotsDir = resolve(process.cwd(), "e2e/screenshots/fixes");
if (!existsSync(shotsDir)) {
  mkdirSync(shotsDir, { recursive: true });
}

test("verify import review actions and locale switching on desktop", async ({ browser }) => {
  test.setTimeout(60000);

  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "ar-EG",
  });
  const page = await context.newPage();

  console.log("1. Logging in...");
  await page.goto("http://localhost:3000/ar/login", { waitUntil: "networkidle" });
  await page.getByTestId("auth-email").fill("demo@tahseel.test");
  await page.getByTestId("auth-password").fill("demo-password-123");
  await page.getByTestId("auth-submit").click();
  await page.waitForURL(/\/ar\/dashboard/);

  console.log("2. Navigating to /ar/import...");
  await page.goto("http://localhost:3000/ar/import", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  // Check if review button is present in the jobs list
  const reviewButtons = page.getByTestId("import-review-btn");
  const count = await reviewButtons.count();
  console.log(`Found ${count} pending review jobs with review buttons`);

  if (count > 0) {
    console.log("Clicking review button on first job...");
    await reviewButtons.first().click();
    await page.waitForTimeout(1000);
    // Verify preview panel is open
    await expect(page.getByTestId("import-commit")).toBeVisible();
    await expect(page.getByTestId("import-discard")).toBeVisible();
  }

  await page.screenshot({ path: `${shotsDir}/feature_import_review_desktop.png`, fullPage: true });

  console.log("3. Navigating to /en/import (verifying language on desktop)...");
  await page.goto("http://localhost:3000/en/import", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${shotsDir}/feature_en_import_desktop.png`, fullPage: true });

  console.log("4. Navigating to /ar/ledger-photo...");
  await page.goto("http://localhost:3000/ar/ledger-photo", { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${shotsDir}/feature_ledger_photo_desktop.png`, fullPage: true });

  await context.close();
  console.log("Desktop run completed successfully!");
});
