import { describe, it, expect } from "vitest";
import { createDb, createAppDb } from "@tahseel/db";
import { FakeClock, FakeMessagingProvider } from "@tahseel/providers";
import type { EngineDeps } from "@tahseel/reminders";
import { processPlannerTick, processDispatchTick } from "./processors";

/**
 * Worker tick wiring (M2): ticks call the real engine. Against an empty
 * tenant set they are clean no-ops. DB-backed like the engine suites.
 */
const ownerUrl = process.env.DATABASE_URL;
const appUrl = process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL;
if (!ownerUrl || !appUrl) {
  if (process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 but DATABASE_URL/APP_DATABASE_URL are not set");
  console.warn("[worker processors] SKIPPED: DATABASE_URL/APP_DATABASE_URL not set");
}
const d = ownerUrl && appUrl ? describe : describe.skip;

d("worker processors (M2 engine wiring)", () => {
  it("planner + dispatch ticks run against the engine and report the injected clock", async () => {
    const engine: EngineDeps = {
      app: createAppDb(appUrl!).db,
      owner: createDb(ownerUrl!).db,
      providers: { whatsapp: new FakeMessagingProvider(), sms: new FakeMessagingProvider() },
      globalPaused: true, // dispatch must change nothing in this wiring test
    };
    const clock = new FakeClock(new Date("2026-11-09T00:00:00Z"));
    const planned = await processPlannerTick({ clock, engine, dryRun: true, tenantId: "00000000-0000-7000-8000-000000000000" });
    expect(planned.at).toBe("2026-11-09T00:00:00.000Z");
    expect(planned.planned).toBeGreaterThanOrEqual(0);
    const dispatched = await processDispatchTick({ clock, engine, dryRun: true });
    expect(dispatched.sent).toBe(0);
    expect(dispatched.dryRun).toBe(true);
    await engine.app.$client.end();
    await engine.owner.$client.end();
  });
});
