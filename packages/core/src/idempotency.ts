import { AppError } from "./errors";

/**
 * Guard for POST endpoints that trigger sends (BUILD_PLAN F0): they must carry
 * an Idempotency-Key header. First applied to a real send endpoint in M2;
 * the guard itself is built and tested in M0.
 */
export function requireIdempotencyKey(headers: Headers): string {
  const key = headers.get("idempotency-key");
  if (!key || key.length < 8 || key.length > 128) {
    throw new AppError("IDEMPOTENCY_KEY_REQUIRED", "POST endpoints that trigger sends require an Idempotency-Key header (8-128 chars)", 400);
  }
  return key;
}
