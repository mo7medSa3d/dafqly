import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { appRouter } from "./routers";
import { ownerDb, appDb } from "./db";
import { user as userTable, debtors, memberships, tenants } from "@tahseel/db/schema";
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
  const userA = { id: randomUUID().replace(/-/g, ""), email: `a-${randomUUID()}@example.test`, name: "A", emailVerified: true };
  const userB = { id: randomUUID().replace(/-/g, ""), email: `b-${randomUUID()}@example.test`, name: "B", emailVerified: true };
  const staffA = { id: randomUUID().replace(/-/g, ""), email: `staff-${randomUUID()}@example.test`, name: "Staff", emailVerified: true };
  let tenantA = "";
  let tenantB = "";
  const ctxFor = (u: typeof userA | null) => ({ user: u, headers: new Headers(), appDb: appDb(), ownerDb: ownerDb() });

  beforeAll(async () => {
    const owner = ownerDb();
    await owner.insert(userTable).values([userA, userB, staffA]);
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
    // M6: a staff member of tenant A (not its owner).
    await owner.insert(memberships).values({ tenantId: tenantA, userId: staffA.id, role: "staff" });
  });

  afterAll(async () => {
    const owner = ownerDb();
    await owner.delete(userTable).where(eq(userTable.id, userA.id));
    await owner.delete(userTable).where(eq(userTable.id, userB.id));
    await owner.delete(userTable).where(eq(userTable.id, staffA.id));
    // tenants cascade via memberships' tenant FK is on memberships; delete tenants explicitly:
    const { tenants } = await import("@tahseel/db/schema");
    await owner.delete(tenants).where(eq(tenants.id, tenantA));
    await owner.delete(tenants).where(eq(tenants.id, tenantB));
  });

  it("rejects unauthenticated calls", async () => {
    const caller = appRouter.createCaller(ctxFor(null));
    await expect(caller.tenant.mine()).rejects.toThrow();
  });

  it("F-06: an over-precision amount surfaces as 400 INVALID_AMOUNT, not a 500", async () => {
    // Own tenant: the shared tenantA fixtures assert exact debtor counts.
    const user = { id: randomUUID().replace(/-/g, ""), email: `f06-${randomUUID()}@example.test`, name: "F06", emailVerified: true };
    const owner = ownerDb();
    await owner.insert(userTable).values([user]);
    const tenant = (await createTenantForUser(appDb(), user.id, {
      businessNameAr: "شركة عملات", timezone: "Africa/Cairo", quietStart: "21:00", quietEnd: "09:00",
      fridayMorningSkip: false, defaultTermsDays: 14, tone: "polite", consent: true,
    })).tenantId;
    try {
      const caller = appRouter.createCaller(ctxFor(user));
      const debtor = await caller.debtors.create({ displayName: "عملات", phone: "01099990004" });
      const jpy = await caller.invoices.create({
        debtorId: debtor.id, amount: "500", currency: "JPY", issuedOn: "2026-11-01", dueOn: "2026-11-20",
      });
      let caught: unknown;
      try {
        await caller.payments.record({
          debtorId: debtor.id, amount: "100.5", method: "cash", receivedOn: "2026-11-05",
          allocations: [{ invoiceId: jpy.id, amount: "100.5" }],
        });
      } catch (e) { caught = e; }
      expect(caught).toBeDefined();
      // tRPC wraps the thrown AppError as the TRPCError's cause; the
      // route's responseMeta maps that cause to HTTP 400, and the
      // errorFormatter surfaces its code in the response body.
      expect((caught as { cause?: { code?: string } }).cause?.code).toBe("INVALID_AMOUNT");
      expect((caught as Error).message).toMatch(/JPY/);
    } finally {
      await owner.delete(tenants).where(eq(tenants.id, tenant));
      await owner.delete(userTable).where(eq(userTable.id, user.id));
    }
  });

  it("H5: with email verification enabled, an unverified user cannot use tenant procedures", async () => {
    const unverified = { id: randomUUID().replace(/-/g, ""), email: `uv-${randomUUID()}@example.test`, name: "UV", emailVerified: false };
    const owner = ownerDb();
    await owner.insert(userTable).values([unverified]);
    await owner.insert(memberships).values({ tenantId: tenantA, userId: unverified.id, role: "staff" });
    const prev = process.env.EMAIL_VERIFICATION_ENABLED;
    try {
      process.env.EMAIL_VERIFICATION_ENABLED = "1";
      const caller = appRouter.createCaller(ctxFor(unverified));
      await expect(caller.tenant.mine()).rejects.toThrow(/EMAIL_NOT_VERIFIED/);
      await expect(caller.debtors.list({})).rejects.toThrow(/EMAIL_NOT_VERIFIED/);
      // Same user, flag off: the gate is dormant and the call proceeds.
      delete process.env.EMAIL_VERIFICATION_ENABLED;
      const mine = await appRouter.createCaller(ctxFor(unverified)).tenant.mine();
      expect(mine.some((m) => m.tenantId === tenantA)).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.EMAIL_VERIFICATION_ENABLED;
      else process.env.EMAIL_VERIFICATION_ENABLED = prev;
      await owner.delete(userTable).where(eq(userTable.id, unverified.id));
    }
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

  it("M6: audit.list is owner-only — staff is FORBIDDEN, the owner reads it", async () => {
    const staffCaller = appRouter.createCaller(ctxFor(staffA));
    await expect(staffCaller.audit.list()).rejects.toThrowError(/Only workspace owners/);
    const ownerCaller = appRouter.createCaller(ctxFor(userA));
    const rows = await ownerCaller.audit.list();
    expect(Array.isArray(rows)).toBe(true);
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
