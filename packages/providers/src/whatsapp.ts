import { ProviderError, type SendResult, type SendTemplateInput, type TextCapableProvider, type WhatsAppCallOverride } from "./messaging";

/**
 * Real WhatsApp Cloud API adapter (BUILD_PLAN F3). API facts verified
 * against Meta's documentation on 2026-11-09 — see ADR-015 in
 * docs/DECISIONS.md. This class is exercised in tests ONLY through an
 * injected fake fetch (mocked responses shaped like Meta's); the real
 * sandbox send is a human step (RUNBOOK) because it needs a real Meta app,
 * number and access token.
 *
 * Idempotency: the interface contract is dedupe by idempotencyKey. Meta's
 * API has no idempotency keys, so the engine guarantees at-most-once
 * dispatch at the DB level (reminder row state machine + SKIP LOCKED +
 * unique idempotency key) and this adapter additionally dedupes repeat
 * calls within the process.
 */
export interface WhatsAppConfig {
  apiVersion: string; // e.g. "v27.0" — from WHATSAPP_API_VERSION
  phoneNumberId: string;
  accessToken: string;
  /** Template language code sent to Meta (our templates are Arabic-first). */
  languageCode?: string;
  fetchImpl?: typeof fetch;
}

interface GraphError { error?: { code?: number; message?: string } }
interface GraphSendOk { messages?: { id?: string }[] }
interface GraphMediaOk { url?: string; mime_type?: string; file_size?: number }

export class WhatsAppCloudProvider implements TextCapableProvider {
  private static readonly MAX_CACHE_ENTRIES = 5_000;
  private static readonly MAX_MEDIA_BYTES = 10 * 1024 * 1024;
  private byKey = new Map<string, SendResult>();
  private inFlight = new Map<string, Promise<SendResult>>();
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly config: WhatsAppConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private remember(key: string, result: SendResult): void {
    if (this.byKey.has(key)) this.byKey.delete(key);
    this.byKey.set(key, result);
    if (this.byKey.size > WhatsAppCloudProvider.MAX_CACHE_ENTRIES) {
      const oldest = this.byKey.keys().next().value;
      if (oldest !== undefined) this.byKey.delete(oldest);
    }
  }

  private async post(body: Record<string, unknown>, override?: WhatsAppCallOverride): Promise<SendResult> {
    const phoneNumberId = (override?.phoneNumberId || this.config.phoneNumberId).trim();
    const accessToken = (override?.accessToken || this.config.accessToken).trim();
    const apiVersion = this.config.apiVersion.trim();
    if (!apiVersion || !phoneNumberId || !accessToken) {
      throw new ProviderError(0, "WhatsApp provider is not configured (WHATSAPP_API_VERSION / WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN)");
    }
    let res: Response;
    try {
      res = await this.fetchImpl(
        `https://graph.facebook.com/${encodeURIComponent(apiVersion)}/${encodeURIComponent(phoneNumberId)}/messages`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(15_000),
        },
      );
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      const isTimeout = err instanceof Error && err.name === "TimeoutError";
      throw new ProviderError(isTimeout ? 504 : 503, err instanceof Error ? err.message : "WhatsApp network error");
    }
    const json = (await res.json().catch(() => ({}))) as GraphSendOk & GraphError;
    if (!res.ok || json.error) {
      const code = json.error?.code ?? (res.status === 429 ? 130429 : res.status);
      throw new ProviderError(code, json.error?.message ?? `WhatsApp send failed with HTTP ${res.status}`);
    }
    const id = json.messages?.[0]?.id;
    if (!id) throw new ProviderError(0, "WhatsApp response carried no message id");
    return { providerMessageId: id };
  }

  private dedupe(key: string, run: () => Promise<SendResult>): Promise<SendResult> {
    const existing = this.byKey.get(key);
    if (existing) return Promise.resolve(existing);
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const p = run()
      .then((res) => { this.remember(key, res); return res; })
      .finally(() => { this.inFlight.delete(key); });
    this.inFlight.set(key, p);
    return p;
  }

  async sendTemplate(input: SendTemplateInput): Promise<SendResult> {
    if (input.channel !== "whatsapp") {
      throw new ProviderError(0, "WhatsAppCloudProvider only sends on the whatsapp channel");
    }
    const parameters = input.parameters ?? Object.values(input.variables);
    const cacheKey = `${(input.override?.phoneNumberId || this.config.phoneNumberId).trim()}:${input.idempotencyKey}`;
    return this.dedupe(cacheKey, () => this.post({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.toE164.replace(/^\+/, ""),
      type: "template",
      template: {
        name: input.templateKey,
        language: { code: this.config.languageCode ?? "ar" },
        ...(parameters.length > 0
          ? { components: [{ type: "body", parameters: parameters.map((text) => ({ type: "text", text })) }] }
          : {}),
      },
    }, input.override));
  }

  /** Free-form text — valid only inside the 24h customer-service window (else Meta returns 131047). */
  async sendText(input: { toE164: string; body: string; idempotencyKey: string; override?: WhatsAppCallOverride }): Promise<SendResult> {
    const cacheKey = `${(input.override?.phoneNumberId || this.config.phoneNumberId).trim()}:${input.idempotencyKey}`;
    return this.dedupe(cacheKey, () => this.post({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.toE164.replace(/^\+/, ""),
      type: "text",
      text: { body: input.body, preview_url: false },
    }, input.override));
  }

  /** 2-step Meta Graph API media download with 15s timeout and 10 MB byte cap. */
  async downloadMedia(
    mediaId: string,
    override?: { apiVersion?: string; accessToken?: string },
  ): Promise<{ bytes: Uint8Array; mime: string }> {
    const cleanMediaId = mediaId.trim();
    if (!cleanMediaId) {
      throw new ProviderError(0, "WhatsApp mediaId is required");
    }
    const apiVersion = override?.apiVersion || this.config.apiVersion;
    const accessToken = override?.accessToken || this.config.accessToken;
    if (!apiVersion || !accessToken) {
      throw new ProviderError(0, "WhatsApp provider is not configured (WHATSAPP_API_VERSION / WHATSAPP_ACCESS_TOKEN)");
    }
    const metaRes = await this.fetchImpl(
      `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(cleanMediaId)}`,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15_000),
      },
    );
    const meta = (await metaRes.json().catch(() => ({}))) as GraphMediaOk & GraphError;
    if (!metaRes.ok || meta.error || !meta.url) {
      const code = meta.error?.code ?? metaRes.status;
      throw new ProviderError(code, meta.error?.message ?? `WhatsApp media lookup failed with HTTP ${metaRes.status}`);
    }
    let parsedMediaUrl: URL;
    try {
      parsedMediaUrl = new URL(meta.url);
    } catch {
      throw new ProviderError(0, "WhatsApp media lookup returned an invalid URL");
    }
    if (parsedMediaUrl.protocol !== "https:") {
      throw new ProviderError(0, "WhatsApp media URL must use HTTPS");
    }
    if (typeof meta.file_size === "number" && meta.file_size > WhatsAppCloudProvider.MAX_MEDIA_BYTES) {
      throw new ProviderError(0, "WhatsApp media exceeds 10 MB limit");
    }
    const binRes = await this.fetchImpl(parsedMediaUrl.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!binRes.ok) {
      await binRes.body?.cancel?.().catch(() => undefined);
      throw new ProviderError(binRes.status, `WhatsApp media download failed with HTTP ${binRes.status}`);
    }
    const contentLength = Number(binRes.headers?.get?.("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > WhatsAppCloudProvider.MAX_MEDIA_BYTES) {
      await binRes.body?.cancel?.().catch(() => undefined);
      throw new ProviderError(0, "WhatsApp media exceeds 10 MB limit");
    }
    let bytes: Uint8Array;
    if (binRes.body && typeof binRes.body.getReader === "function") {
      const reader = binRes.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (!value) continue;
          total += value.byteLength;
          if (total > WhatsAppCloudProvider.MAX_MEDIA_BYTES) {
            await reader.cancel().catch(() => undefined);
            throw new ProviderError(0, "WhatsApp media exceeds 10 MB limit");
          }
          chunks.push(value);
        }
      } finally {
        try { reader.releaseLock(); } catch { /* already released */ }
      }
      bytes = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
    } else {
      bytes = new Uint8Array(await binRes.arrayBuffer());
      if (bytes.byteLength > WhatsAppCloudProvider.MAX_MEDIA_BYTES) {
        throw new ProviderError(0, "WhatsApp media exceeds 10 MB limit");
      }
    }
    const mime = meta.mime_type || binRes.headers?.get?.("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
    return { bytes, mime };
  }
}

/** Placeholder used when no SMS gateway is configured: every send fails loudly (never silently). */
export class NotConfiguredSmsProvider implements TextCapableProvider {
  async sendTemplate(): Promise<SendResult> {
    throw new ProviderError(0, "SMS provider is not configured (SMS_PROVIDER / SMS_API_KEY)");
  }
  async sendText(): Promise<SendResult> {
    throw new ProviderError(0, "SMS provider is not configured (SMS_PROVIDER / SMS_API_KEY)");
  }
}
