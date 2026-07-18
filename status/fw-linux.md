# fw-linux status

## [22:10] WIP — kickoff, env ready
venv at `firmware/linux/.venv` (python-socketio, numpy, onnxruntime, pytest installed). No `firmware/BRIDGE.md` from fw-tools yet — building against an abstract `Bridge` interface with the RPC surface from firmware/CLAUDE.md (`set_drive(l,r)`, `move_servos(joints[5], duration_ms)`, `heartbeat()`, `estop()`); will conform adapter once BRIDGE.md lands. Starting task 1 (pose recorder/replayer).
