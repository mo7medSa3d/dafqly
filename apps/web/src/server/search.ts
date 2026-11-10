import { and, desc, ilike, isNull, or } from "drizzle-orm";
import type { Db } from "@tahseel/db";
import { withTenant } from "@tahseel/db";
import { auditLog, debtors, invoices } from "@tahseel/db/schema";

export interface SearchDebtorResult {
  id: string;
  displayName: string;
  phoneE164: string;
}

export interface SearchInvoiceResult {
  id: string;
  debtorId: string;
  reference: string | null;
  amountMinor: string;
  status: string;
  dueOn: string;
  description: string | null;
}

export interface GlobalSearchResult {
  debtors: SearchDebtorResult[];
  invoices: SearchInvoiceResult[];
}

export async function globalSearch(app: Db, tenantId: string, query: string): Promise<GlobalSearchResult> {
  const q = query.trim();
  if (!q) return { debtors: [], invoices: [] };

  return withTenant(app, tenantId, async (tx) => {
    // 1. Search Debtors
    const debtorRows = await tx
      .select({
        id: debtors.id,
        displayName: debtors.displayName,
        phoneE164: debtors.phoneE164,
      })
      .from(debtors)
      .where(
        and(
          isNull(debtors.deletedAt),
          or(
            ilike(debtors.displayName, `%${q}%`),
            ilike(debtors.phoneE164, `%${q}%`),
          ),
        ),
      )
      .limit(6);

    // 2. Search Invoices
    const invoiceRows = await tx
      .select({
        id: invoices.id,
        debtorId: invoices.debtorId,
        reference: invoices.reference,
        amountMinor: invoices.amountMinor,
        status: invoices.status,
        dueOn: invoices.dueOn,
        description: invoices.description,
      })
      .from(invoices)
      .where(
        or(
          ilike(invoices.reference, `%${q}%`),
          ilike(invoices.description, `%${q}%`),
        ),
      )
      .limit(6);

    return {
      debtors: debtorRows,
      invoices: invoiceRows.map((inv) => ({
        ...inv,
        amountMinor: String(inv.amountMinor),
      })),
    };
  });
}

export interface AuditEntryView {
  id: string;
  actorUserId: string | null;
  action: string;
  entity: string;
  entityId: string;
  createdAt: string;
}

export async function listAuditTrail(app: Db, tenantId: string, limit = 20): Promise<AuditEntryView[]> {
  return withTenant(app, tenantId, async (tx) => {
    const rows = await tx
      .select({
        id: auditLog.id,
        actorUserId: auditLog.actorUserId,
        action: auditLog.action,
        entity: auditLog.entity,
        entityId: auditLog.entityId,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .orderBy(desc(auditLog.createdAt))
      .limit(limit);

    return rows.map((r) => ({
      id: r.id,
      actorUserId: r.actorUserId,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      createdAt: r.createdAt ? r.createdAt.toISOString() : new Date().toISOString(),
    }));
  });
}
