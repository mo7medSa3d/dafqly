// Exploratory spec — final verification pass (2026-11-14).
// Walks every screen as the RICH tenant (rich@tahseel.test, a separate
// tenant seeded by `pnpm db:seed:rich` — the demo tenant is never touched,
// so the m0/m3 demo-total assertions keep passing). Read-only checks run
// first; mutation checks (payment, invoice, cheque, task, promise,
// statement promise/dispute) run last, each against a different debtor
// where it matters so earlier assertions stay valid.
// Run: CI=1 pnpm test:e2e (full suite) or: pnpm --filter @tahseel/web exec playwright test e2e/exploratory.spec.ts
import { test, expect, type Browser, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const RICH_EMAIL = "rich@tahseel.test";
const RICH_PASSWORD = process.env.DEMO_PASSWORD ?? "demo-password-123";
const RICH_TOKEN = "rich-statement-demo-2026";
const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const iso = (daysFromNow: number) => new Date(Date.now() + daysFromNow * 86_400_000).toISOString().slice(0, 10);

test.beforeAll(() => {
  // RESET + an explicit password so the seed and the login below always
  // agree and the dataset is pristine on every run (this spec mutates it:
  // payment, invoice, cheque, task, promise, statement promise/dispute).
  execSync("pnpm db:seed:rich", {
    cwd: REPO_ROOT,
    stdio: "pipe",
    env: { ...process.env, RESET_RICH_SEED: "1", DEMO_PASSWORD: RICH_PASSWORD },
  });
});

async function richLogin(page: Page, locale = "ar") {
  await page.goto(`/${locale}/login`);
  await page.getByTestId("auth-email").fill(RICH_EMAIL);
  await page.getByTestId("auth-password").fill(RICH_PASSWORD);
  await page.getByTestId("auth-submit").click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/dashboard`));
}

async function desktopPage(browser: Browser, locale = "ar") {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: locale === "ar" ? "ar-EG" : "en-US",
  });
  const page = await ctx.newPage();
  return { ctx, page };
}

test("rich dashboard (ar, desktop): KPIs, aging, forecast, funnel full series", async ({ browser }) => {
  const { ctx, page } = await desktopPage(browser, "ar");
  try {
    await richLogin(page, "ar");
    // Hand-computed from the rich seed (EGP, tenant currency only):
    // outstanding 15,988,000 / overdue 9,398,000 / collected Nov 3,465,000
    // / refunded Nov 350,000 / 12 debtors.
    await expect(page.getByTestId("kpi-outstanding")).toContainText("159,880.00");
    await expect(page.getByTestId("kpi-overdue")).toContainText("93,980.00");
    await expect(page.getByTestId("kpi-collected")).toContainText("34,650.00");
    await expect(page.getByTestId("kpi-refunded")).toContainText("3,500.00");
    await expect(page.getByTestId("kpi-debtors")).toContainText("12");
    // Multi-currency lines: KWD + JPY invoices are separate, never summed.
    await expect(page.getByTestId("kpi-other-currencies")).toContainText("KWD");
    await expect(page.getByTestId("kpi-other-currencies")).toContainText("JPY");
    // Reminder funnel, full series (ar-EG renders Eastern Arabic digits).
    await expect(page.getByTestId("perf-sent")).toContainText(/12|١٢/);
    await expect(page.getByTestId("perf-delivered")).toContainText(/7|٧/);
    await expect(page.getByTestId("perf-replied")).toContainText(/5|٥/);
    await expect(page.getByTestId("perf-paid")).toContainText(/4|٤/);
    // Forecast needs ≥10 paid invoices (F12); the rich tenant has 6, so
    // the dashboard shows the not-enough-data state. The chart branch
    // itself is proven live: with 4 extra paid invoices the dashboard
    // renders the ForecastChart (aria-label + weekly-values button).
    await expect(page.getByTestId("forecast-not-enough")).toBeVisible();
    await expect(page.getByTestId("forecast-not-enough")).toContainText(/١٠ فواتير مسددة|10 settled invoices/);
    // Aging bar: every bucket label renders (all buckets non-empty).
    for (const bucket of ["0-7", "8-30", "31-60", "60+"]) {
      await expect(page.getByText(bucket).first()).toBeVisible();
    }
    await page.screenshot({ path: "e2e/screenshots/exploratory-dashboard-rich-ar-desktop.png" });
  } finally {
    await ctx.close();
  }
});

test("rich dashboard (en, mobile): LTR layout, same KPIs", async ({ page }) => {
  await richLogin(page, "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByTestId("kpi-outstanding")).toContainText("159,880.00");
  await expect(page.getByTestId("perf-sent")).toContainText("12");
  await expect(page.getByTestId("perf-paid")).toContainText("4");
  await page.screenshot({ path: "e2e/screenshots/exploratory-dashboard-rich-en-mobile.png" });
});

test("debtors list: search + detail read-only", async ({ browser }) => {
  const { ctx, page } = await desktopPage(browser, "ar");
  try {
    await richLogin(page, "ar");
    await page.goto("/ar/debtors");
    await expect(page.getByTestId("debtor-row")).toHaveCount(12);
    await page.getByTestId("debtor-search").fill("الأفق");
    await expect(page.getByTestId("debtor-row")).toHaveCount(1);
    // Rows are not links — navigation is the التفاصيل (debtor-view) link.
    await page.getByTestId("debtor-view").first().click();
    await expect(page).toHaveURL(/\/ar\/debtors\/[0-9a-f-]+/);
    // الأفق: INV 001 (850,000) + INV 002 (450,000) open = 13,000.00.
    await expect(page.getByTestId("debtor-outstanding")).toContainText("13,000.00");
    await expect(page.getByTestId("detail-invoice")).toHaveCount(3);
  } finally {
    await ctx.close();
  }
});

test("debtors: record payment — invalid rejected, valid recorded (d2)", async ({ browser }) => {
  const { ctx, page } = await desktopPage(browser, "ar");
  try {
    await richLogin(page, "ar");
    await page.goto("/ar/debtors");
    await page.getByTestId("debtor-search").fill("النخبة");
    await page.getByTestId("debtor-view").first().click();
    await expect(page).toHaveURL(/\/ar\/debtors\/[0-9a-f-]+/);
    // The payment list is server-rendered, but count() does not wait for
    // the navigation: capture the baseline only once the list is present
    // (d2 already has one confirmed payment — a count taken on the list
    // page reads 0 and the test then "gains" a row after any submit).
    await expect(page.getByTestId("payment-row").first()).toBeVisible();
    const rowsBefore = await page.getByTestId("payment-row").count();
    // Full-balance prefill is exponent-aware (EGP here): 320k + 350k + 980k.
    await page.getByRole("button", { name: /كامل المستحق|Full Balance/ }).click();
    await expect(page.getByTestId("pay-amount")).toHaveValue("16,500.00");
    // Invalid amount → server rejects, failure message shows, no payment.
    await page.getByTestId("pay-amount").fill("abc");
    await page.getByTestId("pay-submit").click();
    await expect(page.getByTestId("pay-msg")).toBeVisible();
    await expect(page.getByTestId("payment-row")).toHaveCount(rowsBefore);
    // Valid partial payment.
    await page.getByTestId("pay-amount").fill("100.00");
    await page.getByTestId("pay-submit").click();
    await expect(page.getByTestId("pay-msg")).toBeVisible();
    await expect(page.getByTestId("payment-row")).toHaveCount(rowsBefore + 1);
  } finally {
    await ctx.close();
  }
});

test("invoices: search, filters, create invalid then valid", async ({ browser }) => {
  const { ctx, page } = await desktopPage(browser, "ar");
  try {
    await richLogin(page, "ar");
    await page.goto("/ar/invoices");
    await page.getByTestId("inv-search").fill("RICH-2026-007");
    await expect(page.getByTestId("invoice-row")).toHaveCount(1);
    await page.getByTestId("inv-search").fill("");
    await page.getByTestId("inv-status-filter").selectOption("paid");
    await expect(page.getByTestId("invoice-row")).toHaveCount(6);
    await page.getByTestId("inv-status-filter").selectOption("");
    await page.getByTestId("inv-overdue-filter").check();
    // 13, not 12: the 12 overdue EGP invoices + the KWD invoice 022
    // (due -6, open) — the filter does not exclude other currencies.
    await expect(page.getByTestId("invoice-row")).toHaveCount(13);
    await page.getByTestId("inv-overdue-filter").uncheck();
    // Wait for the unfiltered list to settle (rows render atomically on
    // load: 13 filtered → full list in one render), then capture relative
    // baselines so a retry — which re-runs against the row the first
    // attempt already created — still passes.
    const rowsLocator = page.getByTestId("invoice-row");
    await expect.poll(async () => rowsLocator.count(), { timeout: 10_000 }).toBeGreaterThan(13);
    const rowsBefore = await rowsLocator.count();
    const d3Before = await rowsLocator.filter({ hasText: "شركة السلام للحديد والصلب" }).count();
    // Create: the form is always on the page (no modal) and inv-create IS
    // its submit button — disabled while the amount is empty, so an empty
    // submit is blocked without any click (clicking it hangs waiting for
    // the button to become enabled, until the 90 s test timeout).
    await expect(page.getByTestId("inv-create")).toBeDisabled();
    await expect(page.getByTestId("inv-amount")).toBeVisible();
    // Valid invoice for السلام (d3) — keeps d1/d2 totals used elsewhere.
    await page.getByTestId("inv-debtor").selectOption({ label: "شركة السلام للحديد والصلب" });
    await page.getByTestId("inv-amount").fill("2500.00");
    await page.getByTestId("inv-issued").fill(iso(0));
    await page.getByTestId("inv-due").fill(iso(14));
    // Submit via the button's own testid (shipped pattern in m1 /
    // notifications-ai / prompt07): the form+has locator chain hangs
    // resolving on this page while the list refetches.
    await page.getByTestId("inv-create").click();
    // New invoice for السلام: total +1, d3 rows +1. The server search
    // matches reference/description only — not debtor names — so searching
    // "السلام" correctly returns 0; verify in the full list instead.
    await expect(page.getByTestId("invoice-row")).toHaveCount(rowsBefore + 1);
    await expect(page.getByTestId("invoice-row").filter({ hasText: "شركة السلام للحديد والصلب" })).toHaveCount(d3Before + 1);
  } finally {
    await ctx.close();
  }
});

test("cheques: all six statuses listed, create invalid then valid", async ({ browser }) => {
  const { ctx, page } = await desktopPage(browser, "ar");
  try {
    await richLogin(page, "ar");
    await page.goto("/ar/cheques");
    await expect(page.getByTestId("cheque-row")).toHaveCount(6);
    // Empty submit is blocked by native validation (no new row).
    await page.getByTestId("cheque-submit").click();
    await expect(page.getByTestId("cheque-row")).toHaveCount(6);
    // Valid cheque for النخبة (d2).
    await page.getByTestId("cheque-debtor").selectOption({ label: "مؤسسة النخبة للأغذية" });
    await page.getByTestId("cheque-number").fill("0009999");
    await page.getByTestId("cheque-bank").fill("بنك مصر");
    await page.getByTestId("cheque-amount").fill("500.00");
    await page.getByTestId("cheque-issue").fill(iso(0));
    await page.getByTestId("cheque-due").fill(iso(30));
    await page.getByTestId("cheque-submit").click();
    await expect(page.getByTestId("cheque-row")).toHaveCount(7);
    await expect(page.getByText("0009999").first()).toBeVisible();
  } finally {
    await ctx.close();
  }
});

test("tasks + promises: seeded rows, create task, record promise", async ({ browser }) => {
  const { ctx, page } = await desktopPage(browser, "ar");
  try {
    await richLogin(page, "ar");
    await page.goto("/ar/tasks");
    await expect(page.getByText("تصعيد: عميل متأخر 55 يوماً")).toBeVisible();
    // Create a task for السلام (d3): invalid (empty title) stays disabled.
    await page.getByPlaceholder("مثال: متابعة وعد السداد").fill("");
    await expect(page.getByRole("button", { name: "إضافة إلى قائمة العمل" })).toBeDisabled();
    await page.getByPlaceholder("مثال: متابعة وعد السداد").fill("متابعة هاتفية — اختبار استكشافي");
    await page.locator("select").first().selectOption({ label: "شركة السلام للحديد والصلب" });
    await page.getByRole("button", { name: "إضافة إلى قائمة العمل" }).click();
    await expect(page.getByText("متابعة هاتفية — اختبار استكشافي")).toBeVisible();
    // Start it, then complete it — it leaves the active list.
    const taskRow = page.locator("article", { hasText: "متابعة هاتفية — اختبار استكشافي" });
    await taskRow.getByRole("button", { name: "بدء" }).click();
    await taskRow.getByRole("button", { name: "إتمام" }).click();
    await expect(page.getByText("متابعة هاتفية — اختبار استكشافي")).toHaveCount(0);
    // Promises tab: seeded register (broken 10,000.00) + record a new one.
    await page.getByRole("button", { name: "وعود السداد" }).click();
    await expect(page.getByText("10,000.00").first()).toBeVisible();
    await page.getByPlaceholder("1250.00").fill("abc");
    await expect(page.getByRole("button", { name: "تسجيل التعهد" })).toBeDisabled();
    await page.locator("select").first().selectOption({ label: "شركة السلام للحديد والصلب" });
    await page.getByPlaceholder("1250.00").fill("750.00");
    await page.locator("input[type='date']").fill(iso(7));
    await page.getByRole("button", { name: "تسجيل التعهد" }).click();
    await expect(page.getByText("750.00").first()).toBeVisible();
  } finally {
    await ctx.close();
  }
});

test("ai-inbox: seeded intents + receipt upload form", async ({ browser }) => {
  const { ctx, page } = await desktopPage(browser, "ar");
  try {
    await richLogin(page, "ar");
    await page.goto("/ar/ai-inbox");
    // listIntents defaults to onlyHuman: true — the review queue shows
    // only the human-routed dispute intent. The two auto intents (promise,
    // opt-out) are in the DB but are not a human's queue by design.
    await expect(page.locator("li[data-testid^='intent-']")).toHaveCount(1);
    await expect(page.getByText("المبلغ غير صحيح، تم الاتفاق على خصم")).toBeVisible();
    await expect(page.getByTestId("receipt-file")).toBeVisible();
    await expect(page.getByTestId("receipt-debtor")).toBeVisible();
  } finally {
    await ctx.close();
  }
});

test("import + ledger-photo screens render", async ({ browser }) => {
  const { ctx, page } = await desktopPage(browser, "ar");
  try {
    await richLogin(page, "ar");
    await page.goto("/ar/import");
    const download = page.waitForEvent("download");
    await page.getByTestId("import-sample-download").click();
    expect((await download).suggestedFilename()).toBeTruthy();
    await page.goto("/ar/ledger-photo");
    await expect(page.getByTestId("ledger-file")).toBeVisible();
    // No job yet: ledger-empty only renders after an upload returns zero
    // rows, so the fresh page shows the upload prompt instead.
    await expect(page.getByText("رفع صور المستندات أو دفاتر الحسابات")).toBeVisible();
  } finally {
    await ctx.close();
  }
});

test("billing, settings, platform ai-budget render; settings save", async ({ browser }) => {
  const { ctx, page } = await desktopPage(browser, "ar");
  try {
    await richLogin(page, "ar");
    await page.goto("/ar/billing");
    await expect(page.locator("h1").first()).toBeVisible();
    await page.goto("/ar/settings");
    await expect(page.getByTestId("business-name-ar")).toHaveValue("شركة الدلتا للتجارة والمقاولات");
    await page.getByTestId("settings-submit").click();
    await expect(page.getByText("تم حفظ جميع التغييرات بنجاح!")).toBeVisible();
    // The rich user is a tenant user, not a platform admin: the ai-budget
    // page calls notFound() (PLATFORM_ADMIN_USER_IDS guard). That 404 is
    // the access control working, not a missing page.
    await page.goto("/ar/platform/ai-budget");
    await expect(page.getByText("الصفحة غير موجودة")).toBeVisible();
  } finally {
    await ctx.close();
  }
});

test("shell: palette, copilot, bell, theme + locale toggles", async ({ browser }) => {
  const { ctx, page } = await desktopPage(browser, "ar");
  try {
    await richLogin(page, "ar");
    // Command palette (Ctrl+K).
    await page.keyboard.press("Control+k");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByPlaceholder(/ابحث|Search/).fill("الأفق");
    await expect(page.getByRole("dialog").getByText("الأفق").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // AI copilot drawer (fake LLM in e2e). The trigger opens the assistant
    // menu; the drawer opens from the menu's assistant button.
    await page.getByTestId("ai-copilot-trigger-btn").click();
    await expect(page.getByTestId("ai-assistant-menu")).toBeVisible();
    await page.getByTestId("ai-menu-assistant-btn").click();
    await expect(page.getByTestId("ai-copilot-drawer")).toBeVisible();
    // The Ask tab submits with Enter (shipped pattern in
    // notifications-ai.spec.ts); copilot-generate-btn belongs to the
    // message-composer tab and is hidden here — clicking it hangs waiting
    // for visibility until the test timeout.
    await page.getByTestId("copilot-question-input").fill("ما هو إجمالي المستحق؟");
    await page.getByTestId("copilot-question-input").press("Enter");
    await expect(page.getByTestId("ai-copilot-drawer")).toContainText(/ج\.م|EGP|[0-9]/, { timeout: 30_000 });
    // Close the drawer before the header toggles (shipped pattern).
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("ai-copilot-drawer")).toBeHidden();
    // Notification bell.
    await page.getByTestId("notification-bell-btn").click();
    await expect(page.getByTestId("notification-popover")).toBeVisible();
    // Theme toggle flips html[data-theme].
    const themeBefore = await page.locator("html").getAttribute("data-theme");
    await page.getByTestId("theme-toggle").click();
    const themeAfter = await page.locator("html").getAttribute("data-theme");
    expect(themeAfter).not.toBe(themeBefore);
    // Locale toggle navigates to English.
    await page.getByTestId("locale-toggle").click();
    await expect(page).toHaveURL(/\/en\/dashboard/);
  } finally {
    await ctx.close();
  }
});

test("public statement: renders, promise invalid then valid, dispute", async ({ browser }) => {
  const { ctx, page } = await desktopPage(browser, "ar");
  try {
    await page.goto(`/s/${RICH_TOKEN}`);
    await expect(page.getByTestId("statement-page")).toBeVisible();
    // d1 (الأفق): INV 001 + INV 002 open = 13,000.00.
    await expect(page.getByTestId("statement-total")).toContainText("13,000.00");
    await expect(page.getByTestId("statement-invoice")).toHaveCount(3);
    // Promise: invalid amount → error message; valid → success message.
    await page.locator("form:has(input[placeholder='1500.00']) input[type='date']").fill(iso(5));
    await page.getByPlaceholder("1500.00").fill("abc");
    await page.locator("form:has(input[placeholder='1500.00']) button[type='submit']").click();
    await expect(page.getByTestId("statement-msg")).toBeVisible();
    await page.getByPlaceholder("1500.00").fill("500.00");
    await page.locator("form:has(input[placeholder='1500.00']) button[type='submit']").click();
    await expect(page.getByTestId("statement-msg")).toBeVisible();
    // Dispute: empty reason keeps submit disabled; filled reason succeeds.
    await page.locator("[data-testid^='statement-dispute-']").first().click();
    await expect(page.locator("[data-testid^='dispute-submit-']").first()).toBeDisabled();
    await page.locator("[data-testid^='dispute-reason-']").first().fill("المبلغ غير صحيح حسب الاتفاق");
    await page.locator("[data-testid^='dispute-submit-']").first().click();
    await expect(page.getByTestId("statement-msg")).toBeVisible();
  } finally {
    await ctx.close();
  }
});

test("landing, signup validation, 404", async ({ browser }) => {
  const { ctx, page } = await desktopPage(browser, "ar");
  try {
    await page.goto("/ar");
    await expect(page.getByTestId("landing-cta-login")).toBeVisible();
    await page.getByTestId("landing-cta-login").click();
    await expect(page).toHaveURL(/\/ar\/login/);
    // Signup: empty submit stays (native validation); bad email stays.
    await page.goto("/ar/signup");
    await page.getByTestId("auth-submit").click();
    await expect(page).toHaveURL(/\/ar\/signup/);
    await page.getByTestId("auth-name").fill("مستخدم تجريبي");
    await page.getByTestId("auth-email").fill("not-an-email");
    await page.getByTestId("auth-password").fill("e2e-password-123");
    await page.getByTestId("auth-submit").click();
    await expect(page).toHaveURL(/\/ar\/signup/);
    // 404: the panel shows the translated title, not a literal "404".
    await page.goto("/ar/no-such-page-xyz");
    await expect(page.getByText("الصفحة غير موجودة")).toBeVisible();
  } finally {
    await ctx.close();
  }
});
