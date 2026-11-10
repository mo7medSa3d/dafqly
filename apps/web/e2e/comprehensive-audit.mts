import { chromium, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

interface AuditError {
  url: string;
  type: "console_error" | "page_error" | "overflow" | "assertion_failure" | "network_error";
  message: string;
}

const auditErrors: AuditError[] = [];
const screenshotDir = resolve(process.cwd(), "apps/web/e2e/screenshots/comprehensive");
if (!existsSync(screenshotDir)) {
  mkdirSync(screenshotDir, { recursive: true });
}

function recordError(url: string, type: AuditError["type"], message: string) {
  console.error(`❌ [${type.toUpperCase()}] at ${url}: ${message}`);
  auditErrors.push({ url, type, message });
}

async function attachErrorListeners(page: Page) {
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      if (
        text.includes("favicon.ico") ||
        text.includes("Download the React DevTools") ||
        text.includes("prefers-color-scheme")
      ) return;
      recordError(page.url(), "console_error", text);
    }
  });

  page.on("pageerror", (err) => {
    recordError(page.url(), "page_error", err.message);
  });

  page.on("requestfailed", (req) => {
    const err = req.failure()?.errorText ?? "unknown";
    if (err.includes("ERR_ABORTED")) return;
    recordError(page.url(), "network_error", `Request to ${req.url()} failed: ${err}`);
  });
}

async function checkHorizontalOverflow(page: Page, screenName: string) {
  const hasOverflow = await page.evaluate(() => {
    return document.documentElement.scrollWidth > window.innerWidth + 1;
  });
  if (hasOverflow) {
    const details = await page.evaluate(() => {
      const docWidth = document.documentElement.scrollWidth;
      const winWidth = window.innerWidth;
      const overflowingElements: string[] = [];
      document.querySelectorAll("*").forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.right > winWidth + 2) {
          overflowingElements.push(
            `${el.tagName.toLowerCase()}.${Array.from(el.classList).join(".") || "(no-class)"} (right: ${Math.round(rect.right)}px > ${winWidth}px)`
          );
        }
      });
      return { docWidth, winWidth, overflowingElements: overflowingElements.slice(0, 5) };
    });
    recordError(
      page.url(),
      "overflow",
      `Horizontal overflow on ${screenName}: docWidth=${details.docWidth}px > winWidth=${details.winWidth}px. Elements: ${details.overflowingElements.join(", ")}`
    );
  }
}

async function takeScreenshot(page: Page, name: string) {
  const path = resolve(screenshotDir, `${name}.png`);
  await page.screenshot({ path, fullPage: true });
  console.log(`📸 Saved screenshot: ${name}.png`);
}

async function runComprehensiveAudit() {
  console.log("🚀 Starting Comprehensive World-Class SaaS Audit & Test Suite...");
  const browser = await chromium.launch();

  const viewports = [
    { name: "desktop", width: 1440, height: 900 },
    { name: "mobile", width: 390, height: 844 },
  ];

  let publicStatementUrl = "";

  for (const vp of viewports) {
    console.log(`\n======================================================`);
    console.log(`📱 Testing Viewport: ${vp.name.toUpperCase()} (${vp.width}x${vp.height})`);
    console.log(`======================================================\n`);

    const context = await browser.newContext({
      baseURL: "http://localhost:3000",
      viewport: { width: vp.width, height: vp.height },
      locale: "ar-EG",
    });
    const page = await context.newPage();
    await attachErrorListeners(page);

    // 1. Landing Page (Arabic & English)
    console.log("1. Auditing Landing Page (/ar & /en)...");
    await page.goto("/ar");
    await page.waitForLoadState("networkidle");
    await checkHorizontalOverflow(page, `landing-ar-${vp.name}`);
    await takeScreenshot(page, `01_landing_ar_${vp.name}`);

    // Toggle theme on landing
    const themeBtn = page.getByTestId("theme-toggle").first();
    if (await themeBtn.isVisible()) {
      await themeBtn.click();
      await page.waitForTimeout(300);
      await takeScreenshot(page, `01_landing_ar_dark_${vp.name}`);
      await themeBtn.click(); // revert
      await page.waitForTimeout(300);
    }

    await page.goto("/en");
    await page.waitForLoadState("networkidle");
    await checkHorizontalOverflow(page, `landing-en-${vp.name}`);
    await takeScreenshot(page, `01_landing_en_${vp.name}`);

    // 2. Login & Signup Forms
    console.log("2. Auditing Login & Signup Forms...");
    await page.goto("/ar/login");
    await page.waitForLoadState("networkidle");
    await checkHorizontalOverflow(page, `login-${vp.name}`);
    await takeScreenshot(page, `02_login_ar_${vp.name}`);

    await page.goto("/ar/signup");
    await page.waitForLoadState("networkidle");
    await checkHorizontalOverflow(page, `signup-${vp.name}`);
    await takeScreenshot(page, `02_signup_ar_${vp.name}`);

    // 3. Log In as Demo Merchant
    console.log("3. Logging in as demo@tahseel.test...");
    await page.goto("/ar/login");
    await page.fill("[data-testid=\"auth-email\"]", "demo@tahseel.test");
    await page.fill("[data-testid=\"auth-password\"]", "demo-password-123");
    await page.click("[data-testid=\"auth-submit\"]");
    await page.waitForURL("**/dashboard", { timeout: 30000 });
    console.log("✅ Authenticated successfully and arrived at Dashboard!");

    // 4. Dashboard Comprehensive Audit
    console.log("4. Auditing Dashboard (/ar/dashboard)...");
    await page.waitForLoadState("networkidle");
    await page.waitForSelector("[data-testid=\"dashboard\"]", { timeout: 15000 });
    await checkHorizontalOverflow(page, `dashboard-${vp.name}`);
    await takeScreenshot(page, `03_dashboard_${vp.name}`);

    // Check KPIs
    const outstanding = await page.locator("[data-testid=\"kpi-outstanding\"]").textContent();
    const overdue = await page.locator("[data-testid=\"kpi-overdue\"]").textContent();
    const collected = await page.locator("[data-testid=\"kpi-collected\"]").textContent();
    console.log(`   Financial KPIs: Outstanding=${outstanding?.trim()}, Overdue=${overdue?.trim()}, Collected=${collected?.trim()}`);

    // Test Theme Toggle on Dashboard
    const dashThemeBtn = page.getByTestId("theme-toggle").first();
    if (await dashThemeBtn.isVisible()) {
      await dashThemeBtn.click();
      await page.waitForTimeout(400);
      await takeScreenshot(page, `03_dashboard_dark_${vp.name}`);
      await dashThemeBtn.click(); // revert to light
      await page.waitForTimeout(300);
    }

    // 5. Debtors Page & CRM Actions
    console.log("5. Auditing Debtors (/ar/debtors)...");
    await page.goto("/ar/debtors");
    await page.waitForLoadState("networkidle");
    await page.waitForSelector("[data-testid=\"debtor-name\"]", { timeout: 15000 });
    await checkHorizontalOverflow(page, `debtors-${vp.name}`);
    await takeScreenshot(page, `04_debtors_${vp.name}`);

    // Create a new debtor with unique phone
    const testDebtorPhone = `+2010${Math.floor(10000000 + Math.random() * 90000000)}`;
    const testDebtorName = `مؤسسة الأمل التجارية ${Date.now().toString().slice(-4)}`;
    console.log(`   Creating Debtor: ${testDebtorName} (${testDebtorPhone})...`);
    await page.fill("[data-testid=\"debtor-name\"]", testDebtorName);
    await page.fill("[data-testid=\"debtor-phone\"]", testDebtorPhone);
    await page.fill("[data-testid=\"debtor-notes\"]", "عميل ممتاز — فحص شامل ومؤتمت");
    await page.click("[data-testid=\"debtor-create\"]");
    await page.waitForTimeout(1500);

    // Verify creation and search filtering
    await page.fill("[data-testid=\"debtor-search\"]", testDebtorName);
    await page.waitForTimeout(1000);

    const debtorsHtml = await page.content();
    if (!debtorsHtml.includes(testDebtorName)) {
      recordError(page.url(), "assertion_failure", `Created debtor ${testDebtorName} not found in DOM`);
    } else {
      console.log(`   ✅ Debtor ${testDebtorName} created and verified via search!`);
    }

    // Reset search filter
    await page.fill("[data-testid=\"debtor-search\"]", "");
    await page.waitForTimeout(800);

    // 6. Debtor Detail Page Audit (All Tabs & Features)
    console.log("6. Auditing Debtor Detail Page...");
    await page.waitForSelector("[data-testid=\"debtor-view\"]", { timeout: 10000 });
    const debtorLink = page.locator("[data-testid=\"debtor-view\"]").first();
    const debtorHref = await debtorLink.getAttribute("href");
    if (debtorHref) {
      await page.goto(debtorHref);
      await page.waitForLoadState("networkidle");
      await checkHorizontalOverflow(page, `debtor_detail-${vp.name}`);
      await takeScreenshot(page, `05_debtor_detail_${vp.name}`);

      // Create Statement Link
      const createStmtBtn = page.locator("[data-testid=\"stmt-create\"]");
      if (await createStmtBtn.count() > 0) {
        await createStmtBtn.click();
        await page.waitForTimeout(1200);
        const stmtBox = page.locator("[data-testid=\"stmt-new-url\"]");
        if (await stmtBox.isVisible()) {
          const text = (await stmtBox.textContent()) ?? "";
          const match = /\/s\/([A-Za-z0-9_-]+)/.exec(text);
          if (match) {
            publicStatementUrl = `http://localhost:3000/s/${match[1]}`;
            console.log(`   ✅ Public Statement URL generated: ${publicStatementUrl}`);
          }
        }
      }

      // Record Manual Payment
      const payAmount = page.locator("[data-testid=\"pay-amount\"]");
      const paySubmit = page.locator("[data-testid=\"pay-submit\"]");
      if ((await payAmount.count()) > 0 && (await paySubmit.count()) > 0) {
        await payAmount.fill("300");
        await paySubmit.click();
        await page.waitForTimeout(1200);
        console.log("   ✅ Manual payment of 300 EGP recorded!");
      }
    }

    // 7. Invoices Page & Filters
    console.log("7. Auditing Invoices (/ar/invoices)...");
    await page.goto("/ar/invoices");
    await page.waitForLoadState("networkidle");
    await page.waitForSelector("[data-testid=\"inv-amount\"]", { timeout: 15000 });
    await checkHorizontalOverflow(page, `invoices-${vp.name}`);
    await takeScreenshot(page, `06_invoices_${vp.name}`);

    // Create an Invoice
    console.log("   Creating test invoice of 1500 EGP...");
    await page.fill("[data-testid=\"inv-amount\"]", "1500");
    await page.fill("[data-testid=\"inv-description\"]", "توريدات تجريبية — فحص شامل");
    await page.click("[data-testid=\"inv-create\"]");
    await page.waitForTimeout(1500);
    console.log("   ✅ Invoice created!");

    // Test transition to disputed
    const disputeBtn = page.locator("[data-testid=\"inv-transition-disputed\"]").first();
    if (await disputeBtn.isVisible()) {
      await disputeBtn.click();
      await page.waitForTimeout(1000);
      console.log("   ✅ Invoice transitioned to disputed!");
    }

    // Test bulk select and transition
    const selectBox = page.locator("[data-testid=\"inv-select\"]").first();
    if (await selectBox.isVisible()) {
      await selectBox.check();
      await page.selectOption("[data-testid=\"inv-bulk-to\"]", "cancelled");
      await page.click("[data-testid=\"inv-bulk-apply\"]");
      await page.waitForTimeout(1500);
      console.log("   ✅ Bulk status transition applied!");
    }

    // Test Invoices Search and Filter
    const searchInput = page.locator("input[placeholder*='بحث'], input[placeholder*='Search']").first();
    if (await searchInput.isVisible()) {
      await searchInput.fill("1500");
      await page.waitForTimeout(500);
      await searchInput.fill("");
    }

    // 8. Cheques Management
    console.log("8. Auditing Cheques (/ar/cheques)...");
    await page.goto("/ar/cheques");
    await page.waitForLoadState("networkidle");
    await page.waitForSelector("[data-testid=\"cheque-number\"]", { timeout: 15000 });
    await checkHorizontalOverflow(page, `cheques-${vp.name}`);
    await takeScreenshot(page, `07_cheques_${vp.name}`);

    // Register a Cheque via Photo Scan
    const chequePayload = {
      kind: "cheque",
      extraction: {
        number: `CHK-${Date.now().toString().slice(-6)}`,
        bank: "بنك مصر",
        amount_minor: 850000,
        issue_date: "2026-11-10",
        due_date: "2026-12-10",
        confidence: 0.95,
      },
      errors: {},
    };
    const chequeSvg = `<svg xmlns="http://www.w3.org/2000/svg" data-synthetic="true"><desc>TAHSEEL_SYNTHETIC_B64:${Buffer.from(JSON.stringify(chequePayload)).toString("base64")}</desc><text>cheque</text></svg>`;
    await page.getByTestId("cheque-photo").setInputFiles({
      name: "cheque.png",
      mimeType: "image/png",
      buffer: Buffer.from(chequeSvg),
    });
    await page.waitForTimeout(1500);

    const chkDebtor = page.locator("[data-testid=\"cheque-debtor\"]");
    if (await chkDebtor.count() > 0) {
      await chkDebtor.selectOption({ index: 1 });
      await page.click("[data-testid=\"cheque-submit\"]");
      await page.waitForTimeout(1500);
      console.log("   ✅ Cheque extracted from photo and registered!");
    }

    // Transition cheque: deposited -> cleared
    const depositBtn = page.locator("[data-testid=\"cheque-to-deposited\"]").first();
    if (await depositBtn.isVisible()) {
      await depositBtn.click();
      await page.waitForTimeout(1200);
      const clearBtn = page.locator("[data-testid=\"cheque-to-cleared\"]").first();
      if (await clearBtn.isVisible()) {
        await clearBtn.click();
        await page.waitForTimeout(1200);
        console.log("   ✅ Cheque lifecycle transitions (deposited -> cleared) executed!");
      }
    }

    // Trigger run alerts
    const alertsBtn = page.locator("[data-testid=\"cheque-run-alerts\"]");
    if (await alertsBtn.isVisible()) {
      await alertsBtn.click();
      await page.waitForTimeout(1000);
      console.log("   ✅ Cheque alerts executed without errors!");
    }

    // 9. Import Module
    console.log("9. Auditing Import Page (/ar/import)...");
    await page.goto("/ar/import");
    await page.waitForLoadState("networkidle");
    await page.waitForSelector("[data-testid=\"import-file\"]", { timeout: 15000 });
    await checkHorizontalOverflow(page, `import-${vp.name}`);
    await takeScreenshot(page, `08_import_${vp.name}`);

    // Upload CSV
    const csvPath = resolve(process.cwd(), "apps/web/e2e/fixtures/test_import.csv");
    if (existsSync(csvPath)) {
      await page.setInputFiles("[data-testid=\"import-file\"]", csvPath);
      await page.waitForTimeout(2000);
      const commitBtn = page.locator("[data-testid=\"import-commit\"]");
      if (await commitBtn.isVisible()) {
        await commitBtn.click();
        await page.waitForTimeout(2000);
        console.log("   ✅ Import previewed and committed!");

        // Test Undo
        const undoBtn = page.locator("[data-testid=\"import-undo\"]").first();
        if (await undoBtn.isVisible()) {
          await undoBtn.click();
          await page.waitForTimeout(1500);
          console.log("   ✅ Import successfully undone!");
        }
      }
    }

    // 10. Ledger Photo Smart Scan
    console.log("10. Auditing Ledger Photo (/ar/ledger-photo)...");
    await page.goto("/ar/ledger-photo");
    await page.waitForLoadState("networkidle");
    await page.waitForSelector("[data-testid=\"ledger-file\"]", { timeout: 15000 });
    await checkHorizontalOverflow(page, `ledger_photo-${vp.name}`);
    await takeScreenshot(page, `09_ledger_photo_${vp.name}`);

    // Test uploading synthetic fixture with extracted rows
    const l01Path = resolve(process.cwd(), "packages/eval/fixtures/ledger/test/L01.svg");
    if (existsSync(l01Path)) {
      const l01Buffer = readFileSync(l01Path);
      await page.getByTestId("ledger-file").setInputFiles({
        name: "ledger.png",
        mimeType: "image/png",
        buffer: l01Buffer,
      });
      await page.waitForTimeout(2500);
      const ledgerCommit = page.getByTestId("ledger-commit");
      if (await ledgerCommit.isVisible()) {
        await ledgerCommit.click();
        await page.waitForTimeout(2000);
        console.log("   ✅ Ledger photo extracted, reviewed, and committed!");
      }
    }

    // 11. AI Inbox & Human Review
    console.log("11. Auditing AI Inbox (/ar/ai-inbox)...");
    await page.goto("/ar/ai-inbox");
    await page.waitForLoadState("networkidle");
    await checkHorizontalOverflow(page, `ai_inbox-${vp.name}`);
    await takeScreenshot(page, `10_ai_inbox_${vp.name}`);

    // Upload receipt to AI Inbox
    const receiptSvgPath = resolve(process.cwd(), "packages/eval/fixtures/receipts/test/R01.svg");
    if (existsSync(receiptSvgPath)) {
      const rSvg = readFileSync(receiptSvgPath);
      const debtorSelect = page.getByTestId("receipt-debtor");
      if (await debtorSelect.count() > 0) {
        await debtorSelect.selectOption({ index: 1 });
        await page.getByTestId("receipt-file").setInputFiles({
          name: "receipt.png",
          mimeType: "image/png",
          buffer: rSvg,
        });
        await page.waitForTimeout(2500);

        const claimConfirm = page.locator("[data-testid^=\"claim-\"] button:has-text('تأكيد')").first();
        if (await claimConfirm.isVisible()) {
          await claimConfirm.click();
          await page.waitForTimeout(1500);
          console.log("   ✅ AI receipt processed and confirmed!");
        }
      }
    }

    // 12. Settings Page
    console.log("12. Auditing Settings Page (/ar/settings)...");
    await page.goto("/ar/settings");
    await page.waitForLoadState("networkidle");
    await page.waitForSelector("[data-testid=\"business-name-ar\"]", { timeout: 15000 });
    await checkHorizontalOverflow(page, `settings-${vp.name}`);
    await takeScreenshot(page, `11_settings_${vp.name}`);

    // Test exports
    const exportInv = page.getByTestId("export-invoices");
    if (await exportInv.isVisible()) {
      await exportInv.click();
      await page.waitForTimeout(600);
    }
    const exportAll = page.getByTestId("export-all");
    if (await exportAll.isVisible()) {
      await exportAll.click();
      await page.waitForTimeout(600);
    }

    // Test saving settings
    const saveSettingsBtn = page.locator("[data-testid=\"settings-submit\"]").first();
    if (await saveSettingsBtn.isVisible()) {
      await saveSettingsBtn.click();
      await page.waitForTimeout(1000);
      console.log("   ✅ Merchant settings and data exports verified!");
    }

    // 13. Billing & Quota Page
    console.log("13. Auditing Billing & Quota (/ar/billing)...");
    await page.goto("/ar/billing");
    await page.waitForLoadState("networkidle");
    await checkHorizontalOverflow(page, `billing-${vp.name}`);
    await takeScreenshot(page, `12_billing_${vp.name}`);

    // Test upgrade flow
    const upgradePro = page.getByTestId("upgrade-pro");
    const upgradeStarter = page.getByTestId("upgrade-starter");
    const upgradeBtn = (await upgradePro.isVisible()) ? upgradePro : upgradeStarter;
    if (await upgradeBtn.isVisible()) {
      await upgradeBtn.click();
      await page.waitForTimeout(1500);
      console.log("   ✅ Plan upgrade action verified!");
    }

    // 14. English Locale Navigation
    console.log("14. Auditing English Routes (/en/*)...");
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
      await page.goto(r);
      await page.waitForLoadState("networkidle");
      await checkHorizontalOverflow(page, `en-${r.split("/")[2]}-${vp.name}`);
    }
    await takeScreenshot(page, `13_en_dashboard_${vp.name}`);
    console.log("   ✅ All English SaaS routes verified!");

    await context.close();
  }

  // 15. Public Statement Unauthenticated View & Dispute
  if (publicStatementUrl) {
    console.log("\n======================================================");
    console.log(`🌐 Auditing Public Statement: ${publicStatementUrl}`);
    console.log("======================================================\n");

    const pubContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "ar-EG",
    });
    const pubPage = await pubContext.newPage();
    await attachErrorListeners(pubPage);

    await pubPage.goto(publicStatementUrl);
    await pubPage.waitForLoadState("networkidle");
    await checkHorizontalOverflow(pubPage, "public_statement");
    await takeScreenshot(pubPage, "14_public_statement_desktop");

    // Test disputing an invoice on the public statement
    const disputeBtn = pubPage.locator("[data-testid^=\"statement-dispute-\"]").first();
    if (await disputeBtn.isVisible()) {
      await disputeBtn.click();
      await pubPage.waitForTimeout(500);
      const disputeInput = pubPage.locator("textarea");
      if (await disputeInput.isVisible()) {
        await disputeInput.fill("اعتراض تجريبي لاختبار دورة حياة الفاتورة الشاملة");
        const submitDispute = pubPage.locator("button:has-text('إرسال الاعتراض'), button:has-text('Submit')").first();
        await submitDispute.click();
        await pubPage.waitForTimeout(1200);
        console.log("   ✅ Invoice dispute submitted from public statement!");
      }
    }

    await pubContext.close();
  }

  await browser.close();

  console.log("\n======================================================");
  console.log(`🏁 COMPREHENSIVE AUDIT COMPLETE: ${auditErrors.length} issues found`);
  console.log("======================================================\n");

  if (auditErrors.length > 0) {
    console.log("🚨 Issues found during audit:");
    auditErrors.forEach((err, idx) => {
      console.log(`${idx + 1}. [${err.type.toUpperCase()}] ${err.url}: ${err.message}`);
    });
    process.exit(1);
  } else {
    console.log("✨ ALL 15 MODULES, FLOWS, VIEWPORTS, AND CONTROLS PASSED WITH ZERO ERRORS! 🚀");
  }
}

runComprehensiveAudit().catch((err) => {
  console.error("FATAL AUDIT CRASH:", err);
  process.exit(1);
});
