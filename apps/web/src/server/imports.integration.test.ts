import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { ownerDb, appDb } from "./db";
import { user as userTable, tenants } from "@tahseel/db/schema";
import { createTenantForUser } from "./services";
import { createDebtor, getDebtorDetail, listInvoicesPage } from "./ledger";
import { createImportPreview, updateImportMapping, commitImport, undoImport, getImportJob } from "./imports";
import { reminders } from "@tahseel/db/schema";
import { withTenant } from "@tahseel/db";

/**
 * M5 race fix (setup only): commitImport fires the async tenant planner
 * (replanTenantLater); its reminder inserts can deadlock the undo's
 * deletes when the planner is still running under parallel load. Wait
 * until the tenant's reminder count is stable before undoing.
 */
async function settlePlanner(tenantId: string): Promise<void> {
  let last = -1; let stable = 0;
  for (let i = 0; i < 75 && stable < 3; i++) {
    const rows = await withTenant(appDb(), tenantId, (tx) => tx.select({ id: reminders.id }).from(reminders));
    if (rows.length === last && i > 5) stable++; else stable = 0;
    last = rows.length;
    await new Promise((r) => setTimeout(r, 200));
  }
}

/**
 * F2 acceptance at the service layer (real Postgres + RLS): a messy CSV
 * (title rows, Arabic header on row 3, Arabic-digit amounts, bad rows,
 * duplicates) previews with every row accounted for, commits in one
 * transaction, and undoes within 24h.
 */
const hasDb = Boolean(process.env.DATABASE_URL && (process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL));
if (!hasDb && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 but DB env missing");
const d = hasDb ? describe : describe.skip;

const MESSY_CSV = [
  "كشف مديونيات العملاء,,,",
  "تم التصدير من دفتر الأستاذ,,,",
  "اسم العميل,رقم الهاتف,المبلغ المستحق,تاريخ الاستحقاق",
  "وارد أول,01001230001,\"1,250.50\",2026-11-20",
  "وارد ثان,٠١٠٠١٢٣٠٠٠٢,٢٥٠٠,٢٥/١١/٢٠٢٦",
  "موجود مسبقًا,01001230003,400,2026-11-21",
  "تكرار داخل الملف,01001230001,999,2026-11-22",
  "بدون هاتف,,100,2026-11-20",
  "مبلغ فاسد,01001230009,xyz,2026-11-20",
  ",,,,",
].join("\n");

d("F2 import service (preview -> commit -> undo)", () => {
  const user = { id: randomUUID().replace(/-/g, ""), email: `f2-${randomUUID()}@example.test`, name: "F2" };
  let tenantId = "";
  const app = () => appDb();
  const today = "2026-11-09";

  beforeAll(async () => {
    await ownerDb().insert(userTable).values([user]);
    tenantId = (await createTenantForUser(appDb(), user.id, {
      businessNameAr: "شركة ف٢", timezone: "Africa/Cairo", quietStart: "21:00", quietEnd: "09:00",
      fridayMorningSkip: false, defaultTermsDays: 14, tone: "polite", consent: true,
    })).tenantId;
    await createDebtor(app(), tenantId, user.id, { displayName: "موجود مسبقًا", phone: "01001230003" });
  });
  afterAll(async () => {
    const owner = ownerDb();
    await owner.delete(tenants).where(eq(tenants.id, tenantId));
    await owner.delete(userTable).where(eq(userTable.id, user.id));
  });

  it("preview detects the Arabic header on row 3 and accounts for every row", async () => {
    const preview = await createImportPreview(app(), tenantId, user.id, {
      fileName: "messy.csv",
      contentBase64: Buffer.from(MESSY_CSV, "utf8").toString("base64"),
    });
    expect(preview.headerRow).toBe(2); // 0-based index of sheet row 3
    expect(preview.mapping).toMatchObject({ name: 0, phone: 1, amount: 2, dueDate: 3 });
    expect(preview.stats).toMatchObject({ total: 7, valid: 2, duplicate: 2, invalid: 2, empty: 1 });
    const job = await getImportJob(app(), tenantId, preview.jobId);
    const byRow = new Map(job.rows.map((r) => [r.rowNumber, r]));
    expect(byRow.get(4)?.status).toBe("valid");
    expect(byRow.get(6)?.status).toBe("duplicate"); // existing debtor
    expect(byRow.get(7)?.status).toBe("duplicate"); // in-file repeat
    expect(byRow.get(8)?.status).toBe("invalid");
    expect(byRow.get(8)?.errors.map((e) => e.field)).toContain("phone");
    expect(byRow.get(9)?.errors.map((e) => e.field)).toContain("amount");
    expect(byRow.get(10)?.status).toBe("empty"); // empty row reported with its own status, never dropped
  });

  it("commit creates debtors+invoices in one transaction; duplicates reuse the debtor; undo removes them within 24h", async () => {
    const preview = await createImportPreview(app(), tenantId, user.id, {
      fileName: "messy.csv",
      contentBase64: Buffer.from(MESSY_CSV, "utf8").toString("base64"),
    });
    const committed = await commitImport(app(), tenantId, user.id, preview.jobId, today);
    expect(committed).toMatchObject({ createdDebtors: 2, createdInvoices: 4 });
    // the two valid rows made debtors; existing + in-file duplicates attached invoices to the right debtor
    const first = await listInvoicesPage(app(), tenantId, { search: undefined }, today);
    expect(first.items.filter((i) => i.source === "import")).toHaveLength(4);
    const detail = await getDebtorDetail(app(), tenantId, (await getImportJob(app(), tenantId, preview.jobId)).rows.find((r) => r.rowNumber === 4)!.debtorId!, today);
    expect(detail.invoices.map((i) => i.amountMinor).sort()).toEqual(["125050", "99900"]); // own invoice + in-file duplicate's invoice
    expect(detail.displayName).toBe("وارد أول");

    await settlePlanner(tenantId);
    const undone = await undoImport(app(), tenantId, user.id, preview.jobId);
    expect(undone).toMatchObject({ deletedInvoices: 4, deletedDebtors: 2 });
    const after = await listInvoicesPage(app(), tenantId, {}, today);
    expect(after.items.filter((i) => i.source === "import")).toHaveLength(0);
    await expect(undoImport(app(), tenantId, user.id, preview.jobId)).rejects.toMatchObject({ code: "NOT_COMMITTED" });
  });

  it("a corrected mapping re-parses from the stored grid without re-upload", async () => {
    const csv = ["Phone,Name,Amount", "01001230007,معكوس,123.45"].join("\n");
    const preview = await createImportPreview(app(), tenantId, user.id, {
      fileName: "swapped.csv",
      contentBase64: Buffer.from(csv, "utf8").toString("base64"),
    });
    expect(preview.stats.valid).toBe(1);
    // merchant insists name/phone were swapped: re-map and the row becomes invalid (name is a phone, phone is a name)
    const remapped = await updateImportMapping(app(), tenantId, user.id, preview.jobId, { name: 1, phone: 0, amount: 2 });
    expect(remapped.stats.valid).toBe(1); // header labels moved with the columns, still consistent
    const remapped2 = await updateImportMapping(app(), tenantId, user.id, preview.jobId, { name: 0, phone: 1, amount: 2 });
    expect(remapped2.stats).toMatchObject({ valid: 0, invalid: 1 });
  });

  it("undo after the 24-hour window is refused with UNDO_EXPIRED", async () => {
    const csv = ["Name,Phone,Amount", "منتهي الصلاحية,01001230011,10"].join("\n");
    const preview = await createImportPreview(app(), tenantId, user.id, {
      fileName: "expiry.csv",
      contentBase64: Buffer.from(csv, "utf8").toString("base64"),
    });
    await commitImport(app(), tenantId, user.id, preview.jobId, today);
    const { importJobs } = await import("@tahseel/db/schema");
    const { eq: eqOp } = await import("drizzle-orm");
    // Owner connection moves the window into the past, as time would.
    await ownerDb().update(importJobs)
      .set({ undoExpiresAt: new Date(Date.now() - 60_000) })
      .where(eqOp(importJobs.id, preview.jobId));
    await expect(undoImport(app(), tenantId, user.id, preview.jobId)).rejects.toMatchObject({ code: "UNDO_EXPIRED" });
  });

  it("files without a detectable header are rejected loudly", async () => {
    await expect(createImportPreview(app(), tenantId, user.id, {
      fileName: "junk.csv",
      contentBase64: Buffer.from("a,b,c\n1,2,3\n", "utf8").toString("base64"),
    })).rejects.toMatchObject({ code: "NO_HEADER_ROW" });
  });
});
