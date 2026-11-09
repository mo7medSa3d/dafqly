import { describe, it, expect } from "vitest";
import { quotaStatus, planAllowsSending, planByKey, PLANS_SEED } from "./plans";

describe("quotaStatus (F13: warn 80%, block 100%)", () => {
  it("states at boundaries", () => {
    expect(quotaStatus({ usedUnits: 79, quota: 100 }).state).toBe("ok");
    expect(quotaStatus({ usedUnits: 80, quota: 100 }).state).toBe("warn");
    expect(quotaStatus({ usedUnits: 99, quota: 100 }).state).toBe("warn");
    expect(quotaStatus({ usedUnits: 100, quota: 100 }).state).toBe("exceeded");
    expect(quotaStatus({ usedUnits: 250, quota: 100 })).toMatchObject({ state: "exceeded", ratio: 2.5 });
  });
  it("unlimited never blocks", () => {
    expect(quotaStatus({ usedUnits: 1_000_000, quota: null }).state).toBe("ok");
  });
  it("seed plans exist with quotas (prices are placeholders)", () => {
    expect(PLANS_SEED.map((p) => p.key)).toEqual(["trial", "starter", "growth"]);
    expect(planByKey("starter")?.monthlyMessageQuota).toBe(500);
  });
});

describe("planAllowsSending (matches engine trial behaviour)", () => {
  const now = new Date("2026-11-09T10:00:00Z");
  it("trial past trial_ends_at is blocked; before is allowed", () => {
    expect(planAllowsSending({ plan: "trial", trialEndsAt: new Date("2026-11-01T00:00:00Z") }, now)).toBe(false);
    expect(planAllowsSending({ plan: "trial", trialEndsAt: new Date("2026-12-01T00:00:00Z") }, now)).toBe(true);
    expect(planAllowsSending({ plan: "trial", trialEndsAt: null }, now)).toBe(true);
  });
  it("paid plans are never blocked by an old trial date", () => {
    expect(planAllowsSending({ plan: "starter", trialEndsAt: new Date("2026-11-01T00:00:00Z") }, now)).toBe(true);
  });
});
