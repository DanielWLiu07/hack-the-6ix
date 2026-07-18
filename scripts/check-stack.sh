#!/usr/bin/env bash
# check-stack.sh — one-shot health check of the web stack. (owner: server-test)
#
#   ./scripts/check-stack.sh            # checks localhost defaults
#   SERVER_URL=http://192.168.1.5:3001 ./scripts/check-stack.sh
#
# Checks: hub port up → socket.io handshake → sim emitting telemetry →
# REST endpoints → /stream → (informational) Vite dev server.
# Exit 0 = all required checks pass. Nonzero = something's broken.

set -u
SERVER_URL="${SERVER_URL:-http://localhost:3001}"
VITE_URL="${VITE_URL:-http://localhost:5173}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TESTDIR="$ROOT/web/server/test"

PASS=0; FAIL=0; WARN=0
ok()   { printf '  \033[32mPASS\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31mFAIL\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }
warn() { printf '  \033[33mWARN\033[0m %s\n' "$1"; WARN=$((WARN+1)); }

echo "== check-stack: $SERVER_URL =="

# 1. TCP/HTTP reachability of the hub
if curl -s -o /dev/null --max-time 3 "$SERVER_URL/socket.io/?EIO=4&transport=polling"; then
  ok "hub reachable (socket.io endpoint answers)"
else
  bad "hub NOT reachable at $SERVER_URL — is web/server running on 3001?"
  echo "== RESULT: FAIL ($FAIL failure) — nothing else can pass without the hub =="
  exit 1
fi

# 2. Socket connect + sim telemetry within 5s (needs socket.io-client from test pkg)
if [ -d "$TESTDIR/node_modules/socket.io-client" ]; then
  SOCK_OUT=$(cd "$TESTDIR" && SERVER_URL="$SERVER_URL" node --input-type=module -e '
    import { connect, connected, waitFor } from "./helpers.js";
    import { validateTelemetry } from "./schemas.js";
    const s = connect("checkstack");
    try {
      await connected(s, 4000);
      const t = await waitFor(s, "telemetry", 5000);
      const errs = validateTelemetry(t);
      if (errs.length) { console.log("SCHEMA_FAIL " + errs.join("; ")); }
      else { console.log("TELEMETRY_OK state=" + t.state + " battery=" + t.battery_v); }
    } catch (e) { console.log("SOCK_FAIL " + e.message); }
    finally { s.close(); }
  ' 2>&1)
  case "$SOCK_OUT" in
    TELEMETRY_OK*) ok "sim emitting telemetry (${SOCK_OUT#TELEMETRY_OK }) and payload passes schema" ;;
    SCHEMA_FAIL*)  bad "telemetry arrives but FAILS schema: ${SOCK_OUT#SCHEMA_FAIL }" ;;
    SOCK_FAIL*)    bad "socket.io connect/telemetry failed: ${SOCK_OUT#SOCK_FAIL }" ;;
    *)             bad "socket check errored: $SOCK_OUT" ;;
  esac
else
  warn "socket.io-client not installed — run: cd web/server/test && npm install (skipping live telemetry check)"
fi

# 3. REST endpoints
for EP in /api/stats /api/picks; do
  CODE=$(curl -s -o /tmp/check-stack-body.$$ -w '%{http_code}' --max-time 3 "$SERVER_URL$EP")
  if [ "$CODE" = "200" ]; then
    if node -e "JSON.parse(require('fs').readFileSync('/tmp/check-stack-body.$$','utf8'))" 2>/dev/null; then
      ok "GET $EP → 200, valid JSON"
    else
      bad "GET $EP → 200 but body is not valid JSON"
    fi
  else
    bad "GET $EP → HTTP $CODE (expected 200)"
  fi
  rm -f /tmp/check-stack-body.$$
done

# 4. MJPEG /stream (test pattern until robot exists). Just needs to answer.
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 -r 0-1024 "$SERVER_URL/stream" || true)
if [ "$CODE" = "200" ] || [ "$CODE" = "206" ]; then
  ok "/stream answers (HTTP $CODE)"
else
  warn "/stream → HTTP ${CODE:-none} (P1 for demo; test pattern expected even without robot)"
fi

# 4b. Informational: /api/health surfaces the phase-2 wiring (agent + Base44).
CODE=$(curl -s -o /tmp/check-stack-health.$$ -w '%{http_code}' --max-time 3 "$SERVER_URL/api/health")
if [ "$CODE" = "200" ]; then
  HEALTH=$(cat /tmp/check-stack-health.$$)
  case "$HEALTH" in
    *'"agent":0'*) warn "no FarmHand agent connected (nl_command→nl_action will get no reply until llm-client's service.py runs)" ;;
    *'"agent":'*)  ok "FarmHand agent connected (NL command path live)" ;;
  esac
  case "$HEALTH" in
    *'"base44_forwarding":true'*)  ok "Base44 pick_event forwarding ON (Orchard OS webhook wired)" ;;
    *'"base44_forwarding":false'*) warn "Base44 forwarding off (set BASE44_WEBHOOK_URL to enable the Orchard OS demo)" ;;
  esac
fi
rm -f /tmp/check-stack-health.$$

# 5. Informational: frontend dev server
if curl -s -o /dev/null --max-time 2 "$VITE_URL"; then
  ok "vite dev server up at $VITE_URL"
else
  warn "vite dev server not reachable at $VITE_URL (informational)"
fi

echo "== RESULT: $PASS pass, $FAIL fail, $WARN warn =="
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
