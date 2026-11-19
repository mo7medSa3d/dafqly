import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Accessibility gate (Prompt 08 baseline: 0 violations on 4 pages).
 * Runs axe-core with the default rule set against the four core pages
 * and fails on any violation. Uses the seeded demo user (the root
 * `pnpm test:e2e` script seeds before running).
 */
const pages = [
  { name: "landing", url: "/ar", auth: false, ready: "h1" },
  { name: "login", url: "/ar/login", auth: false, ready: '[data-testid="auth-submit"]' },
  { name: "dashboard", url: "/ar/dashboard", auth: true, ready: '[data-testid="kpi-outstanding"]' },
  { name: "invoices", url: "/ar/invoices", auth: true, ready: '[data-testid="inv-amount"]' },
] as const;

test("axe: 0 violations on landing, login, dashboard, invoices", async ({ page }) => {
  // Fade-in animations leave text at partial opacity while axe analyzes;
  // reduced motion makes the landing render at its final colors immediately.
  await page.emulateMedia({ reducedMotion: "reduce" });
  let loggedIn = false;
  for (const { name, url, auth, ready } of pages) {
    if (auth && !loggedIn) {
      await page.goto("/ar/login");
      await page.getByTestId("auth-email").fill("demo@tahseel.test");
      await page.getByTestId("auth-password").fill("demo-password-123");
      await page.getByTestId("auth-submit").click();
      await expect(page).toHaveURL(/\/ar\/dashboard/);
      loggedIn = true;
    }
    if (page.url().endsWith(url) === false) {
      await page.goto(url);
    }
    await expect(page.locator(ready).first()).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations, `${name}: ${JSON.stringify(results.violations, null, 2)}`).toEqual([]);
  }
});
