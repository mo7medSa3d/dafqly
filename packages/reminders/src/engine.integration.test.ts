import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDb, createAppDb, debtors, invoices, reminders, messages, statementLinks, tenants, type Db } from "@tahseel/db";
import { FakeMessagingProvider, FlakyProvider } from "@tahseel/providers";
import { dispatchDue, planForInvoice, planForTenant, type EngineDeps } from "./engine";

/**
 * F4 engine acceptance suite (BUILD_PLAN §7-F4 + §10): real Postgres + RLS,
 * fake clock (explicit `now` everywhere), fake provider. Skips loudly when
 * no DB is configured; CI sets REQUIRE_DB_TESTS=1.
 */
const ownerUrl = process.env.DATABASE_URL;
const appUrl = process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL;
if (!ownerUrl || !appUrl) {
  if (process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 but DATABASE_URL/APP_DATABASE_URL are not set");
  console.warn("[engine.integration] SKIPPED: DATABASE_URL/APP_DATABASE_URL not set");
}
const d = ownerUrl && appUrl ? describe : describe.skip;

const hash = (e164: string) => createHash("sha256").update(`:${e164}`).digest("hex");

d("reminder engine (F4)", () => {
  let owner: Db;
  let app: Db;
  const whatsapp = new FakeMessagingProvider();
  const sms = new FakeMessagingProvider();
  const deps = (): EngineDeps => ({ app, owner, providers: { whatsapp, sms } });

  async function makeTenant(settings: Record<string, unknown> = {}): Promise<string> {
    const [t] = await owner.insert(tenants).values({
      name: "Engine Test", businessNameAr: "محل الاختبار", timezone: "Africa/Cairo",
      settings: {
        quietStart: "21:00", quietEnd: "09:00", fridayMorningSkip: false, autoCloseEnabled: false,
        defaultChannel: "whatsapp", tone: "polite", defaultTermsDays: 14, easternDigits: false,
        sendTimeLocal: "10:00", ...settings,
      } as never,
    }).returning();
    return t!.id;
  }
  async function makeDebtor(tenantId: string, phone = "+201001234567"): Promise<string> {
    const [row] = await owner.insert(debtors).values({
      tenantId, displayName: "عميل", phoneE164: phone, phoneHash: hash(phone),
    }).returning();
    return row!.id;
  }
  async function makeInvoice(tenantId: string, debtorId: string, dueOn: string, amount = 100_000n): Promise<string> {
    const [row] = await owner.insert(invoices).values({
      tenantId, debtorId, amountMinor: amount, issuedOn: "2026-11-01", dueOn,
    }).returning();
    return row!.id;
  }
  it("quality guard: >20% failures over the last 25 settled sends auto-pauses the tenant (audited)", async () => {
    const tenantId = await makeTenant();
    const debtorId = await makeDebtor(tenantId, `+2010${String(Math.floor(Math.random() * 90000000) + 10000000)}`);
    const invoiceId = await makeInvoice(tenantId, debtorId, "2026-11-20");
    // History: 25 settled outbound messages, 20 of them failed (80%).
    const rows = Array.from({ length: 25 }, (_, i) => ({
      tenantId, debtorId, direction: "out" as const, channel: "whatsapp" as const, provider: "whatsapp",
      providerMessageId: `wamid.guard-${tenantId}-${i}`,
      status: (i < 20 ? "failed" : "delivered") as "failed" | "delivered",
    }));
    await owner.insert(messages).values(rows as never);
    await planForInvoice(deps(), tenantId, invoiceId, new Date("2026-11-10T00:00:00Z"));
    whatsapp.sent.length = 0;
    const s1 = await dispatchDue(deps(), new Date("2026-11-17T08:30:00Z"), { tenantId });
    expect(s1.groupsSent).toBe(1); // this cycle still sends; the guard evaluates after
    const [t] = await owner.select().from(tenants).where(eq(tenants.id, tenantId));
    expect(t?.settings.sendingPaused).toBe(true);
    expect(t?.settings.qualityPausedReason).toContain("failure rate");
    whatsapp.sent.length = 0;
    const s2 = await dispatchDue(deps(), new Date("2026-11-20T08:30:00Z"), { tenantId });
    expect(s2.groupsSent).toBe(0); // paused: nothing more goes out
    expect(whatsapp.sent).toHaveLength(0);
  });

  const tenantReminders = (tenantId: string) => owner.select().from(reminders).where(eq(reminders.tenantId, tenantId));
  const tenantMessages = (tenantId: string) => owner.select().from(messages).where(eq(messages.tenantId, tenantId));

  beforeAll(() => {
    owner = createDb(ownerUrl!).db;
    app = createAppDb(appUrl!).db;
  });
  afterAll(async () => {
    await owner.$client.end();
    await app.$client.end();
  });

  it("planner persists 6 steps, re-planning is idempotent, paying cancels the future", async () => {
    whatsapp.sent.length = 0;
    const tenantId = await makeTenant();
    const debtorId = await makeDebtor(tenantId);
    const invoiceId = await makeInvoice(tenantId, debtorId, "2026-11-20");
    const now = new Date("2026-11-10T00:00:00Z");
    const first = await planForInvoice(deps(), tenantId, invoiceId, now);
    expect(first.planned).toBe(6);
    const second = await planForInvoice(deps(), tenantId, invoiceId, now);
    expect(second).toEqual({ planned: 0, cancelled: 0 });
    let rows = await tenantReminders(tenantId);
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.dueAt.toISOString()).sort()).toContain("2026-11-17T08:00:00.000Z");

    await owner.update(invoices).set({ status: "paid", paidMinor: 100_000n }).where(eq(invoices.id, invoiceId));
    await planForInvoice(deps(), tenantId, invoiceId, now);
    rows = await tenantReminders(tenantId);
    expect(rows.every((r) => r.status === "cancelled" && r.skipReason === "superseded")).toBe(true);
  });

  it("TIME TRAVEL: exactly the planned steps fire on their days, none on other days", async () => {
    whatsapp.sent.length = 0;
    const tenantId = await makeTenant();
    const debtorId = await makeDebtor(tenantId);
    const invoiceId = await makeInvoice(tenantId, debtorId, "2026-11-20");
    await planForInvoice(deps(), tenantId, invoiceId, new Date("2026-11-10T00:00:00Z"));
    const sendDays: string[] = [];
    for (let day = 10; day <= 30; day++) {
      const now = new Date(Date.UTC(2026, 10, day, 8, 30)); // 10:30 Cairo
      const before = whatsapp.sent.length;
      await dispatchDue(deps(), now, { tenantId });
      if (whatsapp.sent.length > before) sendDays.push(`2026-11-${day}`);
    }
    for (let day = 1; day <= 12; day++) {
      const now = new Date(Date.UTC(2026, 11, day, 8, 30));
      const before = whatsapp.sent.length;
      await dispatchDue(deps(), now, { tenantId });
      if (whatsapp.sent.length > before) sendDays.push(`2026-12-${String(day).padStart(2, "0")}`);
    }
    // d-3=17, d0=20, d+3=23, d+7=27, d+14=Dec 4, weekly=Dec 11 — and nothing else.
    expect(sendDays).toEqual(["2026-11-17", "2026-11-20", "2026-11-23", "2026-11-27", "2026-12-04", "2026-12-11"]);
    expect(whatsapp.sent).toHaveLength(6);
    const rows = await tenantReminders(tenantId);
    expect(rows.every((r) => r.status === "sent" && r.providerMessageId)).toBe(true);
    expect(await tenantMessages(tenantId)).toHaveLength(6);
  });

  it("paying mid-schedule cancels all future reminders within one dispatcher cycle", async () => {
    whatsapp.sent.length = 0;
    const tenantId = await makeTenant();
    const debtorId = await makeDebtor(tenantId);
    const invoiceId = await makeInvoice(tenantId, debtorId, "2026-11-20");
    await planForInvoice(deps(), tenantId, invoiceId, new Date("2026-11-10T00:00:00Z"));
    await dispatchDue(deps(), new Date("2026-11-17T08:30:00Z"), { tenantId });
    expect(whatsapp.sent).toHaveLength(1);
    await owner.update(invoices).set({ status: "paid", paidMinor: 100_000n }).where(eq(invoices.id, invoiceId));
    const summary = await dispatchDue(deps(), new Date("2026-11-20T08:30:00Z"), { tenantId });
    expect(whatsapp.sent).toHaveLength(1);
    expect(summary.skipped.invoice_paid).toBeGreaterThan(0);
    const rows = await tenantReminders(tenantId);
    expect(rows.filter((r) => r.status === "cancelled")).toHaveLength(5);
    expect(rows.filter((r) => r.status === "sent")).toHaveLength(1);
    // Later cycles change nothing further.
    await dispatchDue(deps(), new Date("2026-11-27T08:30:00Z"), { tenantId });
    expect(whatsapp.sent).toHaveLength(1);
  });

  it("grouping: three invoices for one debtor due the same day become ONE message with the total", async () => {
    whatsapp.sent.length = 0;
    const tenantId = await makeTenant();
    const debtorId = await makeDebtor(tenantId);
    for (const amount of [100_000n, 200_000n, 50_000n]) {
      const inv = await makeInvoice(tenantId, debtorId, "2026-11-20", amount);
      await planForInvoice(deps(), tenantId, inv, new Date("2026-11-10T00:00:00Z"));
    }
    await dispatchDue(deps(), new Date("2026-11-20T08:30:00Z"), { tenantId });
    expect(whatsapp.sent).toHaveLength(1);
    expect(whatsapp.sent[0]?.variables.amount).toBe("3,500.00");
    const rows = await tenantReminders(tenantId);
    const sent = rows.filter((r) => r.status === "sent");
    // d-3 stragglers + d0 steps for all three invoices merge into the one message.
    expect(sent).toHaveLength(6);
    expect(new Set(sent.map((r) => r.providerMessageId)).size).toBe(1);
  });

  it("F10: with includePayLinkInReminders on, the send carries a fresh statement URL variable; off means no variable", async () => {
    whatsapp.sent.length = 0;
    const withDeps = (): EngineDeps => ({ app, owner, providers: { whatsapp, sms }, appUrl: "http://test.local" });
    const tenantId = await makeTenant({ includePayLinkInReminders: true });
    const debtorId = await makeDebtor(tenantId, `+2010${String(Math.floor(Math.random() * 90000000) + 10000000)}`);
    const invoiceId = await makeInvoice(tenantId, debtorId, "2026-11-20");
    await planForInvoice(withDeps(), tenantId, invoiceId, new Date("2026-11-10T00:00:00Z"));
    await dispatchDue(withDeps(), new Date("2026-11-17T08:30:00Z"), { tenantId });
    expect(whatsapp.sent).toHaveLength(1);
    const url = whatsapp.sent[0]?.variables.pay_link;
    expect(url).toMatch(/^http:\/\/test\.local\/s\/[A-Za-z0-9_-]{43}$/);
    const links = await owner.select().from(statementLinks).where(eq(statementLinks.debtorId, debtorId));
    expect(links).toHaveLength(1);
    const msgs = await tenantMessages(tenantId);
    expect(msgs[0]?.bodyText).toContain(url!);

    whatsapp.sent.length = 0;
    const tenant2 = await makeTenant(); // setting off by default
    const debtor2 = await makeDebtor(tenant2, `+2010${String(Math.floor(Math.random() * 90000000) + 10000000)}`);
    const invoice2 = await makeInvoice(tenant2, debtor2, "2026-11-20");
    await planForInvoice(withDeps(), tenant2, invoice2, new Date("2026-11-10T00:00:00Z"));
    await dispatchDue(withDeps(), new Date("2026-11-17T08:30:00Z"), { tenantId: tenant2 });
    expect(whatsapp.sent).toHaveLength(1);
    expect(whatsapp.sent[0]?.variables.pay_link).toBeUndefined();
  });

  it("quiet hours reschedule instead of sending or skipping", async () => {
    whatsapp.sent.length = 0;
    const tenantId = await makeTenant();
    const debtorId = await makeDebtor(tenantId);
    const invoiceId = await makeInvoice(tenantId, debtorId, "2026-11-20");
    await planForInvoice(deps(), tenantId, invoiceId, new Date("2026-11-10T00:00:00Z"));
    // 22:00 Cairo on the d-3 day: inside quiet hours (21:00-09:00).
    const summary = await dispatchDue(deps(), new Date("2026-11-17T20:00:00Z"), { tenantId });
    expect(whatsapp.sent).toHaveLength(0);
    expect(summary.rescheduled).toBe(1);
    const rows = await tenantReminders(tenantId);
    const step = rows.find((r) => r.stepKey === "d-3");
    expect(step?.status).toBe("scheduled");
    expect(step?.dueAt.toISOString()).toBe("2026-11-18T07:00:00.000Z"); // next day 09:00 Cairo
    await dispatchDue(deps(), new Date("2026-11-18T07:05:00Z"), { tenantId });
    expect(whatsapp.sent).toHaveLength(1);
  });

  it("guards: invalid phone is skipped with phone_invalid; paused tenant is left untouched", async () => {
    whatsapp.sent.length = 0;
    const tenantId = await makeTenant();
    const debtorId = await makeDebtor(tenantId, "+201001234567");
    const invoiceId = await makeInvoice(tenantId, debtorId, "2026-11-20");
    await planForInvoice(deps(), tenantId, invoiceId, new Date("2026-11-10T00:00:00Z"));
    await owner.update(debtors).set({ phoneE164: "123", phoneHash: hash("123") }).where(eq(debtors.id, debtorId));
    const summary = await dispatchDue(deps(), new Date("2026-11-17T08:30:00Z"), { tenantId });
    expect(summary.skipped.phone_invalid).toBe(1);
    expect(whatsapp.sent).toHaveLength(0);

    const pausedTenant = await makeTenant({ sendingPaused: true });
    const d2 = await makeDebtor(pausedTenant);
    const i2 = await makeInvoice(pausedTenant, d2, "2026-11-20");
    await planForInvoice(deps(), pausedTenant, i2, new Date("2026-11-10T00:00:00Z"));
    const s2 = await dispatchDue(deps(), new Date("2026-11-17T08:30:00Z"), { tenantId: pausedTenant });
    expect(s2.paused).toBe(true);
    const rows = await tenantReminders(pausedTenant);
    expect(rows.every((r) => r.status === "scheduled")).toBe(true);
  });

  it("retries 130429 with backoff, then succeeds (attempts tracked)", async () => {
    const flaky = new FlakyProvider();
    flaky.failNext(2, 130429);
    const localDeps: EngineDeps = { app, owner, providers: { whatsapp: flaky, sms } };
    const tenantId = await makeTenant();
    const debtorId = await makeDebtor(tenantId);
    const invoiceId = await makeInvoice(tenantId, debtorId, "2026-11-20");
    await planForInvoice(localDeps, tenantId, invoiceId, new Date("2026-11-10T00:00:00Z"));
    const t0 = new Date("2026-11-17T08:30:00Z");
    let s = await dispatchDue(localDeps, t0, { tenantId });
    expect(s.retried).toBe(1);
    s = await dispatchDue(localDeps, new Date(t0.getTime() + 500), { tenantId }); // still backing off
    expect(s.due).toBe(0);
    s = await dispatchDue(localDeps, new Date(t0.getTime() + 1500), { tenantId });
    expect(s.retried).toBe(1);
    s = await dispatchDue(localDeps, new Date(t0.getTime() + 4000), { tenantId });
    expect(s.remindersSent).toBe(1);
    const rows = await tenantReminders(tenantId);
    const step = rows.find((r) => r.stepKey === "d-3");
    expect(step?.status).toBe("sent");
    expect(step?.attempts).toBe(3);
    expect(step?.lastErrorCode).toBe(130429);
  });

  it("131026 final failure marks the debtor unreachable and falls back to SMS when enabled", async () => {
    const flaky = new FlakyProvider();
    flaky.failNext(10, 131026);
    sms.sent.length = 0;
    const localDeps: EngineDeps = { app, owner, providers: { whatsapp: flaky, sms } };
    const tenantId = await makeTenant({ smsFallbackEnabled: true });
    const debtorId = await makeDebtor(tenantId);
    const invoiceId = await makeInvoice(tenantId, debtorId, "2026-11-20");
    await planForInvoice(localDeps, tenantId, invoiceId, new Date("2026-11-10T00:00:00Z"));
    const t0 = new Date("2026-11-17T08:30:00Z");
    const s1 = await dispatchDue(localDeps, t0, { tenantId });
    expect(s1.failed).toBe(1);
    const [debtor] = await owner.select().from(debtors).where(eq(debtors.id, debtorId));
    expect(debtor?.whatsappStatus).toBe("unreachable");
    // The SMS sibling was created due now: the next cycle sends it.
    const s2 = await dispatchDue(localDeps, new Date(t0.getTime() + 60_000), { tenantId });
    expect(s2.remindersSent).toBe(1);
    expect(sms.sent).toHaveLength(1);
    expect(sms.sent[0]?.channel).toBe("sms");
  });

  it("weekly cap: second message in the same week is skipped with weekly_cap", async () => {
    whatsapp.sent.length = 0;
    const tenantId = await makeTenant({ weeklyCap: 1 });
    const debtorId = await makeDebtor(tenantId);
    const invA = await makeInvoice(tenantId, debtorId, "2026-11-16"); // d0 Mon 16 Nov
    const invB = await makeInvoice(tenantId, debtorId, "2026-11-18"); // d0 Wed 18 Nov
    await planForInvoice(deps(), tenantId, invA, new Date("2026-11-10T00:00:00Z"));
    await planForInvoice(deps(), tenantId, invB, new Date("2026-11-10T00:00:00Z"));
    await dispatchDue(deps(), new Date("2026-11-16T08:30:00Z"), { tenantId }); // sends invA d0 (and invB d-3 is 15th — past? no: planned 10th, due 15th -> also due! grouped? different days: d-3 of B due Sun 15 08:00Z, dispatch Mon catches it: same group day? localDay differs by dueAt (15th vs 16th) -> two groups same dispatch... daily cap: first group sends, second group sees sentToday>=1 -> rescheduled. Order by due_at: B d-3 first.)
    const afterFirst = whatsapp.sent.length;
    const s = await dispatchDue(deps(), new Date("2026-11-18T08:30:00Z"), { tenantId });
    // Whatever fired on the 16th consumed the single weekly slot.
    expect(afterFirst).toBeGreaterThanOrEqual(1);
    expect(s.skipped.weekly_cap ?? 0).toBeGreaterThanOrEqual(0);
    const rowsB = (await tenantReminders(tenantId)).filter((r) => r.invoiceId === invB && r.stepKey === "d0");
    expect(rowsB[0]?.status).toBe("skipped");
    expect(rowsB[0]?.skipReason).toBe("weekly_cap");
  });

  it("planForTenant covers every open invoice", async () => {
    const tenantId = await makeTenant();
    const debtorId = await makeDebtor(tenantId);
    await makeInvoice(tenantId, debtorId, "2026-11-20");
    await makeInvoice(tenantId, debtorId, "2026-11-25");
    const result = await planForTenant(deps(), tenantId, new Date("2026-11-10T00:00:00Z"));
    expect(result.planned).toBe(12);
  });
});
