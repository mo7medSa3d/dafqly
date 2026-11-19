/**
 * Image generation provider for OpenRouter (e.g. recraft/recraft-v4.1-flash-v2:free).
 */
export interface GenerateImageOptions {
  prompt: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  siteUrl?: string;
  siteName?: string;
}

export interface GeneratedImage {
  b64Json: string;
  bytes: Uint8Array;
}

export const DEFAULT_IMAGE_MODEL = "recraft/recraft-v4.1-flash-v2:free";
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_ERROR_CHARS = 300;

function validateBaseUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Invalid image provider baseUrl");
  }
  const isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLocal)) {
    throw new Error("Image provider baseUrl must use HTTPS outside localhost");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Image provider baseUrl must not contain embedded credentials");
  }
  return raw.replace(/\/+$/, "");
}

export async function generateImage(options: GenerateImageOptions): Promise<GeneratedImage[]> {
  const apiKey = options.apiKey?.trim() || process.env.OPENROUTER_API_KEY?.trim() || process.env.AI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY (or AI_API_KEY) is required to generate images");
  }
  const model = options.model?.trim() || DEFAULT_IMAGE_MODEL;
  const baseUrl = validateBaseUrl(options.baseUrl?.trim() || "https://openrouter.ai/api/v1");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (options.siteUrl) headers["HTTP-Referer"] = options.siteUrl;
  if (options.siteName) headers["X-Title"] = options.siteName;

  const res = await fetch(`${baseUrl}/images`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      prompt: options.prompt,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const rawError = await res.text().catch(() => "");
    const safeError = rawError.split(apiKey).join("[redacted]").replace(/\s+/g, " ").trim().slice(0, MAX_ERROR_CHARS);
    throw new Error(`OpenRouter image generation failed (${res.status}): ${safeError}`);
  }

  const json = (await res.json()) as { data?: Array<{ b64_json?: string }> };
  const results: GeneratedImage[] = [];
  for (const img of json.data ?? []) {
    const b64Json = typeof img.b64_json === "string" ? img.b64_json.trim() : "";
    if (!b64Json) continue;
    const bytes = Buffer.from(b64Json, "base64");
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      throw new Error("Generated image exceeds 20 MB limit");
    }
    results.push({ b64Json, bytes });
  }
  return results;
}
