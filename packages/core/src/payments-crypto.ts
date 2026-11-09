import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { paymobHmacMessage, STATEMENT_TOKEN_BYTES, type PaymobTxnLike } from "./payments";

/**
 * Server-only crypto for F5/F10 (ADR-019/020): Paymob HMAC-SHA512 and
 * statement-token minting/hashing. This module is deliberately NOT exported
 * from the `@tahseel/core` barrel — the barrel is imported by client
 * components, and `node:crypto` must never enter the browser bundle.
 * Import it via the `@tahseel/core/payments-crypto` subpath.
 */

/** HMAC-SHA512 (never SHA-256, ADR-019), hex lowercase. */
export function computePaymobHmac(obj: PaymobTxnLike, secret: string): string {
  return createHmac("sha512", secret).update(paymobHmacMessage(obj), "utf8").digest("hex");
}

export function verifyPaymobHmac(obj: PaymobTxnLike, received: string | undefined | null, secret: string): boolean {
  if (!received) return false;
  const computed = Buffer.from(computePaymobHmac(obj, secret), "utf8");
  const given = Buffer.from(received, "utf8");
  return computed.length === given.length && timingSafeEqual(computed, given);
}

/** Mint a statement token: 32 random bytes, base64url (43 chars). Only the hash is ever stored (ADR-020). */
export function generateStatementToken(): { token: string; tokenHash: string } {
  const token = randomBytes(STATEMENT_TOKEN_BYTES).toString("base64url");
  return { token, tokenHash: hashStatementToken(token) };
}

export function hashStatementToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
