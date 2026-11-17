import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { describe, it, expect } from "vitest";
import { parseWebhookPayload, redactWebhookPayload } from "./webhook";
import { resolveTenantWhatsappOverride } from "./engine";

/**
 * M6 payload redaction (pure, no DB): the stored webhook payload keeps the
 * dedupe/status fields processing needs and drops the sender's phone and
 * the message body text.
 */
describe("redactWebhookPayload (M6)", () => {
  const payload = {
    object: "whatsapp_business_account",
    entry: [{
      id: "WABA-TEST",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "15550000000", phone_number_id: "1234567890" },
          contacts: [{ profile: { name: "عميل" }, wa_id: "201001234567" }],
          messages: [{ from: "201001234567", id: "wamid.1", timestamp: "1794000100", type: "text", text: { body: "دفعت 500 جنيه" } }],
          statuses: [{ id: "wamid.0", status: "delivered", timestamp: "1794000000", recipient_id: "201001234567" }],
        },
      }],
    }],
  };

  it("strips the sender phone + message body, keeps ids/statuses, leaves the input untouched", () => {
    const redacted = redactWebhookPayload(payload) as typeof payload;
    const json = JSON.stringify(redacted);
    expect(json).not.toContain("201001234567");
    expect(json).not.toContain("دفعت 500 جنيه");
    expect(json).toContain("wamid.1");
    expect(json).toContain("delivered");
    expect(json).toContain("[redacted]");
    // The caller's object is not mutated (persist still parses the raw one).
    expect(JSON.stringify(payload)).toContain("201001234567");
    expect(JSON.stringify(payload)).toContain("دفعت 500 جنيه");
  });

  it("extracts metadata.phone_number_id on inbound events for per-tenant routing", () => {
    const events = parseWebhookPayload(payload);
    const inbound = events.find((e) => e.kind === "inbound");
    expect(inbound?.kind === "inbound" ? inbound.phoneNumberId : null).toBe("1234567890");
  });

  it("passes non-message payloads through unchanged", () => {
    const plain = { object: "whatsapp_business_account", entry: [] };
    expect(redactedJson(redactWebhookPayload(plain))).toBe(JSON.stringify(plain));
  });

  it("returns a tombstone for unserializable input", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(redactWebhookPayload(circular)).toEqual({ redacted: true });
  });
});

describe("resolveTenantWhatsappOverride", () => {
  it("decrypts v1 AES-256-GCM encryptedAccessToken using SHA-256 of SESSION_SECRET", () => {
    const secret = "test-session-secret-32-chars-minimum";
    const key = createHash("sha256").update(secret).digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update("wa-token-secret", "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    const encryptedAccessToken = `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;

    expect(resolveTenantWhatsappOverride({ whatsapp: { phoneNumberId: "987654", encryptedAccessToken } }, secret)).toEqual({
      phoneNumberId: "987654",
      accessToken: "wa-token-secret",
    });
    expect(resolveTenantWhatsappOverride({}, secret)).toBeUndefined();
  });
});

function redactedJson(value: unknown): string {
  return JSON.stringify(value);
}
