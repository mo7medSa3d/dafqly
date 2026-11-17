import type { Page } from "@playwright/test";

export async function clickNav(page: Page, testId: string) {
  const isMobile = (page.viewportSize()?.width ?? 0) < 1024;
  if (isMobile) {
    const toggle = page.getByTestId("mobile-menu-toggle");
    await toggle.waitFor({ state: "visible", timeout: 15000 });
    await toggle.click();
    await page.getByTestId(testId).waitFor({ state: "visible", timeout: 10000 });
  }
  await page.getByTestId(testId).click();
}
