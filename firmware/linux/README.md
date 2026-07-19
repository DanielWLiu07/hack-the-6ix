# firmware/linux - UNO Q Linux side (QRB2210, Python)

Camera capture, on-device inference, pick/sort state machine, and the
Socket.IO link to the laptop hub. Talks to the STM32 (`firmware/mcu/`) over the
App Lab Bridge RPC defined in `firmware/BRIDGE.md`.

## Setup

```bash
cd firmware/linux
python3 -m venv .venv && . .venv/bin/activate
pip install python-socketio[client] numpy onnxruntime pytest requests
```

(The committed `.venv/` already has these.)

## Run

Everything runs against mocks with no hardware. `SERVER_URL` (env) or
`--server` points at the hub's hub (default `http://localhost:3001`).

```bash
# Full robot node: SM + telemetry/detection/pick_event to the hub,
# handles drive/arm_pose/pick/estop/nl_action/set_mode.
python -m robot_linux.robot_node --sim --autostart        # autonomous picking
python -m robot_linux.robot_node --sim --await-command    # NL-demo mode

# Pose recorder: jog joints from the keyboard, save named poses to poses.json
python -m robot_linux.pose_recorder --sim
```

On real hardware drop `--sim`: the node uses `AppLabBridge` (App Lab Bridge RPC)
and `CVCamera` (OpenCV), falling back to mocks if either is unavailable.

### Demo command modes (make NL commands visibly drive the robot)

The robot has two command modes so a spoken command demonstrably moves it on
stage (otherwise the autonomous loop masks whether a command caused the pick):

- **auto** (`--autostart`): continuously SEEK/PICK/SORT on its own.
- **await** (`--await-command`, the default): sit IDLE until a command
  (`nl_action` or `pick`) arrives, run exactly that one command, return to IDLE.
  In sim, a filtered command (e.g. "pick a ripe banana") also presents the
  requested fruit in the mock scene so there is always a matching target.

Toggle live via the hub, using the hub's contract `set_mode {autostart: bool}`
(`autostart:false` pauses autonomy into await, `true` resumes). The operator can
flip it over REST: `curl -XPOST localhost:3001/api/robot/mode -d '{"autostart":false}'`.
The hub replays the last `set_mode` to a robot on reconnect, so a mid-demo toggle
survives a robot restart.

### Detector selection

`load_detector()` prefers, in order: ONNX (`ml/ripeness/export/model.onnx` +
`classes.json`) -> the vision module's HSV fallback (`robot/vision/hsv_detector.py`) ->
`MockDetector` (synthetic ground truth). In `--sim` the node forces
`MockDetector` (the real models see nothing in MockCamera's synthetic frames);
pass `--real-detector` to run the ONNX/HSV path against a live camera in sim.

## Layout

| Module | Role |
|---|---|
| `bridge.py` | `MockBridge` (in-process sim) / `AppLabBridge` (real RPC). Timeout/DOWN handling per BRIDGE.md §3 lives in the node. |
| `camera.py` | `MockCamera` (eye-in-hand sim, fruit position tracks joints) / `CVCamera`. |
| `detector.py` | `Detection` + ONNX / HSV / Mock detectors, NMS. `to_event()` -> root-schema `detection`. |
| `servoing.py` | ALIGN visual servoing: bbox error -> base/shoulder jog. |
| `poses.py` | Named-pose store + sequence replay; `poses.json` (bin poses per class). |
| `pose_recorder.py` | Interactive keyboard pose recorder (P0 arm-bringup tool). |
| `state_machine.py` | SEEK->ALIGN->PICK->SORT->DROP, tick-based, non-blocking. |
| `robot_node.py` | Wires it all to the Socket.IO hub; 20 Hz control tick, 5 Hz telemetry + heartbeat. |
| `soak.py` | N-cycle pick/sort soak + final-model load check (demo-hardening). |
| `config.py` | Env-overridable config (rates, gains, joint limits, paths). |

## Test & soak

```bash
PYTHONPATH=. pytest -q                              # offline unit tests
python -m robot_linux.soak --cycles 100 --model-check   # pick/sort soak + model load
```

The soak runs N full pick/sort cycles against the mock, spawns all 4 fruit
classes, and reports success rate, per-bin distribution, duration stats, stalls,
tick errors, and memory growth (bounded - a demo-hardening leak check).
`--model-check` also loads the final `export/model.onnx` through the real loader
and inference-soaks it (latency/FPS). The behavioral loop uses `MockDetector`
because the real model can't see MockCamera's synthetic frames.

## Verified

- Full pick cycle emits schema-correct `detection` / `pick_event` (correct bins
  `apple_ripe`...`banana_unripe`); `telemetry` payload matches docs/SCHEMAS.md.
- Node runs a steady 20 Hz control loop, 5 Hz telemetry + heartbeat, and picks
  end-to-end against the hub's live hub (REST `/api/stats` aggregates them).
- `drive`/`arm_pose`/`pick`/`estop`/`nl_action` inbound handling; latched estop.
