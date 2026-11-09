import { describe, it, expect, beforeEach } from "vitest";
import { rateLimit, resetRateLimits } from "./rate-limit";

describe("rateLimit", () => {
  beforeEach(() => resetRateLimits());
  it("allows up to the limit, then blocks with a retry hint", () => {
    const opts = { limit: 3, windowSeconds: 60 };
    expect(rateLimit("ip1:sign-in", opts, 0).allowed).toBe(true);
    expect(rateLimit("ip1:sign-in", opts, 0).allowed).toBe(true);
    expect(rateLimit("ip1:sign-in", opts, 0).allowed).toBe(true);
    const blocked = rateLimit("ip1:sign-in", opts, 0);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });
  it("keys are independent and buckets refill over time", () => {
    const opts = { limit: 1, windowSeconds: 60 };
    expect(rateLimit("a", opts, 0).allowed).toBe(true);
    expect(rateLimit("b", opts, 0).allowed).toBe(true);
    expect(rateLimit("a", opts, 0).allowed).toBe(false);
    expect(rateLimit("a", opts, 61_000).allowed).toBe(true);
  });
});
