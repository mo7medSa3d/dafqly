import { eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { AppError } from "@tahseel/core";
import { sha256Of, sniffImageMime, stripImageExif } from "@tahseel/core/files-crypto";
import { auditLog, files } from "@tahseel/db/schema";
import { withTenant, type Db } from "@tahseel/db";
import { validateUpload, type StorageProvider } from "@tahseel/providers";

/**
 * File storage service (§5 files table, F6/F7): validate (§3 allowlist,
 * 8 MB cap), verify the bytes really are the claimed image type (M5:
 * magic-byte sniff — a client MIME string is never trusted), strip
 * EXIF/metadata headers (M5), hash the STORED bytes (sha256 — the receipt
 * duplicate detector, so the same photo with different EXIF still dedupes),
 * store through the StorageProvider seam, and record the row. Bytes never
 * touch the DB. HEIC/HEIF EXIF stripping is the documented remainder
 * (needs a real HEIF parser; see KNOWN_LIMITATIONS). Image downscaling
 * remains an explicit follow-up.
 */
export type FileKind = "ledger_page" | "receipt" | "payment_proof" | "other";

export interface FileView {
  id: string; storageKey: string; mime: string; sizeBytes: number;
  sha256: string; kind: string; createdAt: string;
}

const toView = (r: typeof files.$inferSelect): FileView => ({
  id: r.id, storageKey: r.storageKey, mime: r.mime, sizeBytes: r.sizeBytes,
  sha256: r.sha256, kind: r.kind, createdAt: r.createdAt.toISOString(),
});

export async function storeUpload(
  app: Db, storage: StorageProvider, tenantId: string, actor: string | null,
  input: { bytes: Uint8Array; mime: string; kind: FileKind },
): Promise<FileView & { bytes: Uint8Array; deduped: boolean }> {
  const valid = validateUpload({ mime: input.mime, size: input.bytes.length });
  if (!valid.ok) {
    throw new AppError(valid.code, `Upload rejected: ${valid.code}`, 400);
  }
  // M5: the bytes must be the claimed image type, whatever the client said.
  const sniffed = sniffImageMime(input.bytes);
  if (sniffed !== input.mime) {
    throw new AppError("UNSUPPORTED_MIME", "Upload rejected: UNSUPPORTED_MIME", 400);
  }
  // M5: strip EXIF/metadata before anything downstream sees the bytes —
  // storage, the duplicate hash, and the LLM extraction all get the clean copy.
  const clean = stripImageExif(input.bytes, sniffed);
  const sha256 = sha256Of(clean);
  // M06: duplicate uploads dedupe onto the existing file row instead of
  // creating a second one. Fast path first (one indexed lookup, no blob
  // written); the unique index + onConflictDoNothing below closes the
  // race between the lookup and the insert.
  const existing = await withTenant(app, tenantId, async (tx) => {
    const [row] = await tx.select().from(files).where(eq(files.sha256, sha256)).limit(1);
    return row ?? null;
  });
  if (existing) return { ...toView(existing), bytes: clean, deduped: true };
  const id = uuidv7();
  const storageKey = `${tenantId}/${id}`;
  await storage.put(storageKey, clean, input.mime);
  try {
    return await withTenant(app, tenantId, async (tx) => {
      const [row] = await tx.insert(files).values({
        id, tenantId, storageKey, mime: input.mime, sizeBytes: clean.length, sha256, kind: input.kind,
      }).onConflictDoNothing({ target: [files.tenantId, files.sha256] }).returning();
      if (!row) {
        // Lost the race: another upload of the same bytes committed first.
        // Drop this blob (it is orphaned) and return the winner's row.
        await storage.delete(storageKey).catch(() => undefined);
        const [winner] = await tx.select().from(files).where(eq(files.sha256, sha256)).limit(1);
        if (!winner) throw new AppError("UPLOAD_CONFLICT", "Upload conflicted with an identical file", 409);
        return { ...toView(winner), bytes: clean, deduped: true };
      }
      await tx.insert(auditLog).values({
        tenantId, actorUserId: actor, action: "file.stored", entity: "file", entityId: id,
        after: { kind: input.kind, mime: input.mime, sizeBytes: clean.length, sha256 } as never,
      });
      return { ...toView(row), bytes: clean, deduped: false };
    });
  } catch (error) {
    // Best-effort rollback of the blob if the metadata transaction fails.
    await storage.delete(storageKey).catch(() => undefined);
    throw error;
  }
}

export async function getFile(app: Db, tenantId: string, fileId: string): Promise<FileView> {
  return withTenant(app, tenantId, async (tx) => {
    const [row] = await tx.select().from(files).where(eq(files.id, fileId));
    if (!row) throw new AppError("NOT_FOUND", "File not found", 404);
    return toView(row);
  });
}

export async function getFileBytes(app: Db, storage: StorageProvider, tenantId: string, fileId: string): Promise<{ file: FileView; bytes: Uint8Array }> {
  const file = await getFile(app, tenantId, fileId);
  const bytes = await storage.get(file.storageKey);
  if (!bytes) throw new AppError("FILE_BYTES_MISSING", "Stored bytes for this file are missing", 500);
  return { file, bytes };
}
