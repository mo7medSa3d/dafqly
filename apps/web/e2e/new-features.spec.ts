import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs/promises";

const FIXES_DIR = path.resolve(process.cwd(), "e2e/screenshots/fixes");

test.describe("New Features: Search, WhatsApp Share, Audit Trail", () => {
  test.beforeAll(async () => {
    await fs.mkdir(FIXES_DIR, { recursive: true });
  });

  test("1. Login and verify Command Palette (Ctrl+K)", async ({ page }) => {
    await page.goto("/ar/login");
    await page.fill('[data-testid="auth-email"]', "demo@tahseel.test");
    await page.fill('[data-testid="auth-password"]', "demo-password-123");
    await page.click('[data-testid="auth-submit"]');
    await page.waitForURL("**/ar/dashboard");

    // Open search by clicking the header button or Ctrl+K
    const searchTrigger = page.locator('button[title*="بحث سريع"]');
    await expect(searchTrigger).toBeVisible();
    await searchTrigger.click();

    const palette = page.locator('role=dialog');
    await expect(palette).toBeVisible();

    await page.screenshot({ path: path.join(FIXES_DIR, "feature_command_palette.png") });

    // Type search query
    await page.keyboard.type("عميل");
    await page.waitForTimeout(400);

    await page.screenshot({ path: path.join(FIXES_DIR, "feature_command_palette_results.png") });

    // Close palette
    await page.keyboard.press("Escape");
    await expect(palette).toBeHidden();
  });

  test("2. Verify WhatsApp share on invoices page", async ({ page }) => {
    await page.goto("/ar/login");
    await page.fill('[data-testid="auth-email"]', "demo@tahseel.test");
    await page.fill('[data-testid="auth-password"]', "demo-password-123");
    await page.click('[data-testid="auth-submit"]');
    await page.waitForURL("**/ar/dashboard");

    await page.goto("/ar/invoices");
    await page.waitForSelector('[data-testid="invoice-row"]');

    const shareBtn = page.locator('button[title="مشاركة عبر واتساب"]').first();
    await expect(shareBtn).toBeVisible();

    await page.screenshot({ path: path.join(FIXES_DIR, "feature_invoices_whatsapp.png"), fullPage: true });
  });

  test("3. Verify Audit Trail on settings page", async ({ page }) => {
    await page.goto("/ar/login");
    await page.fill('[data-testid="auth-email"]', "demo@tahseel.test");
    await page.fill('[data-testid="auth-password"]', "demo-password-123");
    await page.click('[data-testid="auth-submit"]');
    await page.waitForURL("**/ar/dashboard");

    await page.goto("/ar/settings");
    await page.waitForSelector('text=سجل العمليات والرقابة');

    const auditTable = page.locator('text=سجل العمليات والرقابة');
    await expect(auditTable).toBeVisible();

    await page.screenshot({ path: path.join(FIXES_DIR, "feature_settings_audit_trail.png"), fullPage: true });
  });
});
