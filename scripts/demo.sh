#!/usr/bin/env bash
# demo.sh - ONE command to boot the whole "Battery, not Blood" demo stack.
# (owner: fw-tools - phase-4 demo readiness)
#
#   scripts/demo.sh            bring the whole stack up (idempotent - safe to re-run)
#   scripts/demo.sh up         ... same as no arg
#   scripts/demo.sh status     what's up / down right now (reads reality, not pidfiles)
#   scripts/demo.sh down       stop everything demo.sh started (leaves pre-existing procs)
#   scripts/demo.sh restart    down, then up
#   scripts/demo.sh logs <svc> tail a service log (svc = hub|robot|lidar|web)
#
# Boots 4 pieces, IN ORDER, each skipped if already listening/running:
#   1. hub    web/server        Socket.IO + REST relay hub          :3001
#   2. robot  firmware/linux    robot node, MOCK mode (real SEEK->PICK->SORT state machine)
#   3. lidar  robot/lidar/sim   synthetic 360deg lidar_scan source  (Socket.IO client)
#   4. web    web/              Vite dashboard dev server (self-contained r3f hero)  :5173
#
# Env overrides:
#   SERVER_URL       hub URL robot+lidar dial (default http://localhost:3001)
#   HT6_ROBOT_SIM=1  use server-core's built-in sim.js as the robot instead of the
#                    fw-linux node (sim.js also emits lidar_scan -> lidar sim auto-skipped).
#                    Demo panic fallback if the Python robot venv is unhappy.
#   HT6_SKIP="..."   space-separated svc names to NOT start (e.g. "web lidar")
#   HT6_DEMO_DIR     where logs + pidfiles live (default /tmp/ht6-demo)
#   HT6_SANITY_WAIT  seconds to pause after each spawn to catch instant death (default 1)
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_URL="${SERVER_URL:-http://localhost:3001}"
DEMO_DIR="${HT6_DEMO_DIR:-/tmp/ht6-demo}"
SANITY_WAIT="${HT6_SANITY_WAIT:-1}"
SKIP=" ${HT6_SKIP:-} "
mkdir -p "$DEMO_DIR"

# pretty printing
c()   { printf '\033[%sm' "$1"; }
ok()   { printf '  %sOK  %s %s\n' "$(c 32)" "$(c 0)" "$1"; }
skip() { printf '  %s--  %s %s\n' "$(c 33)" "$(c 0)" "$1"; }
bad()  { printf '  %sXX  %s %s\n' "$(c 31)" "$(c 0)" "$1"; }
hdr()  { printf '\n%s== %s ==%s\n' "$(c 1)" "$1" "$(c 0)"; }

# liveness probes
port_up() {  # is something LISTENing on TCP port $1 ?
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$1" -sTCP:LISTEN -P -n >/dev/null 2>&1
  elif command -v nc >/dev/null 2>&1; then
    nc -z 127.0.0.1 "$1" >/dev/null 2>&1
  else
    curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$1"
  fi
}
proc_up()  { pgrep -f "$1" >/dev/null 2>&1; }        # a matching process is alive?
skipped()  { case "$SKIP" in *" $1 "*) return 0 ;; *) return 1 ;; esac; }

# ensure_node_deps <dir> <label>: npm install if node_modules is missing.
# A fresh clone has no node_modules (gitignored), so the "one command" promise
# needs this. Set HT6_NO_INSTALL=1 to skip (CI that pre-installs).
ensure_node_deps() {
  local dir=$1 label=$2
  [ "${HT6_NO_INSTALL:-0}" = 1 ] && return 0
  [ -d "$dir/node_modules" ] && return 0
  [ -f "$dir/package.json" ] || return 0
  command -v npm >/dev/null 2>&1 || { bad "$label: npm not found - install Node 18+"; return 1; }
  skip "$label: node_modules missing, running npm install (first run, may take a minute)"
  if ( cd "$dir" && npm install ) >>"$DEMO_DIR/npm-install-$label.log" 2>&1; then
    ok "$label: npm install done"
  else
    bad "$label: npm install FAILED - see $DEMO_DIR/npm-install-$label.log"
    return 1
  fi
}
have_venv() { [ -x "$1/.venv/bin/python" ]; }

# ensure_venv <dir> <label>: create <dir>/.venv and pip install its
# requirements.txt if the venv is missing. Used for light python services
# (e.g. the FarmHand NL responder) so a fresh clone still gets them.
ensure_venv() {
  local dir=$1 label=$2
  have_venv "$dir" && return 0
  [ "${HT6_NO_INSTALL:-0}" = 1 ] && return 1
  [ -f "$dir/requirements.txt" ] || return 1
  command -v python3 >/dev/null 2>&1 || { bad "$label: python3 not found"; return 1; }
  skip "$label: .venv missing, creating it + pip install (first run)"
  if ( cd "$dir" && python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt ) \
       >>"$DEMO_DIR/venv-$label.log" 2>&1; then
    ok "$label: venv ready"
  else
    bad "$label: venv bootstrap FAILED - see $DEMO_DIR/venv-$label.log"
    return 1
  fi
}

# generic service launcher
# start NAME CHECKSPEC WORKDIR -- CMD...
#   CHECKSPEC = "port:3001"  (skip if that port is listening)
#             | "proc:regex" (skip if a process matching regex is running)
start() {
  local name=$1 spec=$2 wd=$3; shift 3; [ "${1:-}" = "--" ] && shift
  local pidf="$DEMO_DIR/$name.pid" log="$DEMO_DIR/$name.log"
  local kind=${spec%%:*} val=${spec#*:}

  if skipped "$name"; then skip "$name skipped (HT6_SKIP)"; return 0; fi

  # Idempotent for OUR OWN launches: if a prior demo.sh run started this and the
  # pid is still alive, don't stack a second one (client svcs have no port to probe).
  if [ -f "$pidf" ]; then
    local prev; prev="$(cat "$pidf")"
    if [ "$prev" != external ] && kill -0 "$prev" 2>/dev/null; then
      skip "$name already running (started by demo.sh, pid $prev)"
      return 0
    fi
  fi

  if { [ "$kind" = port ] && port_up "$val"; } || { [ "$kind" = proc ] && proc_up "$val"; }; then
    echo external > "$pidf"                 # marker: we did NOT start it -> down leaves it
    skip "$name already running - leaving it as-is"
    return 0
  fi

  : > "$log"
  ( cd "$wd" && exec "$@" ) >>"$log" 2>&1 &
  local pid=$!
  echo "$pid" > "$pidf"
  [ "$SANITY_WAIT" = 0 ] || sleep "$SANITY_WAIT"
  if kill -0 "$pid" 2>/dev/null; then
    ok "$name started (pid $pid) -> $log"
  else
    bad "$name FAILED to start - last log lines:"
    tail -n 8 "$log" 2>/dev/null | sed 's/^/         /'
    return 1
  fi
}

wait_hub() {  # block until the hub answers /api/health (up to ~10s)
  local n=0
  until curl -s -o /dev/null --max-time 1 "$SERVER_URL/api/health"; do
    n=$((n + 1))
    if [ "$n" -ge 20 ]; then bad "hub never became healthy at $SERVER_URL"; return 1; fi
    sleep 0.5
  done
  return 0
}

# subcommands
cmd_up() {
  hdr "HT6 demo bring-up  (hub=$SERVER_URL)"

  port_up 3001 || ensure_node_deps "$ROOT/web/server" hub
  start hub port:3001 "$ROOT/web/server" -- node index.js || true
  wait_hub || { bad "aborting - the hub is the spine; nothing else works without it"; exit 1; }

  # FarmHand NL service (llm-client): answers nl_command via the trained Freesolo
  # model (ml/freesolo-agent/client/.env FARMHAND_URL) or built-in rules if unset,
  # with graceful fallback. Needs only the hub. Without it the NL box has no responder.
  if have_venv "$ROOT/ml/freesolo-agent/client"; then
    start farmhand proc:"freesolo-agent/client/service\.py" "$ROOT/ml/freesolo-agent/client" -- \
      .venv/bin/python -u "$ROOT/ml/freesolo-agent/client/service.py"
  else
    skip "farmhand: ml/freesolo-agent/client/.venv absent, NL command box will have no responder"
  fi

  # Robot: prefer the real fw-linux node when its venv exists; otherwise (fresh
  # clone, or HT6_ROBOT_SIM=1) use server-core's built-in sim.js robot, which
  # needs no python and also emits lidar_scan. The proc pattern matches either
  # source so we never stack two robots onto one dashboard.
  local use_sim_robot=0
  [ "${HT6_ROBOT_SIM:-0}" = 1 ] && use_sim_robot=1
  if ! have_venv "$ROOT/firmware/linux"; then
    use_sim_robot=1
    [ "${HT6_ROBOT_SIM:-0}" = 1 ] || skip "robot: firmware/linux/.venv absent (fresh clone), using built-in sim.js robot"
  fi

  if [ "$use_sim_robot" = 1 ]; then
    start robot proc:"robot_linux\.robot_node|sim\.js" "$ROOT/web/server" -- node "$ROOT/web/server/sim.js"
    skip "lidar: sim.js already emits lidar_scan, python lidar sim not needed"
  else
    start robot proc:"robot_linux\.robot_node|sim\.js" "$ROOT/firmware/linux" -- \
      .venv/bin/python -u -m robot_linux.robot_node --sim --autostart --server "$SERVER_URL"
    # `sim\.py` is the lidar sim (only one in the repo), matched whether launched
    # by absolute path (us) or relative path (the tmux fleet pane).
    if have_venv "$ROOT/robot/lidar/sim"; then
      start lidar proc:"sim\.py" "$ROOT/robot/lidar/sim" -- \
        ./.venv/bin/python -u "$ROOT/robot/lidar/sim/sim.py" --server "$SERVER_URL"
    else
      skip "lidar: robot/lidar/sim/.venv absent, skipping python lidar sim"
    fi
  fi

  port_up 5173 || ensure_node_deps "$ROOT/web" web
  start web   port:5173 "$ROOT/web"            -- npm run dev

  summary
}

summary() {
  hdr "Demo is up"
  printf '  %-13s %s\n' "Dashboard"  "http://localhost:5173"
  printf '  %-13s %s\n' "Hub health" "$SERVER_URL/api/health"
  printf '  %-13s %s\n' "Stats API"  "$SERVER_URL/api/stats"
  printf '  %-13s %s\n' "Logs"       "$DEMO_DIR/<svc>.log   (svc: hub robot lidar web)"
  printf '  %-13s %s\n' "Stop all"   "scripts/demo.sh down"
  echo
  echo "  Open the dashboard, then drive/pick from the Teleop page or watch the"
  echo "  mock robot auto-run SEEK->PICK->SORT with live lidar in the 3D view."
}

cmd_status() {
  hdr "HT6 demo status"
  if port_up 3001; then
    ok "hub    :3001 LISTENING"
    curl -s --max-time 2 "$SERVER_URL/api/health" \
      | sed 's/^/         health: /' 2>/dev/null || true
  else bad "hub    :3001 down"; fi

  proc_up "robot_linux\.robot_node" && ok "robot  fw-linux node (mock) running" \
    || { proc_up "sim\.js" && ok "robot  server sim.js running" || bad "robot  not running"; }
  if proc_up "sim\.py"; then ok "lidar  python sim running"
  elif proc_up "sim\.js"; then ok "lidar  via sim.js (built-in emitter)"
  else bad "lidar  not running"; fi
  port_up 5173 && ok "web    :5173 LISTENING (dashboard)" || bad "web    :5173 down"
}

stop_svc() {
  local name=$1
  local pidf="$DEMO_DIR/$name.pid"
  [ -f "$pidf" ] || { skip "$name: nothing recorded"; return; }
  local pid; pid="$(cat "$pidf")"
  rm -f "$pidf"
  if [ "$pid" = external ]; then
    skip "$name: was already running before demo.sh - leaving it"
    return
  fi
  if kill -0 "$pid" 2>/dev/null; then
    pkill -P "$pid" 2>/dev/null || true   # reap children (e.g. vite under npm)
    kill "$pid" 2>/dev/null || true
    ok "$name stopped (pid $pid)"
  else
    skip "$name: pid $pid already gone"
  fi
}

cmd_down() {
  hdr "HT6 demo shutdown"
  for s in web lidar robot farmhand hub; do stop_svc "$s"; done
}

cmd_logs() {
  local svc="${1:-}"
  case "$svc" in
    hub|robot|lidar|web|farmhand) exec tail -n 40 -f "$DEMO_DIR/$svc.log" ;;
    *) echo "usage: demo.sh logs <hub|robot|lidar|web|farmhand>"; exit 2 ;;
  esac
}

# dispatch
case "${1:-up}" in
  up|"")   cmd_up ;;
  status)  cmd_status ;;
  down|stop) cmd_down ;;
  restart) cmd_down; cmd_up ;;
  logs)    shift; cmd_logs "$@" ;;
  *) echo "usage: demo.sh [up|down|status|restart|logs <svc>]"; exit 2 ;;
esac
