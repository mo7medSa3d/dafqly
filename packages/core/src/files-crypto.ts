import { createHash } from "node:crypto";

/**
 * Server-only file hashing (F6/F7): the receipt duplicate check keys on the
 * image sha256 (§5 files table). Deliberately NOT exported from the
 * `@tahseel/core` barrel — `node:crypto` must never enter the client bundle
 * (the M3 lesson that produced the payments-crypto subpath). Import via
 * `@tahseel/core/files-crypto`.
 */
export function sha256Of(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
