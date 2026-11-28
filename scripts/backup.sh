#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${TOVARIX_BACKUP_DB:?Set a libpq service or a dedicated TOVARIX database connection}"
: "${1:?Pass the output dump path}"
destination=$1
if [[ -e "$destination" ]]; then
  printf '%s\n' 'Backup output already exists' >&2
  exit 1
fi
temporary=$(mktemp "${destination}.part.XXXXXX")
trap 'unlink "$temporary" 2>/dev/null || true' EXIT
PGDATABASE="$TOVARIX_BACKUP_DB" pg_dump --format=custom --file="$temporary" --no-owner --no-privileges
pg_restore --list "$temporary" >/dev/null
ln "$temporary" "$destination"
printf 'Backup written to %s\n' "$destination"
