import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { ownerDb, appDb } from "./db";
import { user as userTable, tenants, statementLinks, disputes, reminders } from "@tahseel/db/schema";
import { createTenantForUser } from "./services";
import { createDebtor, createInvoice, recordPayment } from "./ledger";
import {
  createStatementLink, listStatementLinks, revokeStatementLink,
  getStatementData, raiseStatementDispute, listDisputes, resolveStatementDispute,
} from "./statements";

/**
 * F10 acceptance at the service layer (real Postgres + RLS): hash-only token
 * storage, the allowlisted public payload (internal notes never leak),
 * generic not-found for unknown/expired/revoked tokens, and the dispute
 * flow pausing reminders + merchant resolution reopening invoices.
 */
const hasDb = Boolean(process.env.DATABASE_URL && (process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL));
if (!hasDb && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 but DB env missing");
const d = hasDb ? describe : describe.skip;

d("F10 statement links and disputes (service layer)", () => {
  const user = { id: randomUUID().replace(/-/g, ""), email: `f10-${randomUUID()}@example.test`, name: "F10" };
  let tenantId = "";
  const app = () => appDb();
  const owner = () => ownerDb();
  const now = new Date("2026-11-09T10:00:00Z");

  beforeAll(async () => {
    await ownerDb().insert(userTable).values([user]);
    tenantId = (await createTenantForUser(appDb(), user.id, {
      businessNameAr: "شركة ف١٠", timezone: "Africa/Cairo", quietStart: "21:00", quietEnd: "09:00",
      fridayMorningSkip: false, defaultTermsDays: 14, tone: "polite", consent: true,
    })).tenantId;
  });
  afterAll(async () => {
    const o = ownerDb();
    await o.delete(tenants).where(eq(tenants.id, tenantId));
    await o.delete(userTable).where(eq(userTable.id, user.id));
  });

  it("creates a link: 43-char token returned once, only its hash stored, 30-day default expiry", async () => {
    const debtor = await createDebtor(app(), tenantId, user.id, { displayName: "صاحب كشف", phone: "01066661111" });
    const link = await createStatementLink(app(), tenantId, user.id, debtor.id, now);
    expect(link.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(link.path).toBe(`/s/${link.token}`);
    expect(link.state).toBe("valid");
    expect(new Date(link.expiresAt).getTime() - now.getTime()).toBe(30 * 86_400_000);
    const [row] = await owner().select().from(statementLinks).where(eq(statementLinks.id, link.id));
    expect(row!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.tokenHash).not.toBe(link.token);
    expect(JSON.stringify(row)).not.toContain(link.token);
    const listed = await listStatementLinks(app(), tenantId, debtor.id, now);
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(link.token); // the list can never re-leak it
  });

  it("serves an allowlisted statement: totals, invoices, payments — and never the internal notes", async () => {
    const debtor = await createDebtor(app(), tenantId, user.id, {
      displayName: "عميل الكشف", phone: "01066662222", notes: "INTERNAL-NOTE-XYZ do not show",
    });
    const inv = await createInvoice(app(), tenantId, user.id, { debtorId: debtor.id, amount: "900.00", issuedOn: "2026-11-01", dueOn: "2026-11-20", reference: "INV-S1" });
    await recordPayment(app(), tenantId, user.id, { debtorId: debtor.id, amount: "250.00", method: "instapay", receivedOn: "2026-11-05" });
    const link = await createStatementLink(app(), tenantId, user.id, debtor.id, now);
    const data = await getStatementData(app(), owner(), link.token, new Date());
    expect(data).not.toBeNull();
    expect(data!.businessName).toBe("شركة ف١٠");
    expect(data!.debtorName).toBe("عميل الكشف");
    expect(data!.totalDueMinor).toBe("65000");
    expect(data!.invoices).toHaveLength(1);
    expect(data!.invoices[0]).toMatchObject({ id: inv.id, reference: "INV-S1", outstandingMinor: "65000", status: "partially_paid" });
    expect(data!.payments).toHaveLength(1);
    expect(data!.payments[0]).toMatchObject({ amountMinor: "25000", status: "confirmed" });
    expect(JSON.stringify(data)).not.toContain("INTERNAL-NOTE-XYZ");
    expect(JSON.stringify(data)).not.toContain("notes");
    const [row] = await owner().select().from(statementLinks).where(eq(statementLinks.id, link.id));
    expect(row!.lastViewedAt).not.toBeNull();
  });

  it("unknown, expired and revoked tokens are indistinguishable: all return no data", async () => {
    const debtor = await createDebtor(app(), tenantId, user.id, { displayName: "انتهاء وإلغاء", phone: "01066663333" });
    await createInvoice(app(), tenantId, user.id, { debtorId: debtor.id, amount: "100.00", issuedOn: "2026-11-01", dueOn: "2026-11-20" });
    expect(await getStatementData(app(), owner(), "A".repeat(43), new Date())).toBeNull();

    const expiring = await createStatementLink(app(), tenantId, user.id, debtor.id, now);
    await owner().update(statementLinks).set({ expiresAt: new Date(now.getTime() - 1000) }).where(eq(statementLinks.id, expiring.id));
    const afterExpiry = new Date(now.getTime() + 60_000); // evaluated after the forged expiry instant
    expect(await getStatementData(app(), owner(), expiring.token, afterExpiry)).toBeNull();
    await expect(raiseStatementDispute(app(), owner(), expiring.token, { invoiceId: "00000000-0000-7000-8000-000000000000", reason: "x" }, afterExpiry))
      .rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });

    const revoked = await createStatementLink(app(), tenantId, user.id, debtor.id, now);
    await revokeStatementLink(app(), tenantId, user.id, revoked.id, now);
    expect(await getStatementData(app(), owner(), revoked.token, new Date())).toBeNull();
    const listed = await listStatementLinks(app(), tenantId, debtor.id, new Date());
    expect(listed.find((l) => l.id === revoked.id)!.state).toBe("revoked");
  });

  it("ACCEPTANCE: the dispute button creates a dispute, disputes the invoice, pauses its reminders, and merchant resolution reopens it", async () => {
    const debtor = await createDebtor(app(), tenantId, user.id, { displayName: "نزاع", phone: "01066664444" });
    const inv = await createInvoice(app(), tenantId, user.id, { debtorId: debtor.id, amount: "800.00", issuedOn: "2026-11-01", dueOn: "2026-11-20" });
    const waitFor = async (pred: (rows: { status: string }[]) => boolean) => {
      for (let i = 0; i < 25; i++) {
        const rows = await owner().select().from(reminders).where(eq(reminders.invoiceId, inv.id));
        if (rows.length > 0 && pred(rows)) return rows;
        await new Promise((r) => setTimeout(r, 200));
      }
      return owner().select().from(reminders).where(eq(reminders.invoiceId, inv.id));
    };
    const planned = await waitFor((rows) => rows.every((r) => r.status === "scheduled"));
    expect(planned.length).toBeGreaterThan(0);
    expect(planned.every((r) => r.status === "scheduled")).toBe(true);

    const link = await createStatementLink(app(), tenantId, user.id, debtor.id, now);
    const out = await raiseStatementDispute(app(), owner(), link.token, { invoiceId: inv.id, reason: "المبلغ غير صحيح" }, new Date());
    expect(out.invoiceId).toBe(inv.id);
    const rows = await owner().select().from(disputes).where(eq(disputes.id, out.disputeId));
    expect(rows[0]).toMatchObject({ raisedBy: "debtor", status: "open", reason: "المبلغ غير صحيح" });
    const listed = await listDisputes(app(), tenantId, debtor.id);
    expect(listed).toHaveLength(1);

    const after = await waitFor((rs) => rs.every((r) => r.status === "cancelled"));
    expect(after.length).toBe(planned.length);
    expect(after.every((r) => r.status === "cancelled")).toBe(true);

    const data = await getStatementData(app(), owner(), link.token, new Date());
    expect(data!.invoices[0]!.status).toBe("disputed");
    expect(data!.openDisputes).toHaveLength(1);
    await expect(raiseStatementDispute(app(), owner(), link.token, { invoiceId: inv.id, reason: "مرة أخرى" }, new Date()))
      .rejects.toMatchObject({ code: "INVALID_STATE" });

    // Merchant resolves the dispute and reopens the invoice
    const resolved = await resolveStatementDispute(app(), tenantId, user.id, {
      disputeId: out.disputeId,
      resolution: "reopen_invoice",
      note: "تمت مراجعة الفاتورة مع العميل",
    });
    expect(resolved.invoiceStatus).toBe("open");
    const afterResolve = await getStatementData(app(), owner(), link.token, new Date());
    expect(afterResolve!.invoices[0]!.status).toBe("open");
    expect(afterResolve!.openDisputes).toHaveLength(0);
  });

  it("a token cannot dispute another debtor's invoice (generic NOT_FOUND)", async () => {
    const a = await createDebtor(app(), tenantId, user.id, { displayName: "أ", phone: "01066665555" });
    const b = await createDebtor(app(), tenantId, user.id, { displayName: "ب", phone: "01066666666" });
    const invB = await createInvoice(app(), tenantId, user.id, { debtorId: b.id, amount: "50.00", issuedOn: "2026-11-01", dueOn: "2026-11-20" });
    const linkA = await createStatementLink(app(), tenantId, user.id, a.id, now);
    await expect(raiseStatementDispute(app(), owner(), linkA.token, { invoiceId: invB.id, reason: "ليست فاتورتي" }, new Date()))
      .rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});
