#!/usr/bin/env bash
# slam_demo.sh - watch the on-device SLAM work live, no hardware needed.
#
# Boots the synthetic lidar (sim.py) and the on-device SLAM node
# (../pi/slam/node.py) against the local hub, and renders a live-updating
# occupancy map you can open. Same code path the real RPLIDAR C1 will feed later
# (the SLAM consumes lidar_scan events - it does not care if they come from the
# sim or the physical lidar).
#
# Usage:
#   ./slam_demo.sh                 # uses hub at http://localhost:3001
#   SERVER_URL=http://host:3001 ./slam_demo.sh
#   ./slam_demo.sh --duration 60   # extra args pass through to node.py
#
# Requirements: the web hub must be running (web/server: npm start). The sim and
# SLAM venvs are auto-created on first run.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
SIM_DIR="$HERE"
SLAM_DIR="$HERE/../pi/slam"
PI_VENV="$HERE/../pi/.venv/bin/python"
SIM_VENV="$HERE/.venv/bin/python"
: "${SERVER_URL:=http://localhost:3001}"
export SERVER_URL
MAP_OUT="$SLAM_DIR/slam_map.png"

echo "[slam_demo] hub: $SERVER_URL"
echo "[slam_demo] live map will render to: $MAP_OUT"

# 1. Start the synthetic lidar in the background if nothing is emitting one.
SIM_PID=""
if ! curl -s "$SERVER_URL/api/health" 2>/dev/null | grep -q '"robot_connected":true'; then
  echo "[slam_demo] starting sim.py (synthetic lidar)..."
  ( cd "$SIM_DIR" && "$SIM_VENV" sim.py ) &
  SIM_PID=$!
  sleep 2
else
  echo "[slam_demo] a robot/lidar source is already feeding the hub - reusing it."
fi

cleanup() { [ -n "$SIM_PID" ] && kill "$SIM_PID" 2>/dev/null; echo "[slam_demo] stopped"; }
trap cleanup INT TERM EXIT

# 2. Run the on-device SLAM node in the foreground. Renders the map every few
#    scans so you can watch the room fill in (open $MAP_OUT; re-open to refresh).
echo "[slam_demo] running SLAM node - watch pose/ms-per-scan below; open the map:"
echo "            open '$MAP_OUT'"
cd "$SLAM_DIR"
exec "$PI_VENV" node.py --server "$SERVER_URL" --map-out "$MAP_OUT" --map-every 4 "$@"
