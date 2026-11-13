import { describe, it, expect } from "vitest";
import { FakeMessagingProvider, DryRunMessagingProvider, type MessagingProvider } from "./messaging";
import { FakeClock, SystemClock } from "./clock";

/**
 * Provider contract suite (BUILD_PLAN §9): the SAME suite must pass for the
 * fake now and for real adapters later (real adapters run it only with
 * RUN_SANDBOX_TESTS=1 and sandbox credentials).
 */
function messagingContract(name: string, make: () => MessagingProvider & { sent: unknown[] }) {
  describe(`MessagingProvider contract: ${name}`, () => {
    it("returns a provider message id", async () => {
      const p = make();
      const r = await p.sendTemplate({ toE164: "+201001234567", templateKey: "invoice_due_today", variables: { amount: "100" }, idempotencyKey: "k1", channel: "whatsapp" });
      expect(r.providerMessageId).toBeTruthy();
    });
    it("dedupes by idempotency key (a reminder is never sent twice)", async () => {
      const p = make();
      const input = { toE164: "+201001234567", templateKey: "invoice_due_today", variables: {}, idempotencyKey: "same-key", channel: "whatsapp" as const };
      const r1 = await p.sendTemplate(input);
      const r2 = await p.sendTemplate(input);
      expect(r2.providerMessageId).toBe(r1.providerMessageId);
      expect(p.sent).toHaveLength(1);
    });
  });
}
messagingContract("FakeMessagingProvider (FAKE)", () => new FakeMessagingProvider());

describe("DryRunMessagingProvider (FAKE wrapper)", () => {
  it("renders but never calls the inner provider", async () => {
    const inner = new FakeMessagingProvider();
    const dry = new DryRunMessagingProvider(inner);
    const r = await dry.sendTemplate({ toE164: "+201001234567", templateKey: "x", variables: {}, idempotencyKey: "k", channel: "sms" });
    expect(r.providerMessageId).toContain("dry-run");
    expect(inner.sent).toHaveLength(0);
    expect(dry.rendered).toHaveLength(1);
  });
});

describe("FakeClock", () => {
  it("advances deterministically; SystemClock returns real time", () => {
    const fake = new FakeClock(new Date("2026-11-09T00:00:00Z"));
    fake.advanceDays(3);
    expect(fake.now().toISOString()).toBe("2026-11-12T00:00:00.000Z");
    expect(Math.abs(new SystemClock().now().getTime() - Date.now())).toBeLessThan(5000);
  });
});

describe("NotConfiguredMessagingProvider (fail closed)", () => {
  it("never silently accepts sends when a live adapter is missing", async () => {
    const { NotConfiguredMessagingProvider } = await import("./messaging");
    const provider = new NotConfiguredMessagingProvider("whatsapp");
    await expect(provider.sendTemplate({
      toE164: "+201000000000", templateKey: "invoice_due_today", variables: {},
      idempotencyKey: "missing-provider", channel: "whatsapp",
    })).rejects.toThrow(/whatsapp provider is not configured/i);
    await expect(provider.sendText({
      toE164: "+201000000000", body: "test", idempotencyKey: "missing-provider-text",
    })).rejects.toThrow(/whatsapp provider is not configured/i);
  });
});
