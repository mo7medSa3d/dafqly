#!/usr/bin/env bash
# Dafqly / Tahseel database restore (M6, RUNBOOK): pg_restore into a TARGET database
# (never the source), then a smoke check (migration count + key row counts).
# Usage: TARGET_DATABASE_URL=postgres://... ./scripts/restore.sh backups/tahseel-<ts>.dump
set -euo pipefail
umask 077

: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL is required}"
command -v pg_restore >/dev/null 2>&1 || { echo "pg_restore is required" >&2; exit 1; }
command -v psql >/dev/null 2>&1 || { echo "psql is required" >&2; exit 1; }

if [ -n "${DATABASE_URL:-}" ] && [ "$TARGET_DATABASE_URL" = "$DATABASE_URL" ]; then
  echo "refusing to restore into DATABASE_URL; set TARGET_DATABASE_URL to a separate target" >&2
  exit 1
fi

FILE="${1:?usage: restore.sh <dump file>}"
[ -f "$FILE" ] || { echo "no such dump: $FILE" >&2; exit 1; }

PGPASS_TMP=""
cleanup() {
  if [ -n "$PGPASS_TMP" ]; then
    rm -f "$PGPASS_TMP"
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

if [ -f "$FILE.sha256" ]; then
  (
    cd "$(dirname "$FILE")"
    if command -v sha256sum >/dev/null 2>&1; then
      sha256sum -c "$(basename "$FILE").sha256"
    elif command -v shasum >/dev/null 2>&1; then
      shasum -a 256 -c "$(basename "$FILE").sha256"
    else
      echo "sha256sum or shasum is required" >&2
      exit 1
    fi
  )
fi

# Strip password from URI so it never appears in process args (ps / /proc).
SAFE_URL="$TARGET_DATABASE_URL"
if [[ "$TARGET_DATABASE_URL" == *"://"* ]]; then
  scheme="${TARGET_DATABASE_URL%%://*}"
  rest="${TARGET_DATABASE_URL#*://}"
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
pg_restore --no-owner --clean --if-exists --exit-on-error -d "$SAFE_URL" "$FILE"
END=$(date +%s)
echo "restore: $FILE -> target in $((END - START))s"

psql -v ON_ERROR_STOP=1 "$SAFE_URL" -Atc "select 'migrations=' || count(*) from drizzle.__drizzle_migrations;"
psql -v ON_ERROR_STOP=1 "$SAFE_URL" -Atc "select 'tenants=' || count(*) from tenants;"
psql -v ON_ERROR_STOP=1 "$SAFE_URL" -Atc "select 'debtors=' || count(*) from debtors;"
psql -v ON_ERROR_STOP=1 "$SAFE_URL" -Atc "select 'invoices=' || count(*) from invoices;"
psql -v ON_ERROR_STOP=1 "$SAFE_URL" -Atc "select 'payments=' || count(*) from payments;"
