import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { createDb, createAppDb, type Db } from "@tahseel/db";
import { FakeMessagingProvider } from "@tahseel/providers";
import { dispatchDue, type EngineDeps } from "./engine";

/**
 * F4 load acceptance (BUILD_PLAN §7-F4): 50,000 due reminders processed in
 * bounded pages (dispatcher `limit`) — memory stays flat because each cycle
 * claims at most `limit` rows; grouping collapses 25 reminders per debtor
 * into ONE message (2,000 provider sends for 50,000 reminders), which is
 * also what keeps the run far under provider throughput limits.
 * Seeding uses set-based SQL (generate_series); ids are gen_random_uuid().
 */
const ownerUrl = process.env.DATABASE_URL;
const appUrl = process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL;
if (!ownerUrl || !appUrl) {
  if (process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 but DATABASE_URL/APP_DATABASE_URL are not set");
  console.warn("[load.integration] SKIPPED: DATABASE_URL/APP_DATABASE_URL not set");
}
const d = ownerUrl && appUrl ? describe : describe.skip;

d("load: 50,000 due reminders", () => {
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

  it("processes 50k due reminders in pages; 25-per-debtor grouping yields 2,000 sends", async () => {
    const started = Date.now();
    const tenantRows = await owner.execute(sql`
      insert into tenants (id, name, business_name_ar, timezone, settings)
      values (gen_random_uuid(), 'Load Test', 'محل الحمل', 'Africa/Cairo',
        ${JSON.stringify({
          quietStart: "21:00", quietEnd: "09:00", fridayMorningSkip: false, autoCloseEnabled: false,
          defaultChannel: "whatsapp", tone: "polite", defaultTermsDays: 14, easternDigits: false,
          sendTimeLocal: "10:00", weeklyCap: 100000,
        })}::jsonb)
      returning id
    `) as unknown as { id: string }[];
    const tenantId = tenantRows[0]!.id;
    await owner.execute(sql`
      insert into debtors (id, tenant_id, display_name, phone_e164, phone_hash)
      select gen_random_uuid(), ${tenantId}, 'عميل ' || g, '+2010' || lpad(g::text, 8, '0'),
             md5('load-debtor-' || g::text)
      from generate_series(1, 2000) as g
    `);
    await owner.execute(sql`
      insert into invoices (id, tenant_id, debtor_id, amount_minor, issued_on, due_on)
      select gen_random_uuid(), ${tenantId}, d.id, 100000, '2026-11-01', '2026-11-20'
      from debtors d cross join generate_series(1, 25) as g
      where d.tenant_id = ${tenantId}
    `);
    await owner.execute(sql`
      insert into reminders (id, tenant_id, invoice_id, debtor_id, step_key, channel, template_key, due_at, idempotency_key)
      select gen_random_uuid(), ${tenantId}, i.id, i.debtor_id, 'd0', 'whatsapp', 'invoice_due_today',
             '2026-11-20T08:00:00Z', 'load-' || i.id::text
      from invoices i where i.tenant_id = ${tenantId}
    `);
    const seeded = await owner.execute(sql`select count(*)::int as n from reminders where tenant_id = ${tenantId}`) as unknown as { n: number }[];
    expect(seeded[0]?.n).toBe(50_000);

    const deps: EngineDeps = { app, owner, providers: { whatsapp, sms } };
    const now = new Date("2026-11-20T08:30:00Z");
    let sentTotal = 0;
    let guard = 0;
    while (sentTotal < 50_000 && guard++ < 100) {
      const cycleStart = Date.now();
      const s = await dispatchDue(deps, now, { tenantId, limit: 5000 });
      console.info(`[load] cycle ${guard}: due=${s.due} sent=${s.remindersSent} skipped=${JSON.stringify(s.skipped)} resched=${s.rescheduled} failed=${s.failed} retried=${s.retried} in ${Date.now() - cycleStart}ms`);
      sentTotal += s.remindersSent;
      if (s.due === 0) break;
    }
    const elapsedMs = Date.now() - started;
    expect(sentTotal).toBe(50_000);
    expect(whatsapp.sent).toHaveLength(2_000); // one consolidated message per debtor
    const msgs = await owner.execute(sql`select count(*)::int as n from messages where tenant_id = ${tenantId}`) as unknown as { n: number }[];
    expect(msgs[0]?.n).toBe(2_000);
    const remaining = await owner.execute(sql`
      select count(*)::int as n from reminders where tenant_id = ${tenantId} and status != 'sent'
    `) as unknown as { n: number }[];
    expect(remaining[0]?.n).toBe(0);
    console.info(`[load] 50,000 reminders -> 2,000 sends in ${elapsedMs}ms`);
  }, 600_000);
});
