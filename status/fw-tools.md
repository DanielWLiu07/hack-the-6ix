# fw-tools status

## [22:10] DONE — firmware/BRIDGE.md: MCU↔Linux RPC contract published
7 calls (set_drive, move_servos, heartbeat, estop, clear_estop, get_status, zero_all), units, MCU safety state machine (OK/OBSTACLE/WATCHDOG/ESTOP), 5 Hz heartbeat / 500 ms watchdog, Linux-side timeout policy, plus a serial bench protocol (115200, single-letter cmds) that mirrors the RPC 1:1.
fw-mcu + fw-linux: build against §3 signatures; exact App Lab `Bridge.provide/call` identifiers need verifying on the real board (§4 note) — semantic contract is normative.
Next: arduino-cli setup + flash/monitor scripts in firmware/tools/.

## [22:25] DONE — firmware/tools/: arduino-cli toolchain + flash/monitor scripts, WORKING
setup.sh installed arduino-cli + core `arduino:zephyr` 0.56.0 — **UNO Q has a real desktop FQBN: `arduino:zephyr:unoq`**, scratch blink compiles clean. flash.sh (auto-FQBN/port, `--check` = compile-only), monitor.sh (115200). fw-mcu: run `tools/flash.sh --check` for compile feedback with no board.

## [22:28] DONE — BRIDGE.md §4 upgraded from "TBC" to VERIFIED: RPC lib is Arduino_RouterBridge
Read the shipped library (v0.4.3, installed by setup.sh): `Bridge.begin()`, `Bridge.provide_safe("name", fn)` (main-loop thread — use for motion state), plain `provide` for estop, `Bridge.call(...)`, MsgPack-RPC to an rpclib-compatible router on Linux. Wire sigs pinned: move_servos = 6 flat ints; get_status returns MsgPack::arr_t<int>[10]. fw-mcu + fw-linux: re-read BRIDGE.md §4 before writing bridge code. Linux-side Python import still TBC on first board contact (rpclib-compatible worst case).

## [22:30] DONE — bench.py + mock_mcu.py: serial bench client + mock MCU, selftest 18/18
`python3 tools/mock_mcu.py --selftest` spawns the mock (full §2 state machine: watchdog, estop latch, obstacle hysteresis, 20 ms interpolation) on a pty and runs bench.py's smoke suite against it — all green. mock_mcu.py is an EXECUTABLE SPEC for fw-mcu's bench mode; fw-linux can also point a serial transport at it pre-board. Design change caught by testing: bench mode boots watchdog-DISARMED, new `W <0|1>` serial cmd arms it (BRIDGE.md §5) — else human-paced typing lives in WATCHDOG and all motion cmds get ignored.
Next: firmware/PINOUT.md.

## [restart] DONE — recovered after crash; all 4 tasks verified on disk + toolchain repaired
Verified: BRIDGE.md, PINOUT.md, tools/{setup,flash,monitor}.sh, bench.py, mock_mcu.py all present. `mock_mcu.py --selftest` = 18/18 PASS + bench smoke PASS. PINOUT.md (task 4) complete.
Bug found + fixed while verifying (my ownership: the toolchain): `./tools/flash.sh --check` on fw-mcu's sketch FAILED — Arduino_RouterBridge lib was never actually installed (setup.sh's `|| warn` swallowed the original failure). Root cause: arduino-cli's default sketchbook `~/Documents/Arduino` is under macOS TCC; a stale partial `ArxContainer` dir there blocked every reinstall ("destination dir already exists" / "Operation not permitted"). Fix: pointed `directories.user` -> `~/.arduino-ht6`, reinstalled RouterBridge 0.4.3 + PCA9685. **fw-mcu sketch now compiles CLEAN: 14% flash / 16% RAM.** Baked the dir-redirect + a loud-fail RouterBridge install into setup.sh so a fresh `./tools/setup.sh` reproduces it.
@fw-mcu: your bench.cpp conforms to my serial spec (D/S/H/E/C/Q/Z/W/? incl. the `W <0|1>` watchdog-arm cmd) — nice. Run `./tools/flash.sh --check` for live compile feedback; it works now.
All assigned items complete; no phase-2 directive names fw-tools. Idle-available to assist fw-mcu/fw-linux on bridge conformance.

## [phase4] DONE — scripts/demo.sh (one-command bringup) + docs/INTEGRATION.md
**`scripts/demo.sh`** — ONE command boots the whole demo: hub(:3001) → robot node in mock (fw-linux `robot_node --sim --autostart`) → lidar sim → Vite dashboard(:5173) → :8123 orchard scene. Subcommands: `up` (default), `status`, `down`, `restart`, `logs <svc>`. Idempotent: each service skipped if already listening/running, and re-runs consult our own pidfile so client svcs (no port) don't stack. `down` stops only what demo.sh started (pre-existing procs marked `external` are left alone). Logs+pids in `/tmp/ht6-demo/`. Env: `SERVER_URL`, `HT6_ROBOT_SIM=1` (server sim.js robot fallback, auto-skips lidar), `HT6_SKIP`, `HT6_DEMO_DIR`.
**Verified live against the running fleet**: spawn path works (started robot_node+lidar, both registered with hub → robot count rose); `down` stopped exactly those two and left hub/web/scene; `status` reads reality; idempotent `up` now detects the fleet's sim.js (robot) + sim.py (lidar) + 3 ports and spawns **zero duplicates**. Fixed 2 bugs found by testing: (1) `local name=$1 pidf=...$name...` on one line → unbound under `set -u` (bash expands all `local` args before assigning); (2) path-based proc patterns missed relatively-launched fleet procs → broadened to `sim\.js`/`sim\.py`/`robot_linux\.robot_node`. Fleet left in its original pre-test state, no stray procs.
**`docs/INTEGRATION.md`** — first-power-on hardware runbook: wiring/rail audit → flash → per-subsystem bench tests in serial mode (servos zero-before-horns, ultrasonic reflex, watchdog, estop, drive polarity) citing BRIDGE.md §2/§5 states+cmds → Bridge integration → canned pick (P0) → rollback/panic (fall back to demo.sh mocks / HT6_ROBOT_SIM / server-core force-sim) → go/no-go smoke table.
Both deliverables' smoke-table commands verified this session. All fw-tools phase-4 work complete.

## [self-containment] DONE — demo.sh: orchard-scene path + fresh-clone dir guard
Per BROADCAST [self-containment]: updated `web/legacy-ui` → `web/orchard-scene` (both refs: header comment + scene step), and guarded the scene step with `[ -f "$ROOT/web/orchard-scene/serve.py" ]` — a fresh clone lacks that untracked folder, so demo.sh now **skips the scene cleanly** ("...dashboard uses its built-in hero") instead of `cd`-ing into a missing dir and failing. Matches web-frontend's graceful :8123-unreachable fallback.
Verified: `bash -n` clean; no residual `legacy-ui` in scripts/ or docs/; normal run detects real scene on :8123 (skip=already-running); fresh-clone sim (copied demo.sh into a ROOT with no web/orchard-scene) → scene step skipped gracefully. Fleet's live :8123 untouched.

## [cleanup] DONE — removed the :8123 scene step from demo.sh (landing now self-contained)
Per master: the dashboard's r3f hero is self-contained everywhere now, so demo.sh's optional orchard-scene step + its dir-guard are redundant — removed **entirely**. demo.sh now boots **4** pieces (hub, robot mock, lidar sim, web dashboard); every `scene`/`:8123`/`orchard` reference gone from the header, `cmd_up`, `summary`, `cmd_status`, `cmd_down` loop, and `logs` usage. Also scrubbed 2 stale `scene` mentions in docs/INTEGRATION.md (rollback line + smoke table) for consistency.
Verified: `bash -n` clean; `grep scene|8123|orchard scripts/demo.sh` = none; live `up` shows 4 svcs all skip→summary (no scene line); `status` = 4 svcs; fresh-clone dry run (copied demo.sh, empty ROOT) → exit 0, 0 scene mentions, reaches "Demo is up". The fleet's standalone :8123 serve.py is left running (web-frontend owns the landing) — demo.sh simply no longer manages it.
