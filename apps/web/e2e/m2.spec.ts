import { test, expect } from "@playwright/test";
import { createHmac } from "node:crypto";

/**
 * M2 F3 over real HTTP: the webhook route's GET handshake, signature gate
 * (bad signature -> 401, nothing stored), and a signed opt-out webhook that
 * lands on the demo debtor — visible in the UI as the opted-out badge and a
 * message event in the timeline. The engine's send lifecycle is covered by
 * the @tahseel/reminders acceptance suites (fake provider + fake clock);
 * the live Meta sandbox send is a manual RUNBOOK step.
 */
const SECRET = "e2e-app-secret-for-tests-only-0123456789";
const sign = (body: string) => `sha256=${createHmac("sha256", SECRET).update(body, "utf8").digest("hex")}`;

function inboundPayload(wamid: string, from: string, body: string) {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: "WABA-E2E",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "15550000000", phone_number_id: "1234567890" },
          contacts: [{ profile: { name: "عميل" }, wa_id: from }],
          messages: [{ from, id: wamid, timestamp: "1794000100", type: "text", text: { body } }],
        },
      }],
    }],
  };
}

test("M2 webhook: handshake, signature gate, signed opt-out lands in the UI", async ({ page, request }) => {
  const ok = await request.get("/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=e2e-verify-token&hub.challenge=987654");
  expect(ok.status()).toBe(200);
  expect(await ok.text()).toBe("987654");
  const wrong = await request.get("/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1");
  expect(wrong.status()).toBe(403);

  const body = JSON.stringify(inboundPayload("wamid.e2e-bad", "201001111111", "إيقاف"));
  const bad = await request.post("/api/webhooks/whatsapp", {
    data: body,
    headers: { "Content-Type": "application/json", "x-hub-signature-256": "sha256=deadbeef" },
  });
  expect(bad.status()).toBe(401);

  // Demo debtor 1 (عميل تجريبي ١, +201001111111) opts out via a signed webhook.
  const goodBody = JSON.stringify(inboundPayload(`wamid.e2e-opt-${Date.now()}`, "201001111111", "إيقاف"));
  const good = await request.post("/api/webhooks/whatsapp", {
    data: goodBody,
    headers: { "Content-Type": "application/json", "x-hub-signature-256": sign(goodBody) },
  });
  expect(good.status()).toBe(200);
  const summary = (await good.json()) as { optOutsApplied?: number; inboundStored?: number };
  expect(summary.inboundStored).toBe(1);
  expect(summary.optOutsApplied).toBe(1);

  // Visible in the UI: sign in as the demo user and open the debtor.
  await page.goto("/ar/login");
  await page.getByTestId("auth-email").fill("demo@tahseel.test");
  await page.getByTestId("auth-password").fill("demo-password-123");
  await page.getByTestId("auth-submit").click();
  await expect(page).toHaveURL(/\/ar\/dashboard/);
  await page.getByTestId("nav-debtors").click();
  await expect(page.getByTestId("debtor-row")).toHaveCount(3);
  await page.getByTestId("debtor-view").first().click();
  await expect(page.getByTestId("debtor-opted-out")).toBeVisible();
  await expect(page.getByTestId("timeline-message").first()).toBeVisible();
  await page.screenshot({ path: "e2e/screenshots/m2-opted-out-ar-light.png" });
});
