import { describe, it, expect } from "vitest";
import { decodeBase64Upload, MAX_UPLOAD_BASE64_CHARS, MAX_UPLOAD_BYTES, sniffImageMime, stripImageExif } from "./files-crypto";

describe("decodeBase64Upload (upload size enforced before allocation)", () => {
  it("decodes a small payload and strips a data: URL prefix", () => {
    const hello = Buffer.from("hello").toString("base64");
    expect(decodeBase64Upload(hello)).toEqual(new Uint8Array(Buffer.from("hello")));
    expect(decodeBase64Upload(`data:image/png;base64,${hello}`)).toEqual(new Uint8Array(Buffer.from("hello")));
  });
  it("rejects an encoded payload longer than the cap without decoding it", () => {
    // A 100-char body against a 2-byte cap: the encoded-length check fires first.
    expect(() => decodeBase64Upload("a".repeat(100), 2)).toThrow(/exceeds \d+ characters/);
  });
  it("rejects a payload that decodes past the byte cap", () => {
    const five = Buffer.from("hello").toString("base64");
    expect(() => decodeBase64Upload(five, 2)).toThrow(/exceeds 2 bytes/);
  });
  it("exposes the shared 8 MiB cap used by the Zod schemas", () => {
    expect(MAX_UPLOAD_BYTES).toBe(8 * 1024 * 1024);
    expect(MAX_UPLOAD_BASE64_CHARS).toBe(11_200_000);
  });
});

/** CRC-32 (IEEE) — only for building honest PNG fixtures in these tests. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(out.subarray(4, 8 + data.length));
  view.setUint32(8 + data.length, crc32(crcInput));
  return out;
}
function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}
const PNG_SIG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IHDR_1X1 = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
const IDAT_1X1 = new Uint8Array([0x78, 0x01, 0x01, 0x04, 0x00, 0xfb, 0xff, 0x00, 0xff, 0x00, 0x00, 0x03, 0x01, 0x01, 0x00]);
function minimalPng(extra: Uint8Array[] = []): Uint8Array {
  return concatBytes(PNG_SIG, pngChunk("IHDR", IHDR_1X1), ...extra, pngChunk("IDAT", IDAT_1X1), pngChunk("IEND", new Uint8Array(0)));
}
function jpegSegment(marker: number, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(2 + 2 + data.length);
  out[0] = 0xff; out[1] = marker;
  out[2] = ((data.length + 2) >> 8) & 0xff; out[3] = (data.length + 2) & 0xff;
  out.set(data, 4);
  return out;
}
const te = new TextEncoder();
function exifJpeg(): Uint8Array {
  return concatBytes(
    new Uint8Array([0xff, 0xd8]),
    jpegSegment(0xe0, te.encode("JFIF\0\x01\x01\0\0\x01\0\x01\0\0")),
    jpegSegment(0xe1, concatBytes(te.encode("Exif\0\0"), te.encode("MM\0*\0\0\0\x08GPS-LAT-25.1234"))),
    jpegSegment(0xe1, te.encode("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>")),
    jpegSegment(0xfe, te.encode("a comment")),
    jpegSegment(0xda, new Uint8Array([1, 1, 0, 0, 63, 0])),
    new Uint8Array([0xaa, 0xbb, 0xff, 0xd9]),
  );
}

describe("sniffImageMime (M5: magic bytes, never the client MIME)", () => {
  it("recognises JPEG/PNG/WebP/HEIC/HEIF signatures", () => {
    expect(sniffImageMime(exifJpeg())).toBe("image/jpeg");
    expect(sniffImageMime(minimalPng())).toBe("image/png");
    expect(sniffImageMime(te.encode("RIFF\x00\x00\x00\x00WEBPVP8 "))).toBe("image/webp");
    expect(sniffImageMime(concatBytes(new Uint8Array([0, 0, 0, 24]), te.encode("ftypheic"), new Uint8Array(8)))).toBe("image/heic");
    expect(sniffImageMime(concatBytes(new Uint8Array([0, 0, 0, 24]), te.encode("ftypmif1"), new Uint8Array(8)))).toBe("image/heif");
  });
  it("returns null for HTML, SVG, text and truncated signatures", () => {
    expect(sniffImageMime(te.encode("<!DOCTYPE html><html>"))).toBeNull();
    expect(sniffImageMime(te.encode("<svg xmlns=\"http://www.w3.org/2000/svg\">"))).toBeNull();
    expect(sniffImageMime(te.encode("hello"))).toBeNull();
    expect(sniffImageMime(new Uint8Array([0x89, 0x50, 0x4e]))).toBeNull();
    expect(sniffImageMime(new Uint8Array(0))).toBeNull();
  });
});

describe("stripImageExif (M5)", () => {
  it("JPEG: drops the APP1 Exif segment, keeps XMP/COM/SOS, stays a valid JPEG", () => {
    const clean = stripImageExif(exifJpeg(), "image/jpeg");
    const text = new TextDecoder("latin1").decode(clean);
    expect(text).not.toContain("Exif");
    expect(text).not.toContain("GPS-LAT");
    expect(text).toContain("xap/1.0");
    expect(text).toContain("a comment");
    expect(clean[0]).toBe(0xff); expect(clean[1]).toBe(0xd8);
    expect(clean[clean.length - 1]).toBe(0xd9);
    expect(sniffImageMime(clean)).toBe("image/jpeg");
  });
  it("JPEG without EXIF is returned byte-identical", () => {
    const plain = concatBytes(new Uint8Array([0xff, 0xd8]), jpegSegment(0xe0, te.encode("JFIF\0")), jpegSegment(0xda, new Uint8Array([1, 1, 0, 0, 63, 0])), new Uint8Array([0xaa, 0xff, 0xd9]));
    expect(stripImageExif(plain, "image/jpeg")).toEqual(plain);
  });
  it("JPEG with a corrupt segment length throws INVALID_IMAGE", () => {
    const bad = concatBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xff, 0x01]));
    expect(() => stripImageExif(bad, "image/jpeg")).toThrowError(expect.objectContaining({ code: "INVALID_IMAGE" }));
  });
  it("PNG: drops eXIf + text chunks, keeps IHDR/IDAT/IEND", () => {
    const exif = pngChunk("eXIf", concatBytes(te.encode("MM\0*"), te.encode("GPS")));
    const text = pngChunk("tEXt", te.encode("Comment\0phone photo"));
    const clean = stripImageExif(minimalPng([exif, text]), "image/png");
    const s = new TextDecoder("latin1").decode(clean);
    expect(s).not.toContain("eXIf");
    expect(s).not.toContain("tEXt");
    expect(s).not.toContain("phone photo");
    expect(s).toContain("IHDR");
    expect(s).toContain("IDAT");
    expect(s).toContain("IEND");
    expect(sniffImageMime(clean)).toBe("image/png");
  });
  it("PNG without metadata is returned byte-identical; corrupt chunk length throws", () => {
    const plain = minimalPng();
    expect(stripImageExif(plain, "image/png")).toEqual(plain);
    const bad = concatBytes(PNG_SIG, new Uint8Array([0xff, 0xff, 0xff, 0xff]), te.encode("IHDR"), new Uint8Array(4));
    expect(() => stripImageExif(bad, "image/png")).toThrowError(expect.objectContaining({ code: "INVALID_IMAGE" }));
  });
  it("WebP: drops the EXIF chunk and rebuilds the RIFF size", () => {
    const chunk = (id: string, data: Uint8Array) => {
      const padded = data.length + (data.length % 2);
      const out = new Uint8Array(8 + padded);
      out.set(te.encode(id), 0);
      out[4] = data.length & 0xff; out[5] = (data.length >> 8) & 0xff; out[6] = (data.length >> 16) & 0xff; out[7] = (data.length >> 24) & 0xff;
      out.set(data, 8);
      return out;
    };
    const webp = concatBytes(
      te.encode("RIFF"), new Uint8Array(4), te.encode("WEBP"),
      chunk("VP8X", new Uint8Array(10)), chunk("EXIF", te.encode("II*\0GPS")), chunk("VP8L", new Uint8Array(5)),
    );
    const clean = stripImageExif(webp, "image/webp");
    const s = new TextDecoder("latin1").decode(clean);
    expect(s).not.toContain("EXIF");
    expect(s).toContain("VP8X");
    expect(s).toContain("VP8L");
    const riffSize = clean[4]! | (clean[5]! << 8) | (clean[6]! << 16) | (clean[7]! << 24);
    expect(riffSize).toBe(clean.length - 8);
    expect(sniffImageMime(clean)).toBe("image/webp");
  });
  it("HEIC is returned unchanged (no HEIF parser on this stack — documented remainder)", () => {
    const heic = concatBytes(new Uint8Array([0, 0, 0, 24]), te.encode("ftypheic"), new Uint8Array(8));
    expect(stripImageExif(heic, "image/heic")).toEqual(heic);
  });
});
