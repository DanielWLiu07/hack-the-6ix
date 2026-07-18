#!/usr/bin/env bash
# Deploy the vision pipeline onto the Arduino UNO Q Linux (MPU) side.
#
# The UNO Q runs a Debian-based aarch64 Linux on its MPU. This script sets up a
# self-contained venv, installs the pinned deps, verifies the detector, records
# on-device bench numbers (for the Qualcomm track writeup), and can launch the
# MJPEG pipeline. Everything runs ON the board - no cloud inference.
#
# Usage (on the UNO Q, from the repo's robot/vision dir):
#   ./deploy_unoq.sh setup     # create venv + install deps
#   ./deploy_unoq.sh verify    # run detector eval + schema check
#   ./deploy_unoq.sh bench     # on-device FPS numbers -> bench_unoq.txt
#   ./deploy_unoq.sh run       # start the MJPEG pipeline on :8080
#   ./deploy_unoq.sh all       # setup + verify + bench
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"
VENV="$HERE/.venv"
PY="$VENV/bin/python"

log() { printf '\033[1;36m[deploy_unoq]\033[0m %s\n' "$*"; }

setup() {
  log "arch: $(uname -m)  host: $(uname -n)"
  if [[ "$(uname -m)" != "aarch64" && "$(uname -m)" != "arm64" ]]; then
    log "WARNING: not on ARM ($(uname -m)) - this script targets the UNO Q MPU."
  fi
  command -v python3 >/dev/null || { log "python3 not found"; exit 1; }
  [[ -d "$VENV" ]] || python3 -m venv "$VENV"
  log "installing pinned deps (opencv-headless + onnxruntime)…"
  "$PY" -m pip install --upgrade pip -q
  "$PY" -m pip install -q -r requirements.txt
  log "deps installed. $("$PY" -c 'import cv2,numpy; print("cv2",cv2.__version__,"numpy",numpy.__version__)')"
}

verify() {
  log "detector eval (synthetic ground truth, schema check)…"
  "$PY" test_detector.py --frames 200
}

bench() {
  local out="$HERE/bench_unoq.txt"
  log "on-device bench - quoting these in docs/QUALCOMM.md"
  {
    echo "# UNO Q on-device bench  ($(date -u +%FT%TZ))  arch=$(uname -m)"
    for size in 640x480 320x320 320x240; do
      "$PY" bench.py --detector auto --frames 300 --size "$size" | grep '^BENCH'
    done
  } | tee "$out"
  log "wrote $out - paste the BENCH lines into docs/QUALCOMM.md"
}

run() {
  log "starting MJPEG pipeline on :${PORT:-8080} (Ctrl-C to stop)"
  exec "$PY" pipeline.py --source "${SOURCE:-camera}"
}

case "${1:-all}" in
  setup)  setup ;;
  verify) verify ;;
  bench)  bench ;;
  run)    run ;;
  all)    setup; verify; bench ;;
  *) echo "usage: $0 {setup|verify|bench|run|all}"; exit 2 ;;
esac
