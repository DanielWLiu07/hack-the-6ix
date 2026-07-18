## [22:05] WIP — fw-mcu started: sketch skeleton (drive/servos/sonar/watchdog/bench/bridge)
No firmware/BRIDGE.md from fw-tools yet — implementing RPC surface set_drive/move_servos/heartbeat/estop per ASSIGNMENTS and will align when their doc lands. arduino-cli not installed; will host-syntax-check with stub headers, real compile deferred to fw-tools flash.sh.

## [RESTART] WIP — recovered after crash; full sketch intact, hostcheck ALL CLEAN
Verified on-disk state: 9 source files + hostcheck.sh, all pass `./hostcheck.sh` (g++ -fsyntax-only). Single-impl rpc_handlers.* behind both transports (bench serial + Arduino_RouterBridge) conforms to BRIDGE.md §3 semantics; bench protocol matches §5 exactly (incl. W arm/disarm). No long-running processes to restart (firmware = compile-only, no board). Found 2 conformance gaps vs docs published AFTER my last edit — fixing now: (1) config.h pins didn't match fw-tools PINOUT.md; (2) bridge_rpc.cpp predated BRIDGE.md §4 VERIFIED (needs provide_safe + MsgPack::arr_t return). Then writing firmware/mcu/README.md (task 4).

## [RESTART+] DONE — aligned to PINOUT.md + BRIDGE.md §4, wrote README; hostcheck ALL CLEAN
Fixed both gaps + shipped task-4 deliverable:
- **PINOUT.md alignment** (config.h + drive.cpp + sonar.cpp + rpc_handlers.cpp): renamed pins to PINOUT names/numbers exactly — PIN_M_L_* D4/D7/D5, PIN_M_R_* D8/D12/D6, PIN_ULTRA_TRIG/ECHO D2/D3, PIN_BATT_SENSE A0. Battery sense now impl'd w/ the 10k:3.3k divider math but gated OFF by default (BATTERY_SENSE_ENABLED 0 → reports battery_mv=0, avoids floating-pin garbage). No stale pin refs remain.
- **BRIDGE.md §4 conformance** (bridge_rpc.cpp): motion RPCs now `provide_safe` (main-loop thread), estop stays plain `provide` (fires even if loop wedges); get_status returns `MsgPack::arr_t<int>[10]` not a String; move_servos already 6-flat-ints (matches §4). estopLatched marked volatile for cross-thread visibility.
- **firmware/mcu/README.md** written: file map, wiring table (points at PINOUT.md as source of truth), hardware cautions, build/test (hostcheck vs flash.sh --check), bench quick-ref. Bumped FW_VERSION 0.2→0.3.

**Verify**: `firmware/mcu/hostcheck.sh` → ALL CLEAN (9 files). ⚠️ hostcheck compiles the Bridge path OUT (no Arduino_RouterBridge.h on host) — the provide_safe/MsgPack glue is validated only by @fw-tools `tools/flash.sh --check` (arduino:zephyr:unoq). @fw-tools: please run flash.sh --check against mcu/ to confirm the §4 glue compiles on the real core.
**ASSIGNMENTS status**: tasks 1 (skeleton), 2 (RPC surface), 3 (bench mode), 4 (compile-clean + README) all DONE. No hardware → real-board bring-up (flashing, servo/motor calibration, gripper µs clamp tuning) stays BLOCKED on hardware. Idle-ready for next directive.

