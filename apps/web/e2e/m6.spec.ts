import { test, expect, type Page } from "@playwright/test";
import postgres from "postgres";

/**
 * M6 pilot-ready (§12): timed onboarding — sign up -> wizard -> debtor +
 * invoice -> a reminder is SCHEDULED (asserted on the real reminders
 * table, polling the planner hook) — total elapsed must be < 5 minutes
 * and is printed. Plus the §8 danger-zone smoke: export downloads, and a
 * WRONG delete confirmation is refused (nothing destructive runs against
 * a tenant other specs need; the destructive path is integration-tested).
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

test("M6 timed onboarding: sign-up to first scheduled reminder in under 5 minutes", async ({ page }) => {
  const started = Date.now();
  const stamp = String(Date.now()).slice(-6);
  const signup = await page.request.post("/api/auth/sign-up/email", {
    data: { email: `m6-${stamp}@example.test`, password: "m6-password-123", name: "M6 E2E" },
  });
  expect(signup.status(), await signup.text()).toBe(200);
  await trpcMutate(page, "tenant.create", {
    businessNameAr: "نشاط م٦", timezone: "Africa/Cairo", quietStart: "21:00", quietEnd: "09:00",
    fridayMorningSkip: false, defaultTermsDays: 14, tone: "polite", consent: true,
  });
  const debtor = await trpcMutate<{ id: string }>(page, "debtors.create", {
    displayName: `عميل م٦ ${stamp}`, phone: `01016${stamp}`,
  });
  const invoice = await trpcMutate<{ id: string }>(page, "invoices.create", {
    debtorId: debtor.id, amount: "750.00", issuedOn: "2026-11-09", dueOn: "2026-11-19",
  });
  // The planner hook (replanLater) is async: poll the real reminders table.
  const dbUrl = process.env.DATABASE_URL;
  expect(dbUrl, "DATABASE_URL must be set for the M6 onboarding spec").toBeTruthy();
  const sql = postgres(dbUrl!);
  let scheduled = 0;
  try {
    for (let i = 0; i < 30 && scheduled === 0; i++) {
      const rows = await sql<{ n: number }[]>`select count(*)::int as n from reminders where invoice_id = ${invoice.id} and status = 'scheduled'`;
      scheduled = rows[0]!.n;
      if (scheduled === 0) await page.waitForTimeout(1000);
    }
  } finally {
    await sql.end();
  }
  expect(scheduled).toBeGreaterThan(0);
  const elapsedMs = Date.now() - started;
  console.log(`M6 onboarding elapsed: ${elapsedMs}ms (sign-up -> wizard -> debtor + invoice -> ${scheduled} reminder(s) scheduled)`);
  expect(elapsedMs).toBeLessThan(5 * 60 * 1000);
});

test("M6 danger zone: export works, wrong delete confirmation is refused", async ({ page }) => {
  const stamp = String(Date.now()).slice(-6);
  const signup = await page.request.post("/api/auth/sign-up/email", {
    data: { email: `m6dz-${stamp}@example.test`, password: "m6-password-123", name: "M6 DZ" },
  });
  expect(signup.status(), await signup.text()).toBe(200);
  await trpcMutate(page, "tenant.create", {
    businessNameAr: "نشاط منطقة الخطر", timezone: "Africa/Cairo", quietStart: "21:00", quietEnd: "09:00",
    fridayMorningSkip: false, defaultTermsDays: 14, tone: "polite", consent: true,
  });
  await page.goto("/ar/settings");
  await expect(page.getByTestId("danger-zone")).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-all").click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain("tahseel-export-");
  await page.getByTestId("delete-confirmation").fill("اسم غلط");
  await page.getByTestId("delete-all").click();
  await expect(page.getByTestId("deleted-note")).toHaveCount(0);
  await expect(page.getByTestId("settings")).toBeVisible();
  const mine = await trpcQuery<{ tenantId: string }[]>(page, "tenant.mine", undefined);
  expect(mine.length).toBeGreaterThan(0);
});
