import { describe, it, expect, vi, afterEach } from "vitest";
import { PaymobProvider, PaymobNotConfiguredError } from "./paymob";
import { FakePaymentProvider } from "./payment";

/**
 * Paymob adapter tests (ADR-019): mocked fetch ONLY — no real Paymob account
 * exists and no network call is ever made from tests. The request/response
 * shapes asserted here are the ones verified in DECISIONS.md ADR-019.
 */
const CONFIG = {
  secretKey: "sk_test_fake_secret",
  publicKey: "pk_test_fake_public",
  integrationIds: [123456],
  baseUrl: "https://accept.paymob.com",
};

interface Captured { url: string; init: RequestInit }
function mockFetch(responseBody: unknown, status = 200) {
  const calls: Captured[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return { ok: status >= 200 && status < 300, status, json: async () => responseBody, text: async () => JSON.stringify(responseBody) };
  });
  vi.stubGlobal("fetch", fn);
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe("PaymobProvider (Intention API, ADR-019)", () => {
  it("creates an intention with Token auth and returns the Unified Checkout URL", async () => {
    const calls = mockFetch({ id: "int_abc123", client_secret: "csec_xyz" });
    const provider = new PaymobProvider(CONFIG);
    const link = await provider.createPaymentLink({
      reference: "tahseel_ref_1", amountMinor: 125050n, currency: "EGP",
      debtorName: "Omar Fathy", debtorPhone: "+201001234567",
      notificationUrl: "https://app.example/api/webhooks/paymob",
      redirectionUrl: "https://app.example/s/tok",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://accept.paymob.com/v1/intention/");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Token sk_test_fake_secret");
    const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>;
    expect(body.amount).toBe(125050); // integer piasters, never a float or a string
    expect(body.currency).toBe("EGP");
    expect(body.payment_methods).toEqual([123456]);
    expect(body.special_reference).toBe("tahseel_ref_1");
    expect(body.notification_url).toBe("https://app.example/api/webhooks/paymob");
    const billing = body.billing_data as Record<string, string>;
    expect(billing.phone_number).toBe("+201001234567");
    expect(billing.first_name).toBe("Omar");
    expect(billing.apartment).toBe("NA"); // all billing fields required; NA placeholders per docs
    expect(link.url).toBe("https://accept.paymob.com/unifiedcheckout/?publicKey=pk_test_fake_public&clientSecret=csec_xyz");
    expect(link.transactionId).toBe("int_abc123");
    expect(link.expiresAt.getTime() - Date.now()).toBeGreaterThan(50 * 60_000); // ~1h client_secret lifetime
    expect(link.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(60 * 60_000 + 1000);
  });

  it("refunds through the void_refund endpoint with Token auth", async () => {
    const calls = mockFetch({ id: 777001, success: true });
    const provider = new PaymobProvider(CONFIG);
    const out = await provider.refundPayment({ transactionId: "555000", amountMinor: 4000n });
    expect(calls[0]!.url).toBe("https://accept.paymob.com/api/acceptance/void_refund/refund");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ transaction_id: 555000, amount_cents: 4000 });
    expect(out.refundTransactionId).toBe("777001");
  });

  it("fails loudly when not configured (no silent fake fallback)", async () => {
    const provider = new PaymobProvider({ secretKey: "", publicKey: "", integrationIds: [], baseUrl: CONFIG.baseUrl });
    await expect(provider.createPaymentLink({ reference: "r", amountMinor: 100n, currency: "EGP" })).rejects.toBeInstanceOf(PaymobNotConfiguredError);
    await expect(provider.refundPayment({ transactionId: "1", amountMinor: 100n })).rejects.toBeInstanceOf(PaymobNotConfiguredError);
  });

  it("surfaces a provider rejection with its status", async () => {
    mockFetch({ detail: "Integration not found" }, 404);
    const provider = new PaymobProvider(CONFIG);
    await expect(provider.createPaymentLink({ reference: "r", amountMinor: 100n, currency: "EGP" })).rejects.toThrow(/404/);
  });
});

describe("FakePaymentProvider (dev/tests double for the same interface)", () => {
  it("mints local links and records refunds without any network", async () => {
    const fake = new FakePaymentProvider();
    const link = await fake.createPaymentLink({ reference: "ref-9", amountMinor: 500n, currency: "EGP" });
    expect(link.url).toContain("pay.example.invalid");
    expect(link.transactionId).toBe("fake-intent-1");
    const refund = await fake.refundPayment({ transactionId: "fake-txn-1", amountMinor: 500n });
    expect(refund.refundTransactionId).toBe("fake-refund-1");
    expect(fake.refunded).toHaveLength(1);
  });
});
