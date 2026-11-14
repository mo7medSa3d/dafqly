import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * Quiet Ledger EN pass: landing / login / dashboard in English (LTR),
 * desktop 1440 + mobile 390, plus the 404 page in both locales.
 * The redesign.spec.ts covers ar in depth (light + dark); this spec proves
 * the same system holds in English. Screenshots land in
 * e2e/screenshots/redesign/ as after-en-*.png / after-404-*.png.
 */
const shotsDir = "e2e/screenshots/redesign";
mkdirSync(shotsDir, { recursive: true });

test.use({ reducedMotion: "reduce" });

/** Fixed shell bars render once, at the page edge, in full-page captures. */
async function fullShot(page: Page, name: string) {
  await page.addStyleTag({ content: "aside { position: absolute !important; } :has(> aside) { position: relative !important; }" }).catch(() => {});
  await page.waitForTimeout(600); // let client data settle before capturing
  await page.screenshot({ path: `${shotsDir}/${name}`, fullPage: true });
}

async function loginEn(page: Page) {
  await page.goto("/en/login");
  await page.getByTestId("auth-email").fill("demo@tahseel.test");
  await page.getByTestId("auth-password").fill("demo-password-123");
  await page.getByTestId("auth-submit").click();
  await expect(page).toHaveURL(/\/en\/dashboard/);
}

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test("quiet-ledger en: landing + login + dashboard, desktop + mobile", async ({ page, browser }) => {
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US", reducedMotion: "reduce" });
  const dp = await desk.newPage();
  await dp.goto("/en");
  await fullShot(dp, "after-en-landing-desktop-light.png");
  await dp.goto("/en/login");
  await fullShot(dp, "after-en-login-desktop-light.png");
  await loginEn(dp);
  await expect(dp.getByTestId("dashboard")).toBeVisible();
  await fullShot(dp, "after-en-dashboard-desktop-light.png");
  await desk.close();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/en");
  await noOverflow(page);
  await fullShot(page, "after-en-landing-mobile-light.png");
  await page.goto("/en/login");
  await noOverflow(page);
  await fullShot(page, "after-en-login-mobile-light.png");
  await loginEn(page);
  await expect(page.getByTestId("dashboard")).toBeVisible();
  await noOverflow(page);
  await fullShot(page, "after-en-dashboard-mobile-light.png");
});

test("quiet-ledger 404: custom page renders in both locales", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/ar/definitely-not-a-page");
  await expect(page.getByText("الصفحة غير موجودة")).toBeVisible();
  await page.screenshot({ path: `${shotsDir}/after-404-ar-desktop-light.png` });
  await page.goto("/en/definitely-not-a-page");
  await expect(page.getByText("Page not found")).toBeVisible();
  await page.screenshot({ path: `${shotsDir}/after-404-en-desktop-light.png` });
});
