-- M09: record the resolution on the dispute row so a retried resolution is
-- an idempotent replay (same resolution) or a 409 (different resolution),
-- instead of a second audit row and a misleading success.
ALTER TABLE disputes ADD COLUMN resolution text;
-- M06: receipt duplicate detection must be atomic. Dedupe first (keep the
-- earliest id per tenant+hash; the two references to files.id are
-- ON DELETE SET NULL, so no FK blocks the delete), then replace the plain
-- index with a unique one.
DELETE FROM files f USING files g
WHERE f.tenant_id = g.tenant_id AND f.sha256 = g.sha256 AND f.id > g.id;
DROP INDEX IF EXISTS files_tenant_sha_idx;
CREATE UNIQUE INDEX files_tenant_sha256_uniq ON files (tenant_id, sha256);
