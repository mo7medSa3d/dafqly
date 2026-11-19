#!/usr/bin/env bash
# Dafqly / Tahseel database restore (M6, RUNBOOK): pg_restore into a TARGET database
# (never the source), then a smoke check (migration count + key row counts).
# Usage: TARGET_DATABASE_URL=postgres://... ./scripts/restore.sh backups/tahseel-<ts>.dump
set -euo pipefail
: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL is required}"
if [ -n "${DATABASE_URL:-}" ] && [ "$TARGET_DATABASE_URL" = "$DATABASE_URL" ]; then
  echo "refusing to restore into DATABASE_URL; set TARGET_DATABASE_URL to a separate target" >&2
  exit 1
fi
FILE="${1:?usage: restore.sh <dump file>}"
[ -f "$FILE" ] || { echo "no such dump: $FILE" >&2; exit 1; }
if [ -f "$FILE.sha256" ]; then
  (
    cd "$(dirname "$FILE")"
    if command -v sha256sum >/dev/null 2>&1; then
      sha256sum -c "$(basename "$FILE").sha256"
    else
      shasum -a 256 -c "$(basename "$FILE").sha256"
    fi
  )
fi
START=$(date +%s)
pg_restore --no-owner --clean --if-exists -d "$TARGET_DATABASE_URL" "$FILE"
END=$(date +%s)
echo "restore: $FILE -> target in $((END - START))s"
psql -v ON_ERROR_STOP=1 "$TARGET_DATABASE_URL" -Atc "select 'migrations=' || count(*) from drizzle.__drizzle_migrations;"
psql -v ON_ERROR_STOP=1 "$TARGET_DATABASE_URL" -Atc "select 'tenants=' || count(*) from tenants;"
psql -v ON_ERROR_STOP=1 "$TARGET_DATABASE_URL" -Atc "select 'debtors=' || count(*) from debtors;"
psql -v ON_ERROR_STOP=1 "$TARGET_DATABASE_URL" -Atc "select 'invoices=' || count(*) from invoices;"
psql -v ON_ERROR_STOP=1 "$TARGET_DATABASE_URL" -Atc "select 'payments=' || count(*) from payments;"
