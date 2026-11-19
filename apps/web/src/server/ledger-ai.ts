import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  AppError, MAX_LEDGER_PAGES, normalizeCurrencyCode, normalizeLedgerRowDigits, normalizePhone, parseMoney,
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
  if (!data.phoneE164) errors.push({ field: "phone", reason: "a valid phone number is required before commit" });
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

async function loadJob(tx: Db, tenantId: string, jobId: string, forUpdate = false) {
  const query = tx.select().from(importJobs).where(and(eq(importJobs.id, jobId), eq(importJobs.tenantId, tenantId)));
  const [job] = await (forUpdate ? query.for("update") : query);
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
  const extractionContext = await withTenant(app, tenantId, async (tx) => {
    const job = await loadJob(tx, tenantId, jobId, true);
    if (job.status !== "pending_review") throw new AppError("ALREADY_COMMITTED", "Only a pending-review job can be extracted", 409);
    const [tenant] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
    return {
      fileIds: ((job.sourceGrid ?? {}) as { fileIds?: string[] }).fileIds ?? [],
      currency: normalizeCurrencyCode(tenant?.settings?.currency),
    };
  });
  const { fileIds, currency } = extractionContext;

  const debtorList = await withTenant(app, tenantId, async (tx) =>
    tx.select({ id: debtors.id, displayName: debtors.displayName }).from(debtors).where(and(eq(debtors.tenantId, tenantId), isNull(debtors.deletedAt))));

  interface PageResult { pageIndex: number; fileId: string; rows: LedgerStoredRow[]; usage: { input: number; output: number; model: string; promptVersion: string } | null }
  const pages: PageResult[] = [];
  for (let i = 0; i < fileIds.length; i++) {
    const { file, bytes } = await getFileBytes(app, ai.storage, tenantId, fileIds[i]!);
    const result = await ai.llm.extractLedgerPage(bytes, file.mime, currency);
    const rows: LedgerStoredRow[] = [];
    if (result.data) {
      for (const raw of result.data.rows) {
        const row = normalizeLedgerRowDigits(raw);
        let phoneE164: string | null = null;
        if (row.phone) {
          try { phoneE164 = normalizePhone(row.phone).e164; } catch { phoneE164 = null; }
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
    const lockedJob = await loadJob(tx, tenantId, jobId, true);
    if (lockedJob.status !== "pending_review") throw new AppError("ALREADY_COMMITTED", "Only a pending-review job can be extracted", 409);
    await tx.delete(importRows).where(and(eq(importRows.jobId, jobId), eq(importRows.tenantId, tenantId)));
    let n = 0;
    const rowValues: (typeof importRows.$inferInsert)[] = [];
    const usageValues: (typeof usageLedger.$inferInsert)[] = [];
    for (const page of pages) {
      for (const stored of page.rows) {
        n++;
        rowValues.push({
          tenantId, jobId, rowNumber: n, parsed: stored as never,
          rowStatus: "pending_review",
          errors: stored.data ? validateRowData(stored.data) as never : [{ field: "page", reason: "page could not be read" }] as never,
          confidence: String(stored.confidence),
        });
      }
      if (page.usage) {
        usageValues.push({
          tenantId, kind: "llm_vision", units: page.usage.input + page.usage.output, costEstimateMinor: 0n,
        });
      }
    }
    if (rowValues.length > 0) await tx.insert(importRows).values(rowValues);
    if (usageValues.length > 0) await tx.insert(usageLedger).values(usageValues);
    const stats = { pagesTotal: fileIds.length, pagesDone: pages.length, rowsFound: n };
    const sourceGrid = { ...((lockedJob.sourceGrid ?? {}) as Record<string, unknown>), currency };
    await tx.update(importJobs).set({ sourceGrid: sourceGrid as never, stats, updatedAt: new Date() }).where(and(eq(importJobs.id, jobId), eq(importJobs.tenantId, tenantId)));
    await audit(tx, tenantId, actor, "import.ledger_extracted", jobId, {
      stats, model: pages[0]?.usage?.model ?? null, promptVersion: pages[0]?.usage?.promptVersion ?? null,
    });
  });
  return getLedgerJob(app, tenantId, jobId);
}

export async function getLedgerJob(app: Db, tenantId: string, jobId: string): Promise<LedgerJobView> {
  return withTenant(app, tenantId, async (tx) => {
    const job = await loadJob(tx, tenantId, jobId, false);
    const rows = await tx.select().from(importRows).where(and(eq(importRows.jobId, jobId), eq(importRows.tenantId, tenantId))).orderBy(asc(importRows.rowNumber));
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
  amount: z.string().trim().min(1).optional(), // decimal string in tenant currency
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
    const [row] = await tx.select().from(importRows).where(and(eq(importRows.id, input.rowId), eq(importRows.tenantId, tenantId)));
    if (!row) throw new AppError("NOT_FOUND", "Import row not found", 404);
    const job = await loadJob(tx, tenantId, row.jobId, true);
    if (job.status !== "pending_review") throw new AppError("ALREADY_COMMITTED", "This job can no longer be edited", 409);
    const stored = (row.parsed ?? null) as LedgerStoredRow | null;
    if (!stored?.data) throw new AppError("INVALID_ROW", "Row has no extracted data to edit", 400);
    const data: LedgerRowData = { ...stored.data };
    if (input.name !== undefined) data.name = input.name;
    if (input.phone !== undefined) {
      data.phone = input.phone;
      data.phoneE164 = null;
      if (input.phone) {
        try { data.phoneE164 = normalizePhone(input.phone).e164; } catch { data.phoneE164 = null; }
      }
    }
    if (input.amount !== undefined) {
      const [tenant] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
      const currency = normalizeCurrencyCode(tenant?.settings?.currency);
      try { data.amountMinor = parseMoney(input.amount, currency).toString(); }
      catch { throw new AppError("INVALID_AMOUNT", `Amount is not a readable ${currency} amount`, 400); }
    }
    if (input.date !== undefined) data.date = input.date;
    if (input.note !== undefined) data.note = input.note;
    if (input.debtorId !== undefined) {
      if (input.debtorId !== null) {
        const [deb] = await tx.select({ id: debtors.id }).from(debtors).where(and(eq(debtors.id, input.debtorId), isNull(debtors.deletedAt)));
        if (!deb) throw new AppError("NOT_FOUND", "Debtor not found", 404);
      }
      data.debtorId = input.debtorId;
    }
    const errors = validateRowData(data);
    const next: LedgerStoredRow = { ...stored, data, status: errors.length === 0 ? "valid" : "invalid" };
    await tx.update(importRows).set({ parsed: next as never, errors: errors as never, updatedAt: new Date() })
      .where(and(eq(importRows.id, input.rowId), eq(importRows.tenantId, tenantId)));
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
    const job = await loadJob(tx, tenantId, jobId, true);
    if (job.status !== "pending_review") throw new AppError("ALREADY_COMMITTED", "This ledger import was already committed", 409);
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    const terms = tenant?.settings.defaultTermsDays ?? 14;
    const currency = normalizeCurrencyCode(tenant?.settings?.currency);
    const sourceGrid = (job.sourceGrid ?? {}) as { currency?: string };
    const extractionCurrency = sourceGrid.currency ? normalizeCurrencyCode(sourceGrid.currency) : currency;
    if (extractionCurrency !== currency) {
      throw new AppError("CURRENCY_CHANGED_DURING_IMPORT", "Tenant currency changed after this ledger was extracted. Re-run extraction or review every amount before committing.", 409);
    }
    const rows = await tx.select().from(importRows).where(and(eq(importRows.jobId, jobId), eq(importRows.tenantId, tenantId))).orderBy(asc(importRows.rowNumber));
    let createdDebtors = 0;
    let createdInvoices = 0;
    let skippedInvalid = 0;
    const debtorByPhone = new Map<string, string>();
    const phones = [...new Set(
      rows
        .map((r) => (r.parsed as LedgerStoredRow | null)?.data?.phoneE164)
        .filter((p): p is string => Boolean(p)),
    )];
    if (phones.length > 0) {
      const existingDebtors = await tx.select({ id: debtors.id, phoneE164: debtors.phoneE164 })
        .from(debtors)
        .where(and(eq(debtors.tenantId, tenantId), inArray(debtors.phoneE164, phones), isNull(debtors.deletedAt)));
      for (const d of existingDebtors) debtorByPhone.set(d.phoneE164, d.id);
    }
    for (const row of rows) {
      const stored = (row.parsed ?? null) as LedgerStoredRow | null;
      if (!stored?.data || stored.status !== "valid" || validateRowData(stored.data).length > 0) {
        skippedInvalid++;
        continue;
      }
      const data = stored.data;
      let debtorId = data.debtorId ?? undefined;
      if (!debtorId && data.phoneE164) debtorId = debtorByPhone.get(data.phoneE164);
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
        amountMinor: BigInt(data.amountMinor), currency, issuedOn,
        dueOn: resolveDueOn(issuedOn, null, terms),
        status: "open", source: "ledger_photo", importJobId: jobId,
        evidenceFileId: stored.pageFileId,
      }).returning();
      createdInvoices++;
      await tx.update(importRows).set({ rowStatus: "accepted", debtorId, invoiceId: invoice!.id, updatedAt: new Date() })
        .where(and(eq(importRows.id, row.id), eq(importRows.tenantId, tenantId)));
    }
    await tx.update(importJobs).set({ status: "committed", committedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(importJobs.id, jobId), eq(importJobs.tenantId, tenantId)));
    await audit(tx, tenantId, actor, "import.ledger_committed", jobId, { createdDebtors, createdInvoices, skippedInvalid });
    return { jobId, createdDebtors, createdInvoices, skippedInvalid };
  });
  replanTenantLater(tenantId);
  return result;
}

export async function deleteLedgerJob(app: Db, tenantId: string, actor: string, jobId: string) {
  return withTenant(app, tenantId, async (tx) => {
    const [job] = await tx.select().from(importJobs).where(and(eq(importJobs.id, jobId), eq(importJobs.tenantId, tenantId))).for("update");
    if (!job) throw new AppError("NOT_FOUND", "Ledger job not found", 404);
    if (job.status === "committed") {
      throw new AppError("CANNOT_DELETE_COMMITTED", "Committed imports cannot be deleted", 409);
    }
    await tx.delete(importRows).where(and(eq(importRows.jobId, jobId), eq(importRows.tenantId, tenantId)));
    await tx.delete(importJobs).where(and(eq(importJobs.id, jobId), eq(importJobs.tenantId, tenantId)));
    await audit(tx, tenantId, actor, "import.ledger_deleted", jobId, { fileName: job.fileName });
    return { ok: true, jobId };
  });
}
