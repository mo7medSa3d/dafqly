import { asc, eq, isNull, and } from "drizzle-orm";
import { z } from "zod";
import {
  AppError, MAX_LEDGER_PAGES, normalizeEgPhone, normalizeLedgerRowDigits, parseEgp,
  resolveDueOn, suggestDebtorByName,
} from "@tahseel/core";
import { decodeBase64Upload, MAX_UPLOAD_BASE64_CHARS } from "@tahseel/core/files-crypto";
import { auditLog, debtors, importJobs, importRows, invoices, tenants, usageLedger } from "@tahseel/db/schema";
import { withTenant, type Db } from "@tahseel/db";
import type { OcrLlmProvider, StorageProvider } from "@tahseel/providers";
import { storeUpload, getFileBytes } from "./files";
import { hashPhone } from "./services";
import { nextInvoiceReference } from "./ledger";
import { replanTenantLater } from "./engine";

/**
 * F6 ledger-photo import service. Flow: upload pages (files table) -> async
 * extraction job (LLM per page, import_rows in pending review, NOTHING is
 * imported yet) -> merchant edits/confirms in review -> explicit commit
 * creates debtors + invoices with source=ledger_photo and the page image as
 * evidence. Debtor name matches are SUGGESTIONS only: a suggestion is shown
 * in review and takes effect only when the merchant sets it on the row;
 * otherwise dedupe is by normalized phone (ADR-014), exactly like F2.
 */
export interface LedgerAiDeps { llm: OcrLlmProvider; storage: StorageProvider }

interface LedgerRowData {
  name: string;
  phone: string | null;
  phoneE164: string | null;
  amountMinor: string;
  date: string | null;
  note: string | null;
  /** Merchant-confirmed debtor (set in review); suggestion alone never lands here. */
  debtorId: string | null;
}
interface LedgerStoredRow {
  status: "valid" | "invalid";
  data: LedgerRowData | null;
  confidence: number;
  cellConfidence: { name: number; amount: number };
  suggestedDebtorId: string | null;
  suggestionScore: number | null;
  pageFileId: string;
  pageIndex: number;
}

function validateRowData(data: LedgerRowData): { field: string; reason: string }[] {
  const errors: { field: string; reason: string }[] = [];
  if (!data.name.trim()) errors.push({ field: "name", reason: "name is empty" });
  if (!data.phoneE164) errors.push({ field: "phone", reason: "a valid Egyptian phone is required before commit" });
  try {
    if (BigInt(data.amountMinor) <= 0n) errors.push({ field: "amount", reason: "amount must be positive" });
  } catch {
    errors.push({ field: "amount", reason: "amount is not readable" });
  }
  return errors;
}

async function audit(tx: Db, tenantId: string, actor: string | null, action: string, entityId: string, after: unknown) {
  await tx.insert(auditLog).values({
    tenantId, actorUserId: actor, action, entity: "import_job", entityId,
    after: (after ?? null) as never,
  });
}

// --------------------------------------------------------------------- create
export const createLedgerJobInput = z.object({
  uploads: z.array(z.object({
    fileName: z.string().trim().min(1).max(200),
    mime: z.string().trim().min(3).max(80),
    contentBase64: z.string().min(4).max(MAX_UPLOAD_BASE64_CHARS),
  })).min(1).max(MAX_LEDGER_PAGES),
});
export type CreateLedgerJobInput = z.infer<typeof createLedgerJobInput>;

export async function createLedgerJob(
  app: Db, tenantId: string, actor: string, ai: LedgerAiDeps, input: CreateLedgerJobInput,
): Promise<{ jobId: string; fileIds: string[]; pagesTotal: number }> {
  if (input.uploads.length > MAX_LEDGER_PAGES) {
    throw new AppError("TOO_MANY_PAGES", `A ledger job accepts at most ${MAX_LEDGER_PAGES} pages`, 400);
  }
  const fileIds: string[] = [];
  for (const upload of input.uploads) {
    const bytes = decodeBase64Upload(upload.contentBase64);
    const file = await storeUpload(app, ai.storage, tenantId, actor, { bytes, mime: upload.mime, kind: "ledger_page" });
    fileIds.push(file.id);
  }
  return withTenant(app, tenantId, async (tx) => {
    const [job] = await tx.insert(importJobs).values({
      tenantId, kind: "ledger_photo", status: "pending_review",
      fileName: input.uploads[0]!.fileName, fileId: fileIds[0] ?? null,
      sourceGrid: { fileIds } as never,
      stats: { pagesTotal: fileIds.length, pagesDone: 0, rowsFound: 0 },
    }).returning();
    await audit(tx, tenantId, actor, "import.ledger_created", job!.id, { pages: fileIds.length });
    return { jobId: job!.id, fileIds, pagesTotal: fileIds.length };
  });
}

// ---------------------------------------------------------------- extraction
export interface LedgerJobView {
  id: string; status: string; fileName: string;
  stats: Record<string, number> | null;
  rows: {
    id: string; rowNumber: number; status: string;
    errors: { field: string; reason: string }[];
    data: LedgerRowData | null; confidence: string | null;
    cellConfidence: { name: number; amount: number } | null;
    suggestedDebtorId: string | null; suggestionScore: number | null;
    pageFileId: string | null; debtorId: string | null; invoiceId: string | null;
  }[];
}

async function loadJob(tx: Db, jobId: string) {
  const [job] = await tx.select().from(importJobs).where(eq(importJobs.id, jobId));
  if (!job || job.kind !== "ledger_photo") throw new AppError("NOT_FOUND", "Ledger import job not found", 404);
  return job;
}

/**
 * Run the vision extraction for every page of the job. Progress is the job
 * stats ({pagesDone, pagesTotal, rowsFound}); rows land in pending review.
 * The job status stays pending_review — extraction never imports anything.
 */
export async function runLedgerExtraction(
  app: Db, tenantId: string, actor: string, ai: LedgerAiDeps, jobId: string,
): Promise<LedgerJobView> {
  const fileIds = await withTenant(app, tenantId, async (tx) => {
    const job = await loadJob(tx, jobId);
    if (job.status !== "pending_review") throw new AppError("ALREADY_COMMITTED", "Only a pending-review job can be extracted", 409);
    return ((job.sourceGrid ?? {}) as { fileIds?: string[] }).fileIds ?? [];
  });

  const debtorList = await withTenant(app, tenantId, async (tx) =>
    tx.select({ id: debtors.id, displayName: debtors.displayName }).from(debtors).where(isNull(debtors.deletedAt)));

  interface PageResult { pageIndex: number; fileId: string; rows: LedgerStoredRow[]; usage: { input: number; output: number; model: string; promptVersion: string } | null }
  const pages: PageResult[] = [];
  for (let i = 0; i < fileIds.length; i++) {
    const { file, bytes } = await getFileBytes(app, ai.storage, tenantId, fileIds[i]!);
    const result = await ai.llm.extractLedgerPage(bytes, file.mime);
    const rows: LedgerStoredRow[] = [];
    if (result.data) {
      for (const raw of result.data.rows) {
        const row = normalizeLedgerRowDigits(raw);
        let phoneE164: string | null = null;
        if (row.phone) {
          try { phoneE164 = normalizeEgPhone(row.phone).e164; } catch { phoneE164 = null; }
        }
        const suggestion = suggestDebtorByName(row.name, debtorList);
        const data: LedgerRowData = {
          name: row.name, phone: row.phone, phoneE164,
          amountMinor: String(row.amount_minor), date: row.date, note: row.note, debtorId: null,
        };
        rows.push({
          status: validateRowData(data).length === 0 ? "valid" : "invalid",
          data, confidence: row.confidence, cellConfidence: row.cellConfidence,
          suggestedDebtorId: suggestion?.debtorId ?? null,
          suggestionScore: suggestion?.score ?? null,
          pageFileId: file.id, pageIndex: i,
        });
      }
    }
    pages.push({
      pageIndex: i, fileId: file.id, rows,
      usage: { input: result.inputTokens, output: result.outputTokens, model: result.model, promptVersion: result.promptVersion },
    });
  }

  await withTenant(app, tenantId, async (tx) => {
    await tx.delete(importRows).where(eq(importRows.jobId, jobId));
    let n = 0;
    for (const page of pages) {
      for (const stored of page.rows) {
        n++;
        await tx.insert(importRows).values({
          tenantId, jobId, rowNumber: n, parsed: stored as never,
          rowStatus: "pending_review",
          errors: stored.data ? validateRowData(stored.data) as never : [{ field: "page", reason: "page could not be read" }] as never,
          confidence: String(stored.confidence),
        });
      }
      if (page.usage) {
        await tx.insert(usageLedger).values({
          tenantId, kind: "llm_vision", units: page.usage.input + page.usage.output, costEstimateMinor: 0n,
        });
      }
    }
    const stats = { pagesTotal: fileIds.length, pagesDone: pages.length, rowsFound: n };
    await tx.update(importJobs).set({ stats, updatedAt: new Date() }).where(eq(importJobs.id, jobId));
    await audit(tx, tenantId, actor, "import.ledger_extracted", jobId, {
      stats, model: pages[0]?.usage?.model ?? null, promptVersion: pages[0]?.usage?.promptVersion ?? null,
    });
  });
  return getLedgerJob(app, tenantId, jobId);
}

export async function getLedgerJob(app: Db, tenantId: string, jobId: string): Promise<LedgerJobView> {
  return withTenant(app, tenantId, async (tx) => {
    const job = await loadJob(tx, jobId);
    const rows = await tx.select().from(importRows).where(eq(importRows.jobId, jobId)).orderBy(asc(importRows.rowNumber));
    return {
      id: job.id, status: job.status, fileName: job.fileName, stats: job.stats,
      rows: rows.map((r) => {
        const stored = (r.parsed ?? null) as LedgerStoredRow | null;
        return {
          id: r.id, rowNumber: r.rowNumber, status: stored?.status ?? r.rowStatus,
          errors: (r.errors ?? []) as { field: string; reason: string }[],
          data: stored?.data ?? null, confidence: r.confidence,
          cellConfidence: stored?.cellConfidence ?? null,
          suggestedDebtorId: stored?.suggestedDebtorId ?? null,
          suggestionScore: stored?.suggestionScore ?? null,
          pageFileId: stored?.pageFileId ?? null,
          debtorId: r.debtorId, invoiceId: r.invoiceId,
        };
      }),
    };
  });
}

export async function listLedgerJobs(app: Db, tenantId: string) {
  return withTenant(app, tenantId, async (tx) => {
    const rows = await tx.select().from(importJobs)
      .where(and(eq(importJobs.tenantId, tenantId), eq(importJobs.kind, "ledger_photo")))
      .orderBy(asc(importJobs.id));
    return rows.slice(-25).reverse().map((j) => ({
      id: j.id, fileName: j.fileName, status: j.status, stats: j.stats,
      createdAt: j.createdAt.toISOString(),
    }));
  });
}

// -------------------------------------------------------------------- review
export const updateLedgerRowInput = z.object({
  rowId: z.string().uuid(),
  name: z.string().trim().min(1).max(160).optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  amount: z.string().trim().min(1).optional(), // EGP decimal string
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  note: z.string().trim().max(500).nullable().optional(),
  /** Merchant confirming a suggestion (or choosing another debtor) in review. */
  debtorId: z.string().uuid().nullable().optional(),
});
export type UpdateLedgerRowInput = z.infer<typeof updateLedgerRowInput>;

/** Merchant edit of one review row: the edited values are what commit will use. */
export async function updateLedgerRow(
  app: Db, tenantId: string, actor: string, input: UpdateLedgerRowInput,
): Promise<void> {
  await withTenant(app, tenantId, async (tx) => {
    const [row] = await tx.select().from(importRows).where(eq(importRows.id, input.rowId));
    if (!row) throw new AppError("NOT_FOUND", "Import row not found", 404);
    const [job] = await tx.select().from(importJobs).where(eq(importJobs.id, row.jobId));
    if (!job || job.status !== "pending_review") throw new AppError("ALREADY_COMMITTED", "This job can no longer be edited", 409);
    const stored = (row.parsed ?? null) as LedgerStoredRow | null;
    if (!stored?.data) throw new AppError("INVALID_ROW", "Row has no extracted data to edit", 400);
    const data: LedgerRowData = { ...stored.data };
    if (input.name !== undefined) data.name = input.name;
    if (input.phone !== undefined) {
      data.phone = input.phone;
      data.phoneE164 = null;
      if (input.phone) {
        try { data.phoneE164 = normalizeEgPhone(input.phone).e164; } catch { data.phoneE164 = null; }
      }
    }
    if (input.amount !== undefined) {
      // F-06: the ledger-photo import is EGP-denominated by design —
      // committed invoices are created with currency "EGP" — so the EGP
      // parse here is correct, not a leftover.
      try { data.amountMinor = parseEgp(input.amount).toString(); }
      catch { throw new AppError("INVALID_AMOUNT", "Amount is not a readable EGP amount", 400); }
    }
    if (input.date !== undefined) data.date = input.date;
    if (input.note !== undefined) data.note = input.note;
    if (input.debtorId !== undefined) data.debtorId = input.debtorId;
    const errors = validateRowData(data);
    const next: LedgerStoredRow = { ...stored, data, status: errors.length === 0 ? "valid" : "invalid" };
    await tx.update(importRows).set({ parsed: next as never, errors: errors as never, updatedAt: new Date() })
      .where(eq(importRows.id, input.rowId));
    await tx.insert(auditLog).values({
      tenantId, actorUserId: actor, action: "import.ledger_row_updated", entity: "import_row", entityId: input.rowId,
      after: { jobId: row.jobId } as never,
    });
  });
}

// -------------------------------------------------------------------- commit
/**
 * The ONLY path from a ledger photo to the ledger, and it runs solely when
 * the merchant confirms. Invalid rows are skipped and counted, never
 * silently dropped (their errors stay on the job view).
 */
export async function commitLedgerJob(
  app: Db, tenantId: string, actor: string, jobId: string, today: string,
): Promise<{ jobId: string; createdDebtors: number; createdInvoices: number; skippedInvalid: number }> {
  const result = await withTenant(app, tenantId, async (tx) => {
    const job = await loadJob(tx, jobId);
    if (job.status !== "pending_review") throw new AppError("ALREADY_COMMITTED", "This ledger import was already committed", 409);
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    const terms = tenant?.settings.defaultTermsDays ?? 14;
    const rows = await tx.select().from(importRows).where(eq(importRows.jobId, jobId)).orderBy(asc(importRows.rowNumber));
    let createdDebtors = 0;
    let createdInvoices = 0;
    let skippedInvalid = 0;
    const debtorByPhone = new Map<string, string>();
    for (const row of rows) {
      const stored = (row.parsed ?? null) as LedgerStoredRow | null;
      if (!stored?.data || stored.status !== "valid" || validateRowData(stored.data).length > 0) {
        skippedInvalid++;
        continue;
      }
      const data = stored.data;
      let debtorId = data.debtorId ?? undefined;
      if (!debtorId && data.phoneE164) debtorId = debtorByPhone.get(data.phoneE164);
      if (!debtorId && data.phoneE164) {
        const [existing] = await tx.select().from(debtors)
          .where(and(eq(debtors.phoneE164, data.phoneE164), isNull(debtors.deletedAt)));
        if (existing) debtorId = existing.id;
      }
      if (!debtorId) {
        if (!data.phoneE164) { skippedInvalid++; continue; }
        const [created] = await tx.insert(debtors).values({
          tenantId, displayName: data.name, phoneE164: data.phoneE164,
          phoneValid: true, whatsappStatus: "unknown",
          notes: data.note, phoneHash: hashPhone(data.phoneE164), importJobId: jobId,
        }).returning();
        debtorId = created!.id;
        createdDebtors++;
      }
      if (data.phoneE164) debtorByPhone.set(data.phoneE164, debtorId);
      const issuedOn = data.date ?? today;
      // H05: generated references come from the single per-tenant sequence —
      // a per-job 1001+ counter collided with invoices created elsewhere.
      const reference = await nextInvoiceReference(tx, tenantId, issuedOn.slice(0, 4));
      const [invoice] = await tx.insert(invoices).values({
        tenantId, debtorId, reference, description: data.note,
        amountMinor: BigInt(data.amountMinor), currency: "EGP", issuedOn,
        dueOn: resolveDueOn(issuedOn, null, terms),
        status: "open", source: "ledger_photo", importJobId: jobId,
        evidenceFileId: stored.pageFileId,
      }).returning();
      createdInvoices++;
      await tx.update(importRows).set({ rowStatus: "accepted", debtorId, invoiceId: invoice!.id, updatedAt: new Date() })
        .where(eq(importRows.id, row.id));
    }
    await tx.update(importJobs).set({ status: "committed", committedAt: new Date(), updatedAt: new Date() })
      .where(eq(importJobs.id, jobId));
    await audit(tx, tenantId, actor, "import.ledger_committed", jobId, { createdDebtors, createdInvoices, skippedInvalid });
    return { jobId, createdDebtors, createdInvoices, skippedInvalid };
  });
  replanTenantLater(tenantId);
  return result;
}

export async function deleteLedgerJob(app: Db, tenantId: string, actor: string, jobId: string) {
  return withTenant(app, tenantId, async (tx) => {
    const [job] = await tx.select().from(importJobs).where(eq(importJobs.id, jobId));
    if (!job) throw new AppError("NOT_FOUND", "Ledger job not found", 404);
    if (job.status === "committed") {
      throw new AppError("CANNOT_DELETE_COMMITTED", "Committed imports cannot be deleted", 409);
    }
    await tx.delete(importRows).where(eq(importRows.jobId, jobId));
    await tx.delete(importJobs).where(eq(importJobs.id, jobId));
    await audit(tx, tenantId, actor, "import.ledger_deleted", jobId, { fileName: job.fileName });
    return { ok: true, jobId };
  });
}
