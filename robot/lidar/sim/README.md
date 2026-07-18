# lidar sim — synthetic `lidar_scan` source

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
drops — safe to start in any order.

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
implement (robot-centered radar-style — the primary web viz).

## Scan matching / SLAM-lite (stretch)

`scan_match.py` recovers robot motion **from the pose-less `lidar_scan` stream
alone** and builds a global occupancy map — no wheel odometry, no IMU. It's a
scan-to-map ICP front-end (point-to-point, numpy-only):

- `icp(src, dst)` — SE(2) alignment of two scans (constant-velocity seedable).
- `ScanMapper` — streaming: `add(points)` per scan → `.pose` (x,y,θ) and
  `.world_points()` (accumulated map). Aligns each scan to the growing map (not
  just the previous scan), with a constant-velocity prior + adaptive residual /
  motion gate to reject wild matches.

Runs at the lidar's **native ~10 Hz**, not the 2 Hz display-emit throttle —
that's what keeps inter-scan motion inside ICP's convergence basin. Open-loop
drift is ~10–15 % of path length over a room tour (no loop closure — this is a
demo wow-feature, not metric-grade SLAM). Self-check: `python3 scan_match.py`.

## Room-tour demo video

`tour.py` drives a deterministic tour, runs `ScanMapper`, and renders the global
map assembling in real time (map + live scan + recovered trajectory) — backup
demo footage.

```sh
.venv/bin/pip install matplotlib   # + system ffmpeg for .mp4 (pillow does .gif)
.venv/bin/python tour.py tour.mp4               # 16 s tour, mp4 + tour_map.png hero still
.venv/bin/python tour.py out.gif --seconds 20   # GIF; longer = more coverage, more drift smear
```

Deterministic (fixed seed) so footage is reproducible. `matplotlib` is
intentionally **not** in `requirements.txt` (viz-only) — install ad hoc.
