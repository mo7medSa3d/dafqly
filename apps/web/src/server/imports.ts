import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  AppError, dedupeImportRows, detectHeaderRow, parseCsvText, parseImportGrid,
  readWorkbookGrid, resolveDueOn, type ColumnMapping, type Grid, type ParsedImportRow,
} from "@tahseel/core";
import { auditLog, debtors, importJobs, importRows, invoices, paymentAllocations, reminders, tenants } from "@tahseel/db/schema";
import { withTenant, type Db } from "@tahseel/db";
import { replanTenantLater } from "./engine";
import { hashPhone } from "./services";

/**
 * F2 import service. Preview persists the parsed grid + one import_rows row
 * per sheet row (valid, invalid, empty, duplicate — never dropped). Commit
 * runs in ONE transaction. Undo is allowed for 24h after commit.
 * Duplicate rows do not create a second debtor: their invoice attaches to
 * the existing debtor (or to the debtor created by the first in-file row).
 */

export const MAX_IMPORT_BYTES = 8 * 1024 * 1024; // aligns with the §3 upload cap

interface StoredRow {
  status: ParsedImportRow["status"];
  data: ParsedImportRow["data"];
  duplicateDebtorId?: string;
  duplicateOfRow?: number;
}

export interface ImportPreview {
  jobId: string;
  fileName: string;
  headerRow: number; // 0-based grid index
  mapping: ColumnMapping;
  stats: { total: number; valid: number; invalid: number; empty: number; duplicate: number };
}

function statsOf(rows: readonly ParsedImportRow[]) {
  const stats = { total: rows.length, valid: 0, invalid: 0, empty: 0, duplicate: 0 };
  for (const r of rows) stats[r.status] += 1;
  return stats;
}

function gridFromUpload(fileName: string, contentBase64: string): Grid {
  const bytes = Buffer.from(contentBase64, "base64");
  if (bytes.length === 0) throw new AppError("EMPTY_FILE", "The uploaded file is empty", 400);
  if (bytes.length > MAX_IMPORT_BYTES) throw new AppError("FILE_TOO_LARGE", "Import file exceeds 8 MB", 400);
  if (/\.csv$/i.test(fileName)) return parseCsvText(bytes.toString("utf8"));
  if (/\.xlsx?$/i.test(fileName)) return readWorkbookGrid(new Uint8Array(bytes)).grid;
  throw new AppError("UNSUPPORTED_FILE", "Only .xlsx, .xls or .csv files can be imported", 400);
}

async function persistRows(tx: Db, tenantId: string, jobId: string, rows: readonly ParsedImportRow[]) {
  await tx.delete(importRows).where(eq(importRows.jobId, jobId));
  for (const r of rows) {
    const stored: StoredRow = {
      status: r.status, data: r.data,
      ...(r.duplicateDebtorId ? { duplicateDebtorId: r.duplicateDebtorId } : {}),
      ...(r.duplicateOfRow ? { duplicateOfRow: r.duplicateOfRow } : {}),
    };
    await tx.insert(importRows).values({
      tenantId, jobId, rowNumber: r.rowNumber,
      parsed: stored as never,
      rowStatus: r.status === "valid" ? "pending_review" : r.status === "duplicate" ? "duplicate" : "rejected",
      errors: r.errors as never,
    });
  }
}

async function parseAndStore(tx: Db, tenantId: string, jobId: string, grid: Grid, mapping: ColumnMapping, headerRow: number) {
  const existing = await tx.select({ id: debtors.id, phoneE164: debtors.phoneE164 }).from(debtors);
  const byPhone = new Map(existing.map((d) => [d.phoneE164, d.id]));
  let rows: ParsedImportRow[];
  try {
    rows = dedupeImportRows(parseImportGrid(grid, mapping, headerRow), byPhone);
  } catch (err) {
    throw new AppError("INVALID_MAPPING", err instanceof Error ? err.message : "Invalid column mapping", 400);
  }
  await persistRows(tx, tenantId, jobId, rows);
  return { rows, stats: statsOf(rows) };
}

export const createImportPreviewInput = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentBase64: z.string().min(4),
});

export async function createImportPreview(app: Db, tenantId: string, actor: string,
  input: z.infer<typeof createImportPreviewInput>): Promise<ImportPreview> {
  const grid = gridFromUpload(input.fileName, input.contentBase64);
  const detected = detectHeaderRow(grid);
  if (!detected) {
    throw new AppError("NO_HEADER_ROW", "No header row with name, phone and amount columns was found in the first 10 rows", 400);
  }
  return withTenant(app, tenantId, async (tx) => {
    const [job] = await tx.insert(importJobs).values({
      tenantId, kind: "excel", status: "pending_review", fileName: input.fileName,
      mapping: detected.mapping as Record<string, number>, headerRow: detected.rowIndex,
      sourceGrid: grid as never,
    }).returning();
    const { stats } = await parseAndStore(tx, tenantId, job!.id, grid, detected.mapping, detected.rowIndex);
    await tx.update(importJobs).set({ stats, updatedAt: new Date() }).where(eq(importJobs.id, job!.id));
    await tx.insert(auditLog).values({
      tenantId, actorUserId: actor, action: "import.previewed", entity: "import_job", entityId: job!.id,
      after: { fileName: input.fileName, stats } as never,
    });
    return { jobId: job!.id, fileName: input.fileName, headerRow: detected.rowIndex, mapping: detected.mapping, stats };
  });
}

export async function updateImportMapping(app: Db, tenantId: string, actor: string, jobId: string, mapping: ColumnMapping): Promise<ImportPreview> {
  return withTenant(app, tenantId, async (tx) => {
    const [job] = await tx.select().from(importJobs).where(eq(importJobs.id, jobId));
    if (!job) throw new AppError("NOT_FOUND", "Import job not found", 404);
    if (job.status !== "pending_review") throw new AppError("ALREADY_COMMITTED", "Only a pending-review import can be re-mapped", 409);
    const grid = (job.sourceGrid ?? []) as Grid;
    const headerRow = job.headerRow ?? 0;
    const { stats } = await parseAndStore(tx, tenantId, jobId, grid, mapping, headerRow);
    await tx.update(importJobs).set({ mapping: mapping as Record<string, number>, stats, updatedAt: new Date() })
      .where(eq(importJobs.id, jobId));
    await tx.insert(auditLog).values({
      tenantId, actorUserId: actor, action: "import.remapped", entity: "import_job", entityId: jobId,
      after: { mapping, stats } as never,
    });
    return { jobId, fileName: job.fileName, headerRow, mapping, stats };
  });
}

export interface ImportJobView {
  id: string; fileName: string; status: string; mapping: ColumnMapping | null;
  headerRow: number | null; stats: Record<string, number> | null;
  committedAt: string | null; undoExpiresAt: string | null;
  rows: { rowNumber: number; status: string; errors: { field: string; reason: string }[]; data: StoredRow["data"]; debtorId: string | null; invoiceId: string | null }[];
}

export async function getImportJob(app: Db, tenantId: string, jobId: string): Promise<ImportJobView> {
  return withTenant(app, tenantId, async (tx) => {
    const [job] = await tx.select().from(importJobs).where(eq(importJobs.id, jobId));
    if (!job) throw new AppError("NOT_FOUND", "Import job not found", 404);
    const rows = await tx.select().from(importRows).where(eq(importRows.jobId, jobId)).orderBy(asc(importRows.rowNumber));
    return {
      id: job.id, fileName: job.fileName, status: job.status,
      mapping: job.mapping as ColumnMapping | null, headerRow: job.headerRow,
      stats: job.stats, committedAt: job.committedAt?.toISOString() ?? null,
      undoExpiresAt: job.undoExpiresAt?.toISOString() ?? null,
      rows: rows.map((r) => {
        const stored = (r.parsed ?? {}) as StoredRow;
        return {
          rowNumber: r.rowNumber, status: stored.status ?? r.rowStatus,
          errors: (r.errors ?? []) as { field: string; reason: string }[],
          data: stored.data ?? null, debtorId: r.debtorId, invoiceId: r.invoiceId,
        };
      }),
    };
  });
}

export async function listImportJobs(app: Db, tenantId: string) {
  return withTenant(app, tenantId, async (tx) => {
    const rows = await tx.select().from(importJobs).where(eq(importJobs.tenantId, tenantId)).orderBy(asc(importJobs.id));
    return rows.slice(-25).reverse().map((j) => ({
      id: j.id, fileName: j.fileName, status: j.status, stats: j.stats,
      committedAt: j.committedAt?.toISOString() ?? null, undoExpiresAt: j.undoExpiresAt?.toISOString() ?? null,
    }));
  });
}

export async function commitImport(app: Db, tenantId: string, actor: string, jobId: string, today: string) {
  const result = await withTenant(app, tenantId, async (tx) => {
    const [job] = await tx.select().from(importJobs).where(eq(importJobs.id, jobId));
    if (!job) throw new AppError("NOT_FOUND", "Import job not found", 404);
    if (job.status !== "pending_review") throw new AppError("ALREADY_COMMITTED", "This import was already committed", 409);
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    const terms = tenant?.settings.defaultTermsDays ?? 14;
    const rows = await tx.select().from(importRows).where(eq(importRows.jobId, jobId)).orderBy(asc(importRows.rowNumber));

    let createdDebtors = 0;
    let createdInvoices = 0;
    const debtorByRow = new Map<number, string>();
    const debtorByPhone = new Map<string, string>();

    for (const row of rows) {
      const stored = (row.parsed ?? {}) as StoredRow;
      if (!stored.data || (stored.status !== "valid" && stored.status !== "duplicate")) continue;
      const data = stored.data;
      let debtorId: string | undefined;
      if (stored.status === "duplicate" && stored.duplicateDebtorId) debtorId = stored.duplicateDebtorId;
      if (!debtorId && stored.status === "duplicate" && stored.duplicateOfRow !== undefined) debtorId = debtorByRow.get(stored.duplicateOfRow);
      if (!debtorId) debtorId = debtorByPhone.get(data.phoneE164);
      if (!debtorId) {
        const [created] = await tx.insert(debtors).values({
          tenantId, displayName: data.name, phoneE164: data.phoneE164,
          phoneValid: true, whatsappStatus: data.whatsappCapable ? "unknown" : "unreachable",
          notes: data.notes, phoneHash: hashPhone(data.phoneE164), importJobId: jobId,
        }).returning();
        debtorId = created!.id;
        createdDebtors += 1;
      }
      debtorByRow.set(row.rowNumber, debtorId);
      debtorByPhone.set(data.phoneE164, debtorId);
      const issuedOn = data.issuedOn ?? today;
      const [invoice] = await tx.insert(invoices).values({
        tenantId, debtorId, reference: data.reference, description: data.description,
        amountMinor: BigInt(data.amountMinor), currency: "EGP", issuedOn,
        dueOn: resolveDueOn(issuedOn, data.dueOn, terms),
        status: "open", source: "import", importJobId: jobId,
      }).returning();
      createdInvoices += 1;
      await tx.update(importRows).set({ rowStatus: "accepted", debtorId, invoiceId: invoice!.id, updatedAt: new Date() })
        .where(eq(importRows.id, row.id));
    }

    const committedAt = new Date();
    const undoExpiresAt = new Date(committedAt.getTime() + 24 * 3600_000);
    await tx.update(importJobs).set({ status: "committed", committedAt, undoExpiresAt, updatedAt: committedAt })
      .where(eq(importJobs.id, jobId));
    await tx.insert(auditLog).values({
      tenantId, actorUserId: actor, action: "import.committed", entity: "import_job", entityId: jobId,
      after: { createdDebtors, createdInvoices, undoExpiresAt: undoExpiresAt.toISOString() } as never,
    });
    return { jobId, createdDebtors, createdInvoices, undoExpiresAt: undoExpiresAt.toISOString() };
  });
  replanTenantLater(tenantId); // F4: imported invoices get reminder plans too
  return result;
}

export async function undoImport(app: Db, tenantId: string, actor: string, jobId: string) {
  return withTenant(app, tenantId, async (tx) => {
    const [job] = await tx.select().from(importJobs).where(eq(importJobs.id, jobId));
    if (!job) throw new AppError("NOT_FOUND", "Import job not found", 404);
    if (job.status !== "committed") throw new AppError("NOT_COMMITTED", "Only a committed import can be undone", 409);
    if (job.undoExpiresAt && job.undoExpiresAt.getTime() < Date.now()) {
      throw new AppError("UNDO_EXPIRED", "The 24-hour undo window for this import has closed", 409);
    }
    const importedInvoices = await tx.select().from(invoices).where(eq(invoices.importJobId, jobId));
    const invoiceIds = importedInvoices.map((i) => i.id);
    if (invoiceIds.length > 0) {
      const allocs = await tx.select().from(paymentAllocations)
        .where(inArray(paymentAllocations.invoiceId, invoiceIds));
      if (allocs.length > 0) {
        throw new AppError("UNDO_BLOCKED_PAYMENTS", "Payments were recorded against imported invoices; resolve them before undoing this import", 409);
      }
      // Reminder rows belong to the imported invoices (M2): ones that were
      // actually sent (or are in flight) block the undo like payments do;
      // merely-planned ones are removed with their invoices.
      const rems = await tx.select().from(reminders).where(inArray(reminders.invoiceId, invoiceIds));
      if (rems.some((r) => r.status === "sent" || r.status === "queued")) {
        throw new AppError("UNDO_BLOCKED_REMINDERS", "Reminders were already sent for imported invoices; this import can no longer be undone", 409);
      }
      if (rems.length > 0) await tx.delete(reminders).where(inArray(reminders.invoiceId, invoiceIds));
      await tx.delete(invoices).where(eq(invoices.importJobId, jobId));
    }
    // Debtors created by this import are removed only when nothing else
    // references them anymore (their imported invoices are already gone).
    const importedDebtors = await tx.select().from(debtors).where(eq(debtors.importJobId, jobId));
    let deletedDebtors = 0;
    for (const debtor of importedDebtors) {
      const remaining = await tx.select({ id: invoices.id }).from(invoices)
        .where(and(eq(invoices.debtorId, debtor.id)));
      if (remaining.length === 0) {
        await tx.delete(debtors).where(eq(debtors.id, debtor.id));
        deletedDebtors += 1;
      }
    }
    await tx.update(importJobs).set({ status: "undone", undoneAt: new Date(), updatedAt: new Date() })
      .where(eq(importJobs.id, jobId));
    await tx.insert(auditLog).values({
      tenantId, actorUserId: actor, action: "import.undone", entity: "import_job", entityId: jobId,
      after: { deletedInvoices: invoiceIds.length, deletedDebtors } as never,
    });
    return { jobId, deletedInvoices: invoiceIds.length, deletedDebtors };
  });
}
