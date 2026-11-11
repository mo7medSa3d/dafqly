import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

/**
 * v0.9.0 premium redesign evidence: AFTER screenshots paired with the
 * BEFORE baseline in e2e/screenshots/redesign/, plus responsive guards —
 * exactly one nav instance per testid at any viewport (sidebar and bottom
 * bar are one morphing DOM node) and no horizontal overflow on mobile.
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

async function login(page: Page) {
  await page.goto("/ar/login");
  await page.getByTestId("auth-email").fill("demo@tahseel.test");
  await page.getByTestId("auth-password").fill("demo-password-123");
  await page.getByTestId("auth-submit").click();
  await expect(page).toHaveURL(/\/ar\/dashboard/);
}

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test("redesign: single nav instance + no mobile overflow + AFTER shots (mobile)", async ({ page }) => {
  await login(page);
  await expect(page.getByTestId("dashboard")).toBeVisible();
  for (const id of ["nav-dashboard", "nav-debtors", "nav-invoices", "nav-import", "nav-ledger-photo", "nav-ai-inbox", "nav-cheques"]) {
    await expect(page.getByTestId(id)).toHaveCount(1);
  }
  await noOverflow(page);
  await fullShot(page, "after-dashboard-mobile.png");
  const reports = page.getByTestId("reports");
  await reports.screenshot({ path: `${shotsDir}/after-reports-mobile.png` });

  for (const [route, name] of [["invoices", "invoices"], ["debtors", "debtors"], ["import", "import"], ["ledger-photo", "ledger-photo"], ["ai-inbox", "ai-inbox"], ["cheques", "cheques"]] as const) {
    await page.goto(`/ar/${route}`);
    await noOverflow(page);
    await fullShot(page, `after-${name}-mobile.png`);
  }

  // Debtor detail + a public statement rendered from it.
  await page.goto("/ar/debtors");
  await page.getByTestId("debtor-view").first().click();
  await expect(page.getByTestId("debtor-outstanding")).toBeVisible();
  await noOverflow(page);
  await fullShot(page, "after-debtor-detail-mobile.png");
  const m = /debtors\/([0-9a-f-]{36})/.exec(page.url());
  expect(m).not.toBeNull();
  const res = await page.request.post("/api/trpc/statements.create", { data: { debtorId: m![1] } });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { result: { data: { path: string } } };
  const pub = await page.context().newPage();
  await pub.goto(body.result.data.path);
  await expect(pub.getByTestId("statement-page")).toBeVisible();
  await noOverflow(pub);
  await fullShot(pub, "after-statement-mobile.png");
  await pub.close();
});

test("redesign: AFTER shots (desktop + dark + onboarding)", async ({ page, browser }) => {
  const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar-EG", reducedMotion: "reduce" });
  const dp = await desk.newPage();
  await dp.goto("/ar");
  await fullShot(dp, "after-landing-desktop.png");
  await dp.goto("/ar/login");
  await fullShot(dp, "after-login-desktop.png");
  await login(dp);
  await fullShot(dp, "after-dashboard-desktop.png");
  await dp.goto("/ar/invoices");
  await fullShot(dp, "after-invoices-desktop.png");
  await dp.goto("/ar/debtors");
  await fullShot(dp, "after-debtors-desktop.png");
  await desk.close();

  const dark = await browser.newContext({ colorScheme: "dark", viewport: { width: 1440, height: 900 }, locale: "ar-EG", reducedMotion: "reduce" });
  const kp = await dark.newPage();
  await kp.goto("/ar/login");
  await fullShot(kp, "after-login-desktop-dark.png");
  await login(kp);
  await fullShot(kp, "after-dashboard-desktop-dark.png");
  await dark.close();

  const darkMobile = await browser.newContext({ colorScheme: "dark", viewport: { width: 390, height: 844 }, locale: "ar-EG", reducedMotion: "reduce" });
  const mp = await darkMobile.newPage();
  await mp.goto("/ar/login");
  await fullShot(mp, "after-login-mobile-dark.png");
  await login(mp);
  await fullShot(mp, "after-dashboard-mobile-dark.png");
  await darkMobile.close();

  // Onboarding wizard (fresh user, no tenant yet).
  await page.goto("/ar/signup");
  await page.getByTestId("auth-name").fill("Redesign Shots");
  await page.getByTestId("auth-email").fill(`redesign-${Date.now()}@tahseel.test`);
  await page.getByTestId("auth-password").fill("redesign-password-123");
  await page.getByTestId("auth-submit").click();
  await expect(page).toHaveURL(/\/ar\/onboarding/, { timeout: 15000 });
  await fullShot(page, "after-onboarding-mobile.png");
});
