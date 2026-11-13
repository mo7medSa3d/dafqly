import { createHash } from "node:crypto";
import { AppError } from "./errors";

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

// ------------------------------------------------------- M5: image sniffing
/** Image types the upload allowlist accepts (mirrors providers UPLOAD_MIMES). */
export type SupportedImageMime = "image/jpeg" | "image/png" | "image/webp" | "image/heic" | "image/heif";

function ascii(bytes: Uint8Array, at: number, len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) out += String.fromCharCode(bytes[at + i] ?? 0);
  return out;
}

/**
 * M5: identify an image from its magic bytes, never from a client-supplied
 * MIME string. Returns null for anything unrecognised (HTML, SVG, ZIP, …).
 */
export function sniffImageMime(bytes: Uint8Array): SupportedImageMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "image/png";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4);
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs"].includes(brand)) return "image/heic";
    if (["mif1", "msf1"].includes(brand)) return "image/heif";
  }
  return null;
}

// ------------------------------------------------------- M5: EXIF stripping
/** PNG ancillary chunks that carry metadata (not pixels): dropped on upload. */
const PNG_METADATA_CHUNKS = new Set(["eXIf", "tEXt", "zTXt", "iTXt"]);

/**
 * M5: strip EXIF/metadata from an image's container headers, in pure buffer
 * code (no native image library on this stack). JPEG: APP1 segments whose
 * payload starts with "Exif\\0\\0" are dropped (other APPn/COM segments are
 * kept); PNG: eXIf + text chunks are dropped; WebP: EXIF chunks are dropped
 * and the RIFF size is rebuilt. HEIC/HEIF: returned unchanged — EXIF lives
 * in nested `meta` boxes and stripping it needs a real HEIF parser; see
 * KNOWN_LIMITATIONS. Structurally corrupt containers throw INVALID_IMAGE
 * (fail-closed) instead of storing bytes we could not inspect.
 */
export function stripImageExif(bytes: Uint8Array, mime: SupportedImageMime): Uint8Array {
  switch (mime) {
    case "image/jpeg": return stripJpegExif(bytes);
    case "image/png": return stripPngMetadata(bytes);
    case "image/webp": return stripWebpExif(bytes);
    case "image/heic":
    case "image/heif": return bytes;
  }
}

function invalidImage(): AppError {
  return new AppError("INVALID_IMAGE", "Upload rejected: the image file is structurally invalid", 400);
}

function stripJpegExif(bytes: Uint8Array): Uint8Array {
  // JPEG: SOI, then segments until SOS (scan data follows verbatim to EOF).
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw invalidImage();
  const kept: Uint8Array[] = [bytes.subarray(0, 2)];
  let at = 2;
  while (at + 1 < bytes.length) {
    if (bytes[at] !== 0xff) throw invalidImage();
    // Padding 0xFF bytes between segments.
    let marker = bytes[at + 1]!;
    let pos = at + 1;
    while (marker === 0xff && pos + 1 < bytes.length) { pos++; marker = bytes[pos]!; }
    if (marker === 0xd9) { // EOI: keep it, done.
      kept.push(bytes.subarray(at, pos + 1));
      return concat(kept);
    }
    if (marker === 0xda) { // SOS: the rest (scan data + EOI) is copied verbatim.
      kept.push(bytes.subarray(at));
      return concat(kept);
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { // standalone markers
      kept.push(bytes.subarray(at, pos + 1));
      at = pos + 1;
      continue;
    }
    if (pos + 3 >= bytes.length) throw invalidImage();
    const len = (bytes[pos + 1]! << 8) | bytes[pos + 2]!;
    if (len < 2 || pos + 1 + len > bytes.length) throw invalidImage();
    const dataStart = pos + 3;
    const isExifApp1 = marker === 0xe1 && len >= 8 && ascii(bytes, dataStart, 6) === "Exif\0\0";
    if (!isExifApp1) kept.push(bytes.subarray(at, pos + 1 + len));
    at = pos + 1 + len;
  }
  throw invalidImage();
}

function stripPngMetadata(bytes: Uint8Array): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 8 || !sig.every((b, i) => bytes[i] === b)) throw invalidImage();
  const kept: Uint8Array[] = [bytes.subarray(0, 8)];
  let at = 8;
  while (at + 8 <= bytes.length) {
    const len = (bytes[at]! << 24) | (bytes[at + 1]! << 16) | (bytes[at + 2]! << 8) | bytes[at + 3]!;
    const type = ascii(bytes, at + 4, 4);
    if (len < 0 || at + 12 + len > bytes.length) throw invalidImage();
    if (!PNG_METADATA_CHUNKS.has(type)) kept.push(bytes.subarray(at, at + 12 + len));
    at += 12 + len;
    if (type === "IEND") return concat(kept);
  }
  throw invalidImage();
}

function stripWebpExif(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 12 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") throw invalidImage();
  const kept: Uint8Array[] = [];
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = ascii(bytes, at, 4);
    const len = bytes[at + 4]! | (bytes[at + 5]! << 8) | (bytes[at + 6]! << 16) | (bytes[at + 7]! << 24);
    const padded = len + (len % 2);
    if (len < 0 || at + 8 + padded > bytes.length) throw invalidImage();
    if (id !== "EXIF") kept.push(bytes.subarray(at, at + 8 + padded));
    at += 8 + padded;
  }
  if (at !== bytes.length) throw invalidImage();
  const bodyLen = 4 + kept.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(8 + bodyLen);
  out.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  out[4] = bodyLen & 0xff; out[5] = (bodyLen >> 8) & 0xff; out[6] = (bodyLen >> 16) & 0xff; out[7] = (bodyLen >> 24) & 0xff;
  out.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
  let pos = 12;
  for (const chunk of kept) { out.set(chunk, pos); pos += chunk.length; }
  return out;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}

/** Upload cap shared by every base64 intake (matches providers MAX_UPLOAD_BYTES). */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
/** Base64 of 8 MiB, rounded up with headroom for padding/newlines. */
export const MAX_UPLOAD_BASE64_CHARS = 11_200_000;

/**
 * Decode a base64 upload with the size enforced BEFORE the allocation:
 * a bare `Buffer.from(hugeString, "base64")` allocates the full decoded
 * buffer first, so an authenticated caller could force multi-hundred-MB
 * allocations with a single request. The encoded-length check rejects
 * anything that could decode past the cap, and the decoded length is
 * re-checked after decode (padding/newlines can only shrink it).
 * Accepts an optional `data:<mime>;base64,` prefix.
 */
export function decodeBase64Upload(b64: string, maxBytes: number = MAX_UPLOAD_BYTES): Uint8Array {
  let body = b64;
  const comma = b64.indexOf(",");
  if (comma !== -1 && /^data:[^,]*;base64$/.test(b64.slice(0, comma))) body = b64.slice(comma + 1);
  // 4 encoded chars per 3 bytes, plus headroom for padding/newlines.
  const maxChars = maxBytes === MAX_UPLOAD_BYTES ? MAX_UPLOAD_BASE64_CHARS : Math.ceil(maxBytes / 3) * 4 + 64;
  if (body.length > maxChars) {
    throw new AppError("FILE_TOO_LARGE", `Upload too large: base64 payload exceeds ${maxChars} characters`, 400);
  }
  const bytes = Buffer.from(body, "base64");
  if (bytes.length > maxBytes) {
    throw new AppError("FILE_TOO_LARGE", `Upload too large: decoded file exceeds ${maxBytes} bytes`, 400);
  }
  return new Uint8Array(bytes);
}
