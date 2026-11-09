import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { appRouter } from "./routers";
import { ownerDb, appDb } from "./db";
import { user as userTable, debtors } from "@tahseel/db/schema";
import { createTenantForUser, hashPhone } from "./services";
import { v7 as uuidv7 } from "uuid";

/**
 * F0 acceptance at the API layer: a user in tenant A cannot read tenant B
 * rows through the tRPC procedures that exist in M0, unauthenticated calls
 * are rejected, and onboarding enforces consent. Real Postgres, real RLS.
 */
const hasDb = Boolean(process.env.DATABASE_URL && (process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL));
if (!hasDb && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 but DB env missing");
const d = hasDb ? describe : describe.skip;

d("tRPC tenant isolation + onboarding rules", () => {
  const userA = { id: randomUUID().replace(/-/g, ""), email: `a-${randomUUID()}@example.test`, name: "A" };
  const userB = { id: randomUUID().replace(/-/g, ""), email: `b-${randomUUID()}@example.test`, name: "B" };
  let tenantA = "";
  let tenantB = "";
  const ctxFor = (u: typeof userA | null) => ({ user: u, appDb: appDb(), ownerDb: ownerDb() });

  beforeAll(async () => {
    const owner = ownerDb();
    await owner.insert(userTable).values([userA, userB]);
    tenantA = (await createTenantForUser(appDb(), userA.id, {
      businessNameAr: "شركة أ", timezone: "Africa/Cairo", quietStart: "21:00", quietEnd: "09:00",
      fridayMorningSkip: false, defaultTermsDays: 14, tone: "polite", consent: true,
    })).tenantId;
    tenantB = (await createTenantForUser(appDb(), userB.id, {
      businessNameAr: "شركة ب", timezone: "Africa/Cairo", quietStart: "21:00", quietEnd: "09:00",
      fridayMorningSkip: false, defaultTermsDays: 14, tone: "polite", consent: true,
    })).tenantId;
    // A debtor that belongs to tenant B only, inserted as owner.
    await owner.insert(debtors).values({
      id: uuidv7(), tenantId: tenantB, displayName: "B-only debtor", phoneE164: "+201009999999",
      phoneHash: hashPhone("+201009999999"),
    });
  });

  afterAll(async () => {
    const owner = ownerDb();
    await owner.delete(userTable).where(eq(userTable.id, userA.id));
    await owner.delete(userTable).where(eq(userTable.id, userB.id));
    // tenants cascade via memberships' tenant FK is on memberships; delete tenants explicitly:
    const { tenants } = await import("@tahseel/db/schema");
    await owner.delete(tenants).where(eq(tenants.id, tenantA));
    await owner.delete(tenants).where(eq(tenants.id, tenantB));
  });

  it("rejects unauthenticated calls", async () => {
    const caller = appRouter.createCaller(ctxFor(null));
    await expect(caller.tenant.mine()).rejects.toThrow();
  });

  it("tenant A sees only its own (empty) debtor list; B's debtor is invisible", async () => {
    const callerA = appRouter.createCaller(ctxFor(userA));
    const page = await callerA.debtors.list({});
    expect(page.items).toEqual([]);
    const callerB = appRouter.createCaller(ctxFor(userB));
    const pageB = await callerB.debtors.list({});
    expect(pageB.items).toHaveLength(1);
    expect(pageB.items[0]?.displayName).toBe("B-only debtor");
  });

  it("dashboard summary is scoped: A has 0 debtors, B has 1", async () => {
    const sumA = await appRouter.createCaller(ctxFor(userA)).dashboard.summary();
    const sumB = await appRouter.createCaller(ctxFor(userB)).dashboard.summary();
    expect(sumA.debtors).toBe(0);
    expect(sumB.debtors).toBe(1);
    expect(sumA.totalOutstandingMinor).toBe("0");
  });

  it("onboarding without consent is rejected by validation", async () => {
    const caller = appRouter.createCaller(ctxFor(userA));
    await expect(
      caller.tenant.create({
        businessNameAr: "شركة جديدة", timezone: "Africa/Cairo", quietStart: "21:00", quietEnd: "09:00",
        fridayMorningSkip: false, defaultTermsDays: 14, tone: "polite",
        consent: false as unknown as true,
      }),
    ).rejects.toThrow();
  });
});
