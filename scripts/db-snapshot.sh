#!/usr/bin/env bash
# db-snapshot.sh - Atlas backup / restore for venue-outage resilience.  (owner: db)
#
# The demo persists picks to MongoDB Atlas. If the venue WiFi drops or Atlas is
# unreachable mid-judging, we must not lose the data OR the dashboard. This script
# takes portable snapshots of the Atlas `ht6` db and can restore them either back
# to Atlas or into a LOCAL mongod (the offline failover) in one command.
#
# Usage:
#   scripts/db-snapshot.sh dump              # snapshot Atlas -> db-snapshots/<ts>.gz
#   scripts/db-snapshot.sh list              # list snapshots (newest first)
#   scripts/db-snapshot.sh restore [ARCHIVE] # restore into Atlas (MONGODB_URI); latest if omitted
#   scripts/db-snapshot.sh restore-local     # VENUE FAILOVER: local mongod + restore latest, prints the URI to use
#   scripts/db-snapshot.sh auto [SECONDS]    # dump on a loop (default 300s) for unattended backups during the event
#
# Reads MONGODB_URI / MONGODB_DB from web/server/.env (falls back to env vars).
# Requires: mongodump, mongorestore (brew install mongodb-database-tools).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/web/server/.env"
SNAP_DIR="$ROOT/db-snapshots"
LOCAL_MONGO="$ROOT/web/server/db/local-mongo.sh"
LOCAL_PORT=27777
LOCAL_URI="mongodb://127.0.0.1:${LOCAL_PORT}"
KEEP=10  # retain this many snapshots

# --- config: pull MONGODB_URI / MONGODB_DB from .env if present, env wins if set
load_env() {
  if [[ -f "$ENV_FILE" ]]; then
    # only export the two keys we care about; ignore everything else + comments
    while IFS='=' read -r k v; do
      k="${k## }"; k="${k%% }"
      [[ "$k" == "MONGODB_URI" || "$k" == "MONGODB_DB" ]] || continue
      v="${v%$'\r'}"
      [[ -z "${!k:-}" ]] && export "$k=$v"
    done < <(grep -E '^\s*MONGODB_(URI|DB)=' "$ENV_FILE" || true)
  fi
  DB="${MONGODB_DB:-ht6}"
}

need_tools() {
  for t in mongodump mongorestore; do
    command -v "$t" >/dev/null 2>&1 || { echo "$t not found - brew install mongodb-database-tools" >&2; exit 1; }
  done
}

require_uri() {
  [[ -n "${MONGODB_URI:-}" ]] || { echo "MONGODB_URI not set (web/server/.env or env). Can't reach Atlas." >&2; exit 1; }
}

latest_snapshot() { ls -1t "$SNAP_DIR"/*.gz 2>/dev/null | head -1; }

# --- commands ---------------------------------------------------------------

cmd_dump() {
  require_uri; need_tools
  mkdir -p "$SNAP_DIR"
  local ts file
  ts="$(date +%Y%m%d-%H%M%S)"
  file="$SNAP_DIR/${DB}-${ts}.gz"
  echo "→ dumping '$DB' from Atlas → $file"
  mongodump --uri="$MONGODB_URI" --db="$DB" --archive="$file" --gzip --quiet
  local size; size="$(du -h "$file" | cut -f1)"
  echo "snapshot $file ($size)"
  # retention: keep newest $KEEP
  ls -1t "$SNAP_DIR"/*.gz 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
    echo "  pruning old snapshot $(basename "$old")"; rm -f "$old"
  done
}

cmd_list() {
  mkdir -p "$SNAP_DIR"
  if ! ls "$SNAP_DIR"/*.gz >/dev/null 2>&1; then echo "(no snapshots in $SNAP_DIR)"; return; fi
  echo "snapshots in $SNAP_DIR (newest first):"
  ls -1t "$SNAP_DIR"/*.gz | while read -r f; do printf "  %s  %s\n" "$(du -h "$f" | cut -f1)" "$(basename "$f")"; done
}

# restore an archive into a target URI (default: Atlas MONGODB_URI)
_restore_into() {
  local target="$1" archive="$2"
  [[ -f "$archive" ]] || { echo "archive not found: $archive" >&2; exit 1; }
  echo "→ restoring $(basename "$archive") → $target/$DB  (--drop)"
  mongorestore --uri="$target" --gzip --archive="$archive" \
    --nsInclude="${DB}.*" --drop --quiet
  echo "restore complete"
}

cmd_restore() {
  need_tools; require_uri
  local archive="${1:-$(latest_snapshot)}"
  [[ -n "$archive" ]] || { echo "no snapshot to restore (run 'dump' first)" >&2; exit 1; }
  _restore_into "$MONGODB_URI" "$archive"
}

# VENUE FAILOVER: bring up local mongod and restore the latest snapshot into it,
# so the hub can keep serving real historical data with Atlas/WiFi down.
cmd_restore_local() {
  need_tools
  local archive="${1:-$(latest_snapshot)}"
  [[ -n "$archive" ]] || { echo "no snapshot to restore (run 'dump' while Atlas is up)" >&2; exit 1; }
  echo "→ starting local mongod on :$LOCAL_PORT"
  "$LOCAL_MONGO" start
  _restore_into "$LOCAL_URI" "$archive"
  cat <<EOF

Failover DB is live locally. Point the hub at it and restart:

    export MONGODB_URI="$LOCAL_URI"
    # (in web/server/) node index.js

  When Atlas is back:  scripts/db-snapshot.sh restore   # push local → Atlas
  Stop local mongod:   $LOCAL_MONGO stop
EOF
}

cmd_auto() {
  local interval="${1:-300}"
  echo "→ auto-snapshot every ${interval}s (Ctrl-C to stop). Keeping newest $KEEP."
  while true; do cmd_dump || echo "  (dump failed - will retry)"; sleep "$interval"; done
}

# --- dispatch ---------------------------------------------------------------
load_env
case "${1:-}" in
  dump)          cmd_dump ;;
  list)          cmd_list ;;
  restore)       shift; cmd_restore "${1:-}" ;;
  restore-local) shift; cmd_restore_local "${1:-}" ;;
  auto)          shift; cmd_auto "${1:-}" ;;
  *) grep -E '^#( |$)' "$0" | sed -E 's/^# ?//'; exit 1 ;;
esac
