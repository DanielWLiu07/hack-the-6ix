#!/usr/bin/env bash
# Venue fallback: if Atlas is unreachable (hotel/venue WiFi), run Mongo locally
# on the laptop with one command and point the server at it:
#
#   ./local-mongo.sh start     # then set MONGODB_URI=mongodb://127.0.0.1:27777 in web/server/.env
#   ./local-mongo.sh stop
#
# Requires homebrew mongodb-community (already installed on the demo laptop).
set -euo pipefail

PORT=27777
DATA_DIR="${TMPDIR:-/tmp}/ht6-local-mongo"
LOG="$DATA_DIR/mongod.log"

ping_ok() { mongosh --port "$PORT" --quiet --eval 'db.runCommand({ping:1}).ok' >/dev/null 2>&1; }

case "${1:-}" in
  start)
    mkdir -p "$DATA_DIR"
    if ping_ok; then
      echo "already running on port $PORT"
    else
      # NB: mongod --fork is unsupported on macOS builds — nohup instead.
      nohup mongod --dbpath "$DATA_DIR" --port "$PORT" --bind_ip 127.0.0.1 \
        --logpath "$LOG" >/dev/null 2>&1 &
      for _ in $(seq 1 15); do ping_ok && break; sleep 1; done
      ping_ok || { echo "failed to start; see $LOG" >&2; exit 1; }
      echo "started on port $PORT (data: $DATA_DIR)"
    fi
    echo "MONGODB_URI=mongodb://127.0.0.1:$PORT"
    ;;
  stop)
    mongosh --port "$PORT" --quiet --eval 'db.getSiblingDB("admin").shutdownServer()' >/dev/null 2>&1 || true
    echo "stopped"
    ;;
  *)
    echo "usage: $0 start|stop" >&2
    exit 1
    ;;
esac
