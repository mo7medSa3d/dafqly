import { describe, it, expect } from "vitest";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { appRouter } from "./routers";

/**
 * §9 security check (M6): EVERY route requires auth unless it is on this
 * explicit public allowlist. The test walks the real app directory: a new
 * route.ts/page.tsx that nobody classified FAILS the suite, and a stale
 * allowlist entry (route deleted) fails too. tRPC procedures are checked
 * behaviourally: called with no session, every procedure except the
 * single public `health` probe must throw UNAUTHORIZED before any DB
 * access (ctx carries no db handles in this test, so a pass proves the
 * auth middleware runs first).
 */
const APP_DIR = new URL("../../app", import.meta.url).pathname;

type RouteClass = "public" | "session";
const CLASSIFICATION: Record<string, RouteClass> = {
  // Public allowlist — each is safe WITHOUT a session by design:
  "healthz/route.ts": "public", // liveness probe, no data
  "readyz/route.ts": "public", // readiness probe, no data
  "api/auth/[...all]/route.ts": "public", // Better Auth sign-in/sign-up endpoints (rate-limited, M0)
  "api/webhooks/whatsapp/route.ts": "public", // HMAC signature verified before anything is stored (M2)
  "api/webhooks/paymob/route.ts": "public", // HMAC-SHA512 verified before fulfilment (M3)
  "api/public/statement/[token]/route.ts": "public", // 32-byte hash token + per-IP rate limit (M3)
  "api/public/statement/[token]/dispute/route.ts": "public", // same token gate
  "api/public/statement/[token]/pay/route.ts": "public", // same token gate
  "s/[token]/page.tsx": "public", // statement page behind the same unguessable token
  "[locale]/login/page.tsx": "public", // sign-in form (redirects away when signed in)
  "[locale]/signup/page.tsx": "public", // sign-up form (rate-limited by the auth limiter)
  // Everything else requires a session:
  "api/trpc/[trpc]/route.ts": "session", // procedures enforce auth individually (proven below)
  "[locale]/page.tsx": "session",
  "[locale]/onboarding/page.tsx": "session",
  "[locale]/dashboard/page.tsx": "session",
  "[locale]/debtors/page.tsx": "session",
  "[locale]/debtors/[id]/page.tsx": "session",
  "[locale]/invoices/page.tsx": "session",
  "[locale]/import/page.tsx": "session",
  "[locale]/ledger-photo/page.tsx": "session",
  "[locale]/cheques/page.tsx": "session",
  "[locale]/ai-inbox/page.tsx": "session",
  "[locale]/billing/page.tsx": "session",
  "[locale]/settings/page.tsx": "session",
};

function walk(dir: string, base: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, base));
    else if (name === "route.ts" || name === "page.tsx") out.push(relative(base, p));
  }
  return out;
}

describe("route auth allowlist (§9, M6)", () => {
  it("every route/page on disk is classified, and every classification exists", () => {
    const discovered = walk(APP_DIR, APP_DIR).sort();
    const classified = Object.keys(CLASSIFICATION).sort();
    expect(discovered).toEqual(classified);
  });

  it("the public allowlist is exactly the documented set", () => {
    const publics = Object.entries(CLASSIFICATION).filter(([, v]) => v === "public").map(([k]) => k);
    expect(publics).toHaveLength(11);
  });

  it("every tRPC procedure except `health` rejects unauthenticated calls", async () => {
    const defs = (appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures;
    const paths = Object.keys(defs);
    expect(paths.length).toBeGreaterThan(50);
    expect(paths).toContain("tenantData.deleteAll");
    const caller = (appRouter as unknown as {
      createCaller: (ctx: unknown) => Record<string, Record<string, (input?: unknown) => Promise<unknown>>>;
    }).createCaller({ user: null, appDb: undefined, ownerDb: undefined });
    for (const path of paths) {
      const fn = path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], caller) as (input?: unknown) => Promise<unknown>;
      if (path === "health") {
        await expect(fn()).resolves.toEqual({ ok: true });
        continue;
      }
      const err = await fn(undefined).catch((e: unknown) => e) as { code?: string };
      expect(err.code, `${path} must reject unauthenticated calls`).toBe("UNAUTHORIZED");
    }
  });
});
