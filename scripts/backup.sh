#!/usr/bin/env bash
# Dafqly / Tahseel database backup (M6, RUNBOOK): custom-format pg_dump + sha256.
# Usage: DATABASE_URL=postgres://... ./scripts/backup.sh [outdir]
# Production schedule (procedure, not deployed): daily via cron, keep 30.
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
OUTDIR="${1:-backups}"
mkdir -p "$OUTDIR"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
BASE="tahseel-$TS.dump"
FILE="$OUTDIR/$BASE"
START=$(date +%s)
pg_dump -Fc --no-owner -d "$DATABASE_URL" -f "$FILE"
END=$(date +%s)
(cd "$OUTDIR" && sha256sum "$BASE" > "$BASE.sha256")
SIZE=$(wc -c < "$FILE" | tr -d ' ')
echo "backup: $FILE ($SIZE bytes, $((END - START))s) sha256=$(cut -d' ' -f1 "$FILE.sha256")"
