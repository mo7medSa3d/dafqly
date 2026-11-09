import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { appRouter } from "./routers";
import { ownerDb, appDb } from "./db";
import { user as userTable, tenants, debtors, invoices, tenantDeletions } from "@tahseel/db/schema";
import { createTenantForUser, hashPhone } from "./services";

/**
 * §8 data rights (M6): export contains ONLY the caller's tenant; delete is
 * owner-only + typed confirmation; deleting tenant A leaves tenant B
 * byte-identical; a tombstone row records the deletion. Real Postgres + RLS.
 */
const hasDb = Boolean(process.env.DATABASE_URL && (process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL));
if (!hasDb && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 but DB env missing");
const d = hasDb ? describe : describe.skip;

d("tenant data export + delete (M6)", () => {
  const ownerA = { id: randomUUID().replace(/-/g, ""), email: `oa-${randomUUID()}@example.test`, name: "OA" };
  const ownerB = { id: randomUUID().replace(/-/g, ""), email: `ob-${randomUUID()}@example.test`, name: "OB" };
  const staffA = { id: randomUUID().replace(/-/g, ""), email: `sa-${randomUUID()}@example.test`, name: "SA" };
  let tenantA = "";
  let tenantB = "";
  const ctxFor = (u: typeof ownerA | null) => ({ user: u, appDb: appDb(), ownerDb: ownerDb() });
  const mkTenant = async (u: typeof ownerA, name: string) =>
    (await createTenantForUser(appDb(), u.id, {
      businessNameAr: name, timezone: "Africa/Cairo", quietStart: "21:00", quietEnd: "09:00",
      fridayMorningSkip: false, defaultTermsDays: 14, tone: "polite", consent: true,
    })).tenantId;

  beforeAll(async () => {
    const owner = ownerDb();
    await owner.insert(userTable).values([ownerA, ownerB, staffA]);
    tenantA = await mkTenant(ownerA, "شركة الحذف أ");
    tenantB = await mkTenant(ownerB, "شركة الحذف ب");
    // staff membership in tenant A for the staff user
    const { memberships } = await import("@tahseel/db/schema");
    await owner.insert(memberships).values({ tenantId: tenantA, userId: staffA.id, role: "staff" });
    // one debtor + invoice per tenant
    for (const [tenantId, phone] of [[tenantA, "+201001112223"], [tenantB, "+201004445556"]] as const) {
      const debtorId = uuidv7();
      await owner.insert(debtors).values({ id: debtorId, tenantId, displayName: "عميل", phoneE164: phone, phoneHash: hashPhone(phone) });
      await owner.insert(invoices).values({
        id: uuidv7(), tenantId, debtorId, amountMinor: 100_000n, issuedOn: "2026-11-01", dueOn: "2026-11-15", status: "open",
      });
    }
  });

  afterAll(async () => {
    const owner = ownerDb();
    // Tenant A is deleted by the test itself; B and users are cleaned here.
    await owner.delete(tenants).where(eq(tenants.id, tenantB));
    await owner.delete(tenantDeletions).where(eq(tenantDeletions.tenantName, "شركة الحذف أ"));
    await owner.delete(userTable).where(eq(userTable.id, ownerA.id));
    await owner.delete(userTable).where(eq(userTable.id, ownerB.id));
    await owner.delete(userTable).where(eq(userTable.id, staffA.id));
  });

  it("export contains only the caller's tenant data", async () => {
    const out = await appRouter.createCaller(ctxFor(ownerA)).tenantData.export();
    const parsed = JSON.parse(out.json) as { tenant: { id: string }; tables: Record<string, { tenantId?: string }[]>; rowCounts: Record<string, number> };
    expect(parsed.tenant.id).toBe(tenantA);
    expect(out.rowCounts.debtors).toBe(1);
    expect(out.rowCounts.invoices).toBe(1);
    for (const rows of Object.values(parsed.tables)) {
      for (const row of rows) if (row.tenantId) expect(row.tenantId).toBe(tenantA);
    }
    expect(out.json).not.toContain(tenantB);
    expect(out.json).not.toContain("+201004445556");
  });

  it("staff cannot delete; owner with wrong confirmation cannot delete", async () => {
    const staffCaller = appRouter.createCaller(ctxFor(staffA));
    await expect(staffCaller.tenantData.deleteAll({ confirmation: "DELETE" })).rejects.toThrow(/FORBIDDEN|owner/i);
    const ownerCaller = appRouter.createCaller(ctxFor(ownerA));
    await expect(ownerCaller.tenantData.deleteAll({ confirmation: "wrong name" })).rejects.toThrow(/business name or DELETE/i);
    // tenant A still fully present
    const still = await ownerDb().select().from(debtors).where(eq(debtors.tenantId, tenantA));
    expect(still).toHaveLength(1);
  });

  it("owner delete removes tenant A completely, leaves B identical, writes a tombstone", async () => {
    const before = await ownerDb().select().from(debtors).where(eq(debtors.tenantId, tenantB));
    const res = await appRouter.createCaller(ctxFor(ownerA)).tenantData.deleteAll({ confirmation: "شركة الحذف أ" });
    expect(res.rowCounts.debtors).toBe(1);
    const owner = ownerDb();
    expect(await owner.select().from(tenants).where(eq(tenants.id, tenantA))).toHaveLength(0);
    expect(await owner.select().from(debtors).where(eq(debtors.tenantId, tenantA))).toHaveLength(0);
    expect(await owner.select().from(invoices).where(eq(invoices.tenantId, tenantA))).toHaveLength(0);
    const after = await owner.select().from(debtors).where(eq(debtors.tenantId, tenantB));
    expect(after).toEqual(before);
    const tomb = await owner.select().from(tenantDeletions).where(and(eq(tenantDeletions.tenantName, "شركة الحذف أ")));
    expect(tomb).toHaveLength(1);
    expect(tomb[0]!.deletedByUserId).toBe(ownerA.id);
    expect(tomb[0]!.rowCounts.debtors).toBe(1);
  });
});
