import { sha256Of } from "@tahseel/core/files-crypto";

/** Storage provider (BUILD_PLAN §3): S3-compatible, private bucket, signed URLs. M0 ships the in-memory fake; MinIO/S3 adapter lands with F2/F6 uploads. */
export interface StorageProvider {
  put(key: string, bytes: Uint8Array, mime: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string>;
}

/** FAKE in-memory storage for dev/tests. */
export class FakeStorageProvider implements StorageProvider {
  readonly objects = new Map<string, { bytes: Uint8Array; mime: string }>();
  async put(key: string, bytes: Uint8Array, mime: string): Promise<void> {
    this.objects.set(key, { bytes, mime });
  }
  async get(key: string): Promise<Uint8Array | null> {
    return this.objects.get(key)?.bytes ?? null;
  }
  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
  async getSignedUrl(key: string, _expiresInSeconds: number): Promise<string> {
    if (!this.objects.has(key)) throw new Error(`fake storage: no such key ${key}`);
    return `https://storage.example.invalid/fake/${encodeURIComponent(key)}?signed=1`;
  }
}

/** sha256 hex of an upload — the F7 duplicate-receipt detector keys on this. */
export function computeSha256(bytes: Uint8Array): string {
  return sha256Of(bytes);
}

// ------------------------------------------------------------------ uploads
/** §3 upload allowlist: images only, max 8 MB. */
export const UPLOAD_MIMES = ["image/jpeg", "image/png", "image/webp", "image/heic"] as const;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export function validateUpload(input: { mime: string; size: number }): { ok: true } | { ok: false; code: "UNSUPPORTED_MIME" | "FILE_TOO_LARGE" | "EMPTY_FILE" } {
  if (input.size <= 0) return { ok: false, code: "EMPTY_FILE" };
  if (!(UPLOAD_MIMES as readonly string[]).includes(input.mime)) return { ok: false, code: "UNSUPPORTED_MIME" };
  if (input.size > MAX_UPLOAD_BYTES) return { ok: false, code: "FILE_TOO_LARGE" };
  return { ok: true };
}
