import { chromium } from "@playwright/test";

const base = "http://localhost:3000";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "ar-EG" });
page.on("console", (m) => console.log(`[${m.type()}]`, m.text()));
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("response", (r) => { if (r.url().includes("/api/")) console.log("[api]", r.status(), r.url()); });
page.on("requestfailed", (r) => console.log("[reqfail]", r.url(), r.failure()?.errorText));

await page.goto(`${base}/ar/login`, { waitUntil: "domcontentloaded" });
await page.getByTestId("auth-email").fill("demo@tahseel.test");
await page.getByTestId("auth-password").fill("demo-password-123");
await page.getByTestId("auth-submit").click();
await page.waitForTimeout(6000);
console.log("URL:", page.url());
console.log("BODY:", (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 400));
await browser.close();
