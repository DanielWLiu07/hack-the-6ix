#!/usr/bin/env bash
# firmware/tools: install + configure arduino-cli for the UNO Q STM32 side.
# Safe to re-run (idempotent). macOS + Linux.
set -euo pipefail

say() { printf '\033[1;32m[setup]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[setup]\033[0m %s\n' "$*"; }

# 1. arduino-cli
if ! command -v arduino-cli >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    say "installing arduino-cli via homebrew..."
    brew install arduino-cli
  else
    say "installing arduino-cli via official script into ~/.local/bin ..."
    mkdir -p "$HOME/.local/bin"
    curl -fsSL https://raw.githubusercontent.com/arduino/arduino-cli/master/install.sh \
      | BINDIR="$HOME/.local/bin" sh
    export PATH="$HOME/.local/bin:$PATH"
    warn 'add ~/.local/bin to your PATH if it is not already'
  fi
fi
say "arduino-cli: $(arduino-cli version)"

arduino-cli config init --overwrite >/dev/null 2>&1 || true

# Move the sketchbook/libraries dir OUT of ~/Documents. On macOS that path is
# under TCC (privacy) protection: `arduino-cli lib install` can leave a stale
# partial dependency dir there that then blocks every later install with
# "destination dir ... already exists", and a plain `ls` returns "Operation
# not permitted". A repo-neutral dir under $HOME sidesteps both. (flash.sh /
# monitor.sh read the same global config, so they pick this up automatically.)
ARDUINO_USER_DIR="${ARDUINO_USER_DIR:-$HOME/.arduino-ht6}"
say "setting arduino-cli user dir -> ${ARDUINO_USER_DIR} (avoids ~/Documents TCC block)"
arduino-cli config set directories.user "${ARDUINO_USER_DIR}"

# STM32duino board index - fallback target for compile-checking the sketch
# when no UNO Q core / board is available on this machine.
arduino-cli config set board_manager.additional_urls \
  https://github.com/stm32duino/BoardManagerFiles/raw/main/package_stmicroelectronics_index.json

say "updating board index..."
arduino-cli core update-index

# 2. UNO Q core (if Arduino publishes one for desktop CLI)
say "searching for an UNO Q core..."
UNOQ_CORE="$(arduino-cli core search 2>/dev/null | grep -i -E 'uno[ _-]?q|qualcomm' | awk '{print $1}' | head -1 || true)"
if [ -n "${UNOQ_CORE}" ]; then
  say "found core '${UNOQ_CORE}' - installing"
  arduino-cli core install "${UNOQ_CORE}"
else
  warn "no UNO Q core in the index. That's expected: UNO Q sketches normally"
  warn "deploy via Arduino App Lab (see README.md). Installing STM32duino core"
  warn "so we can at least COMPILE-CHECK firmware/mcu on this laptop."
  arduino-cli core install STMicroelectronics:stm32 || warn "STM32 core install failed - compile checks unavailable"
fi

# 3. libraries the MCU firmware needs
say "installing sketch libraries..."
arduino-cli lib install "Adafruit PWM Servo Driver Library" || warn "PCA9685 lib install failed"
# MCU<->Linux RPC library for the UNO Q (see ../BRIDGE.md §4). This one is
# NOT optional: the UNO Q core's variant.h #errors out without it (no Serial),
# so a silent failure here breaks EVERY compile. Fail loud.
if ! arduino-cli lib install Arduino_RouterBridge; then
  warn "Arduino_RouterBridge install FAILED - firmware/mcu will not compile."
  warn "If the error is 'destination dir ... already exists', a stale partial"
  warn "install is in the OLD user dir; this script now uses ${ARDUINO_USER_DIR}."
  exit 1
fi

say "done. next: ./flash.sh (or see README.md for App Lab deploy path)"
arduino-cli board list || true
