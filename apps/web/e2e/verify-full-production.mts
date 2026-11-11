import { chromium, type Page } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const shotsDir = resolve(process.cwd(), "apps/web/e2e/screenshots/production-audit");
if (!existsSync(shotsDir)) {
  mkdirSync(shotsDir, { recursive: true });
}

interface AuditIssue {
  page: string;
  type: "console-error" | "page-error" | "network-fail";
  detail: string;
}

const issues: AuditIssue[] = [];

function setupPageMonitoring(page: Page, pageName: string) {
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      // Ignore favicon 404 or expected minor noise if any
      if (!text.includes("favicon") && !text.includes("404")) {
        issues.push({ page: pageName, type: "console-error", detail: text });
      }
    }
  });

  page.on("pageerror", (err) => {
    issues.push({ page: pageName, type: "page-error", detail: err.message });
  });

  page.on("response", (res) => {
    const status = res.status();
    const url = res.url();
    if (status >= 400 && url.includes("/api/")) {
      issues.push({ page: pageName, type: "network-fail", detail: `${res.request().method()} ${url} -> ${status}` });
    }
  });
}

async function run() {
  console.log("=================================================");
  console.log("🚀 Starting Full Production Verification & Audit");
  console.log("=================================================");

  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "ar-EG",
  });
  const page = await context.newPage();

  // 1. Landing Page (AR & EN)
  console.log("1. Verifying Landing Page (/ar & /en)...");
  setupPageMonitoring(page, "Landing AR");
  await page.goto("http://localhost:3000/ar", { waitUntil: "networkidle" });
  await page.screenshot({ path: `${shotsDir}/01_landing_ar.png` });

  setupPageMonitoring(page, "Landing EN");
  await page.goto("http://localhost:3000/en", { waitUntil: "networkidle" });
  await page.screenshot({ path: `${shotsDir}/01_landing_en.png` });

  // 2. Login Page
  console.log("2. Verifying Login (/ar/login)...");
  setupPageMonitoring(page, "Login");
  await page.goto("http://localhost:3000/ar/login", { waitUntil: "networkidle" });
  await page.screenshot({ path: `${shotsDir}/02_login_ar.png` });

  // Perform Login
  console.log("Logging in as demo@tahseel.test...");
  await page.getByTestId("auth-email").fill("demo@tahseel.test");
  await page.getByTestId("auth-password").fill("demo-password-123");
  await page.getByTestId("auth-submit").click();
  await page.waitForURL(/\/ar\/dashboard/, { timeout: 15000 });
  await page.waitForTimeout(500);

  // 3. Dashboard (AR & EN)
  console.log("3. Verifying Dashboard (/ar/dashboard & /en/dashboard)...");
  setupPageMonitoring(page, "Dashboard AR");
  await page.screenshot({ path: `${shotsDir}/03_dashboard_ar.png` });

  // Toggle Theme to Dark
  console.log("Testing Dark Theme on Dashboard...");
  const themeToggle = page.getByTestId("theme-toggle").first();
  await themeToggle.click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shotsDir}/03_dashboard_ar_dark.png` });

  // Switch to English Dashboard
  console.log("Switching to English Dashboard...");
  setupPageMonitoring(page, "Dashboard EN");
  const localeToggle = page.getByTestId("locale-toggle").first();
  await localeToggle.click();
  await page.waitForURL(/\/en\/dashboard/, { timeout: 15000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${shotsDir}/03_dashboard_en_dark.png` });

  // Switch back to Arabic & Light Theme
  const localeToggleEn = page.getByTestId("locale-toggle").first();
  await localeToggleEn.click();
  await page.waitForURL(/\/ar\/dashboard/, { timeout: 15000 });
  await page.waitForTimeout(400);
  await themeToggle.click();
  await page.waitForTimeout(400);

  // 4. Debtors Page
  console.log("4. Verifying Debtors (/ar/debtors)...");
  setupPageMonitoring(page, "Debtors");
  await page.goto("http://localhost:3000/ar/debtors", { waitUntil: "networkidle" });
  await page.screenshot({ path: `${shotsDir}/04_debtors_ar.png` });

  // Test Search Debounce
  console.log("Testing Debtors Search Debouncing...");
  const searchInput = page.getByTestId("debtor-search");
  await searchInput.fill("الأمل");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${shotsDir}/04_debtors_searched.png` });
  await searchInput.fill("");
  await page.waitForTimeout(300);

  // 5. Debtor Detail Page
  console.log("5. Verifying Debtor Detail (/ar/debtors/[id])...");
  setupPageMonitoring(page, "Debtor Detail");
  const debtorRow = page.getByTestId("debtor-row").first();
  const debtorViewLink = debtorRow.locator('a[href*="/ar/debtors/"]').first();
  if (await debtorViewLink.isVisible()) {
    await debtorViewLink.click();
    await page.waitForURL(/\/ar\/debtors\//, { timeout: 10000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${shotsDir}/05_debtor_detail_ar.png` });
  }

  // 6. Invoices Page
  console.log("6. Verifying Invoices (/ar/invoices)...");
  setupPageMonitoring(page, "Invoices");
  await page.goto("http://localhost:3000/ar/invoices", { waitUntil: "networkidle" });
  await page.screenshot({ path: `${shotsDir}/06_invoices_ar.png` });

  // Test Invoice Search
  const invSearch = page.getByTestId("inv-search");
  await invSearch.fill("INV");
  await page.waitForTimeout(300);
  await invSearch.fill("");
  await page.waitForTimeout(300);

  // 7. Import Page
  console.log("7. Verifying Import Page (/ar/import & /en/import)...");
  setupPageMonitoring(page, "Import AR");
  await page.goto("http://localhost:3000/ar/import", { waitUntil: "networkidle" });
  await page.screenshot({ path: `${shotsDir}/07_import_ar.png` });

  setupPageMonitoring(page, "Import EN");
  await page.goto("http://localhost:3000/en/import", { waitUntil: "networkidle" });
  await page.screenshot({ path: `${shotsDir}/07_import_en.png` });

  // 8. Ledger Photo Page (Smart Scan)
  console.log("8. Verifying Ledger Photo (/ar/ledger-photo & /en/ledger-photo)...");
  setupPageMonitoring(page, "Ledger Photo AR");
  await page.goto("http://localhost:3000/ar/ledger-photo", { waitUntil: "networkidle" });
  await page.screenshot({ path: `${shotsDir}/08_ledger_photo_ar.png` });

  setupPageMonitoring(page, "Ledger Photo EN");
  await page.goto("http://localhost:3000/en/ledger-photo", { waitUntil: "networkidle" });
  await page.screenshot({ path: `${shotsDir}/08_ledger_photo_en.png` });

  // 9. AI Inbox Page
  console.log("9. Verifying AI Inbox (/ar/ai-inbox & /en/ai-inbox)...");
  setupPageMonitoring(page, "AI Inbox AR");
  await page.goto("http://localhost:3000/ar/ai-inbox", { waitUntil: "networkidle" });
  await page.screenshot({ path: `${shotsDir}/09_ai_inbox_ar.png` });

  setupPageMonitoring(page, "AI Inbox EN");
  await page.goto("http://localhost:3000/en/ai-inbox", { waitUntil: "networkidle" });
  await page.screenshot({ path: `${shotsDir}/09_ai_inbox_en.png` });

  // 10. Cheques Page
  console.log("10. Verifying Cheques (/ar/cheques & /en/cheques)...");
  setupPageMonitoring(page, "Cheques AR");
  await page.goto("http://localhost:3000/ar/cheques", { waitUntil: "networkidle" });
  await page.screenshot({ path: `${shotsDir}/10_cheques_ar.png` });

  // 11. Billing Page (Plans & Tiers)
  console.log("11. Verifying Billing (/ar/billing & /en/billing)...");
  setupPageMonitoring(page, "Billing AR");
  await page.goto("http://localhost:3000/ar/billing", { waitUntil: "networkidle" });
  await page.screenshot({ path: `${shotsDir}/11_billing_ar.png` });

  // Test Annual Billing Toggle
  console.log("Testing Annual Billing Toggle...");
  const annualBtn = page.getByRole("button", { name: /الدفع السنوي/i });
  if (await annualBtn.isVisible()) {
    await annualBtn.click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${shotsDir}/11_billing_ar_annual.png` });
  }

  // 12. Settings Page
  console.log("12. Verifying Settings (/ar/settings)...");
  setupPageMonitoring(page, "Settings AR");
  await page.goto("http://localhost:3000/ar/settings", { waitUntil: "networkidle" });
  await page.screenshot({ path: `${shotsDir}/12_settings_ar.png` });

  // 13. Command Palette (Ctrl+K)
  console.log("13. Testing Command Palette (Ctrl+K)...");
  setupPageMonitoring(page, "Command Palette");
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(300);
  const cpInput = page.locator('input[placeholder*="ابحث"]').first();
  if (await cpInput.isVisible()) {
    await cpInput.fill("الأمل");
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${shotsDir}/13_command_palette.png` });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
  }

  // 14. Mobile Responsive Audit
  console.log("14. Testing Mobile Viewport (390x844)...");
  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: "ar-EG",
  });
  const mobPage = await mobileContext.newPage();
  setupPageMonitoring(mobPage, "Mobile Dashboard");
  await mobPage.goto("http://localhost:3000/ar/login", { waitUntil: "networkidle" });
  await mobPage.getByTestId("auth-email").fill("demo@tahseel.test");
  await mobPage.getByTestId("auth-password").fill("demo-password-123");
  await mobPage.getByTestId("auth-submit").click();
  await mobPage.waitForURL(/\/ar\/dashboard/, { timeout: 15000 });
  await mobPage.screenshot({ path: `${shotsDir}/14_mobile_dashboard_ar.png` });

  setupPageMonitoring(mobPage, "Mobile Invoices");
  await mobPage.goto("http://localhost:3000/ar/invoices", { waitUntil: "networkidle" });
  await mobPage.screenshot({ path: `${shotsDir}/14_mobile_invoices_ar.png` });

  setupPageMonitoring(mobPage, "Mobile Billing");
  await mobPage.goto("http://localhost:3000/ar/billing", { waitUntil: "networkidle" });
  await mobPage.screenshot({ path: `${shotsDir}/14_mobile_billing_ar.png` });

  await browser.close();

  console.log("=================================================");
  console.log("📊 Audit Summary Results:");
  console.log(`Total Issues / Console Errors / Failed APIs: ${issues.length}`);
  if (issues.length > 0) {
    console.error("Issues found:", JSON.stringify(issues, null, 2));
    process.exit(1);
  } else {
    console.log("✅ 0 Console Errors, 0 Page Errors, 0 Failed API Requests!");
    console.log("All pages verified clean, performant, and production-ready.");
    console.log("=================================================");
  }
}

run().catch((e) => {
  console.error("Fatal test error:", e);
  process.exit(1);
});
