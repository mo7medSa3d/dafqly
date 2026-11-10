import type { Page } from "@playwright/test";

export async function clickNav(page: Page, testId: string) {
  const toggle = page.getByTestId("mobile-menu-toggle");
  if (await toggle.isVisible()) {
    await toggle.click();
    await page.waitForTimeout(100);
  }
  await page.getByTestId(testId).click();
}
