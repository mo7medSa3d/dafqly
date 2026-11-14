import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Accessibility gate (Prompt 08 baseline: 0 violations on 4 pages).
 * Runs axe-core with the default rule set against the four core pages
 * and fails on any violation. Uses the seeded demo user (the root
 * `pnpm test:e2e` script seeds before running).
 */
const pages = [
  { name: "landing", url: "/ar", auth: false },
  { name: "login", url: "/ar/login", auth: false },
  { name: "dashboard", url: "/ar/dashboard", auth: true },
  { name: "invoices", url: "/ar/invoices", auth: true },
] as const;

test("axe: 0 violations on landing, login, dashboard, invoices", async ({ page }) => {
  for (const { name, url, auth } of pages) {
    if (auth) {
      await page.goto("/ar/login");
      await page.getByTestId("auth-email").fill("demo@tahseel.test");
      await page.getByTestId("auth-password").fill("demo-password-123");
      await page.getByTestId("auth-submit").click();
      await expect(page).toHaveURL(/\/ar\/dashboard/);
    }
    await page.goto(url);
    await page.waitForTimeout(600); // let client data settle
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations, `${name}: ${JSON.stringify(results.violations, null, 2)}`).toEqual([]);
  }
});
