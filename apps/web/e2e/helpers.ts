import { expect, type Page } from "@playwright/test";

export function isoDate(daysFromNow = 0): string {
  return new Date(Date.now() + daysFromNow * 86_400_000).toISOString().slice(0, 10);
}

export async function clickNav(page: Page, testId: string) {
  // The AppShell mounts after the [locale]/loading.tsx shell: the URL
  // already matches while the shell is showing, so wait for the shell to
  // be replaced before deciding anything. isVisible() does not wait — an
  // immediate check during the shell phase misses the toggle, the mobile
  // menu never opens, and the nav click then times out on the off-canvas
  // sidebar ("element is outside of the viewport"). The toggle is always
  // in the DOM (lg:hidden on desktop), so `attached` is the right signal
  // on both viewports.
  const toggle = page.getByTestId("mobile-menu-toggle");
  await toggle.waitFor({ state: "attached", timeout: 10_000 });
  const target = page.getByTestId(testId);
  if (await toggle.isVisible()) {
    // SSR renders the button before React attaches its handler; a click in
    // that window is a no-op, so keep clicking until the drawer really opens.
    for (let i = 0; i < 5 && (await toggle.getAttribute("aria-expanded")) !== "true"; i++) {
      await toggle.click();
      await page.waitForTimeout(200);
    }
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await target.waitFor({ state: "visible", timeout: 5_000 });
  }
  await target.click();
}
