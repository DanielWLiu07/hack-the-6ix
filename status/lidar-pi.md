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
