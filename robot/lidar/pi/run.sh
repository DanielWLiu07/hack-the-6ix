#!/usr/bin/env bash
# Lidar node launcher with auto-restart. Safe to run under systemd, tmux,
# or bare on the Pi. Ctrl-C stops the loop cleanly.
#
#   SERVER_URL=http://<laptop-ip>:3001 ./run.sh
set -u

cd "$(dirname "$0")"

VENV=".venv"
if [ ! -d "$VENV" ]; then
    echo "[run.sh] creating venv + installing deps (first run)..."
    python3 -m venv "$VENV"
    "$VENV/bin/pip" install --quiet --upgrade pip
    "$VENV/bin/pip" install --quiet -r requirements.txt
fi

: "${SERVER_URL:=http://localhost:3001}"
export SERVER_URL

echo "[run.sh] lidar node → $SERVER_URL (Ctrl-C to stop)"

STOP=0
trap 'STOP=1' INT TERM

while [ "$STOP" -eq 0 ]; do
    "$VENV/bin/python" -m lidar_node.main
    CODE=$?
    [ "$STOP" -eq 1 ] && break
    case "$CODE" in
        0) echo "[run.sh] clean exit"; break ;;
        2) echo "[run.sh] NO_DEVICE — retrying in 5s (plug in the lidar?)"; sleep 5 ;;
        3) echo "[run.sh] server unreachable — retrying in 5s"; sleep 5 ;;
        *) echo "[run.sh] crashed (exit $CODE) — restarting in 3s"; sleep 3 ;;
    esac
done
echo "[run.sh] stopped"
