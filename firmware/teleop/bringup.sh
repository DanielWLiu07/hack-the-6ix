#!/usr/bin/env bash
# bringup.sh - deploy the teleop app to the Uno Q and start it.
#
# Run from the laptop. Syncs this folder to ~/ArduinoApps/teleop on the board,
# then compiles+flashes the MCU sketch, installs the web_ui brick, and starts
# the node. Re-run any time you edit a file here.
#
#   ./bringup.sh              # deploy + start, then tail logs
#   UNOQ=uno-q ./bringup.sh   # target by hostname instead of tailscale IP
#   ./bringup.sh --no-logs    # deploy + start, don't tail
#
# First run compiles the sketch (~2 min) and reflashes the STM32. Editing only
# python/ or assets/ still reflashes on restart - that's App Lab, not us.
set -euo pipefail

UNOQ="${UNOQ:-100.111.103.46}"        # tailscale uno-q; override with env
USER_="${UNOQ_USER:-arduino}"
APP="ArduinoApps/teleop"              # relative to the board user's home
HERE="$(cd "$(dirname "$0")" && pwd)"
SSH=(ssh -o ConnectTimeout=8 "${USER_}@${UNOQ}")

echo ">> target: ${USER_}@${UNOQ}:~/${APP}"

# 1. make sure the app exists on the board (scaffolds sketch/ + registers it).
"${SSH[@]}" "test -d ~/${APP} || arduino-app-cli app new teleop >/dev/null 2>&1 || true; mkdir -p ~/${APP}/python ~/${APP}/assets ~/${APP}/sketch"

# 2. sync our sources via tar-over-ssh (no rsync needed on either end).
tar -C "${HERE}" -cf - \
    app.yaml requirements.txt \
    python/main.py \
    assets/index.html assets/socket.io.min.js \
    sketch/sketch.ino sketch/sketch.yaml \
  | "${SSH[@]}" "tar -C ~/${APP} -xf -"

# 3. stop any other running app (the board shares one MCU -> one app at a time).
"${SSH[@]}" 'for d in ~/ArduinoApps/*/; do
    [ "$(basename "$d")" = teleop ] && continue
    arduino-app-cli app stop "$d" >/dev/null 2>&1 || true
  done'

# 4. start (compiles+flashes MCU, installs deps, runs the node).
echo ">> restarting app (first run compiles the sketch, ~2 min)…"
"${SSH[@]}" "arduino-app-cli app restart ~/${APP}"

# 4. where to drive from.
IP="$("${SSH[@]}" "hostname -I 2>/dev/null | awk '{print \$1}'" || true)"
echo
echo ">> teleop page:"
echo "     http://${UNOQ}:7000        (tailscale)"
[ -n "${IP:-}" ] && echo "     http://${IP}:7000   (same-LAN)"
echo "   Open it in a browser with the controller plugged into that computer."
echo

if [ "${1:-}" != "--no-logs" ]; then
  echo ">> logs (Ctrl-C to stop tailing; app keeps running):"
  "${SSH[@]}" "arduino-app-cli app logs ~/${APP}"
fi
