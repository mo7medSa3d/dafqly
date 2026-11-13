import { test, expect } from "@playwright/test";
import { clickNav } from "./helpers";

async function signupAndOnboard(page: import("@playwright/test").Page, business: string) {
  const email = `e2e-ai-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
  await page.goto("/ar/signup");
  await page.getByTestId("auth-name").fill("مدير التحصيل");
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

test("Notifications Bell, Dashboard AI Briefing, Debtors Health & AI Copilot Drawer", async ({ page }) => {
  await signupAndOnboard(page, "شركة التميز الذكية");

  // 1. Create an overdue customer and overdue invoice (> 14 days overdue)
  await clickNav(page, "nav-debtors");
  await expect(page).toHaveURL(/\/ar\/debtors/);
  await page.getByTestId("debtor-name").fill("شركة الساحل للمقاولات");
  await page.getByTestId("debtor-phone").fill("01099887766");
  await page.getByTestId("debtor-create").click();
  await expect(page.getByTestId("debtor-row")).toHaveCount(1);

  await clickNav(page, "nav-invoices");
  await expect(page).toHaveURL(/\/ar\/invoices/);
  await page.getByTestId("inv-amount").fill("8500");
  await page.getByTestId("inv-reference").fill("INV-AI-900");
  await page.getByTestId("inv-due").fill("2025-10-01");
  await page.getByTestId("inv-create").click();
  await expect(page.getByTestId("invoice-row")).toHaveCount(1);

  // 2. Dashboard: verify AI Executive Briefing & Top Suggested Follow-ups
  await clickNav(page, "nav-dashboard");
  await expect(page).toHaveURL(/\/ar\/dashboard/);
  const briefing = page.getByTestId("dashboard-ai-briefing");
  await expect(briefing).toBeVisible();
  await expect(briefing).toContainText("شركة الساحل للمقاولات");

  // 3. Notification Bell: trigger sync + open popover + mark all read
  const bellBtn = page.getByTestId("notification-bell-btn");
  await expect(bellBtn).toBeVisible();
  await bellBtn.click();
  const popover = page.getByTestId("notification-popover");
  await expect(popover).toBeVisible();
  await page.getByRole("button", { name: "تحديث" }).click();
  await expect(popover).toContainText("شركة الساحل للمقاولات", { timeout: 10000 });
  await page.keyboard.press("Escape");
  await expect(popover).toBeHidden();

  // 4. AI Copilot Drawer: Briefing -> Smart Draft -> Ask AI
  // Prompt 07: the trigger button only opens the AI menu — the drawer
  // opens from a menu item (ai-menu-briefing-btn), not from the trigger.
  await page.getByTestId("ai-copilot-trigger-btn").click();
  await page.getByTestId("ai-menu-briefing-btn").click();
  const drawer = page.getByTestId("ai-copilot-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer).toContainText("شركة الساحل للمقاولات");

  await drawer.getByRole("button", { name: "صياغة رسالة" }).click();
  await drawer.getByRole("button", { name: /صياغة الرسالة بالذكاء الاصطناعي/ }).click();
  await expect(drawer.locator("textarea")).toContainText("شركة الساحل للمقاولات", { timeout: 10000 });

  await drawer.getByRole("button", { name: "اسأل المساعد" }).click();
  await page.getByTestId("copilot-question-input").fill("من هم أهم العملاء المتأخرين؟");
  await page.getByTestId("copilot-question-input").press("Enter");
  await expect(drawer).toContainText("شركة الساحل للمقاولات", { timeout: 45000 });
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();

  // 5. Debtors page AI Priority filter & Debtor Detail Health pill + Smart Draft button
  await clickNav(page, "nav-debtors");
  await expect(page).toHaveURL(/\/ar\/debtors/);
  await page.getByTestId("filter-ai-priority").click();
  await expect(page.getByTestId("debtor-row")).toHaveCount(1);

  await page.getByTestId("debtor-row").first().getByRole("link").first().click();
  await expect(page.getByTestId("debtor-health-pill")).toBeVisible();
  await page.getByTestId("debtor-ai-draft-btn").click();
  await expect(page.getByTestId("ai-copilot-drawer")).toBeVisible();
});
