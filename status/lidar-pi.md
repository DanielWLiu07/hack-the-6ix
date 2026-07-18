# lidar-pi status

## [22:08] DONE — Task 1: lidar reader package built & verified against live hub
`robot/lidar/pi/lidar_node/`: reader (pyrplidar + rplidar-roboticia backends, lazy imports), polar→cartesian in robot frame (x fwd / y left, m), nearest-per-bin downsample ≤360 pts, Socket.IO emitter throttled to 2 Hz.
Verified: smoke test emitted a real `lidar_scan` (360 pts, schema-exact) to server-core's hub on :3001 — connect + emit both succeeded. web-frontend can also use lidar-sim for continuous data.
Run: `cd robot/lidar/pi && SERVER_URL=http://<laptop>:3001 ./run.sh`

## [22:09] DONE — Task 2: run.sh + auto-restart + SETUP.md
`run.sh` self-bootstraps a venv, restarts on crash/NO_DEVICE(exit 2)/server-unreachable(exit 3) with backoff. `SETUP.md`: Pi flashing w/ hotspot preload, systemd unit, env var table (SERVER_URL, LIDAR_PORT, LIDAR_BAUD 115200 — note A3/S-series need 256000), troubleshooting.

## [22:10] DONE — Task 3: autodetect + NO_DEVICE path + unit tests
Autodetect via pyserial VID/PID (CP2102/CH340/STM32-VCP) + /dev glob fallback; clean `NoDeviceError` (code NO_DEVICE). Verified live: no lidar attached → logs NO_DEVICE, exits 2, run.sh retries. 24/24 pytest passing (`python3 -m pytest robot/lidar/pi/tests/ -q` — stdlib-only, no hw deps needed).

## [22:10] BLOCKED — hardware integration only
All software done. Remaining needs the physical lidar: confirm model/baud, verify motor spin-up + real scan framing, tune ANGLE_OFFSET_DEG for mounting. ~15 min of work once hardware arrives. Idle-ready to assist elsewhere if master directs.
