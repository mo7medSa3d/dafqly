/**
 * In-memory token-bucket rate limiter for auth, public and webhook routes
 * (BUILD_PLAN §8). Per-instance only; a shared Redis limiter is a hardening
 * item for M6. Keys must not contain PII (use IP + route, never emails).
 *
 * H2 hardening:
 * - The client IP is NEVER the leftmost X-Forwarded-For entry (that is
 *   client-controlled). The trustworthy entry is `TRUSTED_PROXY_COUNT`
 *   positions from the right: each proxy appends the address it saw, so
 *   only entries added by a trusted proxy can be believed. Default is 1
 *   (one edge/reverse proxy in front of the app). With 0 trusted proxies
 *   the header is ignored entirely and the key falls back to `x-real-ip`
 *   or the shared "local" bucket (fail-closed: one shared throttle).
 * - Buckets expire: entries older than their window are swept, and the
 *   map is capped (MAX_BUCKETS) so spoofed keys cannot grow memory
 *   without bound.
 */
import { createHash } from "node:crypto";

/**
 * M9: a per-token bucket key for public statement routes. The token itself
 * never enters a key (it would leak into logs/metrics); only a SHA-256
 * prefix does — enough to throttle one statement link without identifying it.
 */
export function tokenBucketKey(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

export interface RateLimitResult { allowed: boolean; remaining: number; retryAfterSeconds: number }

interface Bucket { tokens: number; updatedAt: number; windowMs: number }
// shortcut: in-memory per-instance buckets only, upgrade to shared Redis store when running multiple web replicas
const buckets = new Map<string, Bucket>();
export const MAX_RATE_LIMIT_BUCKETS = 10_000;
const SWEEP_INTERVAL_MS = 10_000;
let lastSweepAt = Number.NEGATIVE_INFINITY;

/** Number of proxies between the client and this app that append to XFF. */
function trustedProxyCount(explicit?: number): number {
  if (explicit !== undefined) return Math.max(0, Math.floor(explicit));
  const raw = Number(process.env.TRUSTED_PROXY_COUNT ?? "1");
  return Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 1;
}

/**
 * Derive the client identity for rate limiting from request headers.
 * Never returns a client-controlled value as the identity.
 */
export function clientIp(headers: Headers, explicitTrustedProxies?: number): string {
  const trusted = trustedProxyCount(explicitTrustedProxies);
  const forwarded = headers.get("x-forwarded-for");
  if (trusted > 0 && forwarded) {
    const parts = forwarded.split(",").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) {
      // Index from the right: trusted proxies appended the last entries.
      const idx = Math.max(0, parts.length - trusted);
      return parts[idx]!;
    }
  }
  if (trusted > 0) {
    const realIp = headers.get("x-real-ip")?.trim();
    if (realIp) return realIp;
  }
  return "local";
}

/** Remove buckets whose window has fully elapsed. Returns how many were removed. */
export function sweepRateLimitBuckets(now = Date.now()): number {
  lastSweepAt = now;
  let removed = 0;
  for (const [key, bucket] of buckets) {
    if (now - bucket.updatedAt > bucket.windowMs) {
      buckets.delete(key);
      removed++;
    }
  }
  return removed;
}

/** Whether the next `rateLimit` call for this key would be allowed, without consuming a token. */
export function rateLimitPeek(key: string, opts: { limit: number; windowSeconds: number }, now = Date.now()): RateLimitResult {
  if (!Number.isFinite(opts.limit) || opts.limit <= 0 || !Number.isFinite(opts.windowSeconds) || opts.windowSeconds <= 0) {
    return { allowed: false, remaining: 0, retryAfterSeconds: 1 };
  }
  const windowMs = opts.windowSeconds * 1000;
  const refillPerMs = opts.limit / windowMs;
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.updatedAt > bucket.windowMs) return { allowed: true, remaining: opts.limit, retryAfterSeconds: 0 };
  const elapsed = Math.max(0, now - bucket.updatedAt);
  const tokens = Math.min(opts.limit, bucket.tokens + elapsed * refillPerMs);
  if (tokens >= 1) return { allowed: true, remaining: Math.floor(tokens) - 1, retryAfterSeconds: 0 };
  return { allowed: false, remaining: 0, retryAfterSeconds: Math.ceil((1 - tokens) / (refillPerMs * 1000)) };
}

export function rateLimit(key: string, opts: { limit: number; windowSeconds: number }, now = Date.now()): RateLimitResult {
  if (!Number.isFinite(opts.limit) || opts.limit <= 0 || !Number.isFinite(opts.windowSeconds) || opts.windowSeconds <= 0) {
    return { allowed: false, remaining: 0, retryAfterSeconds: 1 };
  }
  const windowMs = opts.windowSeconds * 1000;
  const refillPerMs = opts.limit / windowMs;
  let bucket = buckets.get(key);
  if (bucket && now - bucket.updatedAt > bucket.windowMs) {
    // Expired bucket: start fresh instead of refilling a stale one.
    buckets.delete(key);
    bucket = undefined;
  }
  if (!bucket) {
    // Bound memory in amortized O(1): sweep expired buckets at most once per
    // SWEEP_INTERVAL_MS, otherwise evict the least-recently-used Map head.
    if (buckets.size >= MAX_RATE_LIMIT_BUCKETS) {
      if (now - lastSweepAt >= SWEEP_INTERVAL_MS) {
        sweepRateLimitBuckets(now);
      }
      if (buckets.size >= MAX_RATE_LIMIT_BUCKETS) {
        const oldest = buckets.keys().next().value;
        if (oldest !== undefined) buckets.delete(oldest);
      }
    }
    bucket = { tokens: opts.limit, updatedAt: now, windowMs };
  } else {
    // Refresh Map insertion order so active keys stay at the tail (LRU).
    buckets.delete(key);
  }
  const elapsed = Math.max(0, now - bucket.updatedAt);
  bucket.tokens = Math.min(opts.limit, bucket.tokens + elapsed * refillPerMs);
  bucket.updatedAt = Math.max(now, bucket.updatedAt);
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    buckets.set(key, bucket);
    return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterSeconds: 0 };
  }
  buckets.set(key, bucket);
  return { allowed: false, remaining: 0, retryAfterSeconds: Math.ceil((1 - bucket.tokens) / (refillPerMs * 1000)) };
}

/** Test hook: reset all buckets. */
export function resetRateLimits(): void {
  buckets.clear();
  lastSweepAt = Number.NEGATIVE_INFINITY;
}

/** Test hook: how many buckets are currently tracked. */
export function rateLimitBucketCount(): number { return buckets.size; }
