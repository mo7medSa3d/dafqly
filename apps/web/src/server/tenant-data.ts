import { eq, sql } from "drizzle-orm";
import { AppError } from "@tahseel/core";
import {
  auditLog, chequeAlerts, cheques, debtors, disputes, files, importJobs, importRows,
  invoices, memberships, messageIntents, messages, notifications, optOuts, paymentAllocations,
  paymentLinks, payments, reminders, statementLinks, subscriptionInvoices,
  tenantDeletions, tenants, usageLedger, withTenant, type Db,
} from "@tahseel/db";

/**
 * §8 data rights (M6): tenant data EXPORT and DELETE-TENANT-DATA.
 *
 * Export runs under RLS (withTenant) so the bundle can only ever contain
 * the caller's tenant. Delete runs on the OWNER connection (ADR-008) in
 * one transaction: count -> delete every tenant-owned table in FK-safe
 * order -> write the platform tombstone (tenant_deletions, ADR-024) ->
 * delete the tenant row itself. Better Auth user accounts of the members
 * are NOT deleted: an account may belong to other tenants, and account
 * deletion is the user's own action (documented in RUNBOOK/SECURITY).
 * Money is serialized as strings (bigint replacer), never floats.
 */

const bigintReplacer = (_k: string, v: unknown) => (typeof v === "bigint" ? v.toString() : v);

interface TenantTableSpec {
  name: string;
  read: (tx: Db, tenantId: string) => Promise<unknown[]>;
  remove: (tx: Db, tenantId: string) => Promise<void>;
}

/** FK-safe order matters for `remove` (children before parents). */
export const TENANT_DATA_TABLES: TenantTableSpec[] = [
  { name: "message_intents", read: (tx, id) => tx.select().from(messageIntents).where(eq(messageIntents.tenantId, id)), remove: async (tx, id) => { await tx.delete(messageIntents).where(eq(messageIntents.tenantId, id)); } },
  { name: "payment_allocations", read: (tx, id) => tx.select().from(paymentAllocations).where(eq(paymentAllocations.tenantId, id)), remove: async (tx, id) => { await tx.delete(paymentAllocations).where(eq(paymentAllocations.tenantId, id)); } },
  { name: "payment_links", read: (tx, id) => tx.select().from(paymentLinks).where(eq(paymentLinks.tenantId, id)), remove: async (tx, id) => { await tx.delete(paymentLinks).where(eq(paymentLinks.tenantId, id)); } },
  { name: "payments", read: (tx, id) => tx.select().from(payments).where(eq(payments.tenantId, id)), remove: async (tx, id) => { await tx.delete(payments).where(eq(payments.tenantId, id)); } },
  { name: "reminders", read: (tx, id) => tx.select().from(reminders).where(eq(reminders.tenantId, id)), remove: async (tx, id) => { await tx.delete(reminders).where(eq(reminders.tenantId, id)); } },
  { name: "messages", read: (tx, id) => tx.select().from(messages).where(eq(messages.tenantId, id)), remove: async (tx, id) => { await tx.delete(messages).where(eq(messages.tenantId, id)); } },
  { name: "cheque_alerts", read: (tx, id) => tx.select().from(chequeAlerts).where(eq(chequeAlerts.tenantId, id)), remove: async (tx, id) => { await tx.delete(chequeAlerts).where(eq(chequeAlerts.tenantId, id)); } },
  { name: "cheques", read: (tx, id) => tx.select().from(cheques).where(eq(cheques.tenantId, id)), remove: async (tx, id) => { await tx.delete(cheques).where(eq(cheques.tenantId, id)); } },
  { name: "disputes", read: (tx, id) => tx.select().from(disputes).where(eq(disputes.tenantId, id)), remove: async (tx, id) => { await tx.delete(disputes).where(eq(disputes.tenantId, id)); } },
  { name: "statement_links", read: (tx, id) => tx.select().from(statementLinks).where(eq(statementLinks.tenantId, id)), remove: async (tx, id) => { await tx.delete(statementLinks).where(eq(statementLinks.tenantId, id)); } },
  { name: "opt_outs", read: (tx, id) => tx.select().from(optOuts).where(eq(optOuts.tenantId, id)), remove: async (tx, id) => { await tx.delete(optOuts).where(eq(optOuts.tenantId, id)); } },
  { name: "import_rows", read: (tx, id) => tx.select().from(importRows).where(eq(importRows.tenantId, id)), remove: async (tx, id) => { await tx.delete(importRows).where(eq(importRows.tenantId, id)); } },
  { name: "invoices", read: (tx, id) => tx.select().from(invoices).where(eq(invoices.tenantId, id)), remove: async (tx, id) => { await tx.delete(invoices).where(eq(invoices.tenantId, id)); } },
  { name: "import_jobs", read: (tx, id) => tx.select().from(importJobs).where(eq(importJobs.tenantId, id)), remove: async (tx, id) => { await tx.delete(importJobs).where(eq(importJobs.tenantId, id)); } },
  { name: "files", read: (tx, id) => tx.select().from(files).where(eq(files.tenantId, id)), remove: async (tx, id) => { await tx.delete(files).where(eq(files.tenantId, id)); } },
  { name: "debtors", read: (tx, id) => tx.select().from(debtors).where(eq(debtors.tenantId, id)), remove: async (tx, id) => { await tx.delete(debtors).where(eq(debtors.tenantId, id)); } },
  { name: "usage_ledger", read: (tx, id) => tx.select().from(usageLedger).where(eq(usageLedger.tenantId, id)), remove: async (tx, id) => { await tx.delete(usageLedger).where(eq(usageLedger.tenantId, id)); } },
  { name: "audit_log", read: (tx, id) => tx.select().from(auditLog).where(eq(auditLog.tenantId, id)), remove: async (tx, id) => { await tx.delete(auditLog).where(eq(auditLog.tenantId, id)); } },
  { name: "subscription_invoices", read: (tx, id) => tx.select().from(subscriptionInvoices).where(eq(subscriptionInvoices.tenantId, id)), remove: async (tx, id) => { await tx.delete(subscriptionInvoices).where(eq(subscriptionInvoices.tenantId, id)); } },
  { name: "notifications", read: (tx, id) => tx.select().from(notifications).where(eq(notifications.tenantId, id)), remove: async (tx, id) => { await tx.delete(notifications).where(eq(notifications.tenantId, id)); } },
  { name: "memberships", read: (tx, id) => tx.select().from(memberships).where(eq(memberships.tenantId, id)), remove: async (tx, id) => { await tx.delete(memberships).where(eq(memberships.tenantId, id)); } },
];

export interface TenantDataExport {
  exportedAt: string;
  format: "tahseel-tenant-export-v1";
  tenant: Record<string, unknown>;
  rowCounts: Record<string, number>;
  tables: Record<string, unknown[]>;
}

export async function exportTenantData(app: Db, tenantId: string): Promise<{ filename: string; json: string; rowCounts: Record<string, number> }> {
  const bundle = await withTenant(app, tenantId, async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant) throw new AppError("NOT_FOUND", "Tenant not found", 404);
    const tables: Record<string, unknown[]> = {};
    const rowCounts: Record<string, number> = {};
    for (const spec of TENANT_DATA_TABLES) {
      const rows = await spec.read(tx, tenantId);
      tables[spec.name] = rows;
      rowCounts[spec.name] = rows.length;
    }
    const out: TenantDataExport = {
      exportedAt: new Date().toISOString(),
      format: "tahseel-tenant-export-v1",
      tenant: tenant as unknown as Record<string, unknown>,
      rowCounts, tables,
    };
    return out;
  });
  return {
    filename: `tahseel-export-${tenantId}.json`,
    json: JSON.stringify(bundle, bigintReplacer, 2),
    rowCounts: bundle.rowCounts,
  };
}

/**
 * Delete ALL of a tenant's data. Owner role only; the confirmation must be
 * the tenant's business name (Arabic or stored name) or the literal DELETE.
 * Runs on the owner connection in a single transaction; other tenants are
 * never touched (every delete is scoped by tenant_id and proven by test).
 */
export async function deleteTenantData(
  owner: Db, tenantId: string, actor: { userId: string; role: string }, confirmation: string,
): Promise<{ rowCounts: Record<string, number> }> {
  if (actor.role !== "owner") {
    throw new AppError("FORBIDDEN", "Only the tenant owner can delete all tenant data", 403);
  }
  return owner.transaction(async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant) throw new AppError("NOT_FOUND", "Tenant not found", 404);
    const accepted = confirmation === "DELETE" || confirmation === tenant.businessNameAr || confirmation === tenant.name;
    if (!accepted) {
      throw new AppError("CONFIRMATION_MISMATCH", "Type the business name or DELETE to confirm", 400);
    }
    const rowCounts: Record<string, number> = {};
    for (const spec of TENANT_DATA_TABLES) {
      const rows = await tx.execute(sql`select count(*)::int as n from ${sql.identifier(spec.name)} where tenant_id = ${tenantId}`);
      rowCounts[spec.name] = (rows[0] as { n: number }).n;
      await spec.remove(tx as unknown as Db, tenantId);
    }
    await tx.insert(tenantDeletions).values({
      tenantName: tenant.name, businessNameAr: tenant.businessNameAr,
      deletedByUserId: actor.userId, rowCounts,
    });
    await tx.delete(tenants).where(eq(tenants.id, tenantId));
    return { rowCounts };
  });
}
