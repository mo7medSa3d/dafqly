import { AppError, toApiErrorBody } from "@tahseel/core";
import { withTenant } from "@tahseel/db";
import { messageIntents, messages } from "@tahseel/db/schema";
import { appDb, ownerDb } from "@/server/db";
import { aiDeps } from "@/server/engine";
import { withAiTenantContext } from "@/server/ai-budget";
import { upsertNotificationInTx } from "@/server/notifications";
import { clientIp, rateLimit, tokenBucketKey } from "@/server/rate-limit";
import { processReceiptImage } from "@/server/receipts";
import { readRequestBodyLimited, RequestBodyTooLargeError } from "@/server/request-body";
import { resolveStatement } from "@/server/statements";

const HEADERS = { "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" };
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIMES = ["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif", "application/pdf"];

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const ip = clientIp(req.headers);
  const limit = rateLimit(`statement:receipt:${ip}`, { limit: 10, windowSeconds: 60 });
  if (!limit.allowed) {
    return Response.json(toApiErrorBody(new AppError("RATE_LIMITED", "Too many requests", 429)), {
      status: 429, headers: { ...HEADERS, "Retry-After": String(limit.retryAfterSeconds) },
    });
  }
  if (!TOKEN_RE.test(token)) {
    return Response.json(toApiErrorBody(new AppError("NOT_FOUND", "Not found", 404)), { status: 404, headers: HEADERS });
  }
  const tokenLimit = rateLimit(`statement:receipt:token:${tokenBucketKey(token)}`, { limit: 5, windowSeconds: 60 });
  if (!tokenLimit.allowed) {
    return Response.json(toApiErrorBody(new AppError("RATE_LIMITED", "Too many requests", 429)), {
      status: 429, headers: { ...HEADERS, "Retry-After": String(tokenLimit.retryAfterSeconds) },
    });
  }
  let formData: FormData;
  try {
    const rawBytes = await readRequestBodyLimited(req, MAX_RECEIPT_BYTES + 65_536);
    const boundedReq = new Request(req.url, { method: req.method, headers: req.headers, body: Buffer.from(rawBytes) });
    formData = await boundedReq.formData();
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) {
      return Response.json(toApiErrorBody(new AppError("BODY_TOO_LARGE", "Receipt file exceeds 10 MB", 413)), { status: 413, headers: HEADERS });
    }
    return Response.json(toApiErrorBody(new AppError("BAD_REQUEST", "Invalid multipart form data", 400)), { status: 400, headers: HEADERS });
  }
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return Response.json(toApiErrorBody(new AppError("NO_FILE", "A receipt file is required", 400)), { status: 400, headers: HEADERS });
  }
  if (file.size > MAX_RECEIPT_BYTES) {
    return Response.json(toApiErrorBody(new AppError("BODY_TOO_LARGE", "Receipt file exceeds 10 MB", 413)), { status: 413, headers: HEADERS });
  }
  const mime = (file.type || "image/jpeg").toLowerCase().split(";")[0]?.trim() || "image/jpeg";
  if (!ALLOWED_MIMES.includes(mime)) {
    return Response.json(toApiErrorBody(new AppError("UNSUPPORTED_FILE", "Unsupported receipt file type", 400)), { status: 400, headers: HEADERS });
  }
  try {
    const { state, link } = await resolveStatement(ownerDb(), token, new Date());
    if (state !== "valid" || !link) {
      return Response.json(toApiErrorBody(new AppError("NOT_FOUND", "Not found", 404)), { status: 404, headers: HEADERS });
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const ai = aiDeps();
    const out = await withAiTenantContext(link.tenantId, () =>
      processReceiptImage(appDb(), link.tenantId, null, { llm: ai.llm, storage: ai.storage }, {
        debtorId: link.debtorId,
        bytes,
        mime,
      }),
    );
    // Ensure the merchant is always notified even if AI could not parse the image
    if (!out.paymentId) {
      await withTenant(appDb(), link.tenantId, async (tx) => {
        await upsertNotificationInTx(tx, link.tenantId, {
          kind: "receipt_claim",
          severity: "warning",
          titleAr: "مرفق إيصال جديد من بوابة العميل بحاجة للمراجعة",
          titleEn: "New receipt attachment from customer portal needs review",
          bodyAr: "رفع العميل صورة إيصال عبر رابط كشف الحساب ولم يتم استخراج بياناتها آلياً.",
          bodyEn: "A customer uploaded a receipt via the statement link that needs manual review.",
          actionUrl: "/ai-inbox",
          entityType: "file",
          entityId: out.fileId,
          dedupeKey: `portal_receipt:${out.fileId}`,
        });
        const [msgRow] = await tx.insert(messages).values({
          tenantId: link.tenantId, debtorId: link.debtorId, direction: "in", channel: "whatsapp",
          provider: "portal", bodyText: "Customer uploaded receipt via statement portal",
          mediaId: out.fileId, status: "received",
        }).returning({ id: messages.id });
        if (msgRow) {
          await tx.insert(messageIntents).values({
            tenantId: link.tenantId, messageId: msgRow.id, intent: "receipt_image_pending",
            extracted: { fileId: out.fileId, sha256: out.sha256, outcome: out.outcome, checks: out.checks } as never,
            confidence: out.extraction?.confidence ?? 0, resolvedBy: "human", actionTaken: "human_inbox",
          });
        }
      });
    }
    return Response.json({ ok: true, outcome: out.outcome, paymentId: out.paymentId, fileId: out.fileId }, { status: 201, headers: HEADERS });
  } catch (err) {
    const status = err instanceof AppError ? err.status : 500;
    return Response.json(toApiErrorBody(err), { status, headers: HEADERS });
  }
}
