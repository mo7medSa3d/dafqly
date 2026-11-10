import { chromium } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const shotsDir = resolve(process.cwd(), "apps/web/e2e/screenshots/fixes");
if (!existsSync(shotsDir)) {
  mkdirSync(shotsDir, { recursive: true });
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    locale: "ar-EG",
  });
  const page = await context.newPage();

  await page.goto("http://localhost:3000/ar/login", { waitUntil: "networkidle" });
  await page.getByTestId("auth-email").fill("demo@tahseel.test");
  await page.getByTestId("auth-password").fill("demo-password-123");
  await page.getByTestId("auth-submit").click();
  await page.waitForURL(/\/ar\/dashboard/);

  const pages = ["dashboard", "debtors", "invoices", "import", "ledger-photo", "ai-inbox", "cheques"];
  for (const p of pages) {
    await page.goto(`http://localhost:3000/ar/${p}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${shotsDir}/page_${p}.png`, fullPage: true });
  }

  await browser.close();
  console.log("Captured all 7 pages successfully!");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
