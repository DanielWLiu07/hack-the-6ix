#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
FQBN=esp32:esp32:esp32c3:CDCOnBoot=cdc
PORT="${1:-/dev/ttyACM0}"
arduino-cli compile --fqbn "$FQBN" .
arduino-cli upload --fqbn "$FQBN" -p "$PORT" .
echo "flashed. port: $PORT"
