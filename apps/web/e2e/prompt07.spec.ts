import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { clickNav } from "./helpers";

/**
 * Prompt 07 — real browser verification (2026-11-13).
 * Fills the gaps the m0–m6 suite does not cover:
 * - a route tour at desktop 1440×900 (AR) incl. the routes no earlier spec
 *   visits (tasks, cheques, ai-inbox) + screenshots for every key screen;
 * - the five required viewports (1440×900, 1366×768, 1024×768, 768×1024,
 *   390×844) with no-horizontal-overflow assertions;
 * - an English LTR pass (dir=ltr, dashboard + invoices);
 * - a UI journey (debtor → invoice → partial payment) verified against
 *   the DATABASE afterwards, not just the toast;
 * - F-20 RTL visual checks: the billing tier badge must be centred on its
 *   card in RTL, and the forecast chart must keep time flowing left→right
 *   in both locales (charts are LTR data visualisations; only labels
 *   localise) — the chart needs 10 paid invoices, seeded by SQL below;
 * - the customer portal visited in a logged-out browser.
 */
const dbUrl = process.env.DATABASE_URL || "postgres://tahseel:tahseel@localhost:5432/tahseel";
const sqlClient = postgres(dbUrl);

test.afterAll(async () => {
  await sqlClient.end();
});
const shot = (name: string) => `e2e/screenshots/prompt07/${name}.png`;

async function loginDemo(page: Page, locale: "ar" | "en" = "ar") {
  await page.goto(`/${locale}/login`);
  await page.getByTestId("auth-email").fill("demo@tahseel.test");
  await page.getByTestId("auth-password").fill("demo-password-123");
  await page.getByTestId("auth-submit").click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/dashboard`));
}

async function signupAndOnboard(page: Page, business: string) {
  const email = `e2e-p07-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
  await page.goto("/ar/signup");
  await page.getByTestId("auth-name").fill("مستخدم تحقق");
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

async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function dbOne(sql: string): Promise<string> {
  const rows = await sqlClient.unsafe(sql);
  if (!rows || rows.length === 0) return "";
  const values = Object.values(rows[0] as Record<string, unknown>);
  return String(values[0] ?? "");
}

async function dbExec(sql: string): Promise<void> {
  await sqlClient.unsafe(sql);
}

test("P07 route tour (AR desktop 1440): every key screen renders + screenshots", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginDemo(page);
  // No seed-total assertion here: the M3 spec pays INV-2026-001 and
  // disputes INV-2026-002 earlier in the run, so the demo tenant's
  // outstanding is 0.00 by the time this spec runs — the tour checks that
  // every screen renders, not the seed totals (M0 already pins those,
  // running first).
  await expect(page.getByTestId("kpi-outstanding")).toBeVisible();
  await page.screenshot({ path: shot("01-dashboard-ar-1440") });

  const routes: { nav: string; url: RegExp; shot: string; marker: string }[] = [
    { nav: "nav-debtors", url: /\/ar\/debtors/, shot: "02-debtors-ar-1440", marker: '[data-testid="debtor-name"]' },
    { nav: "nav-invoices", url: /\/ar\/invoices/, shot: "03-invoices-ar-1440", marker: '[data-testid="inv-amount"]' },
    { nav: "nav-tasks", url: /\/ar\/tasks/, shot: "04-tasks-ar-1440", marker: "h1" },
    { nav: "nav-cheques", url: /\/ar\/cheques/, shot: "05-cheques-ar-1440", marker: '[data-testid="cheque-number"]' },
    { nav: "nav-ai-inbox", url: /\/ar\/ai-inbox/, shot: "06-ai-inbox-ar-1440", marker: "h1, h2" },
    { nav: "nav-import", url: /\/ar\/import/, shot: "07-import-ar-1440", marker: '[data-testid="import-file"]' },
    { nav: "nav-ledger-photo", url: /\/ar\/ledger-photo/, shot: "08-ledger-photo-ar-1440", marker: '[data-testid="ledger-file"]' },
    { nav: "nav-billing", url: /\/ar\/billing/, shot: "09-billing-ar-1440", marker: "h1" },
    { nav: "nav-settings", url: /\/ar\/settings/, shot: "10-settings-ar-1440", marker: '[data-testid="business-name-ar"]' },
  ];
  for (const r of routes) {
    await clickNav(page, r.nav);
    await expect(page).toHaveURL(r.url);
    await expect(page.locator(r.marker).first()).toBeVisible();
    await expectNoOverflow(page);
    await page.screenshot({ path: shot(r.shot) });
  }
});

test("P07 viewports: dashboard + invoices have no horizontal overflow at all five sizes", async ({ page }) => {
  await loginDemo(page);
  const sizes = [
    { width: 1440, height: 900 },
    { width: 1366, height: 768 },
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
    { width: 390, height: 844 },
  ];
  for (const size of sizes) {
    await page.setViewportSize(size);
    await page.goto("/ar/dashboard");
    await expect(page.getByTestId("kpi-outstanding")).toBeVisible();
    await expectNoOverflow(page);
    await page.goto("/ar/invoices");
    await expect(page.getByTestId("inv-amount")).toBeVisible();
    await expectNoOverflow(page);
    await page.screenshot({ path: shot(`viewport-${size.width}x${size.height}-invoices`) });
  }
});

test("P07 English LTR: dir=ltr, dashboard + invoices render in English", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginDemo(page, "en");
  expect(await page.evaluate(() => document.documentElement.dir)).toBe("ltr");
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("en");
  await expect(page.getByTestId("kpi-outstanding")).toBeVisible();
  await page.screenshot({ path: shot("11-dashboard-en-1440") });
  await clickNav(page, "nav-invoices");
  await expect(page).toHaveURL(/\/en\/invoices/);
  await expectNoOverflow(page);
  await page.screenshot({ path: shot("12-invoices-en-1440") });
});

test("P07 UI journey verified in the DB: partial payment updates the invoice row", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signupAndOnboard(page, "محل تحقق م٧");
  const phone = `010${String(Math.floor(10000000 + Math.random() * 89999999))}`;
  const ref = `P07-${Date.now().toString().slice(-6)}`;

  await clickNav(page, "nav-debtors");
  await page.getByTestId("debtor-name").fill("عميل التحقق");
  await page.getByTestId("debtor-phone").fill(phone);
  await page.getByTestId("debtor-create").click();
  await expect(page.getByTestId("debtor-row")).toHaveCount(1);

  await clickNav(page, "nav-invoices");
  await page.getByTestId("inv-amount").fill("1000");
  await page.getByTestId("inv-reference").fill(ref);
  await page.getByTestId("inv-due").fill("2026-11-20");
  await page.getByTestId("inv-create").click();
  await expect(page.getByTestId("invoice-row")).toHaveCount(1);

  await clickNav(page, "nav-debtors");
  await page.getByTestId("debtor-view").click();
  await page.getByTestId("pay-amount").fill("400");
  await page.locator('[data-testid^="pay-alloc-"]').fill("400");
  await page.getByTestId("pay-submit").click();
  await expect(page.getByTestId("pay-msg")).toHaveText("تم تسجيل الدفعة");
  await expect(page.getByTestId("debtor-outstanding")).toContainText("600.00");
  await page.screenshot({ path: shot("13-debtor-partial-ar-1440") });

  // The toast is not proof: the invoice row itself must say so.
  const row = await dbOne(`SELECT status || '|' || paid_minor::text FROM invoices WHERE reference='${ref}'`);
  expect(row).toBe("partially_paid|40000");
  const payment = await dbOne(`SELECT count(*) FROM payments p JOIN debtors d ON d.id = p.debtor_id WHERE d.phone_e164 = '+20${phone.slice(1)}' AND p.status='confirmed'`);
  expect(payment).toBe("1");
});

test("P07 F-20: billing badge is centred on its card in RTL", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginDemo(page);
  await clickNav(page, "nav-billing");
  await expect(page).toHaveURL(/\/ar\/billing/);
  const badge = page.locator('[class*="-top-3.5"]').first();
  await expect(badge).toBeVisible();
  const { delta } = await badge.evaluate((el) => {
    const b = el.getBoundingClientRect();
    const parent = el.parentElement!.getBoundingClientRect();
    const badgeCx = b.left + b.width / 2;
    const cardCx = parent.left + parent.width / 2;
    return { delta: Math.abs(badgeCx - cardCx) };
  });
  expect(delta).toBeLessThanOrEqual(2);
  await page.screenshot({ path: shot("14-billing-badge-ar-1440") });
});

test("P07 F-20: forecast chart keeps time left→right in AR and EN", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signupAndOnboard(page, "محل التوقع");
  const phone = `010${String(Math.floor(10000000 + Math.random() * 89999999))}`;
  await clickNav(page, "nav-debtors");
  await page.getByTestId("debtor-name").fill("عميل التوقع");
  await page.getByTestId("debtor-phone").fill(phone);
  await page.getByTestId("debtor-create").click();
  await expect(page.getByTestId("debtor-row")).toHaveCount(1);

  // Seed 10 paid invoices (SQL, test-only): the forecast needs ≥10 paid
  // invoices with confirmed allocations; the UI would need 20 form
  // submissions for the same rows. The rows are exactly what recordPayment
  // + clear would write: paid invoice + confirmed payment + allocation.
  const ids = await dbOne(`SELECT tenant_id::text || '|' || id::text FROM debtors WHERE phone_e164 = '+20${phone.slice(1)}'`);
  const [tenantId, debtorId] = ids.split("|");
  const inserts: string[] = [];
  for (let i = 0; i < 10; i++) {
    // Due dates spread over the past 8 weeks (computed, not hand-rolled:
    // September has 30 days, so 6 + i*4 overflows the month past i=6).
    const due = new Date(Date.UTC(2026, 8, 6 + i * 4)).toISOString().slice(0, 10);
    // Random ids: fixed ids collide on a Playwright retry (the first
    // attempt's rows survive — retries run against the same DB).
    const inv = randomUUID();
    const pay = randomUUID();
    const alc = randomUUID();
    inserts.push(
      `INSERT INTO invoices (id, tenant_id, debtor_id, reference, amount_minor, paid_minor, currency, issued_on, due_on, status, source) VALUES ('${inv}', '${tenantId}', '${debtorId}', 'P07-FC-${i}', 100000, 100000, 'EGP', '2026-09-01', '${due}', 'paid', 'manual');`,
      `INSERT INTO payments (id, tenant_id, debtor_id, amount_minor, currency, method, received_on, status, source) VALUES ('${pay}', '${tenantId}', '${debtorId}', 100000, 'EGP', 'cash', '${due}', 'confirmed', 'manual');`,
      `INSERT INTO payment_allocations (id, tenant_id, payment_id, invoice_id, amount_minor) VALUES ('${alc}', '${tenantId}', '${pay}', '${inv}', 100000);`,
    );
  }
  // One OPEN invoice, so the chart has a non-zero week to draw (10 paid
  // invoices alone train the lateness stats but leave every week at 0).
  inserts.push(
    `INSERT INTO invoices (id, tenant_id, debtor_id, reference, amount_minor, paid_minor, currency, issued_on, due_on, status, source) VALUES ('${randomUUID()}', '${tenantId}', '${debtorId}', 'P07-FC-OPEN', 50000, 0, 'EGP', '2026-11-01', '2026-11-27', 'open', 'manual');`,
  );
  await dbExec(inserts.join(" "));

  await page.goto("/ar/dashboard");
  const svg = page.locator('svg[aria-label*="توقع"]');
  await expect(svg).toBeVisible();
  // Y-axis labels sit at x=28; week labels start at x=40, so >= 40 keeps
  // only the week labels, in document order.
  const xsAr = await svg.locator("text").evaluateAll((els) => els.map((el) => Number(el.getAttribute("x"))).filter((x) => x >= 40));
  expect(xsAr.length).toBeGreaterThanOrEqual(2);
  expect(xsAr[0]).toBeLessThan(xsAr[xsAr.length - 1]!);
  await page.screenshot({ path: shot("15-forecast-ar-1440") });

  await page.goto("/en/dashboard");
  const svgEn = page.locator('svg[aria-label*="cash flow projection"]');
  await expect(svgEn).toBeVisible();
  const xsEn = await svgEn.locator("text").evaluateAll((els) => els.map((el) => Number(el.getAttribute("x"))).filter((x) => x >= 40));
  expect(xsEn[0]).toBeLessThan(xsEn[xsEn.length - 1]!);
  await page.screenshot({ path: shot("16-forecast-en-1440") });
});

test("P07 portal: statement page renders logged-out (mobile + desktop)", async ({ page, browser }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // Fresh tenant, not the demo one: the demo tenant's first debtor has
  // 0.00 outstanding by the time this spec runs (M3 pays/disputes its
  // seed invoices), and a portal for a zero-balance debtor proves nothing.
  await signupAndOnboard(page, "محل البوابة");
  const phone = `010${String(Math.floor(10000000 + Math.random() * 89999999))}`;
  await clickNav(page, "nav-debtors");
  await page.getByTestId("debtor-name").fill("عميل البوابة");
  await page.getByTestId("debtor-phone").fill(phone);
  await page.getByTestId("debtor-create").click();
  await expect(page.getByTestId("debtor-row")).toHaveCount(1);
  await clickNav(page, "nav-invoices");
  await page.getByTestId("inv-amount").fill("1000");
  await page.getByTestId("inv-reference").fill(`P07-PORTAL-${Date.now().toString().slice(-6)}`);
  await page.getByTestId("inv-due").fill("2026-11-20");
  await page.getByTestId("inv-create").click();
  await expect(page.getByTestId("invoice-row")).toHaveCount(1);
  await clickNav(page, "nav-debtors");
  await page.getByTestId("debtor-view").click();
  // The portal shows THIS debtor's outstanding — read it off the detail
  // page instead of assuming a value.
  const outstanding = (await page.getByTestId("debtor-outstanding").textContent())!.trim();
  await page.getByTestId("stmt-create").click();
  // Read the URL <p> inside the box: the box also holds a success-message
  // <p> and a copy button, whose text corrupts the token if included.
  const url = await page.locator('[data-testid="stmt-new-url"] p[dir="ltr"]').textContent();
  expect(url).toMatch(/\/s\//);
  const token = url!.trim().split("/s/")[1]!;

  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mob = await ctx.newPage();
  await mob.goto(`/s/${token}`);
  await expect(mob.locator("body")).toContainText(outstanding);
  await mob.screenshot({ path: shot("17-portal-ar-390") });
  await ctx.close();

  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const desk = await ctx2.newPage();
  await desk.goto(`/s/${token}`);
  await expect(desk.locator("body")).toContainText(outstanding);
  await desk.screenshot({ path: shot("18-portal-ar-1440") });
  await ctx2.close();
});
