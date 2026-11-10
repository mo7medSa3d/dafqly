import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
import { clickNav } from "./helpers";

/**
 * M1 exit flow (§10): manage invoices with correct statuses, and import a
 * messy Excel file end-to-end. Runs in Arabic RTL on a mobile viewport.
 */

async function signupAndOnboard(page: import("@playwright/test").Page, business: string) {
  const email = `e2e-m1-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
  await page.goto("/ar/signup");
  await page.getByTestId("auth-name").fill("مستخدم تجريبي");
  await page.getByTestId("auth-email").fill(email);
  await page.getByTestId("auth-password").fill("e2e-password-123");
  await page.getByTestId("auth-submit").click();
  await expect(page).toHaveURL(/\/ar\/onboarding/);
  await page.getByTestId("ob-name-ar").fill(business);
  await page.getByTestId("ob-next").click();
  await page.getByTestId("ob-next").click();
  await page.getByTestId("ob-consent").check();
  await page.getByTestId("ob-create").click();
  await expect(page).toHaveURL(/\/ar\/dashboard/);
}

test("M1 F1: debtor -> invoice -> partial payment -> paid, with correct statuses", async ({ page }) => {
  await signupAndOnboard(page, "محل اختبار م١");

  await clickNav(page, "nav-debtors");
  await expect(page).toHaveURL(/\/ar\/debtors/);
  await page.getByTestId("debtor-name").fill("عميل الاختبار");
  await page.getByTestId("debtor-phone").fill("01001234567");
  await page.getByTestId("debtor-create").click();
  await expect(page.getByTestId("debtor-row")).toHaveCount(1);

  await clickNav(page, "nav-invoices");
  await expect(page).toHaveURL(/\/ar\/invoices/);
  await page.getByTestId("inv-amount").fill("1000");
  await page.getByTestId("inv-reference").fill("E2E-INV-1");
  await page.getByTestId("inv-due").fill("2026-11-20");
  await page.getByTestId("inv-create").click();
  await expect(page.getByTestId("invoice-row")).toHaveCount(1);
  await expect(page.getByTestId("invoice-status")).toHaveText("مفتوحة");

  // Partial payment with an explicit allocation on the debtor page.
  await clickNav(page, "nav-debtors");
  await page.getByTestId("debtor-view").click();
  await expect(page.getByTestId("debtor-outstanding")).toContainText("1,000.00");
  const allocInput = page.locator('[data-testid^="pay-alloc-"]');
  await page.getByTestId("pay-amount").fill("400");
  await allocInput.fill("400");
  await page.getByTestId("pay-submit").click();
  await expect(page.getByTestId("pay-msg")).toHaveText("تم تسجيل الدفعة");
  await expect(page.getByTestId("debtor-outstanding")).toContainText("600.00");
  await expect(page.locator('[data-testid^="detail-invoice-status-"]')).toHaveText("مدفوعة جزئيًا");
  await expect(page.getByTestId("timeline-payment")).toHaveCount(1);

  // Remainder auto-allocates and closes the invoice.
  await page.getByTestId("pay-amount").fill("600");
  await page.getByTestId("pay-submit").click();
  await expect(page.getByTestId("debtor-outstanding")).toContainText("0.00");
  await expect(page.locator('[data-testid^="detail-invoice-status-"]')).toHaveText("مدفوعة");
  await page.screenshot({ path: "e2e/screenshots/m1-debtor-paid-ar-light.png" });
});

test("M1 F2 exit: import a messy Excel file (header on row 3), commit, undo", async ({ page }) => {
  await signupAndOnboard(page, "مستورد اختبار");
  await clickNav(page, "nav-import");
  await expect(page).toHaveURL(/\/ar\/import/);

  const fixture = resolve(process.cwd(), "../../packages/eval/fixtures/import/test/03-header-row-3.xlsx");
  await page.getByTestId("import-file").setInputFiles(fixture);
  await expect(page.getByTestId("import-stats")).toContainText("1");
  await expect(page.getByTestId("import-row")).toHaveCount(1);
  await expect(page.getByTestId("import-row")).toHaveAttribute("data-status", "valid");

  await page.getByTestId("import-commit").click();
  await expect(page.getByTestId("import-msg")).toHaveText("تم الاستيراد");
  await expect(page.getByTestId("import-job")).toContainText("committed");

  await clickNav(page, "nav-debtors");
  await expect(page.getByTestId("debtor-row")).toHaveCount(1);
  await expect(page.getByTestId("debtor-row")).toContainText("Omar Fathy");
  await page.screenshot({ path: "e2e/screenshots/m1-import-committed-ar-light.png" });

  await clickNav(page, "nav-import");
  await page.getByTestId("import-undo").click();
  await expect(page.getByTestId("import-msg")).toHaveText("تم التراجع عن الاستيراد");
  await clickNav(page, "nav-debtors");
  await expect(page.getByTestId("debtors-empty")).toBeVisible();
});
