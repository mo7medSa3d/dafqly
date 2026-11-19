import { describe, it, expect, vi } from "vitest";
import { createDb, createAppDb, withAdvisoryLock, type Db } from "@tahseel/db";
import { FakeClock, FakeMessagingProvider } from "@tahseel/providers";
import type { EngineDeps } from "@tahseel/reminders";
import {
  InvalidJobPayloadError,
  processPlannerTick, processDispatchTick,
  processReplanInvoice, processReplanTenant,
  replayFailedWebhooksWithLock,
  type TickDeps,
} from "./processors";

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

describe("worker processor payload validation", () => {
  const stubDeps = {
    clock: new FakeClock(new Date("2026-11-09T00:00:00Z")),
    engine: {} as EngineDeps,
    dryRun: true,
  } satisfies TickDeps;

  it("rejects missing or blank ids in processReplanInvoice", async () => {
    await expect(processReplanInvoice(stubDeps, { tenantId: "", invoiceId: "inv-1" })).rejects.toBeInstanceOf(InvalidJobPayloadError);
    await expect(processReplanInvoice(stubDeps, { tenantId: "t-1", invoiceId: "   " })).rejects.toBeInstanceOf(InvalidJobPayloadError);
  });

  it("rejects missing or blank tenantId in processReplanTenant", async () => {
    await expect(processReplanTenant(stubDeps, { tenantId: "" })).rejects.toBeInstanceOf(InvalidJobPayloadError);
    await expect(processReplanTenant(stubDeps, { tenantId: "   " })).rejects.toBeInstanceOf(InvalidJobPayloadError);
  });
});

describe("webhook replay single-flight advisory lock", () => {
  function createMockLockDb() {
    let held = false;
    const db = {
      transaction: async <T>(fn: (tx: { execute: () => Promise<{ locked: boolean }[]> }) => Promise<T>): Promise<T> => {
        let acquiredHere = false;
        const tx = {
          execute: async () => {
            if (held) return [{ locked: false }];
            held = true;
            acquiredHere = true;
            return [{ locked: true }];
          },
        };
        try {
          return await fn(tx);
        } finally {
          if (acquiredHere) held = false;
        }
      },
    };
    return db as unknown as Db;
  }

  it("skips replay immediately when another replica holds the advisory lock", async () => {
    const owner = {
      transaction: async <T>(fn: (tx: { execute: () => Promise<{ locked: boolean }[]> }) => Promise<T>) =>
        fn({ execute: async () => [{ locked: false }] }),
    } as unknown as Db;
    const replayFn = vi.fn(async () => ({ replayed: 4, failed: 0 }));

    const result = await replayFailedWebhooksWithLock(
      { owner } as EngineDeps,
      new Date("2026-11-09T00:00:00Z"),
      replayFn,
    );

    expect(replayFn).not.toHaveBeenCalled();
    expect(result).toEqual({ replayed: 0, failed: 0, skippedLocked: true });
  });

  it("allows only one concurrent replica to replay and releases the lock afterward", async () => {
    const owner = createMockLockDb();
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const replayFn = vi.fn(async () => {
      await firstGate;
      return { replayed: 3, failed: 1 };
    });
    const engine = { owner } as EngineDeps;
    const now = new Date("2026-11-09T00:00:00Z");

    const firstRun = replayFailedWebhooksWithLock(engine, now, replayFn);
    // Let firstRun enter transaction and acquire the advisory lock before replica 2 arrives.
    await Promise.resolve();
    const secondResult = await replayFailedWebhooksWithLock(engine, now, replayFn);
    expect(secondResult).toEqual({ replayed: 0, failed: 0, skippedLocked: true });

    releaseFirst();
    const firstResult = await firstRun;
    expect(firstResult).toEqual({ replayed: 3, failed: 1, skippedLocked: false });
    expect(replayFn).toHaveBeenCalledTimes(1);

    // Once the transaction finishes, the lock is released and a subsequent tick can acquire it.
    const thirdResult = await replayFailedWebhooksWithLock(engine, now, async () => ({ replayed: 1, failed: 0 }));
    expect(thirdResult).toEqual({ replayed: 1, failed: 0, skippedLocked: false });
  });

  it("rejects non-integer lock keys in withAdvisoryLock", async () => {
    const owner = createMockLockDb();
    await expect(withAdvisoryLock(owner, 1.5, async () => "ok")).rejects.toThrow(/safe integer/);
  });
});

d("worker processors (M2 engine wiring)", () => {
  it("planner + dispatch ticks run against the engine and report the injected clock", async () => {
    const engine: EngineDeps = {
      app: createAppDb(appUrl!).db,
      owner: createDb(ownerUrl!).db,
      providers: { whatsapp: new FakeMessagingProvider(), sms: new FakeMessagingProvider() },
      globalPaused: true, // dispatch must change nothing in this wiring test
    };
    try {
      const clock = new FakeClock(new Date("2026-11-09T00:00:00Z"));
      const planned = await processPlannerTick({ clock, engine, dryRun: true, tenantId: "00000000-0000-7000-8000-000000000000" });
      expect(planned.at).toBe("2026-11-09T00:00:00.000Z");
      expect(planned.planned).toBeGreaterThanOrEqual(0);
      const dispatched = await processDispatchTick({ clock, engine, dryRun: true });
      expect(dispatched.sent).toBe(0);
      expect(dispatched.dryRun).toBe(true);
    } finally {
      await engine.app.$client.end();
      await engine.owner.$client.end();
    }
  });
});
