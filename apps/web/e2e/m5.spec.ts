import { test, expect, type Page } from "@playwright/test";

/**
 * M5 (F9/F11/F12/F13) over real HTTP against the production build:
 *  1. Cheques UI: register a cheque for a fresh tenant, deposit it (a
 *     CLAIMED cheque payment appears), clear it — the invoice is paid.
 *  2. Dashboard: the reports section renders; the demo-seeded fresh tenant
 *     has < 10 paid invoices, so the forecast honestly shows the
 *     not-enough-data state.
 *  3. Plans: the catalogue renders with placeholder labelling and the
 *     upgrade flow works end-to-end (FAKE provider). The quota banner and
 *     the dispatcher's quota_exceeded block are proven by the M5
 *     integration suite on real Postgres (usage rows are not creatable
 *     through the public API, by design).
 */
async function trpcMutate<T>(page: Page, path: string, input: unknown): Promise<T> {
  const res = await page.request.post(`/api/trpc/${path}`, { data: input as Record<string, unknown> });
  expect(res.status(), `${path} -> ${await res.text()}`).toBe(200);
  const body = (await res.json()) as { result: { data: T } };
  return body.result.data;
}
async function trpcQuery<T>(page: Page, path: string, input: unknown): Promise<T> {
  const res = await page.request.get(`/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`);
  expect(res.status(), `${path} -> ${await res.text()}`).toBe(200);
  const body = (await res.json()) as { result: { data: T } };
  return body.result.data;
}

test("M5 cheque lifecycle in the UI: register -> deposit -> clear pays the invoice", async ({ page }) => {
  const stamp = String(Date.now()).slice(-6);
  const signup = await page.request.post("/api/auth/sign-up/email", {
    data: { email: `m5-${stamp}@example.test`, password: "m5-password-123", name: "M5 E2E" },
  });
  expect(signup.status(), await signup.text()).toBe(200);
  await trpcMutate(page, "tenant.create", {
    businessNameAr: "نشاط م٥", timezone: "Africa/Cairo", quietStart: "21:00", quietEnd: "09:00",
    fridayMorningSkip: false, defaultTermsDays: 14, tone: "polite", consent: true,
  });
  const debtor = await trpcMutate<{ id: string }>(page, "debtors.create", {
    displayName: `عميل م٥ ${stamp}`, phone: `01013${stamp}`,
  });
  const invoice = await trpcMutate<{ id: string; outstandingMinor: string }>(page, "invoices.create", {
    debtorId: debtor.id, amount: "300.00", issuedOn: "2026-11-09", dueOn: "2026-11-25",
  });

  await page.goto("/ar/cheques");
  await expect(page.getByTestId("nav-cheques")).toBeVisible();
  await page.getByTestId("cheque-debtor").selectOption(debtor.id);
  await page.getByTestId("cheque-direction").selectOption("receivable");
  await page.getByTestId("cheque-number").fill(`E2E-${stamp}`);
  await page.getByTestId("cheque-bank").fill("CIB");
  await page.getByTestId("cheque-amount").fill("300");
  await page.getByTestId("cheque-invoice").selectOption(invoice.id);
  await page.getByTestId("cheque-issue").fill("2026-11-09");
  await page.getByTestId("cheque-due").fill("2026-11-12");
  await page.getByTestId("cheque-submit").click();
  const row = page.getByTestId("cheque-row").filter({ hasText: `E2E-${stamp}` });
  await expect(row).toBeVisible();
  await expect(row.getByTestId("cheque-status")).toContainText("محفوظ");

  await row.getByTestId("cheque-to-deposited").click();
  await expect(row.getByTestId("cheque-status")).toContainText("مودع");
  // The claimed payment exists and the invoice is NOT paid yet.
  let detail = await trpcQuery<{ payments: { method: string; status: string }[]; invoices: { id: string; status: string }[] }>(
    page, "debtors.get", { id: debtor.id });
  expect(detail.payments.some((p) => p.method === "cheque" && p.status === "claimed")).toBe(true);
  expect(detail.invoices.find((i) => i.id === invoice.id)?.status).toBe("open");

  await row.getByTestId("cheque-to-cleared").click();
  await expect(row.getByTestId("cheque-status")).toContainText("تم صرفه");
  detail = await trpcQuery(page, "debtors.get", { id: debtor.id });
  expect(detail.invoices.find((i) => i.id === invoice.id)?.status).toBe("paid");
});

test("M5 dashboard: reports render, forecast is honestly not-enough-data, upgrade flow works", async ({ page }) => {
  const stamp = String(Date.now()).slice(-6);
  const signup = await page.request.post("/api/auth/sign-up/email", {
    data: { email: `m5b-${stamp}@example.test`, password: "m5-password-123", name: "M5B E2E" },
  });
  expect(signup.status(), await signup.text()).toBe(200);
  await trpcMutate(page, "tenant.create", {
    businessNameAr: "نشاط م٥ ب", timezone: "Africa/Cairo", quietStart: "21:00", quietEnd: "09:00",
    fridayMorningSkip: false, defaultTermsDays: 14, tone: "polite", consent: true,
  });
  await page.goto("/ar/dashboard");
  await expect(page.getByTestId("reports")).toBeVisible();
  await expect(page.getByTestId("kpi-collection-rate")).toBeVisible();
  await expect(page.getByTestId("forecast-not-enough")).toBeVisible();

  // Plans render with the placeholder-price label; upgrading via the FAKE
  // provider takes effect immediately (the live Paymob charge is a human
  // step — prices are NOT decided).
  await page.getByTestId("upgrade-starter").click();
  // The click fires an async mutation; poll the quota until it commits.
  await expect.poll(async () => {
    const quotaRes = await page.request.get("/api/trpc/billing.quota");
    if (quotaRes.status() !== 200) return null;
    const quota = (await quotaRes.json() as { result: { data: { planKey: string; quota: number | null } } }).result.data;
    return quota.planKey === "starter" && quota.quota === 500 ? "starter:500" : quota.planKey;
  }, { timeout: 10_000 }).toBe("starter:500");
});
