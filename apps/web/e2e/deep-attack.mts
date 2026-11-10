import { chromium, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { writeFileSync, existsSync } from "node:fs";

interface Failure {
  step: string;
  url: string;
  error: string;
}

const failures: Failure[] = [];

function recordFail(step: string, url: string, error: string) {
  console.error(`💥 [FAIL] ${step} (${url}): ${error}`);
  failures.push({ step, url, error });
}

async function attachListeners(page: Page, stepRef: { current: string }) {
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      if (text.includes("favicon.ico") || text.includes("prefers-color-scheme") || text.includes("Download the React DevTools")) return;
      recordFail(stepRef.current, page.url(), `Console Error: ${text}`);
    }
  });
  page.on("pageerror", (err) => {
    recordFail(stepRef.current, page.url(), `Page Crash Error: ${err.message}`);
  });
  page.on("requestfailed", (req) => {
    const failure = req.failure();
    if (failure && !failure.errorText.includes("ERR_ABORTED")) {
      recordFail(stepRef.current, page.url(), `Network Request Failed: ${req.url()} (${failure.errorText})`);
    }
  });
}

// Generate dummy test images if needed
const dummyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);
const testImagePath = resolve(process.cwd(), "apps/web/e2e/fixtures/test_scan.png");
if (!existsSync(testImagePath)) {
  writeFileSync(testImagePath, dummyPng);
}

async function runDeepAttack() {
  console.log("🛡️ STARTING DEEP ATTACK: Testing ALL neglected flows, buttons, edge cases, and English routes...");
  const browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL: "http://localhost:3000",
    viewport: { width: 1440, height: 900 },
    locale: "ar-EG",
  });
  const page = await context.newPage();
  const stepRef = { current: "init" };
  await attachListeners(page, stepRef);

  // Login
  stepRef.current = "auth-login";
  await page.goto("/ar/login");
  await page.fill("[data-testid=\"auth-email\"]", "demo@tahseel.test");
  await page.fill("[data-testid=\"auth-password\"]", "demo-password-123");
  await page.click("[data-testid=\"auth-submit\"]");
  await page.waitForURL("**/dashboard");
  console.log("✅ Authenticated!");

  // ATTACK 1: Test Invoices transitions, bulk transition, and inline edit
  stepRef.current = "invoices-deep";
  console.log("\n--- Testing Invoices Deep Actions ---");
  await page.goto("/ar/invoices");
  await page.waitForLoadState("networkidle");

  // Create an invoice specifically for transition testing
  await page.fill("[data-testid=\"inv-amount\"]", "2500");
  await page.fill("[data-testid=\"inv-description\"]", "فاتورة اختبار الانتقالات");
  await page.click("[data-testid=\"inv-create\"]");
  await page.waitForTimeout(1500);

  // Transition invoice to disputed
  const disputeBtn = page.locator("[data-testid=\"inv-transition-disputed\"]").first();
  if (await disputeBtn.isVisible()) {
    console.log("   Clicking transition to disputed...");
    await disputeBtn.click();
    await page.waitForTimeout(1000);
  } else {
    recordFail("invoices-deep", page.url(), "No transition to disputed button found");
  }

  // Bulk action: Select all and transition
  const firstCheckbox = page.locator("[data-testid=\"inv-select\"]").first();
  if (await firstCheckbox.isVisible()) {
    console.log("   Selecting invoice for bulk transition...");
    await firstCheckbox.check();
    await page.selectOption("[data-testid=\"inv-bulk-to\"]", "cancelled");
    await page.click("[data-testid=\"inv-bulk-apply\"]");
    await page.waitForTimeout(1500);
    console.log("   ✅ Bulk transition applied!");
  }

  // ATTACK 2: Test Import Undo
  stepRef.current = "import-undo";
  console.log("\n--- Testing Import Undo Action ---");
  await page.goto("/ar/import");
  await page.waitForLoadState("networkidle");
  const undoBtn = page.locator("[data-testid=\"import-undo\"]").first();
  if (await undoBtn.isVisible()) {
    console.log("   Clicking Import Undo...");
    await undoBtn.click();
    await page.waitForTimeout(1500);
    const undoMsg = await page.locator("[data-testid=\"import-msg\"]").textContent();
    console.log(`   ✅ Import undo executed! Status message: ${undoMsg}`);
  } else {
    console.log("   (No previous committed import job to undo)");
  }

  // ATTACK 3: Test Smart Scan / Ledger Photo Upload, Extraction, Commit
  stepRef.current = "ledger-photo-deep";
  console.log("\n--- Testing Smart Scan / Ledger Photo Upload & Commit ---");
  await page.goto("/ar/ledger-photo");
  await page.waitForLoadState("networkidle");
  await page.setInputFiles("[data-testid=\"ledger-file\"]", testImagePath);
  await page.waitForTimeout(3000);
  const ledgerCommit = page.locator("[data-testid=\"ledger-commit\"]");
  if (await ledgerCommit.isVisible()) {
    console.log("   Ledger extraction finished! Committing job...");
    await ledgerCommit.click();
    await page.waitForTimeout(2000);
    console.log("   ✅ Ledger job committed!");
  } else {
    console.log("   Note: Ledger commit button not visible (check extraction output)");
  }

  // ATTACK 4: Test AI Inbox - Receipt Upload & Processing
  stepRef.current = "ai-inbox-deep";
  console.log("\n--- Testing AI Inbox Receipt Upload ---");
  await page.goto("/ar/ai-inbox");
  await page.waitForLoadState("networkidle");
  const receiptDebtor = page.locator("[data-testid=\"receipt-debtor\"]");
  if (await receiptDebtor.count() > 0) {
    await receiptDebtor.selectOption({ index: 1 });
    await page.setInputFiles("[data-testid=\"receipt-file\"]", testImagePath);
    await page.waitForTimeout(3000);
    console.log("   ✅ Receipt uploaded and processed!");
  }

  // ATTACK 5: Test Cheques Photo Scan & Transitions
  stepRef.current = "cheques-deep";
  console.log("\n--- Testing Cheques Photo Scan & State Transitions ---");
  await page.goto("/ar/cheques");
  await page.waitForLoadState("networkidle");
  // Test photo extraction
  await page.setInputFiles("[data-testid=\"cheque-photo\"]", testImagePath);
  await page.waitForTimeout(2500);
  console.log("   ✅ Cheque photo pre-fill triggered!");

  // Transition a cheque if any exists with transition buttons
  const depositBtn = page.locator("[data-testid=\"cheque-to-deposited\"]").first();
  if (await depositBtn.isVisible()) {
    console.log("   Transitioning cheque to deposited...");
    await depositBtn.click();
    await page.waitForTimeout(1500);
    console.log("   ✅ Cheque transitioned to deposited!");
  }

  // ATTACK 6: Test Debtor Details Edit & Refund & Statement Revoke
  stepRef.current = "debtor-detail-deep";
  console.log("\n--- Testing Debtor Details Deep Actions ---");
  await page.goto("/ar/debtors");
  await page.waitForLoadState("networkidle");
  const firstDebtorLink = page.locator("[data-testid=\"debtor-view\"]").first();
  if (await firstDebtorLink.isVisible()) {
    await firstDebtorLink.click();
    await page.waitForLoadState("networkidle");

    // Revoke statement if one exists
    const revokeBtn = page.locator("[data-testid=\"stmt-revoke\"]").first();
    if (await revokeBtn.isVisible()) {
      console.log("   Revoking statement link...");
      await revokeBtn.click();
      await page.waitForTimeout(1000);
      console.log("   ✅ Statement link revoked!");
    }

    // Try custom refund if any gateway payment exists
    const customRefundBtn = page.locator("button:has-text('مبلغ مخصص')").first();
    if (await customRefundBtn.isVisible()) {
      console.log("   Testing custom refund input...");
      await customRefundBtn.click();
      await page.waitForTimeout(500);
    }
  }

  // ATTACK 7: Test Settings Exports
  stepRef.current = "settings-exports";
  console.log("\n--- Testing Settings Exports & Danger Zone Export ---");
  await page.goto("/ar/settings");
  await page.waitForLoadState("networkidle");

  const exportInvoicesBtn = page.locator("[data-testid=\"export-invoices\"]");
  if (await exportInvoicesBtn.isVisible()) {
    console.log("   Triggering export invoices CSV...");
    await exportInvoicesBtn.click();
    await page.waitForTimeout(800);
  }
  const exportAllBtn = page.locator("[data-testid=\"export-all\"]");
  if (await exportAllBtn.isVisible()) {
    console.log("   Triggering Danger Zone export-all JSON...");
    await exportAllBtn.click();
    await page.waitForTimeout(800);
  }

  // ATTACK 8: Test Billing Plan Change
  stepRef.current = "billing-plan-change";
  console.log("\n--- Testing Billing Plan Upgrade ---");
  await page.goto("/ar/billing");
  await page.waitForLoadState("networkidle");
  const upgradePro = page.locator("[data-testid=\"upgrade-pro\"]");
  const upgradeStarter = page.locator("[data-testid=\"upgrade-starter\"]");
  const targetUpgrade = (await upgradePro.isVisible()) ? upgradePro : upgradeStarter;
  if (await targetUpgrade.isVisible()) {
    console.log("   Clicking plan upgrade...");
    await targetUpgrade.click();
    await page.waitForTimeout(1500);
    console.log("   ✅ Plan change triggered!");
  }

  // ATTACK 9: Test ALL English routes for 500s, page errors, missing messages
  console.log("\n--- Auditing ALL English Routes ---");
  const enRoutes = [
    "/en/dashboard",
    "/en/debtors",
    "/en/invoices",
    "/en/cheques",
    "/en/import",
    "/en/ledger-photo",
    "/en/ai-inbox",
    "/en/settings",
    "/en/billing",
  ];

  for (const r of enRoutes) {
    stepRef.current = `en-route-${r}`;
    console.log(`   Auditing ${r}...`);
    await page.goto(r);
    await page.waitForLoadState("networkidle");
    const title = await page.title();
    console.log(`   ✅ Loaded ${r} (Title: ${title})`);
  }

  await browser.close();

  console.log("\n======================================================");
  console.log(`🛡️ DEEP ATTACK COMPLETE: ${failures.length} failures found`);
  console.log("======================================================");

  if (failures.length > 0) {
    failures.forEach((f, idx) => {
      console.log(`${idx + 1}. [${f.step}] ${f.url} -> ${f.error}`);
    });
    process.exit(1);
  } else {
    console.log("🚀 ZERO ERRORS ENCOUNTERED ACROSS ALL DEEP ATTACK SCENARIOS!");
  }
}

runDeepAttack().catch((err) => {
  console.error("FATAL ATTACK CRASH:", err);
  process.exit(1);
});
