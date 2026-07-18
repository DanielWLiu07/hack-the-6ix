# fw-linux status

## [22:10] WIP — kickoff, env ready
venv at `firmware/linux/.venv` (python-socketio, numpy, onnxruntime, pytest installed). No `firmware/BRIDGE.md` from fw-tools yet — building against an abstract `Bridge` interface with the RPC surface from firmware/CLAUDE.md (`set_drive(l,r)`, `move_servos(joints[5], duration_ms)`, `heartbeat()`, `estop()`); will conform adapter once BRIDGE.md lands. Starting task 1 (pose recorder/replayer).

## [22:39] WIP — RESTART after crash: recovered, tasks 1/2/4/5 verified on disk
Crash wiped my status log after the kickoff entry, but the code survived. On disk & re-verified this session:
- **Task 1** `poses.py` + `pose_recorder.py` (keyboard jog, named poses→`poses.json`, bin poses per class) — imports clean.
- **Task 2** `state_machine.py` SEEK→ALIGN→PICK→SORT→DROP, tick-based/non-blocking, `MockBridge`/`MockCamera` backends. Smoke test ran a full cycle → emits schema-correct `detection`+`pick_event` (bin `apple_unripe` etc.).
- **Task 4** `detector.py` loader ONNX→HSV→Mock. Note: vision-train's `ml/ripeness/export/model.onnx` now EXISTS and loads (320px) via onnxruntime.
- **Task 5** `servoing.py` ALIGN visual servoing (bbox err→base/shoulder jog); ALIGN reached + settled in smoke test.
Conformed `bridge.py` naming to BRIDGE.md (added `battery_v()`, `clear_estop()`, real-side `get_status()`/`mcu_state()` for telemetry). Now finishing task 3 (Socket.IO client).

## [22:39] DONE — task 3: Socket.IO robot node, verified against live hub
`robot_linux/robot_node.py` — the fw-linux runtime. Connects `auth={role:'robot'}`, runs 20 Hz control tick, 5 Hz `heartbeat()` + 5 Hz `telemetry`, forwards `detection`/`pick_event`; handles inbound `drive`/`arm_pose`/`pick`/`estop` + rich `nl_action` (carries ripeness filter; debounced vs server's mapped `pick` echo so an NL pick isn't aborted). Bridge DOWN/timeout path per BRIDGE.md §3 (pin telemetry ESTOP, drop motion, 1 Hz heartbeat retry).
**Run:** `cd firmware/linux && python -m robot_linux.robot_node --sim --autostart` (README.md has details). In `--sim` it forces `MockDetector` — the real ONNX model sees nothing in MockCamera's synthetic blobs.
**Verified end-to-end** against server-core's hub: spun an isolated hub on :3099, node picked continuously → `/api/stats` aggregated correct picks with correct bins (`apple_unripe`, `banana_ripe`), success_rate 1.0. In-node counter confirms a **steady 5 emits/s telemetry, 20 loop iters/s**. Telemetry payload matches root schema (`battery_v`, `state`, `arm[5]` ints, `drive{l,r}`). Estop from a live fleet worker (llm-client `stop`) latched my node correctly.
Added `tests/test_pipeline.py` (10 tests, offline, all pass: `PYTHONPATH=. pytest -q`).
**Obs for @server-test/@web-frontend:** a Python `ui` receiver on localhost saw telemetry arrive bursty (median gap 198 ms ≈ 5 Hz but occasional multi-second gap) even though the node emits a *provably* steady 5 Hz at the source — likely a transport/Python-client artifact; the JS dashboard client is the real consumer. Flagging, not blocking.
All 5 assigned fw-linux tasks complete. Not named in BROADCAST phase-2. Next: pause for master / real-hardware bring-up; can help with `nl_action` demo wiring if useful.
