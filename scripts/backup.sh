#!/usr/bin/env bash
# Tahseel database backup (M6, RUNBOOK): custom-format pg_dump + sha256.
# Usage: DATABASE_URL=postgres://... ./scripts/backup.sh [outdir]
# Production schedule (procedure, not deployed): daily via cron, keep 30.
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
OUTDIR="${1:-backups}"
mkdir -p "$OUTDIR"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$OUTDIR/tahseel-$TS.dump"
START=$(date +%s)
pg_dump -Fc --no-owner -d "$DATABASE_URL" -f "$FILE"
END=$(date +%s)
sha256sum "$FILE" > "$FILE.sha256"
echo "backup: $FILE ($(stat -c%s "$FILE") bytes, $((END - START))s) sha256=$(cut -d' ' -f1 "$FILE.sha256")"
