import type { CreateLinkInput, CreatedPaymentLink, PaymentProvider, RefundInput } from "./payment";

/**
 * Paymob adapter (BUILD_PLAN F5, ADR-019 — shapes verified 2026-11-09
 * against developers.paymob.com via Paymob's official integration skill):
 * Intention API ONLY (the legacy auth→order→payment-key flow is deprecated).
 * - Create: POST {base}/v1/intention/ with `Authorization: Token <sk_*>`;
 *   amount is integer piasters; billing_data requires every field ("NA"
 *   placeholders allowed); special_reference correlates the webhook.
 * - Checkout: {base}/unifiedcheckout/?publicKey=<pk_*>&clientSecret=<...>;
 *   the client_secret expires in 1 hour, which sets the link's expiresAt.
 * - Refund: POST {base}/api/acceptance/void_refund/refund, same Token auth.
 * Secrets stay server-side; only the public key appears in the checkout URL.
 * Tested with mocked fetch only — no real account exists in dev/CI.
 */
export interface PaymobConfig {
  secretKey: string;
  publicKey: string;
  integrationIds: number[];
  baseUrl: string; // e.g. https://accept.paymob.com (Egypt)
}

export class PaymobNotConfiguredError extends Error {
  readonly code = "PAYMOB_NOT_CONFIGURED";
  constructor() {
    super("Paymob is not configured: PAYMOB_SECRET_KEY, PAYMOB_PUBLIC_KEY and PAYMOB_INTEGRATION_ID are required");
    this.name = "PaymobNotConfiguredError";
  }
}

export class PaymobError extends Error {
  readonly code = "PAYMOB_ERROR";
  constructor(readonly status: number, message: string) {
    super(`Paymob request failed (${status}): ${message}`);
    this.name = "PaymobError";
  }
}

/** The intention's client_secret lifetime per Paymob docs (ADR-019). */
export const PAYMOB_LINK_TTL_MS = 60 * 60_000;

export class PaymobProvider implements PaymentProvider {
  constructor(private readonly config: PaymobConfig) {}

  private assertConfigured(): void {
    const hasKeys = Boolean(this.config.secretKey?.trim() && this.config.publicKey?.trim());
    const validIds =
      this.config.integrationIds.length > 0 &&
      this.config.integrationIds.every((id) => Number.isSafeInteger(id) && id > 0);
    if (!hasKeys || !validIds) {
      throw new PaymobNotConfiguredError();
    }
    let parsed: URL;
    try {
      parsed = new URL(this.config.baseUrl);
    } catch {
      throw new PaymobError(400, "Paymob baseUrl is invalid");
    }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      throw new PaymobError(400, "Paymob baseUrl must use HTTPS without embedded credentials");
    }
  }

  private get base(): string {
    return this.config.baseUrl.replace(/\/+$/, "");
  }

  private async call(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const secretKey = this.config.secretKey.trim();
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Token ${secretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      if (err instanceof PaymobError) throw err;
      const isTimeout = err !== null && typeof err === "object" && (err as { name?: unknown }).name === "TimeoutError";
      throw new PaymobError(isTimeout ? 504 : 503, err instanceof Error ? err.message : "Paymob network error");
    }
    const contentLength = Number(res.headers?.get?.("content-length") ?? 0);
    if (Number.isFinite(contentLength) && contentLength > 1024 * 1024) {
      await res.body?.cancel?.().catch(() => undefined);
      throw new PaymobError(502, "Paymob response exceeded 1 MB limit");
    }
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const rawDetail = typeof data.detail === "string" ? data.detail : typeof data.message === "string" ? data.message : "provider error";
      const safeDetail = rawDetail.split(secretKey).join("[redacted]").replace(/\s+/g, " ").trim().slice(0, 200);
      throw new PaymobError(res.status, safeDetail || "provider error");
    }
    return data;
  }

  async createPaymentLink(input: CreateLinkInput): Promise<CreatedPaymentLink> {
    this.assertConfigured();
    const amount = Number(input.amountMinor);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new PaymobError(400, "amount must be a positive integer of piasters");
    const nameParts = (input.debtorName ?? "Customer").trim().split(/\s+/);
    const firstName = nameParts[0] || "Customer";
    const lastName = nameParts.slice(1).join(" ") || "NA";
    const email = input.debtorEmail?.trim() || "customer@paymob.local";
    const data = await this.call("/v1/intention/", {
      amount,
      currency: input.currency,
      payment_methods: this.config.integrationIds,
      items: [{ name: "Invoice payment", amount, description: `Tahseel payment ${input.reference}`, quantity: 1 }],
      billing_data: {
        first_name: firstName, last_name: lastName, email,
        phone_number: input.debtorPhone?.trim() || "NA",
        apartment: "NA", floor: "NA", street: "NA", building: "NA",
        shipping_method: "NA", postal_code: "NA", city: "NA", country: "EGY", state: "NA",
      },
      customer: { first_name: firstName, last_name: lastName, email },
      special_reference: input.reference,
      ...(input.notificationUrl ? { notification_url: input.notificationUrl } : {}),
      ...(input.redirectionUrl ? { redirection_url: input.redirectionUrl } : {}),
    });
    const clientSecret = typeof data.client_secret === "string" ? data.client_secret : "";
    const intentionId = typeof data.id === "string" || typeof data.id === "number" ? String(data.id) : "";
    if (!clientSecret || !intentionId) throw new PaymobError(502, "intention response missing id/client_secret");
    return {
      url: `${this.base}/unifiedcheckout/?publicKey=${encodeURIComponent(this.config.publicKey)}&clientSecret=${encodeURIComponent(clientSecret)}`,
      transactionId: intentionId,
      expiresAt: new Date(Date.now() + PAYMOB_LINK_TTL_MS),
    };
  }

  async refundPayment(input: RefundInput): Promise<{ refundTransactionId: string }> {
    this.assertConfigured();
    const rawTxnId = input.transactionId.trim();
    const transactionId = Number(rawTxnId);
    if (!/^\d+$/.test(rawTxnId) || !Number.isSafeInteger(transactionId) || transactionId <= 0) {
      throw new PaymobError(400, "transaction_id must be a positive numeric Paymob transaction id");
    }
    const amountCents = Number(input.amountMinor);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
      throw new PaymobError(400, "amount_cents must be a positive safe integer");
    }
    const data = await this.call(
      "/api/acceptance/void_refund/refund",
      {
        transaction_id: transactionId,
        amount_cents: amountCents,
      },
    );
    const id = data.id;
    if (typeof id !== "number" && typeof id !== "string") throw new PaymobError(502, "refund response missing transaction id");
    return { refundTransactionId: String(id) };
  }
}
