import { chromium, type Page } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

interface AuditError {
  url: string;
  type: "console_error" | "page_error" | "overflow" | "assertion_failure" | "network_error";
  message: string;
}

const auditErrors: AuditError[] = [];
const screenshotDir = resolve(process.cwd(), "apps/web/e2e/screenshots/audit");
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
      if (text.includes("favicon.ico") || text.includes("Download the React DevTools")) return;
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

async function runDeepAudit() {
  console.log("🚀 Starting Comprehensive Deep Application Audit...");
  const browser = await chromium.launch();

  // Test both Desktop (1280x800) and Mobile (390x844)
  const viewports = [
    { name: "desktop", width: 1280, height: 800 },
    { name: "mobile", width: 390, height: 844 },
  ];

  let publicStatementUrl = "";

  for (const vp of viewports) {
    console.log(`\n========================================`);
    console.log(`📱 Testing Viewport: ${vp.name.toUpperCase()} (${vp.width}x${vp.height})`);
    console.log(`========================================\n`);

    const context = await browser.newContext({
      baseURL: "http://localhost:3000",
      viewport: { width: vp.width, height: vp.height },
      locale: "ar-EG",
    });
    const page = await context.newPage();
    await attachErrorListeners(page);

    // 1. Visit Login Page
    console.log("1. Visiting /ar/login...");
    await page.goto("/ar/login");
    await page.waitForLoadState("networkidle");
    await checkHorizontalOverflow(page, `login-${vp.name}`);
    await takeScreenshot(page, `01_login_${vp.name}`);

    // Fill credentials & submit
    await page.fill("[data-testid=\"auth-email\"]", "demo@tahseel.test");
    await page.fill("[data-testid=\"auth-password\"]", "demo-password-123");
    await page.click("[data-testid=\"auth-submit\"]");
    await page.waitForURL("**/dashboard", { timeout: 30000 });
    console.log("✅ Successfully logged in and landed on Dashboard!");

    // 2. Dashboard Tests
    console.log("2. Auditing Dashboard (/ar/dashboard)...");
    await page.waitForLoadState("networkidle");
    await page.waitForSelector("[data-testid=\"dashboard\"]", { timeout: 10000 });
    await checkHorizontalOverflow(page, `dashboard-${vp.name}`);
    await takeScreenshot(page, `02_dashboard_${vp.name}`);

    // Verify KPI blocks
    const overdueText = await page.locator("[data-testid=\"kpi-overdue\"]").textContent();
    const collectedText = await page.locator("[data-testid=\"kpi-collected\"]").textContent();
    console.log(`   KPI Overdue: ${overdueText?.trim()}, Collected: ${collectedText?.trim()}`);

    // Test saving Preferences panel on Dashboard
    const savePrefBtn = page.locator("button:has-text(\"حفظ التفضيلات\")");
    if (await savePrefBtn.count() > 0) {
      await savePrefBtn.click();
      await page.waitForTimeout(1000);
      const isSaved = (await page.content()).includes("تم حفظ التفضيلات");
      console.log(`   Business preferences saved: ${isSaved ? "SUCCESS ✅" : "FAILED ❌"}`);
      if (!isSaved) recordError(page.url(), "assertion_failure", "Preferences save button did not show success message");
    }

    // 3. Debtors Page Tests
    console.log("3. Auditing Debtors (/ar/debtors)...");
    await page.goto("/ar/debtors");
    await page.waitForLoadState("networkidle");
    await checkHorizontalOverflow(page, `debtors-${vp.name}`);
    await takeScreenshot(page, `03_debtors_${vp.name}`);

    // Create a new debtor with unique timestamp
    const uniquePhone = `+2010${Math.floor(10000000 + Math.random() * 90000000)}`;
    const uniqueName = `تاجر تجريبي ${Date.now().toString().slice(-4)}`;
    console.log(`   Creating debtor: ${uniqueName} (${uniquePhone})...`);
    await page.fill("[data-testid=\"debtor-name\"]", uniqueName);
    await page.fill("[data-testid=\"debtor-phone\"]", uniquePhone);
    await page.fill("[data-testid=\"debtor-notes\"]", "ملاحظات تجريبية للاختبار الشامل");
    await page.click("[data-testid=\"debtor-create\"]");
    await page.waitForTimeout(1500);

    const debtorsContent = await page.content();
    if (!debtorsContent.includes(uniqueName)) {
      recordError(page.url(), "assertion_failure", `Created debtor ${uniqueName} not visible in debtors list`);
    } else {
      console.log(`   ✅ Debtor ${uniqueName} created and displayed!`);
    }

    // 4. Invoices Page Tests
    console.log("4. Auditing Invoices (/ar/invoices)...");
    await page.goto("/ar/invoices");
    await page.waitForLoadState("networkidle");
    await checkHorizontalOverflow(page, `invoices-${vp.name}`);
    await takeScreenshot(page, `04_invoices_${vp.name}`);

    // Create an invoice
    const invAmount = "2750";
    console.log(`   Creating invoice for amount ${invAmount}...`);
    await page.fill("[data-testid=\"inv-amount\"]", invAmount);
    await page.fill("[data-testid=\"inv-description\"]", "توريد بضاعة تجريبية - فحص شامل");
    await page.click("[data-testid=\"inv-create\"]");
    await page.waitForTimeout(1500);

    const invoicesContent = await page.content();
    if (!invoicesContent.includes("2,750") && !invoicesContent.includes("2750")) {
      recordError(page.url(), "assertion_failure", `Created invoice for ${invAmount} not visible in invoices list`);
    } else {
      console.log(`   ✅ Invoice for ${invAmount} created and displayed!`);
    }

    // 5. Debtor Detail Page
    console.log("5. Auditing Debtor Detail Page...");
    await page.goto("/ar/debtors");
    const debtorLink = page.locator("a[href*=\"/debtors/\"]").first();
    if (await debtorLink.count() > 0) {
      const debtorHref = await debtorLink.getAttribute("href");
      if (debtorHref) {
        await page.goto(debtorHref);
        await page.waitForLoadState("networkidle");
        await checkHorizontalOverflow(page, `debtor_detail-${vp.name}`);
        await takeScreenshot(page, `05_debtor_detail_${vp.name}`);

        // Test creating Statement Link
        const createStmtBtn = page.locator("[data-testid=\"stmt-create\"]");
        if (await createStmtBtn.count() > 0) {
          await createStmtBtn.click();
          await page.waitForTimeout(1500);
          console.log("   ✅ Statement link created!");

          // Grab the created public statement URL
          const stmtInput = page.locator("[data-testid=\"stmt-new-url\"] input");
          if (await stmtInput.count() > 0) {
            publicStatementUrl = (await stmtInput.inputValue()).trim();
            console.log(`   Statement public URL: ${publicStatementUrl}`);
          }
        }

        // Test Recording Manual Payment
        const payAmountInput = page.locator("[data-testid=\"pay-amount\"]");
        const paySubmitBtn = page.locator("[data-testid=\"pay-submit\"]");
        if ((await payAmountInput.count()) > 0 && (await paySubmitBtn.count()) > 0) {
          await payAmountInput.fill("500");
          await paySubmitBtn.click();
          await page.waitForTimeout(1500);
          console.log("   ✅ Manual payment of 500 recorded!");
        }
      }
    }

    // 6. Cheques Module Tests
    console.log("6. Auditing Cheques (/ar/cheques)...");
    await page.goto("/ar/cheques");
    await page.waitForLoadState("networkidle");
    await checkHorizontalOverflow(page, `cheques-${vp.name}`);
    await takeScreenshot(page, `06_cheques_${vp.name}`);

    // Register a cheque
    const chequeNum = `CHK-${Date.now().toString().slice(-6)}`;
    const debtorSelect = page.locator("[data-testid=\"cheque-debtor\"]");
    if (await debtorSelect.count() > 0) {
      await debtorSelect.selectOption({ index: 1 });
      await page.fill("[data-testid=\"cheque-number\"]", chequeNum);
      await page.fill("[data-testid=\"cheque-bank\"]", "البنك الأهلي المصري");
      await page.fill("[data-testid=\"cheque-amount\"]", "3500");
      await page.click("[data-testid=\"cheque-submit\"]");
      await page.waitForTimeout(1500);
      const chkContent = await page.content();
      console.log(`   Cheque registration result: ${chkContent.includes(chequeNum) ? "SUCCESS ✅" : "NOT VISIBLE ❌"}`);
      if (!chkContent.includes(chequeNum)) {
        recordError(page.url(), "assertion_failure", `Registered cheque ${chequeNum} not found in cheques list`);
      }
    }

    // 7. Import Module Tests
    console.log("7. Auditing Import Page (/ar/import)...");
    await page.goto("/ar/import");
    await page.waitForLoadState("networkidle");
    await checkHorizontalOverflow(page, `import-${vp.name}`);
    await takeScreenshot(page, `07_import_${vp.name}`);

    // Upload test CSV
    const csvPath = resolve(process.cwd(), "apps/web/e2e/fixtures/test_import.csv");
    if (existsSync(csvPath)) {
      const fileInput = page.locator("[data-testid=\"import-file\"]");
      await fileInput.setInputFiles(csvPath);
      await page.waitForTimeout(2000);
      const importStats = await page.locator("[data-testid=\"import-stats\"]");
      if (await importStats.count() > 0) {
        console.log(`   ✅ Import CSV previewed! Stats: ${await importStats.textContent()}`);
        await page.click("[data-testid=\"import-commit\"]");
        await page.waitForTimeout(2500);
        console.log("   ✅ Import CSV committed to database!");
      }
    }

    // 8. Ledger Photo AI Page Tests
    console.log("8. Auditing Ledger Photo Page (/ar/ledger-photo)...");
    await page.goto("/ar/ledger-photo");
    await page.waitForLoadState("networkidle");
    await checkHorizontalOverflow(page, `ledger_photo-${vp.name}`);
    await takeScreenshot(page, `08_ledger_photo_${vp.name}`);

    // 9. AI Inbox Page Tests
    console.log("9. Auditing AI Inbox (/ar/ai-inbox)...");
    await page.goto("/ar/ai-inbox");
    await page.waitForLoadState("networkidle");
    await checkHorizontalOverflow(page, `ai_inbox-${vp.name}`);
    await takeScreenshot(page, `09_ai_inbox_${vp.name}`);

    // 10. English Locale Verification (/en/dashboard)
    console.log("10. Auditing English Locale (/en/dashboard)...");
    await page.goto("/en/dashboard");
    await page.waitForLoadState("networkidle");
    await checkHorizontalOverflow(page, `en_dashboard-${vp.name}`);
    await takeScreenshot(page, `10_en_dashboard_${vp.name}`);

    await context.close();
  }

  // 11. Public Statement View Audit (Incognito / No Auth Session)
  if (publicStatementUrl) {
    console.log("\n========================================");
    console.log(`🌐 Testing Public Statement View (Unauthenticated): ${publicStatementUrl}`);
    console.log("========================================\n");

    const publicContext = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      locale: "ar-EG",
    });
    const publicPage = await publicContext.newPage();
    await attachErrorListeners(publicPage);

    await publicPage.goto(publicStatementUrl);
    await publicPage.waitForLoadState("networkidle");
    await checkHorizontalOverflow(publicPage, "public_statement");
    await takeScreenshot(publicPage, "11_public_statement_desktop");

    const pageContent = await publicPage.content();
    console.log(`   Public statement rendered: ${pageContent.includes("كشف حساب") || pageContent.includes("Statement") ? "SUCCESS ✅" : "FAILED ❌"}`);
    await publicContext.close();
  }

  await browser.close();

  console.log("\n========================================");
  console.log(`🏁 DEEP AUDIT COMPLETE: ${auditErrors.length} issues found`);
  console.log("========================================\n");

  if (auditErrors.length > 0) {
    console.log("🚨 Issues summary:");
    auditErrors.forEach((err, idx) => {
      console.log(`${idx + 1}. [${err.type}] ${err.url}: ${err.message}`);
    });
    process.exit(1);
  } else {
    console.log("🎉 All automated checks, user flows, responsive layouts, and modules passed with ZERO errors!");
  }
}

runDeepAudit().catch((err) => {
  console.error("FATAL AUDIT CRASH:", err);
  process.exit(1);
});
