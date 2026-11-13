import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { ownerDb, appDb } from "./db";
import { user as userTable, tenants } from "@tahseel/db/schema";
import { AppError } from "@tahseel/core";
import { FakeLlmProvider, FakeStorageProvider } from "@tahseel/providers";
import { createTenantForUser } from "./services";
import {
  createDebtor, createInvoice, recordPayment, getDebtorTimeline,
} from "./ledger";
import {
  createCollectionTask, updateCollectionTask, createMerchantPromise,
  decidePromiseToPay, listPromisesToPay,
} from "./workflows";
import { getDashboardSummary } from "./services";
import { getKpis } from "./reports";
import {
  createStatementLink, createPublicPromiseRequest, listDisputes,
} from "./statements";
import { extractChequePhoto, listCheques } from "./cheques";
// Public portal route handlers (HTTP layer, not just services). The
// `@/app/...` spelling does not exist in tsconfig paths (the routes live
// under `app/`, not `src/app/`), so these are relative imports; the
// routes' own `@/server/...` imports resolve via the vitest `@` alias.
import { POST as payPost } from "../../app/api/public/statement/[token]/pay/route";
import { POST as disputePost } from "../../app/api/public/statement/[token]/dispute/route";
import { POST as promisePost } from "../../app/api/public/statement/[token]/promise/route";

/**
 * Prompts 03/04: the journeys as single continuous tests — each one walks
 * the chain across services and asserts every hop updates the records,
 * balances, reports and activity history it should. The pieces were
 * already covered in isolation (ledger / workflows / statements /
 * gateway / reminders); these tests prove the pieces connect.
 */
const hasDb = Boolean(process.env.DATABASE_URL && (process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL));
if (!hasDb && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 but DB env missing");
const d = hasDb ? describe : describe.skip;

// M5: a REAL 1×1 PNG carrying the synthetic FakeLlm payload in a private
// `synT` ancillary chunk (copied from ai.integration.test.ts).
const pngChunk = (type: string, data: Uint8Array) => {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < 8 + data.length; i++) {
    crc ^= out[i]!;
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  dv.setUint32(8 + data.length, (crc ^ 0xffffffff) >>> 0);
  return out;
};
const concatBytes = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
};
const PNG_SIG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IHDR_1X1 = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
const IDAT_1X1 = new Uint8Array([0x78, 0x01, 0x01, 0x04, 0x00, 0xfb, 0xff, 0x00, 0xff, 0x00, 0x00, 0x03, 0x01, 0x01, 0x00]);
/** Service-level AppError assertions match on the code, not the message. */
const expectCode = async (p: Promise<unknown>, code: string) => {
  let caught: unknown;
  try { await p; } catch (e) { caught = e; }
  expect(caught).toBeInstanceOf(AppError);
  expect((caught as AppError).code).toBe(code);
};

const pngWith = (payload: unknown) => {
  const marker = `TAHSEEL_SYNTHETIC_B64:${Buffer.from(JSON.stringify(payload)).toString("base64")}`;
  return concatBytes(PNG_SIG, pngChunk("IHDR", IHDR_1X1), pngChunk("synT", new TextEncoder().encode(marker)), pngChunk("IDAT", IDAT_1X1), pngChunk("IEND", new Uint8Array(0)));
};

d("Prompt 03 journeys (service + HTTP layers)", () => {
  const user = { id: randomUUID().replace(/-/g, ""), email: `jrn-${randomUUID()}@example.test`, name: "JRN" };
  let tenantId = "";
  const app = () => appDb();

  beforeAll(async () => {
    await ownerDb().insert(userTable).values([user]);
    tenantId = (await createTenantForUser(appDb(), user.id, {
      businessNameAr: "شركة الرحلات", timezone: "Africa/Cairo", quietStart: "21:00", quietEnd: "09:00",
      fridayMorningSkip: false, defaultTermsDays: 14, tone: "polite", consent: true,
    })).tenantId;
  });
  afterAll(async () => {
    const owner = ownerDb();
    await owner.delete(tenants).where(eq(tenants.id, tenantId));
    await owner.delete(userTable).where(eq(userTable.id, user.id));
  });

  it("A: customer → invoice → dashboard → task → follow-up → partial payment → reports + history", async () => {
    const debtor = await createDebtor(app(), tenantId, user.id, { displayName: "عميل الرحلة", phone: "01099990101" });
    const invoice = await createInvoice(app(), tenantId, user.id, { debtorId: debtor.id, amount: "100.00", currency: "EGP", issuedOn: "2026-11-01", dueOn: "2026-11-20" });
    expect(invoice.status).toBe("open");

    // Dashboard + KPIs see the new receivable immediately.
    const before = await getDashboardSummary(app(), tenantId, "2026-11-05");
    expect(before.totalOutstandingMinor).toBe("10000");
    expect(before.debtors).toBe(1);
    expect(before.openInvoices).toBe(1);
    const kpisBefore = await getKpis(app(), tenantId, "2026-11-05");
    expect(kpisBefore.totalOutstandingMinor).toBe(10000);

    // Collection task: assign, follow up, keep open while money is due.
    const task = await createCollectionTask(app(), tenantId, user.id, {
      debtorId: debtor.id, invoiceId: invoice.id, title: "اتصل بالعميل للتحصيل",
      priority: "high", assignedToUserId: user.id, dueAt: "2026-11-10T09:00:00.000Z",
    });
    const inProgress = await updateCollectionTask(app(), tenantId, user.id, "owner", { id: task.id, status: "in_progress" });
    expect(inProgress.status).toBe("in_progress");

    // Partial payment: invoice + balances + dashboard move together.
    const paid = await recordPayment(app(), tenantId, user.id, { debtorId: debtor.id, amount: "40.00", method: "cash", receivedOn: "2026-11-05" });
    expect(paid.amountMinor).toBe("4000");
    const after = await getDashboardSummary(app(), tenantId, "2026-11-05");
    expect(after.totalOutstandingMinor).toBe("6000");
    expect(after.collectedThisMonthMinor).toBe("4000");
    const kpisAfter = await getKpis(app(), tenantId, "2026-11-05");
    expect(kpisAfter.totalOutstandingMinor).toBe(6000);
    expect(kpisAfter.collectedInMonthMinor).toBe(4000);

    // Activity history records the invoice and the payment.
    const timeline = await getDebtorTimeline(app(), tenantId, debtor.id);
    expect(timeline.some((e) => e.kind === "invoice")).toBe(true);
    expect(timeline.some((e) => e.kind === "payment")).toBe(true);

    // Task closes once the follow-up is done (the receivable stays open:
    // 60.00 is still due — the task is about the contact, not the balance).
    const done = await updateCollectionTask(app(), tenantId, user.id, "owner", { id: task.id, status: "done" });
    expect(done.status).toBe("done");
  });

  it("D: promise decisions — accept/reject/broken guards, partial then full fulfillment", async () => {
    const debtor = await createDebtor(app(), tenantId, user.id, { displayName: "عميل الوعد", phone: "01099990102" });
    const invoice = await createInvoice(app(), tenantId, user.id, { debtorId: debtor.id, amount: "100.00", currency: "EGP", issuedOn: "2026-11-01", dueOn: "2026-11-20" });

    // Merchant-created promises start accepted (the merchant is the reviewer).
    const promise = await createMerchantPromise(app(), tenantId, user.id, {
      debtorId: debtor.id, invoiceId: invoice.id, amountMinor: "10000", promisedOn: "2026-11-20",
    });
    expect(promise.status).toBe("accepted");

    // An accepted promise cannot be marked broken before its date, and
    // cannot go back to rejected.
    await expectCode(decidePromiseToPay(app(), tenantId, user.id, promise.id, "broken", "2026-11-10"), "PROMISE_NOT_OVERDUE");
    await expectCode(decidePromiseToPay(app(), tenantId, user.id, promise.id, "rejected"), "INVALID_TRANSITION");

    // Partial fulfillment: 40 of 100 paid — the promise stays accepted,
    // it is NOT kept (a message alone never fulfills it either).
    await recordPayment(app(), tenantId, user.id, { debtorId: debtor.id, amount: "40.00", method: "cash", receivedOn: "2026-11-05" });
    const mid = (await listPromisesToPay(app(), tenantId)).find((p) => p.id === promise.id);
    expect(mid?.status).toBe("accepted");
    expect(mid?.overdue).toBe(false);

    // Full coverage flips it to kept; a kept promise has no transitions left.
    await recordPayment(app(), tenantId, user.id, { debtorId: debtor.id, amount: "60.00", method: "cash", receivedOn: "2026-11-06" });
    const kept = (await listPromisesToPay(app(), tenantId)).find((p) => p.id === promise.id);
    expect(kept?.status).toBe("kept");
    await expectCode(decidePromiseToPay(app(), tenantId, user.id, promise.id, "cancelled"), "INVALID_TRANSITION");

    // Portal-requested promises start pending and go through review.
    const debtor2 = await createDebtor(app(), tenantId, user.id, { displayName: "عميل البوابة", phone: "01099990105" });
    const invoice2 = await createInvoice(app(), tenantId, user.id, { debtorId: debtor2.id, amount: "50.00", currency: "EGP", issuedOn: "2026-11-01", dueOn: "2026-11-20" });
    const link = await createStatementLink(app(), tenantId, user.id, debtor2.id, new Date("2026-11-13T00:00:00.000Z"));
    const pending = await createPublicPromiseRequest(app(), ownerDb(), link.token, { invoiceId: invoice2.id, amountMinor: "5000", promisedOn: "2026-11-25" }, new Date("2026-11-13T00:00:00.000Z"));
    expect(pending.status).toBe("pending");
    const accepted = await decidePromiseToPay(app(), tenantId, user.id, pending.id, "accepted");
    expect(accepted.status).toBe("accepted");
    const pending2 = await createPublicPromiseRequest(app(), ownerDb(), link.token, { invoiceId: invoice2.id, amountMinor: "4000", promisedOn: "2026-11-25" }, new Date("2026-11-13T00:00:00.000Z"));
    const rejected = await decidePromiseToPay(app(), tenantId, user.id, pending2.id, "rejected");
    expect(rejected.status).toBe("rejected");
  });

  it("F: portal pay/dispute/promise POST routes — token gate, 201s, and ledger effects", async () => {
    const debtor = await createDebtor(app(), tenantId, user.id, { displayName: "عميل البوابة ٢", phone: "01099990103" });
    const invoice = await createInvoice(app(), tenantId, user.id, { debtorId: debtor.id, amount: "50.00", currency: "EGP", issuedOn: "2026-11-01", dueOn: "2026-11-20" });
    const link = await createStatementLink(app(), tenantId, user.id, debtor.id, new Date("2026-11-13T00:00:00.000Z"));
    const params = { params: Promise.resolve({ token: link.token }) };

    // Pay mints a gateway link (fake provider in this env) — no money moves
    // until the verified webhook.
    const payRes = await payPost(new Request("http://localhost/api/public/statement/x/pay", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ invoiceId: invoice.id }),
    }), params);
    expect(payRes.status).toBe(200);
    const payBody = await payRes.json() as { checkoutUrl?: unknown };
    expect(typeof payBody.checkoutUrl).toBe("string");

    // An unknown token gets the same generic 404 as the data route.
    const badRes = await payPost(new Request("http://localhost/api/public/statement/x/pay", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}),
    }), { params: Promise.resolve({ token: "definitely-not-a-token" }) });
    expect(badRes.status).toBe(404);

    // Dispute via HTTP: 201, dispute recorded, invoice disputed.
    const disputeRes = await disputePost(new Request("http://localhost/api/public/statement/x/dispute", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ invoiceId: invoice.id, reason: "المبلغ غير صحيح" }),
    }), params);
    expect(disputeRes.status).toBe(201);
    const disputes = await listDisputes(app(), tenantId, debtor.id);
    expect(disputes.some((x) => x.invoiceId === invoice.id && x.status === "open")).toBe(true);

    // Promise via HTTP: 201, pending — the merchant still has to accept it.
    // (A second invoice: the first is disputed by now, and a disputed
    // invoice is not actionable for a new promise.)
    const invoice2 = await createInvoice(app(), tenantId, user.id, { debtorId: debtor.id, amount: "30.00", currency: "EGP", issuedOn: "2026-11-01", dueOn: "2026-11-20" });
    const promiseRes = await promisePost(new Request("http://localhost/api/public/statement/x/promise", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ invoiceId: invoice2.id, amountMinor: "1000", promisedOn: "2026-11-25" }),
    }), params);
    expect(promiseRes.status).toBe(201);
    const promises = await listPromisesToPay(app(), tenantId);
    expect(promises.some((p) => p.debtorId === debtor.id && p.status === "pending")).toBe(true);
  });

  it("04§6: cheque photo extraction pre-fills and matches, but NEVER registers a cheque", async () => {
    const debtor = await createDebtor(app(), tenantId, user.id, { displayName: "عميل الشيك", phone: "01099990104" });
    const invoice = await createInvoice(app(), tenantId, user.id, { debtorId: debtor.id, amount: "2500.00", currency: "EGP", issuedOn: "2026-11-01", dueOn: "2026-12-01" });
    const deps = { llm: new FakeLlmProvider(), storage: new FakeStorageProvider() };

    const out = await extractChequePhoto(app(), tenantId, user.id, deps, {
      bytes: pngWith({ kind: "cheque", extraction: {
        number: "000123", bank: "CIB", amount_minor: 250000, drawer_name: "عميل الشيك",
        issue_date: "2026-11-01", due_date: "2026-12-01", confidence: 0.9,
      } }),
      mime: "image/png",
    });
    expect(out.extraction?.number).toBe("000123");
    expect(out.extraction?.bank).toBe("CIB");
    expect(out.matchedDebtor?.id).toBe(debtor.id);
    expect(out.matchedInvoice?.id).toBe(invoice.id);
    // Pre-fill only: no cheque row exists until the merchant submits.
    expect(await listCheques(app(), tenantId)).toHaveLength(0);

    // No extraction at all: the photo is stored, nothing is matched, and
    // still nothing is registered.
    const empty = await extractChequePhoto(app(), tenantId, user.id, deps, { bytes: pngWith({}), mime: "image/png" });
    expect(empty.extraction).toBeNull();
    expect(empty.matchedDebtor).toBeNull();
    expect(empty.matchedInvoice).toBeNull();
    expect(typeof empty.fileId).toBe("string");
    expect(await listCheques(app(), tenantId)).toHaveLength(0);
  });
});
