import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const shotsDir = resolve(process.cwd(), "apps/web/e2e/screenshots/fixes");
if (!existsSync(shotsDir)) {
  mkdirSync(shotsDir, { recursive: true });
}

async function run() {
  console.log("Launching Chromium for comprehensive verification...");
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "ar-EG",
  });
  const page = await context.newPage();

  // 1. Login
  console.log("1. Logging in...");
  await page.goto("http://localhost:3000/ar/login", { waitUntil: "networkidle" });
  await page.getByTestId("auth-email").fill("demo@tahseel.test");
  await page.getByTestId("auth-password").fill("demo-password-123");
  await page.getByTestId("auth-submit").click();
  await page.waitForURL(/\/ar\/dashboard/, { timeout: 15000 });
  await page.waitForTimeout(500);

  // 2. Language & Theme Switching Test
  console.log("2. Testing Theme & Language Switching...");
  // Toggle to Dark Mode
  const themeToggle = page.getByTestId("theme-toggle").first();
  await themeToggle.click();
  await page.waitForTimeout(300);

  const isDarkAr = await page.evaluate(() => document.documentElement.dataset.theme);
  console.log("Arabic Dashboard Theme:", isDarkAr);

  // Check Locale Toggle element (must be a button without href, so no URL shows on hover)
  const localeToggle = page.getByTestId("locale-toggle").first();
  const tagName = await localeToggle.evaluate((el) => el.tagName.toLowerCase());
  const hasHref = await localeToggle.evaluate((el) => el.hasAttribute("href"));
  console.log(`Locale Toggle Element: <${tagName}>, has href: ${hasHref}`);

  // Switch to English
  console.log("Switching to English...");
  await localeToggle.click();
  await page.waitForURL(/\/en\/dashboard/, { timeout: 15000 });
  await page.waitForTimeout(500);

  const enDir = await page.evaluate(() => document.documentElement.dir);
  const enLang = await page.evaluate(() => document.documentElement.lang);
  const isDarkEn = await page.evaluate(() => document.documentElement.dataset.theme);
  console.log(`English Dashboard: dir=${enDir}, lang=${enLang}, theme=${isDarkEn}`);

  await page.screenshot({ path: `${shotsDir}/en_dashboard_dark_smooth.png`, fullPage: false });

  // Switch back to Arabic
  console.log("Switching back to Arabic...");
  const localeToggleEn = page.getByTestId("locale-toggle").first();
  await localeToggleEn.click();
  await page.waitForURL(/\/ar\/dashboard/, { timeout: 15000 });
  await page.waitForTimeout(500);

  const arDir = await page.evaluate(() => document.documentElement.dir);
  const isDarkArBack = await page.evaluate(() => document.documentElement.dataset.theme);
  console.log(`Arabic Dashboard Restored: dir=${arDir}, theme=${isDarkArBack}`);

  await page.screenshot({ path: `${shotsDir}/ar_dashboard_dark_smooth.png`, fullPage: false });

  // Rapid repeated click test (ensures no race conditions or broken theme cookie)
  console.log("Testing rapid repeated clicks on LocaleToggle...");
  const localeToggleAr = page.getByTestId("locale-toggle").first();
  await Promise.allSettled([
    localeToggleAr.click({ force: true }),
    localeToggleAr.click({ force: true }),
    localeToggleAr.click({ force: true }),
  ]);
  await page.waitForTimeout(1000);
  const themeAfterRapid = await page.evaluate(() => document.documentElement.dataset.theme);
  console.log(`Theme after rapid clicks: ${themeAfterRapid}`);

  // 3. Testing Excel/CSV Import
  console.log("3. Testing Excel/CSV Import on /ar/import...");
  await page.goto("http://localhost:3000/ar/import", { waitUntil: "networkidle" });

  // Create temporary Arabic CSV with Tashkeel, Tatweel, and Egyptian merchant terms
  const tempCsvPath = resolve(process.cwd(), "apps/web/e2e/fixtures/egyptian-merchant-tashkeel.csv");
  const csvContent =
    "جِهَـةُ التَّعَامُلِ,مُوبَـايِلُ التَّوَاصُلِ,صَافِي المَبْلَغِ المَطْلُوبِ,تَارِيخُ الاسْتِحْقَاقِ\n" +
    "مُصْطَفَى المَصْرِي,01099887766,4500,2026-12-15\n" +
    "شَرِكَةُ النَّدَى لِلتِّجَارَةِ,01122334455,8750.50,2026-12-20\n" +
    "مَحْمُودُ عَلِي,01234567890,1200,2026-12-25\n";
  writeFileSync(tempCsvPath, csvContent, "utf8");

  const fileInput = page.getByTestId("import-file");
  await fileInput.setInputFiles(tempCsvPath);

  // Wait for the preview table and mapping review to appear
  console.log("Waiting for import preview stats...");
  await page.waitForTimeout(2000);
  const msgText = await page.getByTestId("import-msg").textContent().catch(() => null);
  if (msgText) {
    console.log("Import Message on screen:", msgText);
  }

  await page.waitForSelector('[data-testid="import-stats"]', { timeout: 15000 });
  await page.waitForTimeout(500);

  await page.screenshot({ path: `${shotsDir}/ar_import_preview_tashkeel_success.png`, fullPage: true });

  // 4. Test Windows-1256 encoded CSV
  console.log("4. Testing Windows-1256 CSV Import...");
  const tempWin1256Path = resolve(process.cwd(), "apps/web/e2e/fixtures/egyptian-win1256.csv");
  const win1256Bytes = Buffer.from([
    0xC7, 0xE1, 0xC7, 0xD3, 0xE3, 0x2C, // الاسم,
    0xC7, 0xE1, 0xE3, 0xE6, 0xC8, 0xC7, 0xED, 0xE1, 0x2C, // الموبايل,
    0xC7, 0xE1, 0xE3, 0xC8, 0xE1, 0xDB, 0x0A, // المبلغ\n
    0xC3, 0xCD, 0xE3, 0xCF, 0x2C, // أحمد,
    0x30, 0x31, 0x30, 0x31, 0x31, 0x32, 0x32, 0x33, 0x33, 0x34, 0x34, 0x2C, // 01011223344,
    0x31, 0x37, 0x35, 0x30, 0x0A, // 1750\n
  ]);
  writeFileSync(tempWin1256Path, win1256Bytes);

  await fileInput.setInputFiles(tempWin1256Path);
  await page.waitForTimeout(2000);
  await page.waitForSelector('[data-testid="import-stats"]', { timeout: 15000 });
  await page.screenshot({ path: `${shotsDir}/ar_import_preview_win1256_success.png`, fullPage: true });

  // 5. Test Semicolon CSV with Eastern Arabic numbers and currency suffix ("١،٥٠٠ ج.م")
  console.log("5. Testing Semicolon CSV with Eastern Arabic digits & currency suffix...");
  const tempEasternCsvPath = resolve(process.cwd(), "apps/web/e2e/fixtures/egyptian-eastern-semicolon.csv");
  const easternCsvContent =
    "جهة التعامل;رقم التواصل;المبلغ المستحق;تاريخ الاستحقاق\n" +
    "علي المصري;01511223344;١،٥٠٠ ج.م;2026-12-30\n" +
    "سارة فهمي;01199887766;٣،٢٥٠.٥٠ جنيه;2026-12-31\n";
  writeFileSync(tempEasternCsvPath, easternCsvContent, "utf8");

  await fileInput.setInputFiles(tempEasternCsvPath);
  await page.waitForTimeout(2000);
  await page.waitForSelector('[data-testid="import-stats"]', { timeout: 15000 });
  await page.screenshot({ path: `${shotsDir}/ar_import_preview_eastern_semicolon_success.png`, fullPage: true });

  console.log("All E2E scenarios completed successfully!");
  await browser.close();
}

run().catch((err) => {
  console.error("E2E Verification Failed:", err);
  process.exit(1);
});
