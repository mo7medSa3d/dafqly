import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDb, createAppDb, debtors, invoices, messages, optOuts, reminders, tenants, webhookEvents, type Db } from "@tahseel/db";
import { FakeMessagingProvider } from "@tahseel/providers";
import { dispatchDue, planForInvoice, type EngineDeps } from "./engine";
import { parseWebhookPayload, persistWebhookEvents, processWebhookEvents, purgeOldWebhookPayloads, verifyWebhookSignature } from "./webhook";

/**
 * F3 acceptance suite (BUILD_PLAN §7-F3): recorded-shape Meta webhook
 * fixtures against the fake provider + real Postgres. The payloads below are
 * hand-built to Meta's documented shapes (ADR-015) — they are FIXTURES, not
 * captures from a live account (no Meta account exists yet; RUNBOOK).
 */
const ownerUrl = process.env.DATABASE_URL;
const appUrl = process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL;
if (!ownerUrl || !appUrl) {
  if (process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 but DATABASE_URL/APP_DATABASE_URL are not set");
  console.warn("[webhook.integration] SKIPPED: DATABASE_URL/APP_DATABASE_URL not set");
}
const d = ownerUrl && appUrl ? describe : describe.skip;
const hash = (e164: string) => createHash("sha256").update(`:${e164}`).digest("hex");

function statusPayload(wamid: string, status: string, errorCode?: number) {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: "WABA-TEST",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "15550000000", phone_number_id: "1234567890" },
          statuses: [{
            id: wamid, status, timestamp: "1794000000", recipient_id: "201001234567",
            ...(errorCode ? { errors: [{ code: errorCode, title: "fixture error" }] } : {}),
          }],
        },
      }],
    }],
  };
}
function inboundPayload(wamid: string, from: string, body: string) {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: "WABA-TEST",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "15550000000", phone_number_id: "1234567890" },
          contacts: [{ profile: { name: "عميل" }, wa_id: from }],
          messages: [{ from, id: wamid, timestamp: "1794000100", type: "text", text: { body } }],
        },
      }],
    }],
  };
}

d("webhook processing (F3)", () => {
  let owner: Db;
  let app: Db;
  const whatsapp = new FakeMessagingProvider();
  const sms = new FakeMessagingProvider();
  const deps = (): EngineDeps => ({ app, owner, providers: { whatsapp, sms } });
  // Random per-process offset: provider message ids are GLOBALLY unique and
  // webhook dedupe is global, so fixture phones/wamids must never repeat
  // across runs against a persistent dev database. The offset is capped so
  // the phone suffix stays 8 digits — past ~30M it became 9 digits, the
  // number stopped normalizing as an EG mobile, and the dispatcher rightly
  // skipped every send (flaky failures in ~25% of parallel full-suite runs).
  let counter = Math.floor(Math.random() * 20_000_000);

  async function fixture(dueOn = "2026-11-20") {
    counter++;
    const phone = `+2010${String(70000000 + counter)}`;
    const [t] = await owner.insert(tenants).values({
      name: "Webhook Test", businessNameAr: "محل الويب هوك", timezone: "Africa/Cairo",
      settings: {
        quietStart: "21:00", quietEnd: "09:00", fridayMorningSkip: false, autoCloseEnabled: false,
        defaultChannel: "whatsapp", tone: "polite", defaultTermsDays: 14, easternDigits: false, sendTimeLocal: "10:00",
      } as never,
    }).returning();
    const [debtor] = await owner.insert(debtors).values({
      tenantId: t!.id, displayName: "عميل", phoneE164: phone, phoneHash: hash(phone),
    }).returning();
    const [invoice] = await owner.insert(invoices).values({
      tenantId: t!.id, debtorId: debtor!.id, amountMinor: 100_000n, issuedOn: "2026-11-01", dueOn,
    }).returning();
    await planForInvoice(deps(), t!.id, invoice!.id, new Date("2026-11-10T00:00:00Z"));
    return { tenantId: t!.id, debtorId: debtor!.id, invoiceId: invoice!.id, phone };
  }

  beforeAll(() => {
    owner = createDb(ownerUrl!).db;
    app = createAppDb(appUrl!).db;
  });
  afterAll(async () => {
    await owner.$client.end();
    await app.$client.end();
  });

  it("signature verification: HMAC-SHA256 over the raw body (ADR-015)", () => {
    const body = JSON.stringify({ hello: "world" });
    const secret = "test-app-secret";
    const good = `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
    expect(verifyWebhookSignature(body, good, secret)).toBe(true);
    expect(verifyWebhookSignature(body, good, "other-secret")).toBe(false);
    expect(verifyWebhookSignature(`${body} `, good, secret)).toBe(false);
    expect(verifyWebhookSignature(body, null, secret)).toBe(false);
    expect(verifyWebhookSignature(body, "sha256=deadbeef", secret)).toBe(false);
  });

  it("full lifecycle: queued -> sent -> delivered -> read; out-of-order events never downgrade", async () => {
    const f = await fixture();
    await dispatchDue(deps(), new Date("2026-11-20T08:30:00Z"), { tenantId: f.tenantId });
    const [msg] = await owner.select().from(messages).where(eq(messages.tenantId, f.tenantId));
    expect(msg?.status).toBe("sent");
    const wamid = msg!.providerMessageId!;
    const now = new Date("2026-11-20T09:00:00Z");
    let s = await processWebhookEvents(deps(), parseWebhookPayload(statusPayload(wamid, "delivered")), now);
    expect(s.statusesApplied).toBe(1);
    s = await processWebhookEvents(deps(), parseWebhookPayload(statusPayload(wamid, "read")), now);
    expect(s.statusesApplied).toBe(1);
    const [after] = await owner.select().from(messages).where(eq(messages.id, msg!.id));
    expect(after?.status).toBe("read");
    // Replay + out-of-order: a late "delivered" and a duplicate "read" change nothing.
    s = await processWebhookEvents(deps(), parseWebhookPayload(statusPayload(wamid, "delivered")), now);
    expect(s.statusesIgnored).toBe(1);
    const [still] = await owner.select().from(messages).where(eq(messages.id, msg!.id));
    expect(still?.status).toBe("read");
  });

  it("a failed status stores the provider error code and fails the reminder", async () => {
    const f = await fixture();
    await dispatchDue(deps(), new Date("2026-11-20T08:30:00Z"), { tenantId: f.tenantId });
    const [msg] = await owner.select().from(messages).where(eq(messages.tenantId, f.tenantId));
    const s = await processWebhookEvents(deps(), parseWebhookPayload(statusPayload(msg!.providerMessageId!, "failed", 131026)), new Date());
    expect(s.statusesApplied).toBe(1);
    const [after] = await owner.select().from(messages).where(eq(messages.id, msg!.id));
    expect(after?.status).toBe("failed");
    expect(after?.statusErrorCode).toBe(131026);
    const rows = await owner.select().from(reminders).where(eq(reminders.providerMessageId, msg!.providerMessageId!));
    expect(rows[0]?.status).toBe("failed");
    expect(rows[0]?.lastErrorCode).toBe(131026);
  });

  it("inbound reply is stored once; replaying the same webhook creates no duplicates", async () => {
    const f = await fixture();
    const payload = inboundPayload(`wamid.in-${f.phone.slice(4)}`, f.phone.slice(1), "هدفع بكرة إن شاء الله");
    const persisted = await persistWebhookEvents(owner, payload);
    expect(persisted.inserted).toBe(1);
    const replay = await persistWebhookEvents(owner, payload);
    expect(replay.inserted).toBe(0); // inbox dedupe by provider message id
    const now = new Date("2026-11-20T09:00:00Z");
    let s = await processWebhookEvents(deps(), persisted.events, now);
    expect(s.inboundStored).toBe(1);
    s = await processWebhookEvents(deps(), persisted.events, now);
    expect(s.inboundStored).toBe(0); // processing dedupe too
    const inbound = (await owner.select().from(messages).where(eq(messages.tenantId, f.tenantId)))
      .filter((m) => m.direction === "in");
    expect(inbound).toHaveLength(1);
    expect(inbound[0]?.bodyText).toContain("هدفع بكرة");
  });

  it("M6: the stored webhook payload never contains the message body or sender phone", async () => {
    const f = await fixture();
    const payload = inboundPayload(`wamid.in-redact-${f.tenantId.slice(0, 8)}`, f.phone.slice(1), "دفعت 500 جنيه اليوم");
    const persisted = await persistWebhookEvents(owner, payload);
    expect(persisted.inserted).toBe(1);
    const [row] = await owner.select().from(webhookEvents).where(eq(webhookEvents.dedupeKey, persisted.events[0]!.dedupeKey));
    const stored = JSON.stringify(row!.payload);
    expect(stored).not.toContain("دفعت 500 جنيه");
    expect(stored).not.toContain(f.phone.slice(1));
    expect(stored).toContain(persisted.events[0]!.providerMessageId);
    // Processing still works from the parsed events (not the stored payload).
    const s = await processWebhookEvents(deps(), persisted.events, new Date("2026-11-20T09:00:00Z"));
    expect(s.inboundStored).toBe(1);
  });

  it("M3/M6 retention purge: old payloads become tombstones, fresh rows untouched, dedupe keys survive", async () => {
    const f = await fixture();
    const oldAt = new Date(Date.now() - 100 * 86_400_000);
    await owner.insert(webhookEvents).values({
      provider: "whatsapp", dedupeKey: `purge-old-${f.tenantId.slice(0, 8)}`,
      payload: { secret: "old-body-text" }, receivedAt: oldAt,
    });
    await owner.insert(webhookEvents).values({
      provider: "whatsapp", dedupeKey: `purge-fresh-${f.tenantId.slice(0, 8)}`,
      payload: { body: "fresh" },
    });
    await owner.insert(messages).values({
      tenantId: f.tenantId, debtorId: f.debtorId, direction: "in", channel: "whatsapp",
      provider: "whatsapp", bodyText: "old inbound", status: "read", raw: { secret: "old-raw" }, createdAt: oldAt,
    });
    const purged = await purgeOldWebhookPayloads(owner);
    expect(purged.webhookEvents).toBeGreaterThanOrEqual(1);
    expect(purged.messages).toBeGreaterThanOrEqual(1);
    const [oldRow] = await owner.select().from(webhookEvents).where(eq(webhookEvents.dedupeKey, `purge-old-${f.tenantId.slice(0, 8)}`));
    expect(oldRow!.payload).toEqual({ redacted: true });
    expect(oldRow!.dedupeKey).toBe(`purge-old-${f.tenantId.slice(0, 8)}`);
    const [freshRow] = await owner.select().from(webhookEvents).where(eq(webhookEvents.dedupeKey, `purge-fresh-${f.tenantId.slice(0, 8)}`));
    expect(freshRow!.payload).toEqual({ body: "fresh" });
    const [msg] = await owner.select().from(messages).where(eq(messages.bodyText, "old inbound"));
    expect(msg!.raw).toBeNull();
  });

  it("OPT-OUT: an إيقاف reply stops all further sends for that phone immediately", async () => {
    const f = await fixture();
    whatsapp.texts.length = 0;
    const payload = inboundPayload(`wamid.in-opt-${f.tenantId.slice(0, 8)}`, f.phone.slice(1), "إيقاف");
    const { events } = await persistWebhookEvents(owner, payload);
    const s = await processWebhookEvents(deps(), events, new Date("2026-11-15T10:00:00Z"));
    expect(s.optOutsApplied).toBe(1);
    const [debtor] = await owner.select().from(debtors).where(eq(debtors.id, f.debtorId));
    expect(debtor?.optedOutAt).not.toBeNull();
    const outs = await owner.select().from(optOuts).where(eq(optOuts.tenantId, f.tenantId));
    expect(outs).toHaveLength(1);
    // All planned reminders cancelled by the opt-out itself.
    const rows = await owner.select().from(reminders).where(eq(reminders.tenantId, f.tenantId));
    expect(rows.every((r) => r.status === "cancelled" && r.skipReason === "opted_out")).toBe(true);
    // A polite confirmation went out inside the 24h window.
    expect(whatsapp.texts).toHaveLength(1);
    // And a later dispatch sends nothing, ever.
    whatsapp.sent.length = 0;
    await dispatchDue(deps(), new Date("2026-11-20T08:30:00Z"), { tenantId: f.tenantId });
    expect(whatsapp.sent.filter((x) => x.toE164 === f.phone)).toHaveLength(0);
  });

  it("inbound from an unknown phone is counted, not crashed", async () => {
    const payload = inboundPayload("wamid.in-unknown", "201099999999", "مرحبا");
    const s = await processWebhookEvents(deps(), parseWebhookPayload(payload), new Date());
    expect(s.unknown).toBe(1);
    expect(s.inboundStored).toBe(0);
  });
});
