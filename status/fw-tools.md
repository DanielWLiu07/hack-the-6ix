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
