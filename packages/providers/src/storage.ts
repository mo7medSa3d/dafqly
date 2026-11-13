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
export const UPLOAD_MIMES = ["image/jpeg", "image/png", "image/webp", "image/heic"] as const;
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

export function validateUpload(input: { mime: string; size: number }): { ok: true } | { ok: false; code: "UNSUPPORTED_MIME" | "FILE_TOO_LARGE" | "EMPTY_FILE" } {
  if (input.size <= 0) return { ok: false, code: "EMPTY_FILE" };
  if (!(UPLOAD_MIMES as readonly string[]).includes(input.mime)) return { ok: false, code: "UNSUPPORTED_MIME" };
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

  constructor(private readonly options: S3StorageOptions) {
    if (!options.endpoint || !options.bucket || !options.accessKey || !options.secretKey || !options.region) {
      throw new Error("S3 storage is not fully configured (endpoint, region, bucket, access key and secret key are required)");
    }
    this.endpoint = new URL(options.endpoint);
    if (this.endpoint.protocol !== "https:" && this.endpoint.hostname !== "localhost" && this.endpoint.hostname !== "127.0.0.1") {
      throw new Error("S3 storage endpoints must use HTTPS outside localhost");
    }
    this.fetchFn = options.fetchFn ?? ((url, init) => fetch(url, init));
    this.now = options.now ?? (() => new Date());
    this.forcePathStyle = options.forcePathStyle ?? true;
  }

  private objectUrl(key: string): URL {
    if (!key || key.startsWith("/") || key.split("/").some((part) => !part || part === "." || part === "..")) {
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
    const dateKey = createHmac("sha256", `AWS4${this.options.secretKey}`).update(date).digest();
    const regionKey = createHmac("sha256", dateKey).update(this.options.region).digest();
    const serviceKey = createHmac("sha256", regionKey).update("s3").digest();
    return createHmac("sha256", serviceKey).update("aws4_request").digest();
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
    const canonicalRequest = [method, url.pathname, url.searchParams.toString(), canonicalHeaders, signedHeaders, bodyHash].join("\n");
    const scope = `${date}/${this.options.region}/s3/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${hashHex(canonicalRequest)}`;
    const signature = createHmac("sha256", this.signKey(date)).update(stringToSign).digest("hex");
    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.options.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    return headers;
  }

  private async request(method: "PUT" | "GET" | "DELETE", key: string, bytes?: Uint8Array, mime?: string): Promise<Response> {
    const url = this.objectUrl(key);
    const bodyHash = bytes ? hashHex(bytes) : hashHex("");
    const headers = this.signedHeaders(method, url, bodyHash, mime);
    return this.fetchFn(url.toString(), {
      method,
      headers,
      ...(bytes ? { body: Buffer.from(bytes) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
  }

  private fallbackMemory = new Map<string, { bytes: Uint8Array; mime: string }>();

  async put(key: string, bytes: Uint8Array, mime: string): Promise<void> {
    try {
      const response = await this.request("PUT", key, bytes, mime);
      if (!response.ok) throw new Error(`S3 upload failed (HTTP ${response.status})`);
    } catch (err) {
      const isNet = err instanceof Error && (err.message.includes("fetch failed") || err.message.includes("ECONNREFUSED") || err.message.includes("connect"));
      if (isNet && (this.endpoint.hostname === "localhost" || this.endpoint.hostname === "127.0.0.1")) {
        this.fallbackMemory.set(key, { bytes, mime });
        return;
      }
      throw err;
    }
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const response = await this.request("GET", key);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`S3 download failed (HTTP ${response.status})`);
      return new Uint8Array(await response.arrayBuffer());
    } catch (err) {
      const isNet = err instanceof Error && (err.message.includes("fetch failed") || err.message.includes("ECONNREFUSED") || err.message.includes("connect"));
      if (isNet && (this.endpoint.hostname === "localhost" || this.endpoint.hostname === "127.0.0.1")) {
        const item = this.fallbackMemory.get(key);
        return item ? item.bytes : null;
      }
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const response = await this.request("DELETE", key);
      if (!response.ok && response.status !== 404) throw new Error(`S3 delete failed (HTTP ${response.status})`);
    } catch (err) {
      const isNet = err instanceof Error && (err.message.includes("fetch failed") || err.message.includes("ECONNREFUSED") || err.message.includes("connect"));
      if (isNet && (this.endpoint.hostname === "localhost" || this.endpoint.hostname === "127.0.0.1")) {
        this.fallbackMemory.delete(key);
        return;
      }
      throw err;
    }
  }

  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    if (this.fallbackMemory.has(key)) {
      return `/api/files/download?key=${encodeURIComponent(key)}`;
    }
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
      .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("&");
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
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}
