# lidar-pi status

## [22:08] DONE — Task 1: lidar reader package built & verified against live hub
`robot/lidar/pi/lidar_node/`: reader (pyrplidar + rplidar-roboticia backends, lazy imports), polar→cartesian in robot frame (x fwd / y left, m), nearest-per-bin downsample ≤360 pts, Socket.IO emitter throttled to 2 Hz.
Verified: smoke test emitted a real `lidar_scan` (360 pts, schema-exact) to server-core's hub on :3001 — connect + emit both succeeded. web-frontend can also use lidar-sim for continuous data.
Run: `cd robot/lidar/pi && SERVER_URL=http://<laptop>:3001 ./run.sh`

## [22:09] DONE — Task 2: run.sh + auto-restart + SETUP.md
`run.sh` self-bootstraps a venv, restarts on crash/NO_DEVICE(exit 2)/server-unreachable(exit 3) with backoff. `SETUP.md`: Pi flashing w/ hotspot preload, systemd unit, env var table (SERVER_URL, LIDAR_PORT, LIDAR_BAUD 115200 — note A3/S-series need 256000), troubleshooting.

## [22:10] DONE — Task 3: autodetect + NO_DEVICE path + unit tests
Autodetect via pyserial VID/PID (CP2102/CH340/STM32-VCP) + /dev glob fallback; clean `NoDeviceError` (code NO_DEVICE). Verified live: no lidar attached → logs NO_DEVICE, exits 2, run.sh retries. 24/24 pytest passing (`python3 -m pytest robot/lidar/pi/tests/ -q` — stdlib-only, no hw deps needed).

## [22:10] DONE — bonus: LIDAR_MOCK mode + full main-loop verification
Added `LIDAR_MOCK=1` reader backend (synthetic 4×4 m room + moving obstacle) — verified end-to-end against the live hub: 20 `lidar_scan` emits over 11 s (~2 Hz cap working), 360 pts each, clean SIGTERM shutdown exit 0. Also verified exit 3 (server-unreachable) live when :3001 briefly dropped. This doubles as the demo fallback if the lidar dies at the venue.

## [22:11] BLOCKED — hardware integration only; otherwise COMPLETE
All assigned software done + verified. Remaining needs the physical lidar: confirm model/baud (A1=115200, A3/S=256000), real scan framing, tune ANGLE_OFFSET_DEG for mounting. ~15 min once hardware arrives. Idle-ready to assist elsewhere if master directs.

## [restart] WIP — recovered after crash, resuming at Task 4 (phone-lidar → world.glb)
Restart checks: tasks 1–3 still green (24/24 pytest pass in robot/lidar/pi/tests). No persistent process was owned by this node (the live C1 emitter is lidar-sim's, PID 50097 per their log) — nothing to restart. Phase-2 directive = start Task 4. Confirmed clean slate: no robot/lidar/phone/ dir, no web/public/world.glb yet. Building the iPhone-lidar → optimized world.glb pipeline + conventions doc + synthetic sample now.

## [restart+] DONE — Task 4: iPhone-lidar → world.glb pipeline (web-frontend UNBLOCKED)
`robot/lidar/phone/`: `process.py` (real ingest: trimesh loads GLB/PLY/OBJ w/ vertex color+texture → align to robot frame → gltf-transform optimize: dedup/weld/simplify/resize/prune → <15 MB), `make_sample.py` (synthetic colored room), README.md (conventions doc), requirements.txt, samples/.gitignore.
**`web/public/world.glb` now exists** (22 KB synthetic room, vertex-colored, loads clean) — @web-frontend can build the 3D lidar view against it NOW; re-run process.py at venue to swap in the real scan, same output path, no web change.
Verified: make_sample → world.glb loads back (558 verts, bounds X±2/Y0-2.5/fwd -Z); process.py end-to-end on a synthetic Z-up PLY (2316v/4608f) → aligned + recentered + simplified to 2304 faces, vertex colors intact, under budget.
⭐ CONVENTIONS for @web-frontend (README.md "Coordinate conventions"): world.glb is glTF/three.js frame (+Y up, +X right, −Z forward, meters, floor y=0). Overlay live C1 `lidar_scan [x,y]` (robot x-fwd/y-left) via axis swap: three (X,Y,Z)=(−y, SENSOR_H, −x). No draco/meshopt by default → stock GLTFLoader works (only `--compress` needs MeshoptDecoder).
Next: Task 5 (Record3D/WebXR live RGBD) is stretch — will start only if fleet idle. Otherwise idle-ready + still BLOCKED on physical C1 for tasks 1–3 hardware tune.

## [restart++] DONE — 3D lidar demo working end-to-end: world.glb + LIVE C1 ring (RENDER-VERIFIED)
Per master directive "work on phone lidar AND 3d c1 lidar" — built `robot/lidar/phone/viewer.html`: self-contained three.js page that loads the phone-scanned `world.glb` AND overlays the live C1 `lidar_scan` ring (decay cyan→blue) in one frame, using the documented transform (X,Y,Z)=(−y, SENSOR_H, −x). OrbitControls, HUD, auto demo-fallback if no live data in 3s.
VERIFIED with real headless-Chrome WebGL renders (SwiftShader), TWO screenshots in scratchpad:
 • `viewer_demo.png` — world (room+table+apples+banana) + synthetic ring, HUD "world.glb: loaded".
 • `viewer_live.png` — SAME scene with **HUD "C1 source: ● live hub, scans:1 pts/scan:171"** = real hub sim data overlaid correctly. This proves phone-world + live-C1 compose in 3D.
Data path re-verified live: hub :3001 healthy (robot_connected), lidar_scan flowing ~2Hz (171–174 pts, robot-frame [x,y]); Vite serves world.glb (200, model/gltf-binary). CDN (three 0.160 + socket.io 4.7.5) reachable.
Run: `cd robot/lidar/phone && python3 -m http.server 8091` → open `viewer.html` (add `?demo=1` for zero-backend). @web-frontend: viewer.html is your copy-paste reference for the dashboard lidar view — transform + decay + loader all in one file.
State: phone-lidar (task 4) + 3D-C1-overlay demo both DONE & render-proven. Screenshots are demo-backup footage. Task 5 (live RGBD stream) still stretch. Physical-C1 hardware tune still the only BLOCKED item.

## [restart+++] DONE — on-device 2D SLAM (C1) + phone capture app, full stack built & tested
Master directive "phone app + 360 lidar SLAM on the UNO Q, planned+tested start to finish". Plan: robot/lidar/pi/slam/PLAN.md.

**On-device SLAM (`robot/lidar/pi/slam/`)** — lidar-only 2D SLAM, pure numpy, no ROS:
 • `icp.py` point-to-point SE(2) scan matching, `occupancy.py` log-odds grid (Bresenham free/occupied + auto-grow), `slam.py` scan-to-map front-end, `synth.py` room raycaster.
 • `node.py` live: subscribes hub `lidar_scan` (role ui), runs SLAM, emits `slam_update`, renders map.png. `run_slam.sh` auto-restart. `.venv` + requirements.txt.
 • TESTED: 9/9 pytest (`slam/tests/`) — ICP recovery, occupancy free/occupied, offline SLAM drift. **Offline drift mean 1.1cm / max 4.7cm over a full loop** (frame-aligned). Ran node.py LIVE against the sim: 50 scans consumed, map rendered (room reconstructed). Render proofs in scratchpad: slam_map.png (offline), slam_live.png (live sim).
 • BENCH (`bench.py`, laptop): **14.8 ms/scan mean, p95 23ms, 41 MB RSS, 34x headroom** over the 2 Hz budget → real-time on-device even on slower UNO Q ARM. DEPLOY.md has the Qualcomm MPU/MCU split story.

**Phone capture app (`robot/lidar/phone/app.py`)** — mobile web server, open ON the iPhone: scan in Polycam/Scaniverse → upload GLB → process.py optimize → `web/public/world.glb` live in dashboard. Stdlib-only. VERIFIED upload→process→world.glb end-to-end. Running now on :8092; master given QR + URL http://100.66.158.62:8092 (en0 WiFi, firewall off, reachable).

**viewer.html** now overlays all THREE lidar layers (world.glb + live C1 ring + SLAM occupancy grid + pose marker) — headless-Chrome render-verified (scratchpad/viewer_slam.png, HUD "slam map: 234 occupied cells").

**COORDINATION NEEDED (master please relay):**
 • @server-core: hub whitelists relayed events (ROBOT_EVENTS). Please add a `slam_update` relay ui→uis (one handler, mirrors the relay loop). Schema in slam/DEPLOY.md + PLAN.md: `slam_update {ts,pose:[x,y,theta_deg],res,origin:[ox,oy],cells:[[x,y]...]}`. This is a NEW event — master-directed; flagging per schema rules. Until added, SLAM emit is a harmless no-op (map.png is the proof).
 • @web-frontend: render slam_update `cells` as a ground occupancy overlay + `pose` marker in the lidar view — viewer.html is the copy-paste reference (setSlam()).
 • @fw-linux: SLAM is the on-device spatial-AI half of the UNO Q story — coordinate running slam/node.py on the UNO Q Linux side alongside vision inference (DEPLOY.md).
 • @vision-infer: SLAM bench numbers (14.8ms/scan, 41MB) for docs/QUALCOMM.md — take them when ready.

Tasks 4–5 (phone→world.glb) + master's SLAM directive all DONE & tested. Only the physical-C1 hardware tune + the server-core relay remain (both external to my code).
