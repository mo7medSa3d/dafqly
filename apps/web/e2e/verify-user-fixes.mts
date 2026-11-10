import { chromium } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const shotsDir = resolve(process.cwd(), "apps/web/e2e/screenshots/fixes");
if (!existsSync(shotsDir)) {
  mkdirSync(shotsDir, { recursive: true });
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  
  // 1. Desktop 1920x1080 Full Screen test
  console.log("1. Testing Desktop 1920x1080 layout...");
  const wideContext = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    locale: "ar-EG",
  });
  const page = await wideContext.newPage();

  // Test Login page (No duplicate buttons)
  await page.goto("http://localhost:3000/ar/login", { waitUntil: "networkidle" });
  await page.getByTestId("auth-email").fill("demo@tahseel.test");
  await page.getByTestId("auth-password").fill("demo-password-123");
  await page.screenshot({ path: `${shotsDir}/desktop_login_clean_wide.png`, fullPage: true });

  // Login to Dashboard
  await page.getByTestId("auth-submit").click();
  await page.waitForURL(/\/ar\/dashboard/);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${shotsDir}/desktop_dashboard_full_wide.png`, fullPage: true });

  // Test Import page
  await page.goto("http://localhost:3000/ar/import", { waitUntil: "networkidle" });
  await page.screenshot({ path: `${shotsDir}/desktop_import_clean_wide.png`, fullPage: true });

  // Test Dark Mode on Dashboard
  await page.goto("http://localhost:3000/ar/dashboard", { waitUntil: "networkidle" });
  await page.getByTestId("theme-toggle").first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${shotsDir}/desktop_dashboard_dark_wide.png`, fullPage: true });

  // 2. Mobile 390x844 test
  console.log("2. Testing Mobile 390x844 layout...");
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "ar-EG",
  });
  const mobPage = await mobileContext.newPage();
  await mobPage.goto("http://localhost:3000/ar/login", { waitUntil: "networkidle" });
  await mobPage.getByTestId("auth-email").fill("demo@tahseel.test");
  await mobPage.getByTestId("auth-password").fill("demo-password-123");
  await mobPage.getByTestId("auth-submit").click();
  await mobPage.waitForURL(/\/ar\/dashboard/);
  await mobPage.waitForTimeout(500);

  const overflow = await mobPage.evaluate(() => {
    return {
      docWidth: document.documentElement.scrollWidth,
      winWidth: window.innerWidth,
      hasOverflow: document.documentElement.scrollWidth > window.innerWidth,
    };
  });
  console.log("Mobile overflow result:", overflow);
  await mobPage.screenshot({ path: `${shotsDir}/mobile_dashboard_clean.png`, fullPage: true });

  await browser.close();
  console.log("Screenshots updated successfully!");
}

run().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
