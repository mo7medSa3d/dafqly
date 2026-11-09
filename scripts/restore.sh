#!/usr/bin/env bash
# Tahseel database restore (M6, RUNBOOK): pg_restore into a TARGET database
# (never the source), then a smoke check (migration count + key row counts).
# Usage: TARGET_DATABASE_URL=postgres://... ./scripts/restore.sh backups/tahseel-<ts>.dump
set -euo pipefail
: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL is required}"
FILE="${1:?usage: restore.sh <dump file>}"
[ -f "$FILE" ] || { echo "no such dump: $FILE" >&2; exit 1; }
if [ -f "$FILE.sha256" ]; then sha256sum -c "$FILE.sha256"; fi
START=$(date +%s)
pg_restore --no-owner --clean --if-exists -d "$TARGET_DATABASE_URL" "$FILE"
END=$(date +%s)
echo "restore: $FILE -> target in $((END - START))s"
psql "$TARGET_DATABASE_URL" -Atc "select 'migrations=' || count(*) from drizzle.__drizzle_migrations;"
psql "$TARGET_DATABASE_URL" -Atc "select 'tenants=' || count(*) from tenants;"
psql "$TARGET_DATABASE_URL" -Atc "select 'debtors=' || count(*) from debtors;"
psql "$TARGET_DATABASE_URL" -Atc "select 'invoices=' || count(*) from invoices;"
psql "$TARGET_DATABASE_URL" -Atc "select 'payments=' || count(*) from payments;"
