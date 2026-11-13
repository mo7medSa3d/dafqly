import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { ownerDb, appDb } from "./db";
import { user as userTable, tenants } from "@tahseel/db/schema";
import { createTenantForUser, listTenantsForUser } from "./services";

/**
 * M1: tenant resolution is deterministic. A user with two memberships must
 * always resolve the same (oldest) tenant first — every caller takes mine[0].
 */
const hasDb = Boolean(process.env.DATABASE_URL && (process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL));
if (!hasDb && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 but DB env missing");
const d = hasDb ? describe : describe.skip;

d("listTenantsForUser (M1)", () => {
  const user = { id: randomUUID().replace(/-/g, ""), email: `svc-${randomUUID()}@example.test`, name: "SVC" };
  let first = "";
  let second = "";
  const input = (name: string) => ({
    businessNameAr: name, timezone: "Africa/Cairo", quietStart: "21:00", quietEnd: "09:00",
    fridayMorningSkip: false, defaultTermsDays: 14, tone: "polite" as const, consent: true as const,
  });

  beforeAll(async () => {
    await ownerDb().insert(userTable).values([user]);
    first = (await createTenantForUser(appDb(), user.id, input("شركة أولى"))).tenantId;
    second = (await createTenantForUser(appDb(), user.id, input("شركة ثانية"))).tenantId;
  });
  afterAll(async () => {
    const owner = ownerDb();
    await owner.delete(tenants).where(eq(tenants.id, first));
    await owner.delete(tenants).where(eq(tenants.id, second));
    await owner.delete(userTable).where(eq(userTable.id, user.id));
  });

  it("returns memberships oldest-first, identically on repeated calls", async () => {
    const one = await listTenantsForUser(ownerDb(), user.id);
    const two = await listTenantsForUser(ownerDb(), user.id);
    expect(one.map((t) => t.tenantId)).toEqual([first, second]);
    expect(two.map((t) => t.tenantId)).toEqual([first, second]);
  });
});
