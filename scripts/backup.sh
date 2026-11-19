#!/usr/bin/env bash
# Dafqly / Tahseel database backup (M6, RUNBOOK): custom-format pg_dump + sha256.
# Usage: DATABASE_URL=postgres://... ./scripts/backup.sh [outdir]
# Production schedule (procedure, not deployed): daily via cron, keep 30.
set -euo pipefail
umask 077

: "${DATABASE_URL:?DATABASE_URL is required}"
command -v pg_dump >/dev/null 2>&1 || { echo "pg_dump is required" >&2; exit 1; }

OUTDIR="${1:-backups}"
mkdir -p "$OUTDIR"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
BASE="tahseel-$TS.dump"
FILE="$OUTDIR/$BASE"
PGPASS_TMP=""
SUCCESS=0

cleanup() {
  if [ -n "$PGPASS_TMP" ]; then
    rm -f "$PGPASS_TMP"
  fi
  if [ "$SUCCESS" -ne 1 ]; then
    rm -f "$FILE" "$FILE.sha256"
  fi
}
# Exit explicitly on INT/TERM so bash does not resume after cleanup and EXIT runs once.
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

url_decode() {
  local s="$1" out="" ch=""
  while [[ "$s" =~ ^([^%]*)(%([0-9A-Fa-f]{2}))(.*)$ ]]; do
    out+="${BASH_REMATCH[1]}"
    printf -v ch '\\x%s' "${BASH_REMATCH[3]}"
    printf -v ch '%b' "$ch"
    out+="$ch"
    s="${BASH_REMATCH[4]}"
  done
  printf '%s%s' "$out" "$s"
}

# Strip password from URI so it never appears in process args (ps / /proc).
SAFE_URL="$DATABASE_URL"
if [[ "$DATABASE_URL" == *"://"* ]]; then
  scheme="${DATABASE_URL%%://*}"
  rest="${DATABASE_URL#*://}"
  authority="${rest%%[/?]*}"
  suffix="${rest#"$authority"}"
  if [[ "$authority" == *"@"* ]]; then
    userinfo="${authority%@*}"
    hostport="${authority##*@}"
    if [[ "$userinfo" == *":"* ]]; then
      db_user="${userinfo%%:*}"
      db_pass="$(url_decode "${userinfo#*:}")"
      db_pass="${db_pass//\\/\\\\}"
      db_pass="${db_pass//:/\\:}"
      PGPASS_TMP="$(mktemp "${TMPDIR:-/tmp}/tahseel-pgpass.XXXXXX")"
      printf '*:*:*:*:%s\n' "$db_pass" > "$PGPASS_TMP"
      export PGPASSFILE="$PGPASS_TMP"
      SAFE_URL="${scheme}://${db_user}@${hostport}${suffix}"
    fi
  fi
fi

START=$(date +%s)
pg_dump -Fc --no-owner -d "$SAFE_URL" -f "$FILE"
END=$(date +%s)

(
  cd "$OUTDIR"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$BASE" > "$BASE.sha256"
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$BASE" > "$BASE.sha256"
  else
    echo "sha256sum or shasum is required" >&2
    exit 1
  fi
)

SUCCESS=1
SIZE=$(wc -c < "$FILE" | tr -d ' ')
echo "backup: $FILE ($SIZE bytes, $((END - START))s) sha256=$(cut -d' ' -f1 "$FILE.sha256")"
