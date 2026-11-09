import { test, expect, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";

/**
 * M3 (F5 + F10) over real HTTP against the production build:
 *  1. The public statement page renders the debtor's statement, the dispute
 *     button disputes the invoice (visible to the merchant), and revoking
 *     the link turns the page into the generic not-found.
 *  2. The Paymob webhook is the only fulfilment path: a bad HMAC is a 401,
 *     a correctly HMAC-SHA512-signed success callback (ADR-019 shapes,
 *     signed here independently of the server code) pays the invoice
 *     exactly once, a replay is a duplicate no-op, and the statement then
 *     shows the payment. The gateway itself is the FAKE provider
 *     (PAYMOB_ALLOW_FAKE=true in playwright.config) — no real Paymob
 *     account exists; the live sandbox run is a RUNBOOK manual step.
 *  3. Unknown tokens get one generic 404 and brute force is rate-limited.
 */
const HMAC_SECRET = "e2e-paymob-hmac-secret-for-tests-only";

/** ADR-019: HMAC-SHA512 over the 20 documented fields, no separator, booleans lowercase. */
function paymobHmac(obj: Record<string, unknown>): string {
  const s = (v: unknown) => (typeof v === "boolean" ? (v ? "true" : "false") : String(v));
  const order = obj.order as { id: unknown };
  const source = obj.source_data as { pan: unknown; sub_type: unknown; type: unknown };
  const msg = [
    obj.amount_cents, obj.created_at, obj.currency, obj.error_occured,
    obj.has_parent_transaction, obj.id, obj.integration_id, obj.is_3d_secure,
    obj.is_auth, obj.is_capture, obj.is_refunded, obj.is_standalone_payment,
    obj.is_voided, order.id, obj.owner, obj.pending,
    source.pan, source.sub_type, source.type, obj.success,
  ].map(s).join("");
  return createHmac("sha512", HMAC_SECRET).update(msg, "utf8").digest("hex");
}

async function login(page: Page) {
  await page.goto("/ar/login");
  await page.getByTestId("auth-email").fill("demo@tahseel.test");
  await page.getByTestId("auth-password").fill("demo-password-123");
  await page.getByTestId("auth-submit").click();
  await expect(page).toHaveURL(/\/ar\/dashboard/);
}

async function openDebtor(page: Page, index: number): Promise<string> {
  await page.getByTestId("nav-debtors").click();
  await expect(page.getByTestId("debtor-row")).toHaveCount(3);
  await page.getByTestId("debtor-view").nth(index).click();
  await expect(page.getByTestId("debtor-outstanding")).toBeVisible();
  const match = /debtors\/([0-9a-f-]{36})/.exec(page.url());
  expect(match).not.toBeNull();
  return match![1]!;
}

async function trpcMutate<T>(page: Page, path: string, input: unknown): Promise<T> {
  const res = await page.request.post(`/api/trpc/${path}`, { data: input as Record<string, unknown> });
  expect(res.status(), `${path} -> ${await res.text()}`).toBe(200);
  const body = (await res.json()) as { result: { data: T } };
  return body.result.data;
}

test("M3 statement: view totals, dispute lands + pauses, revoke makes it a generic not-found", async ({ page, browser }) => {
  await login(page);
  await openDebtor(page, 1); // demo debtor 2: INV-DEMO-2 partially paid, 3,000.00 outstanding

  await page.getByTestId("stmt-create").click();
  await expect(page.getByTestId("stmt-new-url")).toBeVisible();
  const urlText = (await page.getByTestId("stmt-new-url").textContent()) ?? "";
  const tokenMatch = /\/s\/([A-Za-z0-9_-]{43})/.exec(urlText);
  expect(tokenMatch).not.toBeNull();
  const statementUrl = `/s/${tokenMatch![1]!}`;

  const pub = await browser.newContext();
  const pubPage = await pub.newPage();
  await pubPage.goto(statementUrl);
  await expect(pubPage.getByTestId("statement-page")).toBeVisible();
  await expect(pubPage.getByTestId("statement-business")).toContainText("النيل");
  await expect(pubPage.getByTestId("statement-total")).toContainText("3,000.00");
  await expect(pubPage.getByTestId("statement-invoice")).toHaveCount(1);

  // Dispute the invoice from the public page.
  await pubPage.locator('[data-testid^="statement-dispute-"]').first().click();
  await pubPage.locator('[data-testid^="dispute-reason-"]').first().fill("المبلغ مختلف عن المتفق عليه");
  await pubPage.locator('[data-testid^="dispute-submit-"]').first().click();
  await expect(pubPage.getByTestId("statement-msg")).toContainText("تم تسجيل اعتراضك");
  await expect(pubPage.locator('[data-testid^="statement-invoice-status-"]').first()).toContainText("متنازع");

  // The merchant sees the dispute on the debtor page.
  await page.reload();
  await expect(page.getByTestId("stmt-dispute").first()).toContainText("المبلغ مختلف");

  // Revoking the link turns the public page into the generic not-found.
  await page.getByTestId("stmt-revoke").first().click();
  await expect(page.getByTestId("stmt-link-state").first()).toContainText("ملغي");
  await pubPage.goto(statementUrl);
  await expect(pubPage.getByTestId("statement-not-found")).toBeVisible();
  await pubPage.screenshot({ path: "e2e/screenshots/m3-statement-not-found-ar-light.png" });
  await pub.close();
});

test("M3 webhook: bad HMAC 401, signed success pays exactly once, replay is a no-op", async ({ page, browser, request }) => {
  await login(page);
  const debtorId = await openDebtor(page, 0); // demo debtor 1: INV-DEMO-1 open, 1,250.50 due

  const link = await trpcMutate<{ specialReference: string; amountMinor: string }>(page, "payments.createLink", { debtorId });
  expect(link.amountMinor).toBe("125050");

  const obj: Record<string, unknown> = {
    amount_cents: 125050, created_at: "2026-11-09T10:00:00.000000", currency: "EGP",
    error_occured: false, has_parent_transaction: false, id: 424242001, integration_id: 123456,
    is_3d_secure: true, is_auth: false, is_capture: false, is_refunded: false,
    is_standalone_payment: true, is_voided: false,
    order: { id: 987650, merchant_order_id: link.specialReference }, owner: 777, pending: false,
    source_data: { pan: "2346", sub_type: "MasterCard", type: "card" }, success: true,
  };
  const payload = { type: "TRANSACTION", obj };

  const bad = await request.post("/api/webhooks/paymob?hmac=deadbeef", { data: payload });
  expect(bad.status()).toBe(401);

  const good = await request.post(`/api/webhooks/paymob?hmac=${paymobHmac(obj)}`, { data: payload });
  expect(good.status()).toBe(200);
  expect(((await good.json()) as { outcome: string }).outcome).toBe("fulfilled");

  const replay = await request.post(`/api/webhooks/paymob?hmac=${paymobHmac(obj)}`, { data: payload });
  expect(replay.status()).toBe(200);
  expect(((await replay.json()) as { outcome: string }).outcome).toBe("duplicate");

  // The statement now shows the invoice paid, total zero, exactly one payment.
  const stmt = await trpcMutate<{ path: string }>(page, "statements.create", { debtorId });
  const pub = await browser.newContext();
  const pubPage = await pub.newPage();
  await pubPage.goto(stmt.path);
  await expect(pubPage.getByTestId("statement-page")).toBeVisible();
  await expect(pubPage.getByTestId("statement-total")).toContainText("0.00");
  await expect(pubPage.locator('[data-testid^="statement-invoice-status-"]').first()).toContainText("مدفوعة");
  await expect(pubPage.getByTestId("statement-payment")).toHaveCount(1);
  await pubPage.screenshot({ path: "e2e/screenshots/m3-statement-paid-ar-light.png" });
  await pub.close();

  // Merchant side: one gateway payment row and a balanced reconciliation.
  await page.reload();
  await expect(page.getByTestId("payment-row")).toHaveCount(1);
  await expect(page.getByTestId("gw-recon")).toContainText("متوازنة");
});

test("M3 statement abuse: unknown token is one generic 404 and brute force is rate-limited", async ({ page, request }) => {
  const api = await request.get("/api/public/statement/definitely-not-a-token");
  expect(api.status()).toBe(404);
  expect(((await api.json()) as { error: { code: string } }).error.code).toBe("NOT_FOUND");

  await page.goto("/s/definitely-not-a-token");
  await expect(page.getByTestId("statement-not-found")).toBeVisible();

  const statuses: number[] = [];
  for (let i = 0; i < 70; i++) {
    const res = await request.get(`/api/public/statement/brute-force-probe-${i}`);
    statuses.push(res.status());
  }
  expect(statuses).toContain(429);
  expect(statuses[statuses.length - 1]).toBe(429);
});
