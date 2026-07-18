#!/usr/bin/env bash
# Launch the FarmHand NL service. Called by scripts/demo.sh (ops rule: long-running
# services are started by demo.sh, detached + pidfile-managed, not a worker shell).
# Reads client/.env: FARMHAND_URL set -> trained Freesolo model; unset -> mock rules.
set -euo pipefail
cd "$(dirname "$0")"
exec .venv/bin/python service.py
