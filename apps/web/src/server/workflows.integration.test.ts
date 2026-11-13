import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { ownerDb, appDb } from "./db";
import { user as userTable, tenants, memberships } from "@tahseel/db/schema";
import { withTenant } from "@tahseel/db";
import { createTenantForUser } from "./services";
import { createDebtor, createInvoice } from "./ledger";
import {
  createCollectionTask, createPendingAiApproval, decideAiActionApproval,
  listAiActionApprovals, listCollectionTasks, updateCollectionTask,
} from "./workflows";

const hasDb = Boolean(process.env.DATABASE_URL && (process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL));
if (!hasDb && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 but DB env missing");
const d = hasDb ? describe : describe.skip;

/** Workflow acceptance on real PostgreSQL/RLS: tenant members, task assignment,
 * staff scope, owner reassignment, and durable AI approval before side effects. */
d("collection workflows and AI approvals (service layer)", () => {
  const owner = { id: randomUUID().replace(/-/g, ""), email: `workflow-owner-${randomUUID()}@example.test`, name: "Workflow Owner" };
  const staff = { id: randomUUID().replace(/-/g, ""), email: `workflow-staff-${randomUUID()}@example.test`, name: "Workflow Staff" };
  let tenantId = "";
  const app = () => appDb();

  beforeAll(async () => {
    await ownerDb().insert(userTable).values([owner, staff]);
    tenantId = (await createTenantForUser(app(), owner.id, {
      businessNameAr: "شركة مهام التحصيل", timezone: "Africa/Cairo", quietStart: "21:00", quietEnd: "09:00",
      fridayMorningSkip: false, defaultTermsDays: 14, tone: "polite", consent: true,
    })).tenantId;
    await withTenant(app(), tenantId, async (tx) => {
      await tx.insert(memberships).values({ tenantId, userId: staff.id, role: "staff" });
    });
  });

  afterAll(async () => {
    await ownerDb().delete(tenants).where(eq(tenants.id, tenantId));
    await ownerDb().delete(userTable).where(eq(userTable.id, staff.id));
    await ownerDb().delete(userTable).where(eq(userTable.id, owner.id));
  });

  it("assigns tasks to same-tenant members and restricts staff to their own tasks", async () => {
    const debtor = await createDebtor(app(), tenantId, owner.id, { displayName: "عميل الفريق", phone: "01077778888" });
    const invoice = await createInvoice(app(), tenantId, owner.id, {
      debtorId: debtor.id, amount: "450.00", issuedOn: "2026-11-01", dueOn: "2026-12-01",
    });
    const task = await createCollectionTask(app(), tenantId, owner.id, {
      debtorId: debtor.id, invoiceId: invoice.id, title: "متابعة موعد التحويل", priority: "urgent",
      assignedToUserId: staff.id, dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const staffTasks = await listCollectionTasks(app(), tenantId, { assignedToUserId: staff.id });
    expect(staffTasks.some((row) => row.id === task.id)).toBe(true);

    const completed = await updateCollectionTask(app(), tenantId, staff.id, "staff", { id: task.id, status: "done" });
    expect(completed.status).toBe("done");
    await expect(updateCollectionTask(app(), tenantId, staff.id, "staff", {
      id: task.id, assignedToUserId: owner.id,
    })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const reassigned = await updateCollectionTask(app(), tenantId, owner.id, "owner", {
      id: task.id, status: "open", assignedToUserId: owner.id,
    });
    expect(reassigned.assignedToUserId).toBe(owner.id);
    await expect(createCollectionTask(app(), tenantId, owner.id, {
      debtorId: debtor.id, title: "مسند لمستخدم خارجي", priority: "normal",
      assignedToUserId: randomUUID().replace(/-/g, ""), dueAt: new Date(Date.now() + 86_400_000).toISOString(),
    })).rejects.toMatchObject({ code: "INVALID_ASSIGNEE" });
  });

  it("keeps AI proposals pending until owner approval, then executes only the approved task", async () => {
    const debtor = await createDebtor(app(), tenantId, owner.id, { displayName: "عميل اقتراح AI", phone: "01077779999" });
    const invoice = await createInvoice(app(), tenantId, owner.id, {
      debtorId: debtor.id, amount: "800.00", issuedOn: "2026-11-01", dueOn: "2026-12-02",
    });
    const dueAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const proposal = await createPendingAiApproval(app(), tenantId, owner.id, {
      actionType: "create_collection_task", debtorId: debtor.id, invoiceId: invoice.id,
      title: "متابعة فاتورة متأخرة", description: "اتصل بالعميل لتأكيد موعد التحويل.",
      priority: "high", dueAt, rationale: "الرصيد ما زال مفتوحاً ويحتاج متابعة.",
    });
    expect(proposal.status).toBe("pending");
    expect((await listCollectionTasks(app(), tenantId)).some((row) => row.title.includes("متابعة فاتورة متأخرة"))).toBe(false);

    const approved = await decideAiActionApproval(app(), tenantId, owner.id, proposal.id, "approve");
    expect(approved.status).toBe("executed");
    const after = await listCollectionTasks(app(), tenantId);
    expect(after.some((row) => row.title === "متابعة فاتورة متأخرة" && row.debtorId === debtor.id)).toBe(true);
    const history = await listAiActionApprovals(app(), tenantId);
    expect(history.find((row) => row.id === proposal.id)?.status).toBe("executed");
  });
});
