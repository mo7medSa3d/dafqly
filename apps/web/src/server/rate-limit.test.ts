import { describe, it, expect, beforeEach } from "vitest";
import {
  clientIp, rateLimit, rateLimitBucketCount, rateLimitPeek, resetRateLimits,
  sweepRateLimitBuckets, MAX_RATE_LIMIT_BUCKETS,
} from "./rate-limit";

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
  it("expired buckets are swept and do not refill stale state", () => {
    const opts = { limit: 1, windowSeconds: 60 };
    expect(rateLimit("sweep-me", opts, 0).allowed).toBe(true);
    expect(rateLimit("sweep-me", opts, 0).allowed).toBe(false);
    expect(sweepRateLimitBuckets(61_000)).toBe(1);
    expect(rateLimitBucketCount()).toBe(0);
    expect(rateLimit("sweep-me", opts, 61_000).allowed).toBe(true);
  });
  it("the bucket map is capped: 10k spoofed keys cannot grow it without bound", () => {
    const opts = { limit: 1, windowSeconds: 60 };
    for (let i = 0; i < MAX_RATE_LIMIT_BUCKETS + 50; i++) {
      rateLimit(`spoof-${i}`, opts, 0);
    }
    expect(rateLimitBucketCount()).toBeLessThanOrEqual(MAX_RATE_LIMIT_BUCKETS);
  });
  it("peek reports the next call without consuming a token", () => {
    const opts = { limit: 1, windowSeconds: 60 };
    expect(rateLimitPeek("peek", opts, 0).allowed).toBe(true);
    expect(rateLimitPeek("peek", opts, 0).allowed).toBe(true);
    expect(rateLimit("peek", opts, 0).allowed).toBe(true);
    expect(rateLimitPeek("peek", opts, 0).allowed).toBe(false);
  });
});

describe("clientIp (H2)", () => {
  const headers = (xff?: string, realIp?: string) => new Headers({
    ...(xff ? { "x-forwarded-for": xff } : {}),
    ...(realIp ? { "x-real-ip": realIp } : {}),
  });
  it("never trusts the leftmost XFF entry: one trusted proxy takes the rightmost", () => {
    // Client claims to be 9.9.9.9; the edge proxy saw 1.2.3.4.
    expect(clientIp(headers("9.9.9.9, 1.2.3.4"), 1)).toBe("1.2.3.4");
    expect(clientIp(headers("9.9.9.9"), 1)).toBe("9.9.9.9");
  });
  it("two trusted proxies take the entry two from the right", () => {
    expect(clientIp(headers("9.9.9.9, 10.0.0.1, 1.2.3.4"), 2)).toBe("10.0.0.1");
  });
  it("zero trusted proxies ignore XFF entirely (fail-closed shared bucket)", () => {
    expect(clientIp(headers("9.9.9.9, 1.2.3.4", "5.6.7.8"), 0)).toBe("5.6.7.8");
    expect(clientIp(headers("9.9.9.9, 1.2.3.4"), 0)).toBe("local");
  });
  it("no XFF falls back to x-real-ip, then local", () => {
    expect(clientIp(headers(undefined, "5.6.7.8"), 1)).toBe("5.6.7.8");
    expect(clientIp(headers(), 1)).toBe("local");
  });
});
