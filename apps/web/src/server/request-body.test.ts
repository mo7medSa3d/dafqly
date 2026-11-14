import { describe, expect, it } from "vitest";
import { readRequestBodyLimited, RequestBodyTooLargeError } from "./request-body";

describe("readRequestBodyLimited", () => {
  it("reads byte-for-byte request content", async () => {
    const bytes = new Uint8Array([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x31, 0x7d]);
    const request = new Request("https://example.test/webhook", { method: "POST", body: bytes });
    expect([...await readRequestBodyLimited(request, 32)]).toEqual([...bytes]);
  });

  it("rejects a declared oversized content length before reading", async () => {
    const request = new Request("https://example.test/webhook", {
      method: "POST", headers: { "content-length": "100" }, body: "{}",
    });
    await expect(readRequestBodyLimited(request, 10)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });

  it("enforces the limit when content-length is missing or understated", async () => {
    const request = new Request("https://example.test/webhook", { method: "POST", body: "12345678901" });
    await expect(readRequestBodyLimited(request, 10)).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  });
});
