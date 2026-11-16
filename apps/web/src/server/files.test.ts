import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { ownerDb, appDb } from "./db";
import { user as userTable, tenants } from "@tahseel/db/schema";
import { createTenantForUser } from "./services";
import { FakeStorageProvider } from "@tahseel/providers";
import { storeUpload, getFileBytes } from "./files";

/**
 * Regression: a duplicate upload must heal a blob the store lost.
 * The files row survives a server restart (Postgres) while the blob store
 * does not (in-memory fake storage; an S3 object can be lost the same way).
 * The dedupe short-circuit used to trust the row and skip the put, so every
 * later read failed with FILE_BYTES_MISSING (500 at ledger extraction) even
 * though the caller had just handed us the bytes. Re-uploading identical
 * bytes must re-put them under the existing key.
 */
const hasDb = Boolean(process.env.DATABASE_URL && (process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL));
if (!hasDb && process.env.REQUIRE_DB_TESTS === "1") throw new Error("REQUIRE_DB_TESTS=1 but DB env missing");
const d = hasDb ? describe : describe.skip;

// 1x1 transparent PNG (same bytes as e2e/fixtures/test_scan.png).
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

d("files: duplicate upload heals a missing blob", () => {
  const user = { id: randomUUID().replace(/-/g, ""), email: `files-${randomUUID()}@example.test`, name: "Files" };
  let tenantId = "";
  const app = () => appDb();

  beforeAll(async () => {
    await ownerDb().insert(userTable).values([user]);
    tenantId = (await createTenantForUser(appDb(), user.id, {
      businessNameAr: "شركة ملفات", timezone: "Africa/Cairo", quietStart: "21:00", quietEnd: "09:00",
      fridayMorningSkip: false, defaultTermsDays: 14, tone: "polite", consent: true,
    })).tenantId;
  });
  afterAll(async () => {
    const owner = ownerDb();
    await owner.delete(tenants).where(eq(tenants.id, tenantId));
    await owner.delete(userTable).where(eq(userTable.id, user.id));
  });

  it("re-uploading identical bytes after the blob store is wiped re-puts them", async () => {
    const storeA = new FakeStorageProvider();
    const first = await storeUpload(app(), storeA, tenantId, user.id, {
      bytes: new Uint8Array(PNG_1X1), mime: "image/png", kind: "ledger_page",
    });
    expect(first.deduped).toBe(false);
    // Simulate a server restart: a fresh, empty blob store; the DB row survives.
    const storeB = new FakeStorageProvider();
    const second = await storeUpload(app(), storeB, tenantId, user.id, {
      bytes: new Uint8Array(PNG_1X1), mime: "image/png", kind: "ledger_page",
    });
    expect(second.deduped).toBe(true);
    expect(second.id).toBe(first.id);
    const { bytes } = await getFileBytes(app(), storeB, tenantId, first.id);
    expect(Buffer.from(bytes).equals(PNG_1X1)).toBe(true);
  });
});
