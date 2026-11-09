import { eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { AppError } from "@tahseel/core";
import { sha256Of } from "@tahseel/core/files-crypto";
import { auditLog, files } from "@tahseel/db/schema";
import { withTenant, type Db } from "@tahseel/db";
import { validateUpload, type StorageProvider } from "@tahseel/providers";

/**
 * File storage service (§5 files table, F6/F7): validate (§3 allowlist,
 * 8 MB cap), hash (sha256 — the receipt duplicate detector), store through
 * the StorageProvider seam, and record the row. Bytes never touch the DB.
 * NOTE on "resize/compress before sending": there is no native image
 * library in this environment, so uploads are validated and byte-capped
 * and sent as stored; a real downscale step lands with the S3 adapter and
 * is recorded as a fake in PROGRESS until then.
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
): Promise<FileView> {
  const valid = validateUpload({ mime: input.mime, size: input.bytes.length });
  if (!valid.ok) {
    throw new AppError(valid.code, `Upload rejected: ${valid.code}`, 400);
  }
  const id = uuidv7();
  const storageKey = `${tenantId}/${id}`;
  const sha256 = sha256Of(input.bytes);
  await storage.put(storageKey, input.bytes, input.mime);
  return withTenant(app, tenantId, async (tx) => {
    const [row] = await tx.insert(files).values({
      id, tenantId, storageKey, mime: input.mime, sizeBytes: input.bytes.length, sha256, kind: input.kind,
    }).returning();
    await tx.insert(auditLog).values({
      tenantId, actorUserId: actor, action: "file.stored", entity: "file", entityId: id,
      after: { kind: input.kind, mime: input.mime, sizeBytes: input.bytes.length, sha256 } as never,
    });
    return toView(row!);
  });
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
