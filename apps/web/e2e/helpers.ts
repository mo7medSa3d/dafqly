import type { Page } from "@playwright/test";

export async function clickNav(page: Page, testId: string) {
  // The AppShell mounts after the [locale]/loading.tsx shell: the URL
  // already matches while the shell is showing, so wait for the shell to
  // be replaced before deciding anything. isVisible() does not wait — an
  // immediate check during the shell phase misses the toggle, the mobile
  // menu never opens, and the nav click then times out on the off-canvas
  // sidebar ("element is outside of the viewport"). The toggle is always
  // in the DOM (lg:hidden on desktop), so `attached` is the right signal
  // on both viewports.
  await page.getByTestId("mobile-menu-toggle").waitFor({ state: "attached", timeout: 10000 });
  const toggle = page.getByTestId("mobile-menu-toggle");
  if (await toggle.isVisible()) {
    await toggle.click();
    await page.waitForTimeout(100);
  }
  await page.getByTestId(testId).click();
}
