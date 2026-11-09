/**
 * MessagingProvider (BUILD_PLAN §3/F3): WhatsApp Cloud API with SMS fallback
 * behind one interface. The interface is designed for ADR-001 (one platform
 * number for MVP; per-tenant numbers later are a config change).
 * Contract: sendTemplate MUST dedupe by idempotencyKey — a retry with the
 * same key returns the original providerMessageId and sends nothing twice
 * (hard rule §1.3: a reminder is never sent twice).
 */
export interface SendTemplateInput {
  toE164: string;
  templateKey: string;
  variables: Record<string, string>;
  /** Ordered template parameters (WhatsApp templates are positional {{1}},{{2}}…).
   * The engine derives the order from the template registry; providers fall
   * back to Object.values(variables) when omitted. */
  parameters?: string[];
  idempotencyKey: string;
  channel: "whatsapp" | "sms";
}
export interface SendResult { providerMessageId: string }

export interface MessagingProvider {
  sendTemplate(input: SendTemplateInput): Promise<SendResult>;
}

/** Providers that can also send free-form text inside the 24h window (F3). */
export interface TextCapableProvider extends MessagingProvider {
  sendText(input: { toE164: string; body: string; idempotencyKey: string }): Promise<SendResult>;
}

/** A provider failure carrying the provider's numeric code (taxonomy in @tahseel/core, ADR-015). */
export class ProviderError extends Error {
  readonly providerCode: number;
  constructor(providerCode: number, message: string) {
    super(message);
    this.name = "ProviderError";
    this.providerCode = providerCode;
  }
}

/** FAKE provider for dev/tests: records sends in memory, dedupes by idempotency key. Never touches a network. */
export class FakeMessagingProvider implements TextCapableProvider {
  readonly sent: SendTemplateInput[] = [];
  readonly texts: { toE164: string; body: string; idempotencyKey: string }[] = [];
  private byKey = new Map<string, SendResult>();
  private readonly tag = Math.random().toString(36).slice(2, 8); // per-instance: provider ids are globally unique (like real wamids)
  private seq = 0;
  async sendTemplate(input: SendTemplateInput): Promise<SendResult> {
    const existing = this.byKey.get(input.idempotencyKey);
    if (existing) return existing;
    const result = { providerMessageId: `fake-${input.channel}-${this.tag}-${++this.seq}` };
    this.byKey.set(input.idempotencyKey, result);
    this.sent.push(input);
    return result;
  }
  async sendText(input: { toE164: string; body: string; idempotencyKey: string }): Promise<SendResult> {
    const existing = this.byKey.get(input.idempotencyKey);
    if (existing) return existing;
    const result = { providerMessageId: `fake-text-${this.tag}-${++this.seq}` };
    this.byKey.set(input.idempotencyKey, result);
    this.texts.push(input);
    return result;
  }
}

/**
 * FAKE failure injection for engine tests: fails the next N sends with a
 * chosen provider code, then delegates to an inner FakeMessagingProvider.
 * Records every attempt (including failed ones) in `attempts`.
 */
export class FlakyProvider implements TextCapableProvider {
  readonly attempts: SendTemplateInput[] = [];
  readonly inner = new FakeMessagingProvider();
  private failuresLeft: { code: number; message: string }[] = [];
  failNext(count: number, code: number, message = `provider error ${code}`): void {
    for (let i = 0; i < count; i++) this.failuresLeft.push({ code, message });
  }
  async sendTemplate(input: SendTemplateInput): Promise<SendResult> {
    this.attempts.push(input);
    const failure = this.failuresLeft.shift();
    if (failure) throw new ProviderError(failure.code, failure.message);
    return this.inner.sendTemplate(input);
  }
  async sendText(input: { toE164: string; body: string; idempotencyKey: string }): Promise<SendResult> {
    return this.inner.sendText(input);
  }
  get sent(): SendTemplateInput[] { return this.inner.sent; }
}

/**
 * Dry-run wrapper (AGENTS.md safety): renders what WOULD be sent and returns
 * a synthetic id without calling the inner provider. Default in dev/CI via
 * DRY_RUN_MESSAGING=true.
 */
export class DryRunMessagingProvider implements TextCapableProvider {
  readonly rendered: SendTemplateInput[] = [];
  readonly renderedTexts: { toE164: string; body: string; idempotencyKey: string }[] = [];
  constructor(private readonly inner: MessagingProvider) {}
  async sendTemplate(input: SendTemplateInput): Promise<SendResult> {
    this.rendered.push(input);
    void this.inner;
    return { providerMessageId: `dry-run-${input.idempotencyKey}` };
  }
  async sendText(input: { toE164: string; body: string; idempotencyKey: string }): Promise<SendResult> {
    this.renderedTexts.push(input);
    return { providerMessageId: `dry-run-text-${input.idempotencyKey}` };
  }
}
