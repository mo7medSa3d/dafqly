import { sha256Of } from "@tahseel/core/files-crypto";
import { createHash, createHmac } from "node:crypto";

/** Storage provider seam: private S3-compatible bucket with short-lived signed reads. */
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
export const UPLOAD_MIMES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const MAX_DOWNLOAD_BYTES = 16 * 1024 * 1024;
const MAX_S3_KEY_BYTES = 1024;
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export function validateUpload(input: { mime: string; size: number }): { ok: true } | { ok: false; code: "UNSUPPORTED_MIME" | "FILE_TOO_LARGE" | "EMPTY_FILE" } {
  if (!Number.isFinite(input.size) || input.size <= 0) return { ok: false, code: "EMPTY_FILE" };
  const normalizedMime = input.mime.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!(UPLOAD_MIMES as readonly string[]).includes(normalizedMime)) return { ok: false, code: "UNSUPPORTED_MIME" };
  if (input.size > MAX_UPLOAD_BYTES) return { ok: false, code: "FILE_TOO_LARGE" };
  return { ok: true };
}

// ---------------------------------------------------------------- S3 / MinIO

export interface S3StorageOptions {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  forcePathStyle?: boolean;
  allowInsecureLocal?: boolean;
  fetchFn?: (url: string, init: RequestInit) => Promise<Response>;
  now?: () => Date;
}

/**
 * S3-compatible private object storage using AWS Signature V4.
 * Supports AWS S3 and MinIO path-style endpoints without adding a runtime SDK.
 * Objects remain private; callers receive short-lived, read-only presigned URLs.
 */
export class S3CompatibleStorageProvider implements StorageProvider {
  private readonly endpoint: URL;
  private readonly fetchFn: (url: string, init: RequestInit) => Promise<Response>;
  private readonly now: () => Date;
  private readonly forcePathStyle: boolean;
  private cachedSignKey: { date: string; key: Buffer } | null = null;

  constructor(private readonly options: S3StorageOptions) {
    if (!options.endpoint || !options.bucket || !options.accessKey || !options.secretKey || !options.region) {
      throw new Error("S3 storage is not fully configured (endpoint, region, bucket, access key and secret key are required)");
    }
    this.endpoint = new URL(options.endpoint);
    const isHttp = this.endpoint.protocol === "http:" || this.endpoint.protocol === "https:";
    const isLoopback = this.endpoint.hostname === "localhost" || this.endpoint.hostname === "127.0.0.1" || this.endpoint.hostname === "[::1]";
    if (!isHttp || (this.endpoint.protocol !== "https:" && !options.allowInsecureLocal && !isLoopback)) {
      throw new Error("S3 storage endpoints must use HTTPS outside localhost");
    }
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(options.bucket) && !/^[a-zA-Z0-9._-]{1,63}$/.test(options.bucket)) {
      throw new Error("Invalid S3 bucket name");
    }
    this.fetchFn = options.fetchFn ?? ((url, init) => fetch(url, init));
    this.now = options.now ?? (() => new Date());
    this.forcePathStyle = options.forcePathStyle ?? true;
  }

  private objectUrl(key: string): URL {
    if (
      !key ||
      key.startsWith("/") ||
      key.includes("\\") ||
      /[\x00-\x1f\x7f]/.test(key) || // eslint-disable-line no-control-regex -- deliberate control-char rejection in S3 keys
      Buffer.byteLength(key, "utf8") > MAX_S3_KEY_BYTES ||
      key.split("/").some((part) => !part || part === "." || part === "..")
    ) {
      throw new Error("Invalid object storage key");
    }
    const url = new URL(this.endpoint.toString());
    const encodedKey = key.split("/").map(encodeRfc3986).join("/");
    if (this.forcePathStyle) {
      url.pathname = `${url.pathname.replace(/\/$/, "")}/${encodeRfc3986(this.options.bucket)}/${encodedKey}`;
    } else {
      url.hostname = `${this.options.bucket}.${url.hostname}`;
      url.pathname = `${url.pathname.replace(/\/$/, "")}/${encodedKey}`;
    }
    return url;
  }

  private signKey(date: string): Buffer {
    if (this.cachedSignKey?.date === date) return this.cachedSignKey.key;
    const dateKey = createHmac("sha256", `AWS4${this.options.secretKey}`).update(date).digest();
    const regionKey = createHmac("sha256", dateKey).update(this.options.region).digest();
    const serviceKey = createHmac("sha256", regionKey).update("s3").digest();
    const key = createHmac("sha256", serviceKey).update("aws4_request").digest();
    this.cachedSignKey = { date, key };
    return key;
  }

  private signedHeaders(method: string, url: URL, bodyHash: string, contentType?: string): Record<string, string> {
    const now = this.now();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const date = amzDate.slice(0, 8);
    const headers: Record<string, string> = {
      host: url.host,
      "x-amz-content-sha256": bodyHash,
      "x-amz-date": amzDate,
    };
    if (contentType) headers["content-type"] = contentType;
    const names = Object.keys(headers).sort();
    const canonicalHeaders = names.map((name) => `${name}:${headers[name]!.trim()}\n`).join("");
    const signedHeaders = names.join(";");
    const canonicalQuery = [...url.searchParams.entries()]
      .map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)] as const)
      .sort(([ak, av], [bk, bv]) => (ak === bk ? compareCodePoints(av, bv) : compareCodePoints(ak, bk)))
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
    const canonicalRequest = [method, url.pathname, canonicalQuery, canonicalHeaders, signedHeaders, bodyHash].join("\n");
    const scope = `${date}/${this.options.region}/s3/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${hashHex(canonicalRequest)}`;
    const signature = createHmac("sha256", this.signKey(date)).update(stringToSign).digest("hex");
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.options.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    return headers;
  }

  private async request(method: "PUT" | "GET" | "DELETE", key: string, bytes?: Uint8Array, mime?: string): Promise<Response> {
    const url = this.objectUrl(key);
    const bodyHash = bytes ? hashHex(bytes) : EMPTY_SHA256;
    const headers = this.signedHeaders(method, url, bodyHash, mime);
    return this.fetchFn(url.toString(), {
      method,
      headers,
      ...(bytes ? { body: bytes } : {}),
      signal: AbortSignal.timeout(30_000),
    } as RequestInit);
  }

  async put(key: string, bytes: Uint8Array, mime: string): Promise<void> {
    const response = await this.request("PUT", key, bytes, mime);
    if (!response.ok) {
      await response.body?.cancel?.().catch(() => undefined);
      throw new Error(`S3 upload failed (HTTP ${response.status})`);
    }
    await response.body?.cancel?.().catch(() => undefined);
  }

  async get(key: string): Promise<Uint8Array | null> {
    const response = await this.request("GET", key);
    if (response.status === 404) {
      await response.body?.cancel?.().catch(() => undefined);
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel?.().catch(() => undefined);
      throw new Error(`S3 download failed (HTTP ${response.status})`);
    }
    const contentLength = Number(response.headers?.get?.("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_DOWNLOAD_BYTES) {
      await response.body?.cancel?.().catch(() => undefined);
      throw new Error("S3 object exceeds 16 MB download limit");
    }
    if (response.body && typeof response.body.getReader === "function") {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!value) continue;
          total += value.byteLength;
          if (total > MAX_DOWNLOAD_BYTES) {
            await reader.cancel().catch(() => undefined);
            throw new Error("S3 object exceeds 16 MB download limit");
          }
          chunks.push(value);
        }
      } finally {
        try { reader.releaseLock(); } catch { /* already released */ }
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return bytes;
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_DOWNLOAD_BYTES) {
      throw new Error("S3 object exceeds 16 MB download limit");
    }
    return bytes;
  }

  async delete(key: string): Promise<void> {
    const response = await this.request("DELETE", key);
    await response.body?.cancel?.().catch(() => undefined);
    if (!response.ok && response.status !== 404) throw new Error(`S3 delete failed (HTTP ${response.status})`);
  }

  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 1 || expiresInSeconds > 604_800) {
      throw new Error("S3 presigned URL expiry must be between 1 second and 7 days");
    }
    const url = this.objectUrl(key);
    const now = this.now();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const date = amzDate.slice(0, 8);
    const scope = `${date}/${this.options.region}/s3/aws4_request`;
    const query: [string, string][] = [
      ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
      ["X-Amz-Credential", `${this.options.accessKey}/${scope}`],
      ["X-Amz-Date", amzDate],
      ["X-Amz-Expires", String(expiresInSeconds)],
      ["X-Amz-SignedHeaders", "host"],
    ];
    const canonicalQuery = query.map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)] as const)
      .sort(([a], [b]) => compareCodePoints(a, b)).map(([k, v]) => `${k}=${v}`).join("&");
    const canonicalRequest = ["GET", url.pathname, canonicalQuery, `host:${url.host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${hashHex(canonicalRequest)}`;
    const signature = createHmac("sha256", this.signKey(date)).update(stringToSign).digest("hex");
    url.search = `${canonicalQuery}&X-Amz-Signature=${signature}`;
    return url.toString();
  }
}

function hashHex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
function compareCodePoints(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}
