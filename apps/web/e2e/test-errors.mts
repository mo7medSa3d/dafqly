import { chromium } from "@playwright/test";

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: "ar-EG" });
  const page = await context.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      console.log("PAGE CONSOLE ERROR:", msg.text());
    }
  });

  page.on("response", async (res) => {
    if (res.status() >= 400 && res.url().includes("/api/trpc")) {
      console.log(`HTTP ${res.status()} ${res.url()}`);
      try {
        const text = await res.text();
        console.log("RESPONSE BODY:", text);
      } catch (e) {
        console.log("Could not read body:", e);
      }
    }
  });

  // Login
  await page.goto("http://localhost:3000/ar/login");
  await page.getByTestId("auth-email").fill("demo@tahseel.test");
  await page.getByTestId("auth-password").fill("demo-password-123");
  await page.getByTestId("auth-submit").click();
  await page.waitForURL(/\/ar\/dashboard/);

  // 1. Test clicking change plan on Dashboard
  console.log("1. Testing change plan button...");
  const upgradeBtn = page.getByRole("button", { name: /ترقية|Upgrade/i }).first();
  if (await upgradeBtn.isVisible()) {
    console.log("Clicking upgrade button...");
    await upgradeBtn.click();
    await page.waitForTimeout(1000);
  } else {
    console.log("No upgrade button found");
  }

  // 2. Test import preview on /ar/import
  console.log("2. Testing /ar/import upload...");
  await page.goto("http://localhost:3000/ar/import");
  // Try uploading a sample CSV
  const fileInput = page.locator("[data-testid='import-file']");
  await fileInput.setInputFiles({
    name: "test.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("name,phone,amount\nعميل تجريبي,01011111111,500\n"),
  });
  await page.waitForTimeout(1000);

  // 3. Test payments.createLink on debtor detail page
  console.log("3. Testing payments.createLink on debtor detail...");
  await page.goto("http://localhost:3000/ar/debtors");
  const firstDebtor = page.getByTestId("debtor-view").first();
  if (await firstDebtor.isVisible()) {
    await firstDebtor.click();
    await page.waitForTimeout(1000);
    // Look for create payment link button if any
    const payLinkBtn = page.locator("button:has-text('رابط'), button:has-text('سداد')").first();
    if (await payLinkBtn.isVisible()) {
      await payLinkBtn.click();
      await page.waitForTimeout(1000);
    }
  }

  await browser.close();
  console.log("Done checking 500 errors.");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
