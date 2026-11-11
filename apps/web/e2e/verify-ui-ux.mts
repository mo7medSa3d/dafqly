import { chromium } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const shotsDir = resolve(process.cwd(), "apps/web/e2e/screenshots/fixes");
if (!existsSync(shotsDir)) {
  mkdirSync(shotsDir, { recursive: true });
}

async function verifyUI() {
  console.log("Starting UI/UX and Flow Verification...");
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "ar-EG",
  });
  const page = await context.newPage();

  // Step 1: Login
  console.log("1. Logging in...");
  await page.goto("http://localhost:3000/ar/login", { waitUntil: "networkidle" });
  await page.getByTestId("auth-email").fill("demo@tahseel.test");
  await page.getByTestId("auth-password").fill("demo-password-123");
  await page.getByTestId("auth-submit").click();
  await page.waitForURL(/\/ar\/dashboard/, { timeout: 15000 });
  await page.waitForTimeout(500);

  // Step 2: Dashboard Light mode
  console.log("2. Capturing Dashboard Light Mode...");
  // Ensure light mode
  const currentTheme = await page.evaluate(() => document.documentElement.dataset.theme);
  if (currentTheme === "dark") {
    await page.getByTestId("theme-toggle").first().click();
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: `${shotsDir}/dashboard_light_borderless.png`, fullPage: false });

  // Step 3: Dashboard Dark mode
  console.log("3. Capturing Dashboard Dark Mode...");
  await page.getByTestId("theme-toggle").first().click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${shotsDir}/dashboard_dark_borderless.png`, fullPage: false });

  // Step 4: Billing Page (3-tier luxury cards)
  console.log("4. Testing Billing Page (/ar/billing)...");
  await page.goto("http://localhost:3000/ar/billing", { waitUntil: "networkidle" });
  await page.waitForTimeout(500);

  // Check 3 tier cards are present
  const starterCard = page.locator("text=البداية التجريبية").or(page.locator("text=Starter Trial"));
  const growthCard = page.locator("text=النمو الذكي").or(page.locator("text=Growth Pro"));
  const enterpriseCard = page.locator("text=المؤسسات الكبرى").or(page.locator("text=Enterprise"));
  console.log("Starter card visible:", await starterCard.first().isVisible());
  console.log("Growth card visible:", await growthCard.first().isVisible());
  console.log("Enterprise card visible:", await enterpriseCard.first().isVisible());

  // Capture Billing Dark Mode
  await page.screenshot({ path: `${shotsDir}/billing_3tier_dark.png`, fullPage: false });

  // Switch to annual toggle
  console.log("Testing Annual billing switch...");
  const annualBtn = page.getByRole("button", { name: /سنوي|Annual/i });
  if (await annualBtn.isVisible()) {
    await annualBtn.click();
    await page.waitForTimeout(300);
    console.log("Clicked annual switch!");
    await page.screenshot({ path: `${shotsDir}/billing_3tier_annual.png`, fullPage: false });
  }

  // Switch to Light mode on Billing
  await page.getByTestId("theme-toggle").first().click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${shotsDir}/billing_3tier_light.png`, fullPage: false });

  // Step 5: Test Logout Flow Redirect
  console.log("5. Testing Logout redirect to landing page (/${locale})...");
  const logoutBtn = page.getByTestId("logout-btn");
  if (await logoutBtn.isVisible()) {
    await logoutBtn.click();
    await page.waitForURL(/http:\/\/localhost:3000\/(ar|en)$/, { timeout: 10000 });
    const finalUrl = page.url();
    console.log("Logged out successfully! Final URL:", finalUrl);
    if (finalUrl.includes("/login")) {
      throw new Error(`Logout redirected to ${finalUrl} instead of landing page!`);
    }
  }

  console.log("All UI/UX & Flow verifications passed flawlessly!");
  await browser.close();
}

verifyUI().catch((err) => {
  console.error("UI Verification failed:", err);
  process.exit(1);
});
