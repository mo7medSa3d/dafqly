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

export async function generateImage(options: GenerateImageOptions): Promise<GeneratedImage[]> {
  const apiKey = options.apiKey || process.env.OPENROUTER_API_KEY || process.env.AI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY (or AI_API_KEY) is required to generate images");
  }
  const model = options.model || DEFAULT_IMAGE_MODEL;
  const baseUrl = (options.baseUrl || "https://openrouter.ai/api/v1").replace(/\/$/, "");

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
    const errorText = await res.text().catch(() => "");
    throw new Error(`OpenRouter image generation failed (${res.status}): ${errorText}`);
  }

  const json = (await res.json()) as { data?: Array<{ b64_json?: string }> };
  return (json.data ?? []).map((img) => {
    const b64Json = img.b64_json ?? "";
    const bytes = Buffer.from(b64Json, "base64");
    return { b64Json, bytes };
  });
}
