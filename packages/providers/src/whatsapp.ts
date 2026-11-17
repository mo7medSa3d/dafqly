import { ProviderError, type SendResult, type SendTemplateInput, type TextCapableProvider } from "./messaging";

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

export class WhatsAppCloudProvider implements TextCapableProvider {
  private static readonly MAX_CACHE_ENTRIES = 5_000;
  private byKey = new Map<string, SendResult>();
  private inFlight = new Map<string, Promise<SendResult>>();
  private readonly fetchImpl: typeof fetch;
  constructor(private readonly config: WhatsAppConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  private get configured(): boolean {
    return Boolean(this.config.apiVersion && this.config.phoneNumberId && this.config.accessToken);
  }

  private remember(key: string, result: SendResult): void {
    if (this.byKey.has(key)) this.byKey.delete(key);
    this.byKey.set(key, result);
    if (this.byKey.size > WhatsAppCloudProvider.MAX_CACHE_ENTRIES) {
      const oldest = this.byKey.keys().next().value;
      if (oldest !== undefined) this.byKey.delete(oldest);
    }
  }

  private async post(body: Record<string, unknown>): Promise<SendResult> {
    if (!this.configured) {
      throw new ProviderError(0, "WhatsApp provider is not configured (WHATSAPP_API_VERSION / WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN)");
    }
    const res = await this.fetchImpl(
      `https://graph.facebook.com/${this.config.apiVersion}/${this.config.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.config.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const json = (await res.json().catch(() => ({}))) as GraphSendOk & GraphError;
    if (!res.ok || json.error) {
      const code = json.error?.code ?? res.status;
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
    return this.dedupe(input.idempotencyKey, () => this.post({
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
    }));
  }

  /** Free-form text — valid only inside the 24h customer-service window (else Meta returns 131047). */
  async sendText(input: { toE164: string; body: string; idempotencyKey: string }): Promise<SendResult> {
    return this.dedupe(input.idempotencyKey, () => this.post({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: input.toE164.replace(/^\+/, ""),
      type: "text",
      text: { body: input.body, preview_url: false },
    }));
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
