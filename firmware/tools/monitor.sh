#!/usr/bin/env bash
# fw-tools: open a serial monitor on the MCU (115200 8N1 per BRIDGE.md §5).
#   ./monitor.sh                    # auto-detect port
#   PORT=/dev/cu.usbmodemX ./monitor.sh
set -euo pipefail

BAUD="${BAUD:-115200}"

if [ -z "${PORT:-}" ]; then
  if command -v arduino-cli >/dev/null 2>&1; then
    PORT="$(arduino-cli board list 2>/dev/null | awk '/usb/ {print $1; exit}' || true)"
  fi
  # fall back to first usb serial device (macOS then Linux naming)
  [ -n "${PORT:-}" ] || PORT="$(ls /dev/cu.usbmodem* /dev/cu.usbserial* /dev/ttyACM* /dev/ttyUSB* 2>/dev/null | head -1 || true)"
fi
[ -n "${PORT:-}" ] || { echo "[monitor] no serial device found — plug the board in or set PORT=..." >&2; exit 1; }

echo "[monitor] $PORT @ $BAUD (exit: ctrl-c / ctrl-a k / ctrl-])"
if command -v arduino-cli >/dev/null 2>&1; then
  exec arduino-cli monitor -p "$PORT" --config "baudrate=$BAUD"
elif python3 -c 'import serial' 2>/dev/null; then
  exec python3 -m serial.tools.miniterm "$PORT" "$BAUD"
else
  exec screen "$PORT" "$BAUD"
fi
