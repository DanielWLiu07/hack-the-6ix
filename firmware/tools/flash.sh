#!/usr/bin/env bash
# firmware/tools: compile (and if possible upload) the MCU sketch.
#
#   ./flash.sh                 # compile + upload firmware/mcu to auto-detected board
#   ./flash.sh --check         # compile only (no board needed) - CI-style sanity
#   PORT=/dev/cu.usbmodemX ARDUINO_FQBN=vendor:arch:board ./flash.sh
#
# If no desktop-flashable UNO Q core exists, use --check here and deploy the
# sketch on the board itself via Arduino App Lab (see README.md).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SKETCH="${SKETCH:-$HERE/../mcu}"
CHECK_ONLY=0
[ "${1:-}" = "--check" ] && CHECK_ONLY=1

say() { printf '\033[1;32m[flash]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[flash]\033[0m %s\n' "$*" >&2; exit 1; }

command -v arduino-cli >/dev/null 2>&1 || die "arduino-cli not found - run ./setup.sh first"
ls "$SKETCH"/*.ino >/dev/null 2>&1 || die "no .ino in $SKETCH (the MCU firmware not started yet?)"

# resolve FQBN
if [ -z "${ARDUINO_FQBN:-}" ]; then
  # 1) an attached board that identifies itself
  ARDUINO_FQBN="$(arduino-cli board list --format json 2>/dev/null \
    | python3 -c 'import json,sys
d=json.load(sys.stdin)
for p in d.get("detected_ports",[]):
    for b in p.get("matching_boards",[]):
        print(b.get("fqbn","")); break' 2>/dev/null | head -1 || true)"
fi
if [ -z "${ARDUINO_FQBN:-}" ]; then
  # 2) an installed UNO Q core
  ARDUINO_FQBN="$(arduino-cli board listall 2>/dev/null | grep -i -E 'uno[ _-]?q' | awk '{print $NF}' | head -1 || true)"
fi
if [ -z "${ARDUINO_FQBN:-}" ]; then
  # 3) STM32U585 compile-check target (same MCU family as the UNO Q's M33)
  ARDUINO_FQBN="STMicroelectronics:stm32:GenU5"
  EXTRA_FLAGS="--build-property build.board=GENERIC_U585ZITXQ"
  say "no UNO Q board/core - compile-checking against generic STM32U585"
  CHECK_ONLY=1
fi
say "FQBN: $ARDUINO_FQBN"

# compile
arduino-cli compile --fqbn "$ARDUINO_FQBN" ${EXTRA_FLAGS:-} "$SKETCH" || die "compile failed"
say "compile OK"
[ "$CHECK_ONLY" = 1 ] && { say "check-only mode - not uploading"; exit 0; }

# upload
if [ -z "${PORT:-}" ]; then
  PORT="$(arduino-cli board list 2>/dev/null | awk '/usb/ {print $1; exit}' || true)"
fi
[ -n "${PORT:-}" ] || die "no serial port found - set PORT=... or deploy via App Lab"
say "uploading to $PORT"
arduino-cli upload --fqbn "$ARDUINO_FQBN" -p "$PORT" "$SKETCH"
say "flashed."
