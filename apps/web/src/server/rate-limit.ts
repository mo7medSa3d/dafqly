/**
 * Minimal in-memory token-bucket rate limiter for auth and public routes
 * (BUILD_PLAN §8). Per-instance only; a shared Redis limiter is a hardening
 * item for M6. Keys must not contain PII (use IP + route, never emails).
 */
export interface RateLimitResult { allowed: boolean; remaining: number; retryAfterSeconds: number }

interface Bucket { tokens: number; updatedAt: number }
const buckets = new Map<string, Bucket>();

export function rateLimit(key: string, opts: { limit: number; windowSeconds: number }, now = Date.now()): RateLimitResult {
  const refillPerMs = opts.limit / (opts.windowSeconds * 1000);
  const existing = buckets.get(key);
  const bucket: Bucket = existing ?? { tokens: opts.limit, updatedAt: now };
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
