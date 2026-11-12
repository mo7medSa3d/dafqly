import { and, desc, ilike, isNull, or } from "drizzle-orm";
import type { Db } from "@tahseel/db";
import { withTenant } from "@tahseel/db";
import { auditLog, cheques, debtors, invoices } from "@tahseel/db/schema";

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

export interface SearchChequeResult {
  id: string;
  debtorId: string;
  number: string;
  bank: string;
  amountMinor: string;
  dueDate: string;
  status: string;
}

export interface GlobalSearchResult {
  debtors: SearchDebtorResult[];
  invoices: SearchInvoiceResult[];
  cheques: SearchChequeResult[];
}

export async function globalSearch(app: Db, tenantId: string, query: string): Promise<GlobalSearchResult> {
  const q = query.trim();
  if (!q) return { debtors: [], invoices: [], cheques: [] };

  return withTenant(app, tenantId, async (tx) => {
    const [debtorRows, invoiceRows, chequeRows] = await Promise.all([
      tx
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
        .limit(6),
      tx
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
        .limit(6),
      tx
        .select({
          id: cheques.id,
          debtorId: cheques.debtorId,
          number: cheques.number,
          bank: cheques.bank,
          amountMinor: cheques.amountMinor,
          dueDate: cheques.dueDate,
          status: cheques.status,
        })
        .from(cheques)
        .where(
          or(
            ilike(cheques.number, `%${q}%`),
            ilike(cheques.bank, `%${q}%`),
          ),
        )
        .limit(4),
    ]);

    return {
      debtors: debtorRows,
      invoices: invoiceRows.map((inv) => ({
        ...inv,
        amountMinor: String(inv.amountMinor),
      })),
      cheques: chequeRows.map((chq) => ({
        ...chq,
        amountMinor: String(chq.amountMinor),
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
