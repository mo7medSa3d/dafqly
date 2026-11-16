import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateImage, DEFAULT_IMAGE_MODEL } from "./image";

describe("generateImage", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.AI_API_KEY;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("throws when no API key is provided", async () => {
    await expect(generateImage({ prompt: "test" })).rejects.toThrow(/OPENROUTER_API_KEY.*required/i);
  });

  it("calls OpenRouter image endpoint with correct headers and body", async () => {
    const mockResponse = {
      data: [{ b64_json: Buffer.from("fake-image-bytes").toString("base64") }],
    };

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const result = await generateImage({
      prompt: "a sunny beach",
      apiKey: "test-key",
      siteUrl: "https://example.com",
      siteName: "ExampleApp",
    });

    expect(fetchMock).toHaveBeenCalledWith("https://openrouter.ai/api/v1/images", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://example.com",
        "X-Title": "ExampleApp",
      },
      body: JSON.stringify({
        model: DEFAULT_IMAGE_MODEL,
        prompt: "a sunny beach",
      }),
    });

    expect(result).toHaveLength(1);
    expect(Buffer.from(result[0]!.bytes).toString()).toBe("fake-image-bytes");
  });

  it("handles non-ok response gracefully", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "Bad request",
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(generateImage({ prompt: "bad", apiKey: "key" })).rejects.toThrow(/OpenRouter image generation failed \(400\): Bad request/);
  });
});
