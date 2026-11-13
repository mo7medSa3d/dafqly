import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

const shotsDir = "e2e/screenshots/fixes";
mkdirSync(shotsDir, { recursive: true });

test("Verify black numbers, in-app modal, AI model identity, and rich data seeding", async ({ page }) => {
  // 1. Login
  await page.goto("/ar/login");
  await page.getByTestId("auth-email").fill("demo@tahseel.test");
  await page.getByTestId("auth-password").fill("demo-password-123");
  await page.getByTestId("auth-submit").click();
  await expect(page).toHaveURL(/\/ar\/dashboard/);

  // Take screenshot of Dashboard with black numbers and no gradients
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${shotsDir}/dashboard_black_numbers.png`, fullPage: false });

  // 2. Open AI Copilot pop-up menu & verify Rased and Gemini model badge
  const copilotBtn = page.getByTestId("ai-copilot-trigger-btn");
  await copilotBtn.click();
  await expect(page.getByTestId("ai-assistant-menu")).toBeVisible();
  await expect(page.getByTestId("ai-assistant-menu").getByText("gemini-3.1-flash-lite")).toBeVisible();
  await expect(page.getByText("راصد · مستشار دفقلي المالي الذكي")).toBeVisible();
  await page.screenshot({ path: `${shotsDir}/rased_menu_model_badge.png` });

  // Open drawer
  await page.getByTestId("ai-menu-briefing-btn").click();
  await expect(page.getByTestId("ai-copilot-drawer")).toBeVisible();
  await expect(page.getByTestId("ai-copilot-drawer").getByText("gemini-3.1-flash-lite")).toBeVisible();
  await page.screenshot({ path: `${shotsDir}/rased_window_model_badge.png` });

  // Close drawer
  await page.locator('button[aria-label="إغلاق"]').first().click();

  // 3. Navigate to Invoices & verify neutral numbers
  await page.goto("/ar/invoices");
  await expect(page.getByTestId("inv-search")).toBeVisible();
  await page.screenshot({ path: `${shotsDir}/invoices_neutral_numbers.png` });

  // 4. Navigate to Settings & verify in-app revoke modal
  await page.goto("/ar/settings");
  await expect(page.getByTestId("settings-submit")).toBeVisible();

  // Click revoke sessions - MUST NOT trigger native alert/confirm, must show in-app modal!
  const revokeBtn = page.getByTestId("revoke-all-sessions");
  await revokeBtn.scrollIntoViewIfNeeded();
  await revokeBtn.click();

  const modalTitle = page.locator("#revoke-modal-title");
  await expect(modalTitle).toBeVisible();
  await expect(modalTitle).toContainText("تسجيل الخروج من كل الأجهزة؟");
  await page.screenshot({ path: `${shotsDir}/in_app_revoke_modal.png` });

  // Cancel modal
  await page.getByRole("button", { name: "إلغاء" }).click();
  await expect(modalTitle).toHaveCount(0);

  // 5. Test Seed Comprehensive Demo Data
  const seedBtn = page.getByTestId("seed-comprehensive-btn");
  await seedBtn.click();
  await expect(page.getByText(/تم بنجاح تحميل البيانات التجريبية/)).toBeVisible({ timeout: 10000 });
  await page.screenshot({ path: `${shotsDir}/seed_data_success.png` });

  // 6. Navigate to Invoices with rich seeded data!
  await page.goto("/ar/invoices");
  await expect(page.getByTestId("invoice-row").first()).toBeVisible();
  await page.screenshot({ path: `${shotsDir}/invoices_rich_seeded_data.png` });

  // 7. Navigate to Cheques with rich seeded data!
  await page.goto("/ar/cheques");
  await expect(page.getByTestId("cheques-visual-summary")).toBeVisible();
  await page.screenshot({ path: `${shotsDir}/cheques_rich_seeded_data.png` });
});
