import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { resolve } from "node:path";

const localShotsDir = resolve(process.cwd(), "apps/web/e2e/screenshots/fixes");
const artifactShotsDir = "/home/mo7amed_saad/.gemini/antigravity/brain/63a56c42-1795-4033-b6d7-87733e39731b/fixes";

if (!existsSync(localShotsDir)) mkdirSync(localShotsDir, { recursive: true });
if (!existsSync(artifactShotsDir)) mkdirSync(artifactShotsDir, { recursive: true });

async function run() {
  const browser = await chromium.launch({ headless: true });

  // 1. Desktop Context
  const desktopContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "ar-EG",
  });
  const desktopPage = await desktopContext.newPage();

  // Landing page full-width
  await desktopPage.goto("http://localhost:3000/ar", { waitUntil: "networkidle" });
  await desktopPage.waitForTimeout(500);
  const landingPath = `${localShotsDir}/final_landing_desktop.png`;
  await desktopPage.screenshot({ path: landingPath, fullPage: false });
  copyFileSync(landingPath, `${artifactShotsDir}/final_landing_desktop.png`);

  // Login
  await desktopPage.goto("http://localhost:3000/ar/login", { waitUntil: "networkidle" });
  await desktopPage.getByTestId("auth-email").fill("demo@tahseel.test");
  await desktopPage.getByTestId("auth-password").fill("demo-password-123");
  await desktopPage.getByTestId("auth-submit").click();
  await desktopPage.waitForURL(/\/ar\/dashboard/);

  // Overview with Blue Banner & Balanced Layout
  await desktopPage.waitForSelector('[data-testid^="upgrade-"]', { timeout: 10000 }).catch(() => {});
  await desktopPage.waitForTimeout(600);
  const dashPath = `${localShotsDir}/final_overview_desktop.png`;
  await desktopPage.screenshot({ path: dashPath, fullPage: true });
  copyFileSync(dashPath, `${artifactShotsDir}/final_overview_desktop.png`);

  // Settings page
  await desktopPage.goto("http://localhost:3000/ar/settings", { waitUntil: "networkidle" });
  await desktopPage.waitForTimeout(500);
  const settingsPath = `${localShotsDir}/final_settings_desktop.png`;
  await desktopPage.screenshot({ path: settingsPath, fullPage: true });
  copyFileSync(settingsPath, `${artifactShotsDir}/final_settings_desktop.png`);

  // Billing page
  await desktopPage.goto("http://localhost:3000/ar/billing", { waitUntil: "networkidle" });
  await desktopPage.waitForTimeout(500);
  const billingPath = `${localShotsDir}/final_billing_desktop.png`;
  await desktopPage.screenshot({ path: billingPath, fullPage: true });
  copyFileSync(billingPath, `${artifactShotsDir}/final_billing_desktop.png`);

  // Invoices page
  await desktopPage.goto("http://localhost:3000/ar/invoices", { waitUntil: "networkidle" });
  await desktopPage.waitForTimeout(500);
  const invPath = `${localShotsDir}/final_invoices_desktop.png`;
  await desktopPage.screenshot({ path: invPath, fullPage: true });
  copyFileSync(invPath, `${artifactShotsDir}/final_invoices_desktop.png`);

  await desktopContext.close();

  // 2. Mobile Context (iPhone 14 / modern Android: 390x844)
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "ar-EG",
    isMobile: true,
  });
  const mobilePage = await mobileContext.newPage();

  // Login
  await mobilePage.goto("http://localhost:3000/ar/login", { waitUntil: "networkidle" });
  await mobilePage.getByTestId("auth-email").fill("demo@tahseel.test");
  await mobilePage.getByTestId("auth-password").fill("demo-password-123");
  await mobilePage.getByTestId("auth-submit").click();
  await mobilePage.waitForURL(/\/ar\/dashboard/);

  // Mobile Overview
  await mobilePage.waitForTimeout(500);
  const mobDashPath = `${localShotsDir}/final_overview_mobile.png`;
  await mobilePage.screenshot({ path: mobDashPath, fullPage: false });
  copyFileSync(mobDashPath, `${artifactShotsDir}/final_overview_mobile.png`);

  // Mobile Settings
  await mobilePage.goto("http://localhost:3000/ar/settings", { waitUntil: "networkidle" });
  await mobilePage.waitForTimeout(500);
  const mobSettingsPath = `${localShotsDir}/final_settings_mobile.png`;
  await mobilePage.screenshot({ path: mobSettingsPath, fullPage: false });
  copyFileSync(mobSettingsPath, `${artifactShotsDir}/final_settings_mobile.png`);

  await mobileContext.close();
  await browser.close();

  console.log("All screenshots captured and copied to artifact dir successfully!");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
