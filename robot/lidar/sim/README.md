# lidar sim - synthetic `lidar_scan` source

Fake 360° lidar: a kinematic robot patrols an 8×6 m room (crates, pillar, one
moving obstacle) and raycast scans are emitted as root-schema `lidar_scan`
Socket.IO events. Use it to develop the dashboard 3D view with zero hardware.

## Run

```sh
cd robot/lidar/sim
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # once
.venv/bin/python sim.py                    # emit to $SERVER_URL (default http://localhost:3001) at 2 Hz
SERVER_URL=http://192.168.x.x:3001 .venv/bin/python sim.py --rate 5
.venv/bin/python sim.py --once             # print one JSON payload (schema check, no server needed)
.venv/bin/python sim.py --stdout           # stream payloads to stdout
```

If the server isn't up yet, sim.py retries every 2 s and auto-reconnects on
drops - safe to start in any order.

## Payload

```json
{"ts": 1784340423511, "points": [[4.73, 0.0], ...]}
```

- `ts`: epoch **milliseconds** (JS `Date.now()` convention)
- `points`: cartesian meters, **robot frame** (+x = robot forward, +y = robot left,
  CCW), ≤360 points. Beams that hit nothing (>8 m) or drop out are omitted, so
  count varies per scan (~340–360).
- Realism: ~1.2 cm gaussian range noise, 2 % beam dropout, one moving obstacle.

## Tests

```sh
python3 test_sim.py          # raycast math, robot-frame rotation, schema shape, bounds
python3 test_scan_match.py   # ICP + scan-to-map odometry (below)
```

See `DECAY.md` for the scan-accumulation/decay algorithm the web view should
implement (robot-centered radar-style - the primary web viz).

## Scan matching / SLAM-lite (stretch)

`scan_match.py` recovers robot motion **from the pose-less `lidar_scan` stream
alone** and builds a global occupancy map - no wheel odometry, no IMU. It's a
scan-to-map ICP front-end (point-to-point, numpy-only):

- `icp(src, dst)` - SE(2) alignment of two scans (constant-velocity seedable).
- `ScanMapper` - streaming: `add(points)` per scan → `.pose` (x,y,θ) and
  `.world_points()` (accumulated map). Aligns each scan to the growing map (not
  just the previous scan), with a constant-velocity prior + adaptive residual /
  motion gate to reject wild matches.

Runs at the lidar's **native ~10 Hz**, not the 2 Hz display-emit throttle -
that's what keeps inter-scan motion inside ICP's convergence basin. Open-loop
drift is ~10–15 % of path length over a room tour (no loop closure - this is a
demo wow-feature, not metric-grade SLAM). Self-check: `python3 scan_match.py`.

## SLAM producer (live to the hub)

`slam_producer.py` is the producer side of the master-approved SLAM map feature.
It drives the sim, runs `ScanMapper` odometry + a log-odds occupancy grid
(`occupancy.py`), and publishes as a **robot-role** hub client:

```
slam_pose {ts, x, y, theta}                                   ~2 Hz   (theta RADIANS)
slam_map  {ts, resolution, width, height, origin, data}       <=0.5 Hz  (128x128)
```

`slam_map.data` is base64 uint8, row-major, `0=free 100=occupied 255=unknown`.
The grid is a **rolling** grid (recenters on the robot, so the map never clips);
read `origin` per message. Same role works for the real C1 on the Pi (scan
source = reader instead of the sim). Run:

```sh
.venv/bin/python slam_producer.py               # publish to $SERVER_URL hub as role=robot
.venv/bin/python slam_producer.py --stdout       # print payloads, no hub (debug)
python3 test_slam_producer.py                    # grid + payload conformance tests
```

Note: `sim.py`, `slam_producer.py`, and server-core's `sim.js` are all robot-role
lidar sources - run exactly ONE so the web does not get overlaid scans.

## Room-tour demo video

`tour.py` drives a deterministic tour, runs `ScanMapper`, and renders the global
map assembling in real time (map + live scan + recovered trajectory) - backup
demo footage.

```sh
.venv/bin/pip install matplotlib   # + system ffmpeg for .mp4 (pillow does .gif)
.venv/bin/python tour.py tour.mp4               # 16 s tour, mp4 + tour_map.png hero still
.venv/bin/python tour.py out.gif --seconds 20   # GIF; longer = more coverage, more drift smear
```

Deterministic (fixed seed) so footage is reproducible. `matplotlib` is
intentionally **not** in `requirements.txt` (viz-only) - install ad hoc.
