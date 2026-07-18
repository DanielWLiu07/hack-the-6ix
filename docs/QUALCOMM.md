# Qualcomm / Arduino UNO Q track — on-device AI + MPU↔MCU split

**What this track rewards:** an *intentional* split between the UNO Q's Linux MPU
and its real-time MCU, and **genuine on-device AI** — no cloud inference. This
doc is the judging brief: it shows exactly where each responsibility lives, why,
and the on-device numbers that prove the AI runs on the board.

> One-line pitch: the fruit **detection + ripeness classification runs on the
> UNO Q itself** (5 W edge inference), while a separate real-time MCU owns
> safety and motion. Pull the network cable and the robot still sees, picks,
> and stops.

## The board

The **Arduino UNO Q** is a dual-brain module:

- **MPU — Qualcomm Dragonwing QRB2210** (quad Cortex-A53, Debian Linux, ~5 W).
  Runs our whole vision stack: camera capture → detector → annotated MJPEG +
  detections. This is where "on-device AI" lives.
- **MCU — STM32U585** (Cortex-M33, bare-metal / Zephyr sketch). Owns real-time
  motion + safety: tank drive PWM, PCA9685 servo interpolation, ultrasonic
  reflex stop, and a 500 ms motion watchdog.

The two talk over the **App Lab Bridge** (`Arduino_RouterBridge`, MsgPack-RPC).
That bridge *is* the Qualcomm-track judging boundary — see `firmware/BRIDGE.md`
for the exact RPC contract.

## Why the split is intentional (not just "Linux runs Python")

The division is drawn along a **latency + safety** line, not convenience:

| Concern | Lives on | Why there |
|---|---|---|
| Camera capture, fruit/ripeness inference, annotated stream | **MPU (Linux)** | Needs OpenCV/onnxruntime + a filesystem + the network stack for telemetry. Milliseconds-scale, not microseconds — Linux scheduling is fine. |
| Visual servoing / pick-and-sort state machine, IK, telemetry to laptop | **MPU (Linux)** | High-level planning; tolerates OS jitter; wants Python. |
| Tank-drive PWM, servo interpolation (20 ms tick, never snaps) | **MCU** | Deterministic timing. A servo snap browns out the rail and drops the fruit. |
| Ultrasonic reflex e-stop (<10 ms, no round-trip) | **MCU** | Safety must survive a hung Linux process or a dropped bridge call. |
| 500 ms motion watchdog | **MCU** | If Linux dies, motion must stop **without** Linux — the whole point of a separate real-time core. |

**The tell that the split is real:** every safety guarantee is enforced on the
MCU *independently* of Linux. If the vision process crashes mid-pick, the MCU's
watchdog zeroes drive and **holds** (never limps) the arm within 500 ms; the
ultrasonic reflex stops forward drive in <10 ms with no Linux involvement at
all. Linux can only *command* motion, never *bypass* safety. That's the
architecture Qualcomm's track is asking for — a genuine hard-real-time / rich-OS
partition, each doing what only it can.

```
        ┌──────────────────────── UNO Q ────────────────────────┐
 camera │  MPU (QRB2210, Linux, ~5W)          MCU (STM32U585)   │
  ──────┼─▶ capture ─▶ detector ─▶ detections   drive PWM       │──▶ motors
        │      │         (HSV / YOLOv8 ONNX)     servo interp    │──▶ arm
        │      ▼            ON-DEVICE AI         ultrasonic reflex│◀── sonar
        │  annotated MJPEG :8080          ▲  watchdog 500ms      │
        │      │        App Lab Bridge ───┘  (safety, MCU-local) │
        └──────┼──────── (MsgPack-RPC) ──────────────────────────┘
               ▼
       Socket.IO telemetry ──▶ laptop server ──▶ web dashboard
       (dashboard/analytics only — NEVER inference)
```

## Genuine on-device AI — no cloud inference

The detector runs entirely on the MPU. Two interchangeable backends behind one
interface (`robot/vision/detector.py`, `load_detector()`):

- **HSV blob detector** (`hsv_detector.py`) — the works-today fallback. Pure
  OpenCV, zero model, classifies fruit type + ripeness by color/shape. Ships
  now, needs no training, and is what runs if the model export isn't ready.
- **YOLOv8n ONNX** (`onnx_detector.py`) — vision-train's trained 4-class model
  (`apple_ripe`, `apple_unripe`, `banana_ripe`, `banana_unripe`), int8-quantized,
  320 px, via **onnxruntime CPUExecutionProvider on the QRB2210 A53 cores**.
  Drops in with zero code changes when `ml/ripeness/export/model.onnx` exists.

Either way, **inference never leaves the board.** The laptop/cloud only ever
receives the *result* dicts (`detection` events) for the dashboard — the raw
camera frames and the model both stay on the UNO Q. This is a hard project rule
(root `CLAUDE.md`): cloud is allowed for the web app, never for robot vision.

## Bench FPS — on-device numbers

`robot/vision/bench.py` measures pure `detect()` latency over synthetic frames
and prints a machine-readable `BENCH {...}` line (includes `machine`/`cpu` so
laptop vs board is unambiguous). **Re-run it on the UNO Q for the final writeup**
— `./deploy_unoq.sh bench` does exactly that and dumps `bench_unoq.txt`.

**Laptop reference (arm64 mac, HSV path)** — placeholder until the board bench:

| Detector | Size | FPS | Mean latency |
|---|---|---|---|
| HSV | 640×480 | ~473 | 2.1 ms |
| HSV | 320×320 | ~1307 | 0.76 ms |
| HSV | 320×240 | ~1693 | 0.59 ms |

Detector accuracy (synthetic ground truth, 200 frames):
**precision 0.965 / recall 0.891** (`test_detector.py`).

The HSV path has enormous headroom, so on the ~5 W QRB2210 it stays real-time
(camera-bound, not compute-bound). The YOLOv8n-320 int8 path is the one whose
on-device FPS is the headline Qualcomm number — fill the table below from the
board:

| Detector | Size | FPS (UNO Q) | Mean latency | Power |
|---|---|---|---|---|
| YOLOv8n int8 | 320×320 | _TBD on board_ | _TBD_ | ~5 W board |
| HSV | 640×480 | _TBD on board_ | _TBD_ | ~5 W board |

> **Green-AI framing (Deloitte track):** the entire perception stack runs inside
> the UNO Q's ~5 W envelope — versus a cloud GPU inference call per frame. Quote
> the measured board FPS ÷ 5 W as "frames per joule" in the sustainability
> writeup.

## Reproduce on the board

On the UNO Q Linux side, from `robot/vision/`:

```bash
./deploy_unoq.sh setup     # venv + pinned deps (opencv-headless, onnxruntime aarch64)
./deploy_unoq.sh verify    # detector eval + schema check  -> PASS
./deploy_unoq.sh bench     # on-device FPS -> bench_unoq.txt  (paste BENCH lines above)
./deploy_unoq.sh run       # MJPEG pipeline on :8080 (server /stream proxies it)
```

Deps are pinned in `robot/vision/requirements.txt` (headless OpenCV — the board
has no display; the pipeline never opens a cv2 window). onnxruntime is only
imported when the ONNX model file is present, so the HSV path installs and runs
even without it.

## Files that back this up

- `firmware/BRIDGE.md` — the MCU↔Linux RPC contract (the split, formalized).
- `robot/vision/detector.py` / `hsv_detector.py` / `onnx_detector.py` — the
  on-device detector (auto-selects ONNX over HSV).
- `robot/vision/bench.py` + `deploy_unoq.sh` — the on-device FPS harness.
- `firmware/mcu/` — the MCU safety state machine (reflex stop, watchdog).
- `firmware/linux/` — the MPU-side capture / state machine / telemetry.
