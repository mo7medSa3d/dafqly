import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { AppError } from "@tahseel/core";
import {
  aiActionApprovals, collectionTasks, debtors, disputes, invoices, memberships,
  optOuts, promisesToPay, reminders, tenants, user, withTenant, type Db,
} from "@tahseel/db";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const amountMinor = z.string().regex(/^[1-9]\d{0,17}$/);

export const createTaskInput = z.object({
  debtorId: z.string().uuid(), invoiceId: z.string().uuid().optional(),
  title: z.string().trim().min(3).max(180), description: z.string().trim().max(2000).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  assignedToUserId: z.string().min(1).max(128).nullable().optional(),
  dueAt: z.string().datetime(),
});
export const updateTaskInput = z.object({
  id: z.string().uuid(), status: z.enum(["open", "in_progress", "done", "cancelled"]).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  assignedToUserId: z.string().min(1).max(128).nullable().optional(),
  dueAt: z.string().datetime().optional(),
});
export const createPromiseInput = z.object({
  debtorId: z.string().uuid(), invoiceId: z.string().uuid().optional(),
  amountMinor, promisedOn: isoDate, note: z.string().trim().max(1000).optional(),
});

async function assertAssignedMember(tx: Db, tenantId: string, assignedToUserId: string | null | undefined) {
  if (!assignedToUserId) return;
  const [member] = await tx.select({ userId: memberships.userId }).from(memberships)
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.userId, assignedToUserId)));
  if (!member) throw new AppError("INVALID_ASSIGNEE", "Assignee is not a member of this workspace", 400);
}

export async function listTeamMembers(app: Db, tenantId: string) {
  return withTenant(app, tenantId, async (tx) => tx.select({
    userId: memberships.userId, name: user.name, role: memberships.role,
  }).from(memberships).innerJoin(user, eq(user.id, memberships.userId))
    .where(eq(memberships.tenantId, tenantId)).orderBy(asc(user.name)));
}

export async function listCollectionTasks(app: Db, tenantId: string, filters: { status?: "open" | "in_progress" | "done" | "cancelled"; assignedToUserId?: string } = {}) {
  return withTenant(app, tenantId, async (tx) => {
    const rows = await tx.select({
      id: collectionTasks.id, debtorId: collectionTasks.debtorId, debtorName: debtors.displayName,
      invoiceId: collectionTasks.invoiceId, title: collectionTasks.title, description: collectionTasks.description,
      priority: collectionTasks.priority, status: collectionTasks.status,
      assignedToUserId: collectionTasks.assignedToUserId, assignedToName: user.name,
      dueAt: collectionTasks.dueAt, completedAt: collectionTasks.completedAt,
      createdAt: collectionTasks.createdAt,
    }).from(collectionTasks)
      .innerJoin(debtors, eq(debtors.id, collectionTasks.debtorId))
      .leftJoin(user, eq(user.id, collectionTasks.assignedToUserId))
      .where(and(
        eq(collectionTasks.tenantId, tenantId),
        filters.status ? eq(collectionTasks.status, filters.status) : sql`true`,
        filters.assignedToUserId ? eq(collectionTasks.assignedToUserId, filters.assignedToUserId) : sql`true`,
      )).orderBy(asc(collectionTasks.dueAt), sql`case ${collectionTasks.priority} when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end`);
    return rows.map((r) => ({ ...r, dueAt: r.dueAt.toISOString(), createdAt: r.createdAt.toISOString(), completedAt: r.completedAt?.toISOString() ?? null }));
  });
}

export async function createCollectionTask(app: Db, tenantId: string, actor: string, raw: z.infer<typeof createTaskInput>) {
  const input = createTaskInput.parse(raw);
  return withTenant(app, tenantId, async (tx) => {
    const [debtor] = await tx.select({ id: debtors.id }).from(debtors)
      .where(and(eq(debtors.id, input.debtorId), isNull(debtors.deletedAt)));
    if (!debtor) throw new AppError("NOT_FOUND", "Customer not found", 404);
    if (input.invoiceId) {
      const [invoice] = await tx.select({ id: invoices.id }).from(invoices)
        .where(and(eq(invoices.id, input.invoiceId), eq(invoices.debtorId, input.debtorId)));
      if (!invoice) throw new AppError("INVOICE_CUSTOMER_MISMATCH", "Invoice does not belong to this customer", 400);
    }
    await assertAssignedMember(tx, tenantId, input.assignedToUserId);
    const [row] = await tx.insert(collectionTasks).values({
      tenantId, debtorId: input.debtorId, invoiceId: input.invoiceId ?? null,
      title: input.title, description: input.description ?? null, priority: input.priority,
      assignedToUserId: input.assignedToUserId ?? null, dueAt: new Date(input.dueAt), createdBy: actor,
    }).returning();
    return row!;
  });
}

export async function updateCollectionTask(
  app: Db, tenantId: string, actor: string, role: "owner" | "staff", raw: z.infer<typeof updateTaskInput>,
) {
  const input = updateTaskInput.parse(raw);
  return withTenant(app, tenantId, async (tx) => {
    const [existing] = await tx.select().from(collectionTasks)
      .where(and(eq(collectionTasks.id, input.id), eq(collectionTasks.tenantId, tenantId)));
    if (!existing) throw new AppError("NOT_FOUND", "Task not found", 404);
    if (role !== "owner" && existing.assignedToUserId !== actor) {
      throw new AppError("FORBIDDEN", "Staff can only update tasks assigned to them", 403);
    }
    if (input.assignedToUserId !== undefined) {
      if (role !== "owner") throw new AppError("FORBIDDEN", "Only owners can reassign tasks", 403);
      await assertAssignedMember(tx, tenantId, input.assignedToUserId);
    }
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (input.status) {
      const transitions: Record<string, string[]> = {
        open: ["in_progress", "done", "cancelled"],
        in_progress: ["open", "done", "cancelled"],
        done: ["open"],
        cancelled: ["open"],
      };
      if (existing.status !== input.status && !transitions[existing.status]?.includes(input.status)) {
        throw new AppError("INVALID_TRANSITION", `Cannot move task from ${existing.status} to ${input.status}`, 409);
      }
      set.status = input.status;
      set.completedAt = input.status === "done" ? (existing.completedAt ?? new Date()) : null;
    }
    if (input.priority) set.priority = input.priority;
    if (input.assignedToUserId !== undefined) set.assignedToUserId = input.assignedToUserId;
    if (input.dueAt) set.dueAt = new Date(input.dueAt);
    const [updated] = await tx.update(collectionTasks).set(set as never).where(eq(collectionTasks.id, input.id)).returning();
    return updated!;
  });
}

export async function listPromisesToPay(app: Db, tenantId: string, todayIso = new Date().toISOString().slice(0, 10)) {
  return withTenant(app, tenantId, async (tx) => {
    const rows = await tx.select({
      id: promisesToPay.id, debtorId: promisesToPay.debtorId, debtorName: debtors.displayName,
      invoiceId: promisesToPay.invoiceId, invoiceReference: invoices.reference,
      amountMinor: promisesToPay.amountMinor, promisedOn: promisesToPay.promisedOn,
      status: promisesToPay.status, source: promisesToPay.source, note: promisesToPay.note,
      requestedBy: promisesToPay.requestedBy, reviewedBy: promisesToPay.reviewedBy,
      createdAt: promisesToPay.createdAt,
    }).from(promisesToPay)
      .innerJoin(debtors, eq(debtors.id, promisesToPay.debtorId))
      .leftJoin(invoices, eq(invoices.id, promisesToPay.invoiceId))
      .where(eq(promisesToPay.tenantId, tenantId))
      .orderBy(desc(promisesToPay.promisedOn), desc(promisesToPay.createdAt)).limit(500);
    return rows.map((r) => ({
      ...r, amountMinor: r.amountMinor.toString(), createdAt: r.createdAt.toISOString(),
      overdue: r.status === "accepted" && r.promisedOn < todayIso,
    }));
  });
}

export async function createMerchantPromise(
  app: Db, tenantId: string, actor: string, raw: z.infer<typeof createPromiseInput>,
  todayIso = new Date().toISOString().slice(0, 10),
) {
  const input = createPromiseInput.parse(raw);
  return withTenant(app, tenantId, async (tx) => {
    const [debtor] = await tx.select({ id: debtors.id }).from(debtors)
      .where(and(eq(debtors.id, input.debtorId), isNull(debtors.deletedAt)));
    if (!debtor) throw new AppError("NOT_FOUND", "Customer not found", 404);
    const promisedDate = new Date(`${input.promisedOn}T00:00:00.000Z`);
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(input.promisedOn)
      && !Number.isNaN(promisedDate.getTime())
      && promisedDate.toISOString().slice(0, 10) === input.promisedOn;
    const maxDate = new Date(`${todayIso}T00:00:00.000Z`);
    maxDate.setUTCDate(maxDate.getUTCDate() + 365);
    if (!validDate || input.promisedOn < todayIso || input.promisedOn > maxDate.toISOString().slice(0, 10)) {
      throw new AppError("INVALID_PROMISE_DATE", "Choose a valid promise date within the next 365 days", 400);
    }
    let availableBalance = 0n;
    if (input.invoiceId) {
      const [invoice] = await tx.select().from(invoices)
        .where(and(eq(invoices.id, input.invoiceId), eq(invoices.debtorId, input.debtorId)));
      if (!invoice) throw new AppError("INVOICE_CUSTOMER_MISMATCH", "Invoice does not belong to this customer", 400);
      if (!["open", "partially_paid"].includes(invoice.status)) {
        throw new AppError("INVOICE_NOT_COLLECTIBLE", "Invoice is not collectible", 400);
      }
      availableBalance = invoice.amountMinor - invoice.paidMinor;
    } else {
      const openRows = await tx.select({ amountMinor: invoices.amountMinor, paidMinor: invoices.paidMinor })
        .from(invoices).where(and(eq(invoices.debtorId, input.debtorId), sql`${invoices.status} in ('open','partially_paid')`));
      availableBalance = openRows.reduce((sum, row) => sum + row.amountMinor - row.paidMinor, 0n);
    }
    if (BigInt(input.amountMinor) > availableBalance) throw new AppError("PROMISE_EXCEEDS_BALANCE", "Promise exceeds available open balance", 400);
    const [row] = await tx.insert(promisesToPay).values({
      tenantId, debtorId: input.debtorId, invoiceId: input.invoiceId ?? null,
      amountMinor: BigInt(input.amountMinor), promisedOn: input.promisedOn,
      status: "accepted", source: "manual", note: input.note ?? null, requestedBy: actor, reviewedBy: actor, reviewedAt: new Date(),
    }).returning();
    return row!;
  });
}

export async function decidePromiseToPay(
  app: Db, tenantId: string, actor: string, id: string,
  status: "accepted" | "rejected" | "broken" | "cancelled", todayIso = new Date().toISOString().slice(0, 10),
) {
  return withTenant(app, tenantId, async (tx) => {
    const [row] = await tx.select().from(promisesToPay)
      .where(and(eq(promisesToPay.id, id), eq(promisesToPay.tenantId, tenantId)));
    if (!row) throw new AppError("NOT_FOUND", "Promise not found", 404);
    const allowed: Record<string, string[]> = {
      pending: ["accepted", "rejected"], accepted: ["broken", "cancelled"],
    };
    if (!allowed[row.status]?.includes(status)) throw new AppError("INVALID_TRANSITION", `Cannot move promise from ${row.status} to ${status}`, 409);
    const now = new Date();
    if (status === "broken" && row.promisedOn >= todayIso) {
      throw new AppError("PROMISE_NOT_OVERDUE", "A promise can only be marked broken after its promised date", 409);
    }
    const [updated] = await tx.update(promisesToPay).set({
      status, reviewedBy: actor, reviewedAt: now,
      updatedAt: now,
    }).where(and(eq(promisesToPay.id, id), eq(promisesToPay.status, row.status))).returning();
    if (!updated) throw new AppError("CONCURRENT_UPDATE", "Promise changed; refresh and retry", 409);
    return updated;
  });
}

export const createAiApprovalInput = z.discriminatedUnion("actionType", [
  z.object({ actionType: z.literal("create_collection_task"), debtorId: z.string().uuid(), invoiceId: z.string().uuid().optional(), title: z.string().trim().min(3).max(180), description: z.string().trim().max(2000).optional(), priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"), dueAt: z.string().datetime(), rationale: z.string().trim().min(4).max(1000) }),
  z.object({ actionType: z.literal("schedule_reminder"), debtorId: z.string().uuid(), invoiceId: z.string().uuid(), channel: z.literal("whatsapp"), dueAt: z.string().datetime(), rationale: z.string().trim().min(4).max(1000) }),
]);

export async function createPendingAiApproval(app: Db, tenantId: string, actor: string, raw: z.infer<typeof createAiApprovalInput>) {
  const input = createAiApprovalInput.parse(raw);
  return withTenant(app, tenantId, async (tx) => {
    const [debtor] = await tx.select({ id: debtors.id, displayName: debtors.displayName, optedOutAt: debtors.optedOutAt, phoneValid: debtors.phoneValid })
      .from(debtors).where(and(eq(debtors.id, input.debtorId), isNull(debtors.deletedAt)));
    if (!debtor) throw new AppError("NOT_FOUND", "Customer not found", 404);
    if (input.invoiceId) {
      const [invoice] = await tx.select({ id: invoices.id, debtorId: invoices.debtorId, status: invoices.status, dueOn: invoices.dueOn })
        .from(invoices).where(eq(invoices.id, input.invoiceId));
      if (!invoice || invoice.debtorId !== input.debtorId) throw new AppError("INVOICE_CUSTOMER_MISMATCH", "Invoice does not belong to this customer", 400);
      if (["paid", "cancelled", "written_off", "disputed"].includes(invoice.status)) throw new AppError("INVOICE_NOT_ACTIONABLE", "Invoice is not eligible for collection action", 400);
    }
    const title = input.actionType === "create_collection_task"
      ? `AI: ${input.title}`
      : `AI: schedule ${input.channel} reminder for ${debtor.displayName}`;
    const [row] = await tx.insert(aiActionApprovals).values({
      tenantId, requestedBy: actor, actionType: input.actionType, title,
      rationale: input.rationale, payload: input as unknown as Record<string, unknown>,
    }).returning();
    return { id: row!.id, title: row!.title, status: row!.status };
  });
}

export async function listAiActionApprovals(app: Db, tenantId: string) {
  return withTenant(app, tenantId, async (tx) => {
    const rows = await tx.select({
      id: aiActionApprovals.id, actionType: aiActionApprovals.actionType, status: aiActionApprovals.status,
      title: aiActionApprovals.title, rationale: aiActionApprovals.rationale, payload: aiActionApprovals.payload,
      requestedBy: aiActionApprovals.requestedBy, requestedByName: user.name,
      approvedBy: aiActionApprovals.approvedBy, createdAt: aiActionApprovals.createdAt,
    }).from(aiActionApprovals).leftJoin(user, eq(user.id, aiActionApprovals.requestedBy))
      .where(eq(aiActionApprovals.tenantId, tenantId))
      .orderBy(desc(aiActionApprovals.createdAt)).limit(100);
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  });
}

export async function decideAiActionApproval(
  app: Db, tenantId: string, actor: string, approvalId: string, decision: "approve" | "reject",
) {
  return withTenant(app, tenantId, async (tx) => {
    const [approval] = await tx.select().from(aiActionApprovals)
      .where(and(eq(aiActionApprovals.id, approvalId), eq(aiActionApprovals.tenantId, tenantId)));
    if (!approval) throw new AppError("NOT_FOUND", "AI approval not found", 404);
    if (approval.status !== "pending") throw new AppError("INVALID_TRANSITION", "This approval has already been handled", 409);
    const now = new Date();
    if (decision === "reject") {
      const [updated] = await tx.update(aiActionApprovals).set({ status: "rejected", approvedBy: actor, approvedAt: now, updatedAt: now })
        .where(and(eq(aiActionApprovals.id, approvalId), eq(aiActionApprovals.status, "pending"))).returning();
      if (!updated) throw new AppError("CONCURRENT_UPDATE", "Approval changed; refresh and retry", 409);
      return { status: "rejected" as const, result: null };
    }

    const payload = approval.payload as Record<string, unknown>;
    let result: Record<string, unknown>;
    if (approval.actionType === "create_collection_task") {
      const input = z.object({ debtorId: z.string().uuid(), invoiceId: z.string().uuid().optional(), title: z.string().min(3).max(180), description: z.string().max(2000).optional(), priority: z.enum(["low", "normal", "high", "urgent"]), dueAt: z.string().datetime() }).parse(payload);
      const [debtor] = await tx.select({ id: debtors.id }).from(debtors).where(and(eq(debtors.id, input.debtorId), isNull(debtors.deletedAt)));
      if (!debtor) throw new AppError("NOT_FOUND", "Customer no longer exists", 404);
      if (input.invoiceId) {
        const [invoice] = await tx.select({ id: invoices.id, debtorId: invoices.debtorId }).from(invoices).where(eq(invoices.id, input.invoiceId));
        if (!invoice || invoice.debtorId !== input.debtorId) throw new AppError("INVOICE_CUSTOMER_MISMATCH", "Invoice no longer belongs to customer", 409);
      }
      const [task] = await tx.insert(collectionTasks).values({
        tenantId, debtorId: input.debtorId, invoiceId: input.invoiceId ?? null, title: input.title,
        description: input.description ?? null, priority: input.priority, dueAt: new Date(input.dueAt), createdBy: actor,
      }).returning({ id: collectionTasks.id });
      result = { taskId: task!.id };
    } else {
      const input = z.object({ debtorId: z.string().uuid(), invoiceId: z.string().uuid(), channel: z.literal("whatsapp"), dueAt: z.string().datetime() }).parse(payload);
      const [invoice] = await tx.select({ id: invoices.id, debtorId: invoices.debtorId, dueOn: invoices.dueOn, status: invoices.status })
        .from(invoices).where(and(eq(invoices.id, input.invoiceId), eq(invoices.debtorId, input.debtorId)));
      const [debtor] = await tx.select({ id: debtors.id, optedOutAt: debtors.optedOutAt, phoneValid: debtors.phoneValid })
        .from(debtors).where(and(eq(debtors.id, input.debtorId), isNull(debtors.deletedAt)));
      if (!invoice || !debtor) throw new AppError("NOT_FOUND", "Customer or invoice no longer exists", 404);
      if (["paid", "cancelled", "written_off", "disputed"].includes(invoice.status)) throw new AppError("INVOICE_NOT_ACTIONABLE", "Invoice is no longer eligible", 409);
      if (debtor.optedOutAt || !debtor.phoneValid) throw new AppError("CONTACT_BLOCKED", "Customer cannot be contacted", 409);
      const [optOut] = await tx.select({ id: optOuts.id }).from(optOuts).where(eq(optOuts.debtorId, input.debtorId)).limit(1);
      if (optOut) throw new AppError("CONTACT_OPTED_OUT", "Customer opted out of messages", 409);
      const [dispute] = await tx.select({ id: disputes.id }).from(disputes).where(and(eq(disputes.invoiceId, input.invoiceId), eq(disputes.status, "open"))).limit(1);
      if (dispute) throw new AppError("INVOICE_DISPUTED", "Resolve the dispute before scheduling a reminder", 409);
      const [tenant] = await tx.select({ settings: tenants.settings, timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, tenantId));
      if (tenant?.settings?.sendingPaused) throw new AppError("MESSAGING_PAUSED", "Messaging is paused for this workspace", 409);
      const dueAt = new Date(input.dueAt);
      if (dueAt.getTime() < now.getTime() + 5 * 60_000 || dueAt.getTime() > now.getTime() + 90 * 86_400_000) {
        throw new AppError("INVALID_SCHEDULE_TIME", "Reminder must be scheduled between 5 minutes and 90 days from now", 400);
      }
      const localTodayParts = new Intl.DateTimeFormat("en-CA", { timeZone: tenant?.timezone ?? "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
      const localToday = `${localTodayParts.find((part) => part.type === "year")?.value}-${localTodayParts.find((part) => part.type === "month")?.value}-${localTodayParts.find((part) => part.type === "day")?.value}`;
      const templateKey = invoice.dueOn < localToday ? "invoice_overdue" : invoice.dueOn === localToday ? "invoice_due_today" : "invoice_upcoming";
      const idempotencyKey = `ai-approval:${approval.id}`;
      const [reminder] = await tx.insert(reminders).values({
        tenantId, debtorId: input.debtorId, invoiceId: input.invoiceId,
        stepKey: `ai_${approval.id.slice(0, 20)}`, channel: input.channel, templateKey,
        dueAt, idempotencyKey, status: "scheduled",
      }).returning({ id: reminders.id });
      result = { reminderId: reminder!.id, scheduledFor: dueAt.toISOString() };
    }

    const [updated] = await tx.update(aiActionApprovals).set({
      status: "executed", approvedBy: actor, approvedAt: now, executedAt: now, result: result as never, updatedAt: now,
    }).where(and(eq(aiActionApprovals.id, approvalId), eq(aiActionApprovals.status, "pending"))).returning();
    if (!updated) throw new AppError("CONCURRENT_UPDATE", "Approval changed; refresh and retry", 409);
    return { status: "executed" as const, result };
  });
}

export async function getCollectionWorkspaceSummary(app: Db, tenantId: string, todayIso: string) {
  return withTenant(app, tenantId, async (tx) => {
    const [tasks] = await tx.select({
      open: sql<number>`count(*) filter (where ${collectionTasks.status} in ('open','in_progress'))::int`,
      overdue: sql<number>`count(*) filter (where ${collectionTasks.status} in ('open','in_progress') and ${collectionTasks.dueAt} < now())::int`,
    }).from(collectionTasks).where(eq(collectionTasks.tenantId, tenantId));
    const [promises] = await tx.select({
      pending: sql<number>`count(*) filter (where ${promisesToPay.status} = 'pending')::int`,
      accepted: sql<number>`count(*) filter (where ${promisesToPay.status} = 'accepted')::int`,
      acceptedAmount: sql<string>`coalesce(sum(${promisesToPay.amountMinor}) filter (where ${promisesToPay.status} = 'accepted' and ${promisesToPay.promisedOn} >= ${todayIso}),0)::text`,
      overdue: sql<number>`count(*) filter (where ${promisesToPay.status} = 'accepted' and ${promisesToPay.promisedOn} < ${todayIso})::int`,
    }).from(promisesToPay).where(eq(promisesToPay.tenantId, tenantId));
    const [approvals] = await tx.select({ pending: sql<number>`count(*)::int` }).from(aiActionApprovals)
      .where(and(eq(aiActionApprovals.tenantId, tenantId), eq(aiActionApprovals.status, "pending")));
    return { openTasks: tasks?.open ?? 0, overdueTasks: tasks?.overdue ?? 0,
      pendingPromises: promises?.pending ?? 0, acceptedPromises: promises?.accepted ?? 0,
      acceptedPromiseAmountMinor: promises?.acceptedAmount ?? "0", overduePromises: promises?.overdue ?? 0,
      pendingAiApprovals: approvals?.pending ?? 0 };
  });
}
