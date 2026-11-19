#!/usr/bin/env bash
# Dafqly / Tahseel database backup (M6, RUNBOOK): custom-format pg_dump + sha256.
# Usage: DATABASE_URL=postgres://... ./scripts/backup.sh [outdir]
# Production schedule (procedure, not deployed): daily via cron, keep 30.
set -euo pipefail
umask 077
: "${DATABASE_URL:?DATABASE_URL is required}"
OUTDIR="${1:-backups}"
mkdir -p "$OUTDIR"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
BASE="tahseel-$TS.dump"
FILE="$OUTDIR/$BASE"
trap 'rm -f "$FILE" "$FILE.sha256"' ERR INT TERM
START=$(date +%s)
pg_dump -Fc --no-owner -d "$DATABASE_URL" -f "$FILE"
END=$(date +%s)
(
  cd "$OUTDIR"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$BASE" > "$BASE.sha256"
  else
    shasum -a 256 "$BASE" > "$BASE.sha256"
  fi
)
trap - ERR INT TERM
SIZE=$(wc -c < "$FILE" | tr -d ' ')
echo "backup: $FILE ($SIZE bytes, $((END - START))s) sha256=$(cut -d' ' -f1 "$FILE.sha256")"
