/**
 * PaymentProvider (BUILD_PLAN §3/F5): Paymob behind an interface.
 * The real adapter (ADR-019, Intention API) lives in ./paymob and is tested
 * with mocked fetch only; this file holds the interface and the fake.
 */
export interface CreateLinkInput {
  /** Our correlation reference — sent to Paymob as special_reference. */
  reference: string;
  amountMinor: bigint;
  currency: string;
  debtorName?: string;
  debtorPhone?: string;
  debtorEmail?: string;
  notificationUrl?: string;
  redirectionUrl?: string;
}

export interface CreatedPaymentLink {
  url: string;
  /** The provider's intention id (Paymob) or the fake's sequence id. */
  transactionId: string;
  /** When the checkout credential expires (Paymob client_secret: 1 hour). */
  expiresAt: Date;
}

export interface RefundInput {
  /** The original Paymob transaction id being refunded. */
  transactionId: string;
  amountMinor: bigint;
  /**
   * Deterministic per-attempt key (H3: `refund:<reversal row id>`). Providers
   * that support idempotent refunds should dedupe on it. The ledger-side
   * refund-intent row is the authoritative dedupe — the key is a second layer.
   */
  idempotencyKey?: string;
}

export interface PaymentProvider {
  createPaymentLink(input: CreateLinkInput): Promise<CreatedPaymentLink>;
  refundPayment(input: RefundInput): Promise<{ refundTransactionId: string }>;
}

/** FAKE provider for dev/tests. Generates local placeholder links; no network, no money ever moves. */
export class FakePaymentProvider implements PaymentProvider {
  readonly created: CreateLinkInput[] = [];
  readonly refunded: RefundInput[] = [];
  private readonly refundedByKey = new Map<string, string>();
  async createPaymentLink(input: CreateLinkInput): Promise<CreatedPaymentLink> {
    this.created.push(input);
    const transactionId = `fake-intent-${this.created.length}`;
    return {
      url: `https://pay.example.invalid/fake/${transactionId}?ref=${encodeURIComponent(input.reference)}`,
      transactionId,
      expiresAt: new Date(Date.now() + 60 * 60_000),
    };
  }
  async refundPayment(input: RefundInput): Promise<{ refundTransactionId: string }> {
    // H3: same idempotency key replays the same refund transaction id.
    if (input.idempotencyKey) {
      const prior = this.refundedByKey.get(input.idempotencyKey);
      if (prior) return { refundTransactionId: prior };
    }
    this.refunded.push(input);
    const refundTransactionId = `fake-refund-${this.refunded.length}`;
    if (input.idempotencyKey) this.refundedByKey.set(input.idempotencyKey, refundTransactionId);
    return { refundTransactionId };
  }
}
