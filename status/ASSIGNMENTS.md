# Worker Assignments & Reporting Protocol

You are one of 14 Claude workers in tmux panes. The master Claude (pane `master.1`) coordinates. Find your section by your worker id, do tasks IN ORDER, and report per the protocol below.

## Reporting protocol (MANDATORY)

- After EVERY completed task, blocked state, or ~20 min of work: append to `status/<your-id>.md`:
  ```
  ## [<HH:MM>] DONE|WIP|BLOCKED — <one line>
  <2-4 lines: what works, how to run/verify it, what's next, what you need>
  ```
- Never rewrite others' status files. Never edit files owned by another worker (ownership listed per section). Shared contracts live in root `CLAUDE.md` — do not change schemas unilaterally; if a schema must change, write a `BLOCKED` entry asking master.
- **NO git commands. Ever.** Master handles all git. (Also: no pushing, no gh.)
- Check `status/BROADCAST.md` before starting each new task — master posts directives there.
- Hardware you don't have (robot, camera, lidar, Atlas creds, Auth0 creds) = build against mocks/env placeholders, mark the integration step BLOCKED, move on. Never sit idle.

## Environment facts

- Repo root: `/Users/danielwliu/Dev/projects/2026/hack-the-6ix` (public: github.com/DanielWLiu07/hack-the-6ix)
- Vite dev server already running in pane web.1 (port 5173). Express server target port: **3001**.
- Node 22, Python 3 available. Vercel project `hack-the-6ix` linked in `web/`. Atlas CLI installed, NOT logged in yet.

---

## web-frontend (pane web.2) — owns `web/src/`, `web/public/`, `web/index.html`
1. Dashboard route/page: Socket.IO client (`VITE_SERVER_URL`, default `http://localhost:3001`) rendering `telemetry` cards (state badge, battery, arm joints, drive), scrolling `pick_event` log, `detection` overlay list. Works against server-sim.
2. Teleop page: browser Gamepad API (PlayStation controller) → emit `drive` at 10 Hz + buttons for `pick`/`estop`; on-screen fallback buttons.
3. Lidar view: react-three-fiber points cloud from `lidar_scan` events with a few seconds of decay.
4. Analytics page: charts from server REST (`GET /api/stats` — coordinate via status file with server-core).
5. Polish landing (`src/App.jsx` placeholder exists) + Auth0 gate on teleop (env placeholders until creds arrive).

## server-core (pane server.1) — owns `web/server/` (make it its OWN npm package — do NOT touch web/package.json, npm-install only inside web/server/)
1. Express + Socket.IO hub on port 3001: relay all events per root-CLAUDE.md schemas between robot clients and browser clients; CORS for 5173.
2. `sim.js`: fake robot — emits plausible `telemetry` 5 Hz, periodic `detection`/`pick_event`/`lidar_scan`, responds to `drive`/`pick`/`estop`. This unblocks everyone; do it EARLY.
3. Persistence layer behind an interface: MongoDB if `MONGODB_URI` set, else in-memory. Collections: `pick_events`, `detections`, `telemetry` (cap/downsample telemetry).
4. REST: `GET /api/stats` (counts by fruit/ripeness/bin, success rate, est. waste-avoided), `GET /api/picks`.
5. MJPEG passthrough endpoint `/stream` (proxy from robot URL env var; serve a test pattern until robot exists).

## server-test (pane server.2) — owns `web/server/test/` and `scripts/check-*.sh`
1. Wait for server-core's sim (poll their status file); then: schema conformance tests — connect a fake browser + fake robot, assert every event payload matches root-CLAUDE.md schemas exactly.
2. `scripts/check-stack.sh`: one command that verifies server up, sim emitting, REST endpoints respond. Master will run this.
3. Load/robustness: disconnect/reconnect storms, malformed payload rejection. File findings as status entries; do NOT fix server-core's code yourself.

## db (pane db.2) — owns `web/server/db/` + `docs/DATA.md`
1. Write `web/server/db/` module for server-core to import (agree on interface via status files): connection, indexes (`pick_events` by ts/fruit), aggregation pipelines for `/api/stats`.
2. `docs/DATA.md`: collection schemas + example docs.
3. BLOCKED on Atlas login (human must run `atlas auth login` in pane db.1). Once logged in: create free M0 cluster `ht6`, DB user, network access 0.0.0.0/0 (hackathon), write `web/server/.env.example` + tell master the URI is ready (do NOT put real URI in git-tracked files).
4. Meanwhile: everything must work against `mongodb-memory-server` or the in-memory fallback.

## deploy (pane deploy.1) — owns `web/vercel.json`, `.github/` (files only, no git), `docs/DEPLOY.md`
1. `web/vercel.json`: SPA rewrites, build config. Verify `npm run build` passes cleanly whenever frontend changes land (poll web-frontend status).
2. Redeploy prod via `vercel deploy --prod --yes` from `web/` when frontend milestones land; post the URL in your status file each time.
3. `docs/DEPLOY.md`: runbook (deploy, env vars, hotspot networking plan for venue).
4. Env story: `VITE_SERVER_URL` for prod (laptop's hotspot IP) — document + set via `vercel env` when known.

## fw-mcu (pane firmware.1) — owns `firmware/mcu/`
1. Arduino sketch skeleton for UNO Q STM32: tank-drive PWM (2 drivers, pins TBD — use #defines), PCA9685 I2C servo control with **interpolated** pose moves (no snapping), ultrasonic reflex stop, watchdog (kill motion if no heartbeat 500 ms).
2. Bridge RPC surface: `set_drive(l,r)`, `move_servos(joints[5],duration_ms)`, `heartbeat()`, `estop()` — match fw-tools' protocol doc.
3. Bench-test mode: serial commands to exercise each subsystem without Linux side.
4. No hardware yet → compile-clean code + wiring notes in `firmware/mcu/README.md`.

## fw-linux (pane firmware.2) — owns `firmware/linux/`
1. Python package: pose recorder/replayer (jog joints from keyboard, save named poses to `poses.json` — include placeholder bin poses `apple_ripe|apple_unripe|banana_ripe|banana_unripe`).
2. State machine SEEK→ALIGN→PICK→SORT→DROP with pluggable backends: `MockBridge`/`MockCamera` now, real later.
3. Socket.IO client to laptop server (`SERVER_URL` env): emit `telemetry` 5 Hz, `detection`, `pick_event`; handle `drive`/`arm_pose`/`pick`/`estop`. Test against server-core's hub.
4. Inference loader: consume `ml/ripeness/export/model.onnx` + `classes.json` via onnxruntime; fall back to vision-infer's HSV detector import.
5. Visual servoing ALIGN: center bbox by jogging base/shoulder (works in mock with synthetic bboxes).

## fw-tools (pane firmware.3) — owns `firmware/tools/`, `firmware/BRIDGE.md`
1. `firmware/BRIDGE.md`: define the exact MCU↔Linux RPC protocol (App Lab Bridge calls, args, units, error/timeout behavior) — fw-mcu and fw-linux both conform to it. Write it FIRST, post status so they align.
2. arduino-cli setup + `flash.sh`, `monitor.sh` scripts; UNO Q board setup notes.
3. Serial bench-test client (Python) driving fw-mcu's bench mode.
4. Then assist: pin map doc `firmware/PINOUT.md` (motors, drivers, PCA9685, ultrasonic, power per docs/HARDWARE.md).

## vision-train (pane vision.1) — owns `ml/ripeness/` (except CLAUDE.md)
1. Training pipeline: ultralytics YOLOv8n, 4 classes (`apple_ripe`,`apple_unripe`,`banana_ripe`,`banana_unripe`), 320px; `train.py`, `export.py` (ONNX + int8 quant), `classes.json`.
2. Bootstrap dataset: pull public apple/banana detection sets (Roboflow/kaggle, scripted download), remap labels; document in `ml/ripeness/DATA.md`.
3. Train v0 on bootstrap data; export to `ml/ripeness/export/`. Post metrics in status.
4. `capture.py`: burst-capture + auto-label helper for photographing the real 3D-printed props at the venue (the REAL dataset — plan for a 30-min relabel+finetune loop).

## vision-infer (pane vision.2) — owns `robot/vision/`
1. `hsv_detector.py`: OpenCV HSV blob detector for 3D-printed fruit (red/green apples, yellow/green bananas) returning root-schema `detection` dicts — this is the works-today fallback; tune on synthetic images you generate.
2. `pipeline.py`: camera capture (device index env) → detector (ONNX if model exists, else HSV) → detections + annotated MJPEG on `:8080` for the server `/stream` proxy.
3. `bench.py`: FPS benchmark harness (report for laptop now; UNO Q later — Qualcomm track needs on-device numbers).
4. Coordinate with fw-linux via status files on the detector import interface.

## lidar-pi (pane lidar.1) — owns `robot/lidar/pi/` and `robot/lidar/phone/`
There are TWO lidar systems — don't conflate them:
- **RPLIDAR C1** (2D 360°, on the robot via Pi) → SLAM / live occupancy mapping → `lidar_scan` events
- **iPhone lidar** (handheld) → colored 3D reconstruction of the world/scene → static mesh in the web 3D view
1. Lidar reader package targeting the **RPLIDAR C1** protocol (`pyrplidar`/rplidar-sdk), polar→cartesian, downsample ≤360 pts, Socket.IO emit `lidar_scan` 2 Hz to `SERVER_URL`. ✅ done
2. `run.sh` + auto-restart loop + `SETUP.md` for the Pi (venue hotspot config). ✅ done
3. Device autodetect + NO_DEVICE path + unit tests. ✅ done
4. **Phone-lidar pipeline** (`robot/lidar/phone/`): ingest an iPhone lidar scan export (Polycam/Scaniverse → GLB or PLY with vertex color/texture) → `process.py` to decimate/optimize (target <15 MB) → output `web/public/world.glb` conventions doc for web-frontend, who renders it as the colored 3D world with the live C1 scan overlaid. Include a sample/synthetic GLB so web-frontend can build before a real phone scan exists.
5. Stretch: Record3D or WebXR live RGBD streaming from the phone instead of static export.

## lidar-sim (pane lidar.2) — owns `robot/lidar/sim/`
1. `sim.py`: synthetic room + moving robot generating realistic `lidar_scan` events to the server — unblocks web-frontend's 3D view TODAY.
2. Scan-accumulation/decay algorithm doc + reference implementation notes for web-frontend (post in status, they implement in JS).
3. Then: simple scan-matching stretch (only if lidar-pi done and idle).

## llm-data (pane freesolo.2) — owns `ml/freesolo-agent/data/`
1. Synthetic SFT dataset for FarmHand: 1.5k+ pairs NL command → action JSON (`{"task":"pick|sort|stop|drive","fruit":"apple|banana|any","filter":"ripe|unripe|any","zone":...}`), varied phrasing/typos/slang + multi-turn clarification dialogs. JSONL.
2. Held-out eval set (30 commands) + `eval.py` accuracy script.
3. Export in Freesolo's expected format (check their docs; if unknown, standard chat-JSONL + note in status). Teammate trains — your deliverable is the dataset + eval.

## llm-client (pane freesolo.1) — owns `ml/freesolo-agent/client/`
1. `farmhand.py`: takes `nl_command` text → calls model endpoint (env `FARMHAND_URL`, mock mode with regex-rules until teammate's model exists) → **strict JSON-schema validation** (reject anything invalid — never pipe raw LLM output to the robot) → forwards structured command.
2. Wire into server-core: server emits `nl_command` to this client, gets back structured action, forwards to robot. Agree interface via status files.
3. `NOTES.md`: questions for the teammate (endpoint, format) — master relays to human.
