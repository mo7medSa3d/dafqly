import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";

const FIXES_DIR = path.resolve(process.cwd(), "e2e", "screenshots", "fixes");

async function loginDemo(page: Page) {
  await page.goto("/ar/login");
  await page.getByTestId("auth-email").fill("demo@tahseel.test");
  await page.getByTestId("auth-password").fill("demo-password-123");
  await page.getByTestId("auth-submit").click();
  await expect(page).toHaveURL(/\/ar\/dashboard/);
}

test.describe("New Features: Search, WhatsApp Share, Audit Trail", () => {
  test.beforeAll(async () => {
    await fs.mkdir(FIXES_DIR, { recursive: true });
  });

  test("1. Login and verify Command Palette (Ctrl+K)", async ({ page }) => {
    await loginDemo(page);

    // Open search by clicking the header button
    const searchTrigger = page.locator('button[title*="بحث سريع"]');
    await expect(searchTrigger).toBeVisible();
    await searchTrigger.click();

    const palette = page.getByRole("dialog");
    await expect(palette).toBeVisible();

    await page.screenshot({ path: path.join(FIXES_DIR, "feature_command_palette.png") });

    // Type search query and wait for debounced results to render
    const searchInput = palette.getByPlaceholder(/ابحث|Search/);
    await searchInput.fill("عميل");
    await expect(palette.getByText("عميل").first()).toBeVisible();

    await page.screenshot({ path: path.join(FIXES_DIR, "feature_command_palette_results.png") });

    // Close palette
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
  });

  test("2. Verify WhatsApp share on invoices page", async ({ page }) => {
    await loginDemo(page);

    await page.goto("/ar/invoices");
    await expect(page.getByTestId("invoice-row").first()).toBeVisible();

    const shareBtn = page.locator('button[title="مشاركة عبر واتساب"]').first();
    await expect(shareBtn).toBeVisible();

    await page.screenshot({ path: path.join(FIXES_DIR, "feature_invoices_whatsapp.png"), fullPage: true });
  });

  test("3. Verify Audit Trail on settings page", async ({ page }) => {
    await loginDemo(page);

    await page.goto("/ar/settings");
    const auditTable = page.getByText("سجل العمليات والرقابة");
    await expect(auditTable).toBeVisible();

    await page.screenshot({ path: path.join(FIXES_DIR, "feature_settings_audit_trail.png"), fullPage: true });
  });
});
