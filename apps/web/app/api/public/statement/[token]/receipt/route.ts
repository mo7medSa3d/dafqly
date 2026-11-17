import { AppError, toApiErrorBody } from "@tahseel/core";
import { withTenant } from "@tahseel/db";
import { appDb, ownerDb } from "@/server/db";
import { aiDeps } from "@/server/engine";
import { withAiTenantContext } from "@/server/ai-budget";
import { upsertNotificationInTx } from "@/server/notifications";
import { clientIp, rateLimit, tokenBucketKey } from "@/server/rate-limit";
import { processReceiptImage } from "@/server/receipts";
import { resolveStatement } from "@/server/statements";

const HEADERS = { "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" };
const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_PREFIXES = ["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif", "application/pdf"];

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  const ip = clientIp(req.headers);
  const limit = rateLimit(`statement:receipt:${ip}`, { limit: 10, windowSeconds: 60 });
  const tokenLimit = rateLimit(`statement:receipt:token:${tokenBucketKey(token)}`, { limit: 5, windowSeconds: 60 });
  if (!limit.allowed || !tokenLimit.allowed) {
    const retryAfter = Math.max(limit.retryAfterSeconds, tokenLimit.retryAfterSeconds);
    return Response.json(toApiErrorBody(new AppError("RATE_LIMITED", "Too many requests", 429)), {
      status: 429, headers: { ...HEADERS, "Retry-After": String(retryAfter) },
    });
  }
  if (!TOKEN_RE.test(token)) {
    return Response.json(toApiErrorBody(new AppError("NOT_FOUND", "Not found", 404)), { status: 404, headers: HEADERS });
  }
  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_RECEIPT_BYTES + 65_536) {
    return Response.json(toApiErrorBody(new AppError("BODY_TOO_LARGE", "Receipt file exceeds 10 MB", 413)), { status: 413, headers: HEADERS });
  }
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return Response.json(toApiErrorBody(new AppError("BAD_REQUEST", "Invalid multipart form data", 400)), { status: 400, headers: HEADERS });
  }
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return Response.json(toApiErrorBody(new AppError("NO_FILE", "A receipt file is required", 400)), { status: 400, headers: HEADERS });
  }
  if (file.size > MAX_RECEIPT_BYTES) {
    return Response.json(toApiErrorBody(new AppError("BODY_TOO_LARGE", "Receipt file exceeds 10 MB", 413)), { status: 413, headers: HEADERS });
  }
  const mime = (file.type || "image/jpeg").toLowerCase();
  if (!ALLOWED_MIME_PREFIXES.includes(mime)) {
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
          actionUrl: `/debtors/${link.debtorId}`,
          entityType: "file",
          entityId: out.fileId,
          dedupeKey: `portal_receipt:${out.fileId}`,
        });
      });
    }
    return Response.json({ ok: true, outcome: out.outcome, paymentId: out.paymentId, fileId: out.fileId }, { status: 201, headers: HEADERS });
  } catch (err) {
    console.error("[public/statement/receipt] error:", err);
    const status = err instanceof AppError ? err.status : 500;
    return Response.json(toApiErrorBody(err), { status, headers: HEADERS });
  }
}
