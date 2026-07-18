# INTEGRATION.md — autonomous system bring-up ladder

How to bring the whole robot up **one layer at a time**, confirming each component
against a known-good layer below it *before* running the full autonomy. Never
integrate everything and hope — if a rung fails you already know every rung below
it is clean, so it's wiring or a tuning number, never logic.

The system, bottom to top:

```
 sensors ── camera + lidar + sonar
   │
 perception ── detector (fruit + ripeness), SLAM
   │
 decision ── state machine  SEEK → APPROACH → ALIGN → PICK → SORT → DROP
   │
 actuation ── navigation → set_drive → MCU → motors ; move_servos → arm
   │
 feedback ── telemetry, sonar reflex, heartbeat watchdog, estop
   │
 operator ── hub (Socket.IO) → web dashboard / teleop
```

**Legend:** ✅ proven · 🟡 runnable **now** (laptop/sim, no board) · ⏳ needs the Uno Q

> **Setup — each subsystem has its own `requirements.txt` / `.venv`.** Create it
> before running that subsystem's tools; do **not** use bare system `python3`
> across subsystems (ABI clashes, e.g. `cv2` vs NumPy 2.x). `scripts/demo.sh`
> auto-creates the venvs it needs. Per module:
> `cd <dir> && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`
> then run tools with `.venv/bin/python`. (`firmware/linux/.venv` also needs
> `python-socketio[client]` + `pytest`.)

| Rung | What | Test | Status |
|---|---|---|---|
| 0 | code compiles / logic | `hostcheck.sh`, `pytest` | ✅ |
| 1 | actuators alone | drive sketches / `pose_recorder` / sonar | drive ✅, arm+sonar ⏳ |
| 2 | MCU↔Linux bridge | `tools/bridge_smoke.py` | ⏳ (RPC ✅ once) |
| 3 | perception alone | `robot/vision` bench + tests | 🟡 |
| 4 | perception→decision | `robot_node --sim --real-detector`, `soak` | 🟡 |
| 5 | operator layer | `demo.sh`, monitor, lidar sim | ✅ |
| 6 | half-integration on hw | teleop live / propped autonomy | ⏳ |
| 7 | full autonomy on floor | tune `APPROACH_*` gains | ⏳ |

---

## Rung 0 — Code & logic (no hardware)

- **MCU firmware compiles**
  `firmware/mcu/hostcheck.sh` — host-side sanity.
  `cd <repo> && TMPDIR=/tmp arduino-cli compile --fqbn arduino:zephyr:unoq firmware/mcu`
  ✅ Pass: clean build (~14% flash).
- **Python logic (state machine / servoing / navigation)**
  `cd firmware/linux && PYTHONPATH=. .venv/bin/python -m pytest -q`
  ✅ Pass: 16/16.
- **Vision detector logic** — `cd robot/vision && .venv/bin/python -m pytest` (needs the vision venv — cv2/numpy)
- **Lidar / SLAM logic** — `cd robot/lidar/sim && .venv/bin/python -m pytest`

## Rung 1 — Actuators, each ALONE

- **Drive train** (motors + drivers + wiring + direction) ✅ **done**
  Flash a standalone sketch, jog with serial keys `f`/`b`/`l`/`r`/`s`:
  `firmware/drive-bringup/` (see its README; wiring in `firmware/DRIVE_BTS7960.md`).
  Pass: each wheel spins the commanded way; both drive straight (trim tuned).
- **Arm servos** ⏳ — `cd firmware/linux && python3 -m robot_linux.pose_recorder` (drop `--sim` on the board)
  Jog each joint through its range; confirm soft limits hold and the 5 V rail doesn't brown out.
- **Sonar** ⏳ — read distance via the MCU bench `Q` (get_status → `ultra_cm`); wave a hand <15 cm, confirm it reads close.

## Rung 2 — MCU ↔ Linux Bridge (command path, no autonomy)

⏳ **Run on the Uno Q, inside an App Lab app:**
```
cd firmware/linux && python3 tools/bridge_smoke.py
```
Exercises every RPC (`set_drive`/`move_servos`/`heartbeat`/`estop`/`clear_estop`) and
prints `get_status` after each. Pass: each command lands (wheels command ~20%, arm
moves, estop latches state 3). *(The serial `firmware/tools/bench.py` is the same idea
for the classic-Uno test rigs, which DO expose MCU serial; the Uno Q does not.)*

- **Watchdog** — stop calling `heartbeat` for >500 ms → motors must die (get_status state → 2/WATCHDOG).

## Rung 3 — Perception, ALONE (biggest sim→real risk)

🟡 **Do this now on the laptop** — mock boxes were perfect; real ones jitter.
(Use the vision venv — `cd robot/vision && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`.)
- Latency / FPS: `.venv/bin/python bench.py --detector auto` (prints a `BENCH {...}` line).
- Detector unit tests: `.venv/bin/python -m pytest` (`test_detector.py`).
- On real imagery: point a webcam / feed real fruit photos through `robot/vision/pipeline.py`
  and eyeball that fruit + ripeness labels are stable and boxes don't flicker.
- Model artifact check (loads the real ONNX + inference soak):
  `cd firmware/linux && PYTHONPATH=. python3 -m robot_linux.soak --model-check`

## Rung 4 — Perception → decision (real detector, fake body)

🟡 Run the full state machine off **real** detections but a mock bridge/body:
```
cd firmware/linux && PYTHONPATH=. python3 -m robot_linux.robot_node --sim --real-detector
```
Confirms SEEK/APPROACH/ALIGN cope with noisy real boxes, no hardware at risk.
(`--real-detector` pulls in the ONNX/HSV deps — install `onnxruntime`/`opencv`
into `firmware/linux/.venv` first, or it falls back to MockDetector.)
Endurance: `PYTHONPATH=. .venv/bin/python -m robot_linux.soak --cycles 100` (survives a judging window).

## Rung 5 — Operator layer (hub / web / teleop) ✅

- Whole stack: `./scripts/demo.sh` (hub + robot + lidar + web). `demo.sh status` / `logs <svc>`.
- Lightweight view (no Three.js/shaders): open `~/ht6-monitor.html`.
- Teleop path: dashboard → Teleop page → drive with controller/keyboard.
- Lidar feed: `robot/lidar/sim` emits `lidar_scan`/SLAM to the dashboard.

## Rung 6 — Half-integration ON hardware (safe)

⏳ Do these **before** letting it drive free:
1. **Teleop on the real robot** — controller → real motors, *you* in control. Proves the whole command path on hardware.
2. **Autonomy propped/tethered** — robot on blocks, wheels free. Run `robot_node` (no `--sim`) with real camera + arm + drive; watch it *try* to approach/pick without moving physically. Confirms integration end-to-end with zero run-away/crash risk.

## Rung 7 — Full autonomy on the floor

⏳ Only after every rung passes. On the ground, tune the four numbers in
`firmware/linux/robot_linux/config.py`:
`APPROACH_FWD`, `APPROACH_TURN_GAIN` (flip sign if it steers *away*),
`APPROACH_AREA_FRAC` (measure the bbox size at true arm reach), `APPROACH_MAX_TICKS`.
Sonar 15 cm stop is the collision backstop; **teleop is the demo-day fallback** if
autonomy needs more tuning than time allows.
