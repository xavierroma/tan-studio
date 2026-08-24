#!/usr/bin/env bash
set -euo pipefail

# Restores the hosted notebook from Cloud Storage into a scratch path and
# proves the result is a usable SQLite notebook rather than a pile of bytes.
#
#   sudo ./restore_notebook.sh                       # newest state, scratch path
#   sudo ./restore_notebook.sh /var/tmp/check.sqlite # explicit destination
#   sudo TAN_STUDIO_RESTORE_TIMESTAMP=2026-08-24T02:00:00Z ./restore_notebook.sh
#
# This never writes to the live notebook. Promoting a restored copy is a
# deliberate, separate act: stop tan-studio, move the file into place, chown it
# to tan-studio:tan-studio, start tan-studio.

LIVE_DATABASE="${TAN_STUDIO_DATABASE_PATH:-/var/lib/tan-studio/tan-studio.sqlite}"
CONFIG_FILE="${TAN_STUDIO_LITESTREAM_CONFIG:-/etc/litestream.yml}"
CREDENTIAL_FILE="${TAN_STUDIO_GCS_CREDENTIAL_FILE:-/etc/tan-studio/litestream-gcs.json}"
LITESTREAM="${LITESTREAM_BINARY:-/usr/local/bin/litestream}"
RESTORE_TIMESTAMP="${TAN_STUDIO_RESTORE_TIMESTAMP:-}"

DESTINATION="${1:-}"
if [[ -z "$DESTINATION" ]]; then
  DESTINATION="/var/tmp/tan-studio-restore-$(date -u +%Y%m%dT%H%M%SZ)/tan-studio.sqlite"
fi

# Refuse to restore over the notebook the service is serving from, whatever
# path spelling was used to name it. This is checked before anything else so a
# dangerous destination is rejected even on a half-installed box.
resolved() {
  local path="$1"
  local directory
  directory="$(dirname "$path")"
  if [[ -d "$directory" ]]; then
    directory="$(cd "$directory" && pwd)"
  fi
  printf '%s/%s' "$directory" "$(basename "$path")"
}
if [[ "$(resolved "$DESTINATION")" == "$(resolved "$LIVE_DATABASE")" ]]; then
  echo "Refusing to restore over the live notebook at $LIVE_DATABASE" >&2
  exit 2
fi
if [[ -e "$DESTINATION" ]]; then
  echo "Destination already exists: $DESTINATION" >&2
  exit 2
fi

for required in "$LITESTREAM" "$CONFIG_FILE" "$CREDENTIAL_FILE"; do
  if [[ ! -e "$required" ]]; then
    echo "Missing $required; run install_litestream.sh first" >&2
    exit 2
  fi
done

install -d -m 0700 "$(dirname "$DESTINATION")"

RESTORE_ARGUMENTS=(restore -config "$CONFIG_FILE" -o "$DESTINATION" -integrity-check full)
if [[ -n "$RESTORE_TIMESTAMP" ]]; then
  RESTORE_ARGUMENTS+=(-timestamp "$RESTORE_TIMESTAMP")
fi
RESTORE_ARGUMENTS+=("$LIVE_DATABASE")

GOOGLE_APPLICATION_CREDENTIALS="$CREDENTIAL_FILE" \
  "$LITESTREAM" "${RESTORE_ARGUMENTS[@]}"

if [[ ! -f "$DESTINATION" ]]; then
  echo "Litestream reported success but wrote no file to $DESTINATION" >&2
  exit 1
fi

INTEGRITY="$(sqlite3 "$DESTINATION" 'PRAGMA integrity_check;')"
if [[ "$INTEGRITY" != "ok" ]]; then
  echo "Restored notebook failed integrity_check: $INTEGRITY" >&2
  exit 1
fi

# A file that opens is not yet a notebook. The schema ledger has to be there,
# and every domain table has to be queryable.
MIGRATIONS="$(sqlite3 "$DESTINATION" 'SELECT count(*) FROM schema_migrations;')"
if [[ "$MIGRATIONS" -lt 1 ]]; then
  echo "Restored notebook has no applied migrations" >&2
  exit 1
fi

printf 'restored   %s\n' "$DESTINATION"
printf 'integrity  %s\n' "$INTEGRITY"
printf 'migrations %s\n' "$MIGRATIONS"
printf 'rows\n'
sqlite3 "$DESTINATION" <<'SQL'
.mode list
.separator "  "
SELECT 'coffees', count(*) FROM coffees
UNION ALL SELECT 'roasts', count(*) FROM roasts
UNION ALL SELECT 'brews', count(*) FROM brews
UNION ALL SELECT 'notes', count(*) FROM notes
UNION ALL SELECT 'attachments', count(*) FROM attachments
UNION ALL SELECT 'api_tokens', count(*) FROM api_tokens
UNION ALL SELECT 'settings', count(*) FROM settings;
SQL
