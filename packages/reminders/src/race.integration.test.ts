import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDb, createAppDb, debtors, invoices, messages, reminders, tenants, type Db } from "@tahseel/db";
import { FakeMessagingProvider } from "@tahseel/providers";
import { dispatchDue, planForInvoice, type EngineDeps } from "./engine";

/**
 * F4 race acceptance (BUILD_PLAN §7-F4): 20 concurrent dispatcher instances
 * over the same due set must never double-send. Real Postgres, SKIP LOCKED.
 */
const ownerUrl = process.env.DATABASE_URL;
const appUrl = process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL;
if (!ownerUrl || !appUrl) {
  if (process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 but DATABASE_URL/APP_DATABASE_URL are not set");
  console.warn("[race.integration] SKIPPED: DATABASE_URL/APP_DATABASE_URL not set");
}
const d = ownerUrl && appUrl ? describe : describe.skip;
const hash = (e164: string) => createHash("sha256").update(`:${e164}`).digest("hex");

d("dispatcher race (20 concurrent instances)", () => {
  let owner: Db;
  let app: Db;
  const whatsapp = new FakeMessagingProvider();
  const sms = new FakeMessagingProvider();

  beforeAll(() => {
    owner = createDb(ownerUrl!).db;
    app = createAppDb(appUrl!).db;
  });
  afterAll(async () => {
    await owner.$client.end();
    await app.$client.end();
  });

  it("30 debtors × due steps, 20 dispatchers at once: exactly one message per debtor, no duplicates", async () => {
    const [t] = await owner.insert(tenants).values({
      name: "Race Test", businessNameAr: "محل السباق", timezone: "Africa/Cairo",
      settings: {
        quietStart: "21:00", quietEnd: "09:00", fridayMorningSkip: false, autoCloseEnabled: false,
        defaultChannel: "whatsapp", tone: "polite", defaultTermsDays: 14, easternDigits: false, sendTimeLocal: "10:00",
      } as never,
    }).returning();
    const tenantId = t!.id;
    const deps: EngineDeps = { app, owner, providers: { whatsapp, sms } };
    for (let i = 0; i < 30; i++) {
      const phone = `+2010${String(81000000 + i)}`;
      const [debtor] = await owner.insert(debtors).values({
        tenantId, displayName: `عميل ${i}`, phoneE164: phone, phoneHash: hash(phone),
      }).returning();
      const [invoice] = await owner.insert(invoices).values({
        tenantId, debtorId: debtor!.id, amountMinor: 100_000n, issuedOn: "2026-11-01", dueOn: "2026-11-20",
      }).returning();
      await planForInvoice(deps, tenantId, invoice!.id, new Date("2026-11-10T00:00:00Z"));
    }
    const now = new Date("2026-11-20T08:30:00Z"); // d-3 + d0 due per debtor -> 60 reminders, 30 groups
    const summaries = await Promise.all(
      Array.from({ length: 20 }, () => dispatchDue(deps, now, { tenantId })),
    );
    const totalSent = summaries.reduce((acc, s) => acc + s.remindersSent, 0);
    const totalGroups = summaries.reduce((acc, s) => acc + s.groupsSent, 0);
    expect(totalGroups).toBe(30);
    expect(totalSent).toBe(60);
    expect(whatsapp.sent).toHaveLength(30);
    expect(new Set(whatsapp.sent.map((s) => s.idempotencyKey)).size).toBe(30);
    const rows = await owner.select().from(reminders).where(eq(reminders.tenantId, tenantId));
    expect(rows.filter((r) => r.status === "sent")).toHaveLength(60);
    const msgs = await owner.select().from(messages).where(eq(messages.tenantId, tenantId));
    expect(msgs).toHaveLength(30);
    expect(new Set(msgs.map((m) => m.providerMessageId)).size).toBe(30);
  });
});
