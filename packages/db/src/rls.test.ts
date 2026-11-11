import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { v7 as uuidv7 } from "uuid";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq } from "drizzle-orm";
import { createDb, createAppDb, withTenant } from "./client";
import { TENANT_TABLES, debtors } from "./schema";

/**
 * Generic cross-tenant isolation test (BUILD_PLAN F0): iterates EVERY table in
 * TENANT_TABLES. Runs against a real Postgres (the app connects as the
 * RLS-bound tahseel_app role, exactly like production request code).
 * If DB URLs are missing the suite skips loudly; CI sets REQUIRE_DB_TESTS=1 so
 * a missing DB fails the build instead of silently skipping the RLS proof.
 */
const ownerUrl = process.env.DATABASE_URL;
const appUrl = process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL;
const requireDb = process.env.REQUIRE_DB_TESTS === "1";
if (!ownerUrl || !appUrl) {
  if (requireDb) throw new Error("REQUIRE_DB_TESTS=1 but DATABASE_URL/APP_DATABASE_URL are not set");
  console.warn("[rls.test] SKIPPED: DATABASE_URL/APP_DATABASE_URL not set");
}

const d = ownerUrl && appUrl ? describe : describe.skip;

d("RLS cross-tenant isolation (generic, every tenant table)", () => {
  const tenantA = uuidv7();
  const tenantB = uuidv7();
  const userA = `user-${uuidv7()}`;
  const userB = `user-${uuidv7()}`;
  let owner: ReturnType<typeof postgres>;
  let app: ReturnType<typeof postgres>;
  const rowIds = new Map<string, { a: string; b: string }>();

  const settings = JSON.stringify({
    quietStart: "21:00", quietEnd: "09:00", fridayMorningSkip: false,
    autoCloseEnabled: false, defaultChannel: "whatsapp", tone: "polite",
    defaultTermsDays: 14, easternDigits: false,
  });

  function factory(table: string, tenant: string, which: "a" | "b"): Record<string, unknown> {
    const id = uuidv7();
    const debtorId = rowIds.get("debtors")?.[which];
    switch (table) {
      case "memberships": return { id, tenant_id: tenant, user_id: which === "a" ? userA : userB, role: "owner" };
      case "audit_log": return { id, tenant_id: tenant, actor_user_id: null, action: "probe.created", entity: "probe", entity_id: "x" };
      case "usage_ledger": return { id, tenant_id: tenant, kind: "sms", units: 1, cost_estimate_minor: 0 };
      case "debtors": return { id, tenant_id: tenant, display_name: "Probe", phone_e164: which === "a" ? "+201001234567" : "+201112345678", phone_hash: "probe-hash" };
      case "invoices": return { id, tenant_id: tenant, debtor_id: debtorId, amount_minor: 1000, issued_on: "2026-11-01", due_on: "2026-11-10" };
      case "payments": return { id, tenant_id: tenant, debtor_id: debtorId, amount_minor: 1000, received_on: "2026-11-05" };
      case "payment_allocations": return { id, tenant_id: tenant, payment_id: rowIds.get("payments")?.[which], invoice_id: rowIds.get("invoices")?.[which], amount_minor: 500 };
      case "import_jobs": return { id, tenant_id: tenant, file_name: "probe.xlsx" };
      case "import_rows": return { id, tenant_id: tenant, job_id: rowIds.get("import_jobs")?.[which], row_number: 2 };
      case "reminders": return { id, tenant_id: tenant, invoice_id: rowIds.get("invoices")?.[which], debtor_id: debtorId, step_key: "d0", channel: "whatsapp", template_key: "invoice_due_today", due_at: new Date(), idempotency_key: `rls-${tenant}` };
      case "messages": return { id, tenant_id: tenant, debtor_id: debtorId, direction: "out", channel: "whatsapp" };
      case "opt_outs": return { id, tenant_id: tenant, debtor_id: debtorId, phone_e164: "+201001234567", phone_hash: `hash-${tenant}` };
      case "payment_links": return { id, tenant_id: tenant, debtor_id: debtorId, amount_minor: 1000, special_reference: `ref-${tenant}`, checkout_url: "https://pay.example.invalid/x", expires_at: new Date(Date.now() + 3600_000) };
      case "statement_links": return { id, tenant_id: tenant, debtor_id: debtorId, token_hash: `hash-${tenant}`, expires_at: new Date(Date.now() + 86400_000) };
      case "disputes": return { id, tenant_id: tenant, invoice_id: rowIds.get("invoices")?.[which], debtor_id: debtorId, raised_by: "debtor", reason: "probe", status: "open" };
      case "files": return { id, tenant_id: tenant, storage_key: `probe-${tenant}`, mime: "image/png", size_bytes: 123, sha256: `sha-${tenant}`, kind: "receipt" };
      case "message_intents": return { id, tenant_id: tenant, message_id: rowIds.get("messages")?.[which], intent: "question", confidence: 0.5, resolved_by: "human", action_taken: "human_inbox" };
      case "cheques": return { id, tenant_id: tenant, debtor_id: debtorId, direction: "receivable", number: `CHQ-${tenant.slice(0, 8)}`, bank: "Probe Bank", amount_minor: 5000, issue_date: "2026-11-01", due_date: "2026-12-01", status: "held" };
      case "cheque_alerts": return { id, tenant_id: tenant, cheque_id: rowIds.get("cheques")?.[which], alert_kind: "due_today", alert_date: "2026-12-01" };
      case "subscription_invoices": return { id, tenant_id: tenant, plan_key: "starter", period_start: "2026-11-01", period_end: "2026-12-01", amount_minor: 4900, status: "issued" };
      case "notifications": return { id, tenant_id: tenant, kind: "ai_briefing", severity: "info", title_ar: "تنبيه", title_en: "Alert", body_ar: "تفاصيل", body_en: "Details", dedupe_key: `probe-${tenant}` };
      default: throw new Error(`no factory for tenant table ${table}`);
    }
  }

  async function insertRaw(client: ReturnType<typeof postgres>, table: string, row: Record<string, unknown>) {
    const cols = Object.keys(row);
    await client.unsafe(
      `insert into "${table}" (${cols.map((c) => `"${c}"`).join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")})`,
      cols.map((c) => row[c] as never),
    );
  }

  beforeAll(async () => {
    const mig = createDb(ownerUrl!);
    await migrate(mig.db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
    await mig.client.end();
    owner = postgres(ownerUrl!);
    app = postgres(appUrl!);
    await owner`insert into tenants (id, name, business_name_ar, settings) values (${tenantA}, 'Tenant A', 'شركة أ', ${settings}), (${tenantB}, 'Tenant B', 'شركة ب', ${settings})`;
    await owner`insert into "user" (id, name, email) values (${userA}, 'A', ${`a-${userA}@example.test`}), (${userB}, 'B', ${`b-${userB}@example.test`})`;
    // Dependency order: debtors -> invoices/import_jobs -> payments -> allocations/rows.
    const depOrder = ["debtors", "files", "invoices", "import_jobs", "payments", "payment_allocations", "import_rows", "reminders", "messages", "opt_outs", "payment_links", "statement_links", "disputes", "message_intents"];
    const ordered = [...TENANT_TABLES].sort((x, y) => {
      const ix = depOrder.indexOf(x.name); const iy = depOrder.indexOf(y.name);
      return (ix === -1 ? 99 : ix) - (iy === -1 ? 99 : iy);
    });
    for (const { name } of ordered) {
      const ra = factory(name, tenantA, "a");
      const rb = factory(name, tenantB, "b");
      await insertRaw(owner, name, ra);
      await insertRaw(owner, name, rb);
      rowIds.set(name, { a: String(ra.id), b: String(rb.id) });
    }
  });

  afterAll(async () => {
    if (owner) {
      await owner`delete from tenants where id in (${tenantA}, ${tenantB})`;
      await owner`delete from "user" where id in (${userA}, ${userB})`;
      await owner.end();
    }
    if (app) await app.end();
  });

  async function asTenant<T>(tenant: string, fn: (sql: ReturnType<typeof postgres>) => Promise<T>): Promise<T> {
    return app.begin(async (tx) => {
      await tx`select set_config('app.tenant_id', ${tenant}, true)`;
      return fn(tx as unknown as ReturnType<typeof postgres>);
    }) as Promise<T>;
  }

  for (const { name, probeColumn, probeValue } of TENANT_TABLES) {
    it(`${name}: tenant A cannot read, insert into, update or delete tenant B rows`, async () => {
      const ids = rowIds.get(name)!;
      const seen = await asTenant(tenantA, (tx) => tx.unsafe(`select id from "${name}" where id in ($1, $2)`, [ids.a, ids.b]));
      expect(seen.map((r) => r.id)).toEqual([ids.a]);

      await expect(asTenant(tenantA, (tx) => insertRaw(tx, name, factory(name, tenantB, "b")))).rejects.toThrow();

      const updated = await asTenant(tenantA, (tx) =>
        tx.unsafe(`update "${name}" set "${probeColumn}" = $1 where id = $2 returning id`, [probeValue, ids.b]));
      expect(updated.length).toBe(0);

      const deleted = await asTenant(tenantA, (tx) => tx.unsafe(`delete from "${name}" where id = $1 returning id`, [ids.b]));
      expect(deleted.length).toBe(0);

      // B's row is untouched (verified as owner)
      const stillThere = await owner.unsafe(`select id from "${name}" where id = $1`, [ids.b]);
      expect(stillThere.length).toBe(1);
    });
  }

  it("fails closed: with no tenant context set, the app role sees zero rows", async () => {
    const seen = await app`select id from debtors`;
    expect(seen.length).toBe(0);
  });

  it("withTenant (drizzle) scopes reads and writes to the tenant", async () => {
    const { db } = createAppDb(appUrl!);
    const rowsA = await withTenant(db, tenantA, (tx) => tx.select().from(debtors));
    expect(rowsA.length).toBeGreaterThanOrEqual(1);
    expect(rowsA.every((r) => r.tenantId === tenantA)).toBe(true);
    const aDebtor = rowsA[0]!;
    const rowsB = await withTenant(db, tenantB, (tx) => tx.select().from(debtors).where(eq(debtors.id, aDebtor.id)));
    expect(rowsB.length).toBe(0);
  });
});
