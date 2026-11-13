import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { ownerDb, appDb } from "./db";
import { user as userTable, tenants, aiGlobalBudget } from "@tahseel/db/schema";
import { AppError } from "@tahseel/core";
import { createTenantForUser } from "./services";
import {
  estimateAiCostUsdMicros, reserveGlobalAiBudget, settleGlobalAiBudget,
  releaseGlobalAiBudget,
} from "./ai-budget";

/**
 * Prompt 04 §9: the monthly AI cap must hold under concurrency, usage must
 * be tracked per tenant, and settle/release must reconcile reserved money
 * to spent/released exactly. The reserve path is a single tx with
 * SELECT … FOR UPDATE on the singleton budget row, so concurrent
 * reservations serialize; this test proves it by firing 40 at once.
 *
 * The cap/reserve come from the process env (defaults $50 / $1.50), so
 * exactly floor(50 / 1.5) = 33 reservations fit and the rest must fail.
 * Every successful reservation is released afterwards, so the suite
 * leaves the budget row empty for the next run.
 */
const hasDb = Boolean(process.env.DATABASE_URL && (process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL));
if (!hasDb && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 but DB env missing");
const d = hasDb ? describe : describe.skip;

d("Prompt 04 §9: global AI budget under concurrency", () => {
  const user = { id: randomUUID().replace(/-/g, ""), email: `aib-${randomUUID()}@example.test`, name: "AIB" };
  let tenantId = "";
  const owner = () => ownerDb();

  beforeAll(async () => {
    await ownerDb().delete(aiGlobalBudget);
    await ownerDb().insert(userTable).values([user]);
    tenantId = (await createTenantForUser(appDb(), user.id, {
      businessNameAr: "شركة الميزانية", timezone: "Africa/Cairo", quietStart: "21:00", quietEnd: "09:00",
      fridayMorningSkip: false, defaultTermsDays: 14, tone: "polite", consent: true,
    })).tenantId;
  });
  afterAll(async () => {
    const o = ownerDb();
    await o.delete(tenants).where(eq(tenants.id, tenantId));
    await o.delete(userTable).where(eq(userTable.id, user.id));
  });

  it("40 concurrent reservations fit exactly floor(cap / reserve) — the rest fail, none over-reserve", async () => {
    const keys = Array.from({ length: 40 }, () => randomUUID());
    const settled = await Promise.allSettled(
      keys.map((key) => reserveGlobalAiBudget(owner(), tenantId, key, "gemini-3.8-flash")),
    );
    const ok = settled.filter((r) => r.status === "fulfilled");
    const failed = settled.filter((r) => r.status === "rejected");
    // Defaults: cap $50, reserve $1.50 → 33 fit ($49.50), the 34th would
    // need $51.00 > $50.
    expect(ok.length).toBe(33);
    expect(failed.length).toBe(7);
    for (const f of failed) {
      expect((f as PromiseRejectedResult).reason).toBeInstanceOf(AppError);
      expect(((f as PromiseRejectedResult).reason as AppError).code).toBe("AI_GLOBAL_BUDGET_EXCEEDED");
    }
    // The budget row shows exactly the 33 reservations, no more.
    const [row] = await owner().select().from(aiGlobalBudget).where(eq(aiGlobalBudget.singletonId, 1));
    expect(row?.reservedUsdMicros).toBe(33n * 1_500_000n);
    // Cleanup: release exactly the reservations that succeeded (the
    // winners are whichever txs took the row lock first — not necessarily
    // the first 33 keys — so collect them from the settled results).
    const okKeys = settled.flatMap((r, i) => r.status === "fulfilled" ? [keys[i]!] : []);
    await Promise.all(okKeys.map((key) => releaseGlobalAiBudget(owner(), key)));
    const [clean] = await owner().select().from(aiGlobalBudget).where(eq(aiGlobalBudget.singletonId, 1));
    expect(clean?.reservedUsdMicros).toBe(0n);
  });

  it("settle converts reserved to spent at the actual token cost; release returns the rest", async () => {
    const settleKey = randomUUID();
    const releaseKey = randomUUID();
    const [before] = await owner().select().from(aiGlobalBudget).where(eq(aiGlobalBudget.singletonId, 1));
    const spentBefore = before?.spentUsdMicros ?? 0n;
    const reservedBefore = before?.reservedUsdMicros ?? 0n;

    await reserveGlobalAiBudget(owner(), tenantId, settleKey, "gemini-3.8-flash");
    await reserveGlobalAiBudget(owner(), tenantId, releaseKey, "gemini-3.8-flash");
    // 1,000 in + 1,000 out on gemini-3.8-flash ($0.75/$3.75 per M) = 4,500 micros.
    await settleGlobalAiBudget(owner(), settleKey, 1000, 1000, "gemini-3.8-flash");
    expect(estimateAiCostUsdMicros("gemini-3.8-flash", 1000, 1000)).toBe(4500n);
    await releaseGlobalAiBudget(owner(), releaseKey);

    const [after] = await owner().select().from(aiGlobalBudget).where(eq(aiGlobalBudget.singletonId, 1));
    expect(after?.spentUsdMicros).toBe(spentBefore + 4500n);
    expect(after?.reservedUsdMicros).toBe(reservedBefore);
    // Settling twice is a no-op (the usage row is no longer "reserved").
    await settleGlobalAiBudget(owner(), settleKey, 1000, 1000, "gemini-3.8-flash");
    const [twice] = await owner().select().from(aiGlobalBudget).where(eq(aiGlobalBudget.singletonId, 1));
    expect(twice?.spentUsdMicros).toBe(spentBefore + 4500n);
  });
});
