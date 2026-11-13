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
const buckets = new Map<string, Bucket>();
export const MAX_RATE_LIMIT_BUCKETS = 10_000;

/** Number of proxies between the client and this app that append to XFF. */
export function trustedProxyCount(explicit?: number): number {
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
  return headers.get("x-real-ip")?.trim() || "local";
}

/** Remove buckets whose window has fully elapsed. Returns how many were removed. */
export function sweepRateLimitBuckets(now = Date.now()): number {
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
  const windowMs = opts.windowSeconds * 1000;
  const refillPerMs = opts.limit / windowMs;
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.updatedAt > bucket.windowMs) return { allowed: true, remaining: opts.limit, retryAfterSeconds: 0 };
  const tokens = Math.min(opts.limit, bucket.tokens + (now - bucket.updatedAt) * refillPerMs);
  if (tokens >= 1) return { allowed: true, remaining: Math.floor(tokens) - 1, retryAfterSeconds: 0 };
  return { allowed: false, remaining: 0, retryAfterSeconds: Math.ceil((1 - tokens) / (refillPerMs * 1000)) };
}

export function rateLimit(key: string, opts: { limit: number; windowSeconds: number }, now = Date.now()): RateLimitResult {
  const windowMs = opts.windowSeconds * 1000;
  const refillPerMs = opts.limit / windowMs;
  let bucket = buckets.get(key);
  if (bucket && now - bucket.updatedAt > bucket.windowMs) {
    // Expired bucket: start fresh instead of refilling a stale one.
    buckets.delete(key);
    bucket = undefined;
  }
  if (!bucket) {
    // Bound memory: sweep expired buckets first, then drop the oldest key.
    if (buckets.size >= MAX_RATE_LIMIT_BUCKETS) {
      sweepRateLimitBuckets(now);
      if (buckets.size >= MAX_RATE_LIMIT_BUCKETS) {
        const oldest = buckets.keys().next().value;
        if (oldest !== undefined) buckets.delete(oldest);
      }
    }
    bucket = { tokens: opts.limit, updatedAt: now, windowMs };
  }
  bucket.tokens = Math.min(opts.limit, bucket.tokens + (now - bucket.updatedAt) * refillPerMs);
  bucket.updatedAt = now;
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    buckets.set(key, bucket);
    return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterSeconds: 0 };
  }
  buckets.set(key, bucket);
  return { allowed: false, remaining: 0, retryAfterSeconds: Math.ceil((1 - bucket.tokens) / (refillPerMs * 1000)) };
}

/** Test hook: reset all buckets. */
export function resetRateLimits(): void { buckets.clear(); }

/** Test hook: how many buckets are currently tracked. */
export function rateLimitBucketCount(): number { return buckets.size; }
