#!/usr/bin/env bash
# run_slam.sh - launch the on-device SLAM node with crash/disconnect auto-restart.
# Mirrors the C1 reader's run.sh. Env: SERVER_URL (default http://localhost:3001).
#   SERVER_URL=http://<laptop>:3001 ./run_slam.sh [--map-every 0 ...extra node.py args]
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
VENV="$HERE/.venv"
PY="$VENV/bin/python"

if [ ! -x "$PY" ]; then
  echo "[run_slam] creating venv..."
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q --upgrade pip
  "$VENV/bin/pip" install -q -r "$HERE/requirements.txt"
fi

: "${SERVER_URL:=http://localhost:3001}"
export SERVER_URL
BACKOFF=1
echo "[run_slam] SERVER_URL=$SERVER_URL"
while true; do
  "$PY" "$HERE/node.py" "$@"
  code=$?
  echo "[run_slam] node.py exited ($code) - restarting in ${BACKOFF}s"
  sleep "$BACKOFF"
  BACKOFF=$(( BACKOFF < 10 ? BACKOFF + 1 : 10 ))
done
