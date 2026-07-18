# On-device 2D SLAM + phone capture - plan

Master directive (17 Jul): make the **phone app** (capture -> generate the 3D
world) AND get the **360° C1 lidar doing SLAM that runs locally on the UNO Q**.
Full plan, built + tested start to finish.

## Two deliverables

### 1. On-device 2D SLAM (this dir, `robot/lidar/pi/slam/`)
The C1 emits pose-less `lidar_scan` (robot-frame points, 2 Hz). SLAM turns that
stream into a **global occupancy-grid map + live robot pose** with no odometry -
lidar-only. Runs on-device (Pi *or* UNO Q Linux side), pure numpy, no ROS.

Pipeline per scan:
```
lidar_scan (robot frame) --> ICP scan-match vs running map --> pose (x,y,theta)
                                                              |
        +-----------------------------------------------------+
        v
  transform scan into WORLD frame --> log-odds occupancy grid update
        (raycast: cells along the beam = free, endpoint = occupied)
        |
        +--> emit `slam_update` {pose, occupied cells}  (2 Hz, throttled)
        +--> render map.png  (offline proof + demo-backup footage)
```

Why occupancy grid (not just an ICP point cloud like lidar-sim's `ScanMapper`):
a probabilistic grid **denoises** the moving-person/noise, fills free space, and
is what a live "the robot is building a map of the room" demo needs. lidar-sim
built the scan-match *algorithm* as a reference; this is the deployable **node +
map + on-device packaging** - self-contained, no cross-package import.

Modules:
- `occupancy.py` - log-odds grid: `integrate(pose, points)`, `occupied_cells()`, `render()`
- `icp.py` - compact point-to-point ICP (SE(2)), lidar odometry
- `slam.py` - `Slam` front-end tying icp+occupancy, pose track, keyframe gating
- `node.py` - live: connect hub, consume `lidar_scan`, run `Slam`, emit `slam_update`, periodic map render; env `SERVER_URL`. Auto-restarts via existing `pi/run.sh` pattern.
- `bench.py` - ms/scan + peak-RAM benchmark -> the Qualcomm on-device number
- `tests/` - offline determinism + drift bounds on a synthetic trajectory

### 2. Phone capture app (`robot/lidar/phone/`)
iPhone lidar (Polycam/Scaniverse) -> colored `world.glb`. `process.py` already
does the optimize. The **app** closes the venue loop *without a laptop*: a
mobile web page to upload the phone's export -> runs `process.py` -> drops
`web/public/world.glb` -> live in the dashboard. Realistic given iOS Safari has
no WebXR depth API - the pro capture apps do the scanning; we do ingest+optimize.
- `app.py` - tiny stdlib HTTP service: `GET /` mobile upload page, `POST /upload`
  runs process.py, `GET /status`. No heavy web deps (Pi/laptop friendly).

## Event schema (NEW - needs coordination)
```jsonc
"slam_update" {"ts":0,"pose":[x,y,theta_deg],"res":0.05,
               "origin":[ox,oy],"cells":[[cx,cy],...]}  // occupied grid cells, capped ≤1500
```
The hub whitelists relayed robot events (`ROBOT_EVENTS` in web/server/index.js).
**Coordination:** ask server-core to add `slam_update` to that list; ask
web-frontend to render the grid in the lidar view. Until then SLAM is fully
verifiable offline (map.png) and its emit is a no-op relay - no one blocked.

## UNO Q / Qualcomm on-device story
- Pure numpy, ARM-clean, <30 MB RAM target, real-time at 2 Hz with headroom.
- Deploys to the UNO Q **Linux (MPU)** side alongside vision inference - SLAM is
  the "spatial AI" half of the on-device compute story; MCU stays real-time motor
  control. Coordinate the process handoff with fw-linux (they own `firmware/linux/`).
- `bench.py` output goes into docs/QUALCOMM.md (vision-infer owns that doc).

## Test plan (start -> finish)
1. `occupancy.py` + `icp.py` unit tests (pure, no hw).
2. Offline SLAM on a scripted trajectory -> assert bounded pose drift + coherent map.
3. Live: run `node.py` against the running sim -> render map.png, eyeball room geometry.
4. `bench.py` ms/scan on this laptop (UNO Q figure noted as pending real board).
5. Phone `app.py`: upload the synthetic sample export -> world.glb regenerated + loads.
6. viewer.html: overlay the slam grid; headless-Chrome render proof.

## Status / ownership
Owned by lidar-pi: everything under `robot/lidar/pi/` and `robot/lidar/phone/`.
Coordination (via status files, not edits): server-core (relay), web-frontend
(render), fw-linux (UNO Q deploy), vision-infer (QUALCOMM.md bench).
