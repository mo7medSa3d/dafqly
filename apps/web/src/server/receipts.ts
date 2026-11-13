import { and, desc, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  AppError, allocatePayment, decideReceiptOutcome, evaluateReceiptChecks, formatMoney,
  localDateOf, matchReceiptAmount, suggestDebtorByName, type ReceiptCheck, type ReceiptExtraction,
} from "@tahseel/core";
import {
  auditLog, debtors, files, invoices, messages, paymentAllocations, payments, tenants, usageLedger,
} from "@tahseel/db/schema";
import { withTenant, type Db } from "@tahseel/db";
import type { OcrLlmProvider, StorageProvider } from "@tahseel/providers";
import { renderTemplate } from "@tahseel/templates";
import { storeUpload, getFileBytes } from "./files";
import { lockDebtorInvoices, recomputeInvoicePaid } from "./ledger";
import { replanLater } from "./engine";
import { upsertNotificationInTx } from "./notifications";

/**
 * F7 transfer-receipt service. A screenshot is a CLAIM, not proof (hard
 * rule 5): extraction -> core checks (duplicate hash/reference, date
 * plausibility, is_receipt, tamper, confidence) -> a `claimed` payment the
 * merchant confirms, UNLESS the tenant opted into auto-close AND every
 * check passes AND confidence >= 0.9, in which case the payment is
 * confirmed with allocations from the core matcher. The debtor is always
 * answered from the template registry (pending vs received), never with
 * free-generated text.
 */
export interface ReceiptDeps {
  llm: OcrLlmProvider;
  storage: StorageProvider;
  /** Sends the debtor reply (the messaging provider seam; dry-run wrapped by the caller). */
  notifyText?: (toE164: string, body: string, idempotencyKey: string) => Promise<void>;
}

export interface ReceiptOutcome {
  outcome: "auto_confirmed" | "claimed" | "not_receipt" | "unreadable";
  paymentId: string | null;
  fileId: string;
  sha256: string;
  extraction: ReceiptExtraction | null;
  checks: ReceiptCheck[];
  matchKind: string | null;
  matchedDebtorId?: string | null;
  matchedDebtorName?: string | null;
}

const METHOD_MAP: Record<string, "instapay" | "bank" | "wallet" | "other"> = {
  instapay: "instapay", bank: "bank", wallet: "wallet", fawry: "other", other: "other",
};

export async function processReceiptImage(
  app: Db, tenantId: string, actor: string | null, deps: ReceiptDeps,
  input: { debtorId?: string; fileId?: string; bytes?: Uint8Array; mime?: string; now?: Date },
): Promise<ReceiptOutcome> {
  const now = input.now ?? new Date();
  // Resolve the evidence file: an existing upload or fresh bytes.
  let fileId = input.fileId ?? null;
  let bytes: Uint8Array | null = input.bytes ?? null;
  let mime = input.mime ?? "image/png";
  // M06: set when storeUpload deduped these exact bytes onto an existing
  // file row (the bytes were uploaded before).
  let uploadWasDuplicate = false;
  if (fileId) {
    const got = await getFileBytes(app, deps.storage, tenantId, fileId);
    bytes = got.bytes;
    mime = got.file.mime;
  } else if (bytes) {
    const stored = await storeUpload(app, deps.storage, tenantId, actor, { bytes, mime, kind: "receipt" });
    fileId = stored.id;
    // M5: the LLM sees the EXIF-stripped bytes, never the raw upload.
    bytes = stored.bytes;
    // M06: the exact bytes were already uploaded — the duplicate-hash
    // check below must fail for this upload (it can only ever be a
    // human-review claim, never an auto-confirm).
    uploadWasDuplicate = stored.deduped;
  }
  if (!fileId || !bytes) throw new AppError("NO_FILE", "A receipt image is required", 400);

  const extractionResult = await deps.llm.extractReceipt(bytes, mime);
  const extraction = extractionResult.data;

  return withTenant(app, tenantId, async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId));
    if (!tenant) throw new AppError("NOT_FOUND", "Tenant not found", 404);

    const allDebtors = await tx.select().from(debtors).where(isNull(debtors.deletedAt));
    if (allDebtors.length === 0) throw new AppError("NOT_FOUND", "No debtors exist in workspace", 404);

    let debtor = input.debtorId
      ? allDebtors.find((d) => d.id === input.debtorId) ?? null
      : null;

    // Smart auto-matching if debtorId was not specified
    if (!debtor && extraction) {
      if (extraction.sender_name && extraction.sender_name.trim().length > 1) {
        const suggestion = suggestDebtorByName(extraction.sender_name, allDebtors);
        if (suggestion && suggestion.score >= 0.5) {
          debtor = allDebtors.find((d) => d.id === suggestion.debtorId) ?? null;
        }
      }
      if (!debtor && extraction.amount_minor && extraction.amount_minor > 0) {
        const openInvs = await tx.select().from(invoices).where(eq(invoices.status, "open"));
        const match = openInvs.find((i) => (i.amountMinor - i.paidMinor) === BigInt(extraction.amount_minor!));
        if (match) {
          debtor = allDebtors.find((d) => d.id === match.debtorId) ?? null;
        }
      }
      if (!debtor) {
        debtor = allDebtors[0] ?? null;
      }
    }

    if (!debtor) throw new AppError("NOT_FOUND", "Debtor not found", 404);
    await tx.insert(usageLedger).values({
      tenantId, kind: "llm_vision",
      units: extractionResult.inputTokens + extractionResult.outputTokens, costEstimateMinor: 0n,
    });
    const [fileRow] = await tx.select().from(files).where(eq(files.id, fileId!));
    const sha256 = fileRow!.sha256;

    if (!extraction) {
      await tx.insert(auditLog).values({
        tenantId, actorUserId: actor, action: "payment.receipt_unreadable", entity: "file", entityId: fileId!,
        after: { debtorId: debtor.id, model: extractionResult.model, promptVersion: extractionResult.promptVersion } as never,
      });
      return {
        outcome: "unreadable" as const, paymentId: null, fileId: fileId!, sha256, extraction: null, checks: [], matchKind: null,
        matchedDebtorId: debtor.id, matchedDebtorName: debtor.displayName,
      };
    }

    // Duplicate detection: a single indexed lookup for ANOTHER file with
    // this hash (this file's own row must not self-match) + every reference
    // number already carried by a payment. M06: the old code loaded the
    // whole files table into memory on every receipt.
    const [otherWithHash] = await tx.select({ id: files.id }).from(files)
      .where(and(eq(files.sha256, sha256), ne(files.id, fileId!))).limit(1);
    const seenHashes = new Set<string>(uploadWasDuplicate || otherWithHash ? [sha256] : []);
    const paidRefs = await tx.select({ referenceNo: payments.referenceNo }).from(payments)
      .where(isNotNull(payments.referenceNo));
    const seenReferences = new Set(paidRefs.map((p) => p.referenceNo!).filter(Boolean));

    const checksResult = evaluateReceiptChecks({ extraction, sha256, seenHashes, seenReferences, now });
    const checks = checksResult.checks;

    if (!extraction.is_receipt || extraction.amount_minor === null) {
      await tx.insert(auditLog).values({
        tenantId, actorUserId: actor, action: "payment.receipt_not_a_receipt", entity: "file", entityId: fileId!,
        after: { debtorId: debtor.id, isReceipt: extraction.is_receipt, checks } as never,
      });
      return {
        outcome: "not_receipt" as const, paymentId: null, fileId: fileId!, sha256,
        extraction, checks, matchKind: null,
        matchedDebtorId: debtor.id, matchedDebtorName: debtor.displayName,
      };
    }

    // F01: lock the debtor's invoices before matching/allocating, so a
    // concurrent manual payment cannot allocate the same outstanding.
    const openInvoices = await lockDebtorInvoices(tx, debtor.id);
    const match = matchReceiptAmount(
      extraction.amount_minor,
      openInvoices
        .filter((i) => i.status === "open" || i.status === "partially_paid")
        .map((i) => ({
          id: i.id,
          outstandingMinor: Number(i.amountMinor - i.paidMinor > 0n ? i.amountMinor - i.paidMinor : 0n),
          dueOn: i.dueOn,
        })),
    );

    const decision = decideReceiptOutcome({
      checks: checksResult, autoCloseEnabled: tenant.settings.autoCloseEnabled, confidence: extraction.confidence,
    });
    const receivedOn = extraction.datetime && !Number.isNaN(new Date(extraction.datetime).getTime())
      ? localDateOf(new Date(extraction.datetime), tenant.timezone)
      : localDateOf(now, tenant.timezone);
    const paymentId = uuidv7();
    // OCR currency is free text ("LE", "ج.م", ...) — only a supported ISO
    // code is stored; anything else falls back to EGP rather than failing
    // the CHECK constraint on payments.currency.
    const receiptCurrency = (extraction.currency ?? "").toUpperCase();
    const paymentCurrency = ["EGP", "SAR", "USD", "AED", "EUR", "KWD", "JPY"].includes(receiptCurrency) ? receiptCurrency : "EGP";
    await tx.insert(payments).values({
      id: paymentId, tenantId, debtorId: debtor.id,
      invoiceId: match.allocations[0]?.invoiceId ?? null,
      amountMinor: BigInt(extraction.amount_minor),
      currency: paymentCurrency,
      method: METHOD_MAP[extraction.method ?? "other"] ?? "other",
      receivedOn, referenceNo: extraction.reference_no,
      status: decision === "auto_confirm" ? "confirmed" : "claimed",
      source: "receipt_ai", evidenceFileId: fileId, confirmedBy: decision === "auto_confirm" ? "auto:receipt_ai" : null,
    });

    let allocatedInvoiceIds: string[] = [];
    if (decision === "auto_confirm") {
      let allocations = match.allocations.map((a) => ({ invoiceId: a.invoiceId, amountMinor: BigInt(a.amountMinor) }));
      if (allocations.length === 0) {
        const plan = allocatePayment(BigInt(extraction.amount_minor), openInvoices.map((i) => ({
          invoiceId: i.id, amountMinor: i.amountMinor, paidMinor: i.paidMinor, dueOn: i.dueOn, status: i.status,
        })));
        allocations = plan.allocations.map((a) => ({ invoiceId: a.invoiceId, amountMinor: a.amountMinor }));
      }
      for (const a of allocations) {
        await tx.insert(paymentAllocations).values({ tenantId, paymentId, invoiceId: a.invoiceId, amountMinor: a.amountMinor });
      }
      for (const a of allocations) await recomputeInvoicePaid(tx, tenantId, a.invoiceId);
      allocatedInvoiceIds = allocations.map((a) => a.invoiceId);
    }

    await upsertNotificationInTx(tx, tenantId, {
      kind: decision === "auto_confirm" ? "payment_confirmed" : "receipt_claim",
      severity: decision === "auto_confirm" ? "success" : "warning",
      titleAr:
        decision === "auto_confirm"
          ? `تم تأكيد إيصال سداد آلياً — ${debtor.displayName}`
          : `إيصال سداد بانتظار المراجعة — ${debtor.displayName}`,
      titleEn:
        decision === "auto_confirm"
          ? `Receipt auto-confirmed — ${debtor.displayName}`
          : `Receipt claim awaiting review — ${debtor.displayName}`,
      bodyAr: `قيمة التحويل: ${formatMoney(BigInt(extraction.amount_minor), paymentCurrency, { locale: "ar" })}.`,
      bodyEn: `Transfer amount: ${formatMoney(BigInt(extraction.amount_minor), paymentCurrency, { locale: "en" })}.`,
      actionUrl: decision === "auto_confirm" ? `/debtors/${debtor.id}` : "/ai-inbox",
      entityType: "payment",
      entityId: paymentId,
      dedupeKey: `receipt:${paymentId}`,
    });

    await tx.insert(auditLog).values({
      tenantId, actorUserId: actor,
      action: decision === "auto_confirm" ? "payment.receipt_auto_confirmed" : "payment.receipt_claimed",
      entity: "payment", entityId: paymentId,
      after: {
        debtorId: debtor.id, amountMinor: String(extraction.amount_minor), fileId,
        checks, matchKind: match.kind, confidence: extraction.confidence,
        model: extractionResult.model, promptVersion: extractionResult.promptVersion,
      } as never,
    });

    // Debtor reply — templates only. Remaining is computed after settlement.
    const freshInvoices = await tx.select().from(invoices).where(eq(invoices.debtorId, debtor.id));
    const remainingMinor = freshInvoices
      .filter((i) => i.status === "open" || i.status === "partially_paid")
      .reduce((s, i) => s + (i.amountMinor - i.paidMinor > 0n ? i.amountMinor - i.paidMinor : 0n), 0n);
    const templateKey = decision === "auto_confirm" ? "payment_received" : "payment_received_pending";
    const body = renderTemplate(templateKey, "ar", {
      amount: formatMoney(BigInt(extraction.amount_minor), paymentCurrency, { locale: "ar" }),
      remaining: formatMoney(remainingMinor, paymentCurrency, { locale: "ar" }),
    });
    const [msg] = await tx.insert(messages).values({
      tenantId, debtorId: debtor.id, direction: "out", channel: "whatsapp", provider: "whatsapp",
      templateKey, bodyText: body, status: "queued",
    }).returning();
    void msg;
    if (deps.notifyText) {
      await deps.notifyText(debtor.phoneE164, body, `receipt-reply:${paymentId}`)
        .catch(() => { /* the reply is recorded; a send failure never undoes the claim */ });
    }

    for (const id of allocatedInvoiceIds) replanLater(tenantId, id);
    return {
      outcome: decision === "auto_confirm" ? "auto_confirmed" as const : "claimed" as const,
      paymentId, fileId: fileId!, sha256, extraction, checks, matchKind: match.kind,
      matchedDebtorId: debtor.id,
      matchedDebtorName: debtor.displayName,
    };
  });
}

/** Receipt claims awaiting the merchant (the AI inbox's payment half). */
export async function listReceiptClaims(app: Db, tenantId: string) {
  return withTenant(app, tenantId, async (tx) => {
    const rows = await tx.select().from(payments)
      .where(and(eq(payments.source, "receipt_ai"), eq(payments.status, "claimed")))
      .orderBy(desc(payments.createdAt));
    if (rows.length === 0) return [];

    const debtorIds = Array.from(new Set(rows.map((p) => p.debtorId)));
    const debtorList = debtorIds.length > 0
      ? await tx.select({ id: debtors.id, displayName: debtors.displayName })
          .from(debtors)
          .where(inArray(debtors.id, debtorIds))
      : [];
    const debtorMap = new Map(debtorList.map((d) => [d.id, d.displayName]));

    return rows.map((p) => ({
      id: p.id, debtorId: p.debtorId, debtorName: debtorMap.get(p.debtorId) ?? "",
      amountMinor: p.amountMinor.toString(), method: p.method, receivedOn: p.receivedOn,
      referenceNo: p.referenceNo, evidenceFileId: p.evidenceFileId,
      createdAt: p.createdAt.toISOString(),
    }));
  });
}
