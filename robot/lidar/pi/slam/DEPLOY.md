# On-device SLAM - deployment + Qualcomm on-device story

Lidar-only 2D SLAM (scan matching + occupancy grid) that turns the C1's
pose-less `lidar_scan` stream into a live global map + robot pose. Pure numpy,
no ROS - runs **on-device** on the Raspberry Pi *or* the Arduino UNO Q Linux
(MPU) side.

## Why this is on-story for the Qualcomm UNO Q track
The track wants a genuine Linux-MPU / MCU split with real on-device compute.
This is the **spatial-AI half** of that split, running on the MPU alongside the
vision inference:

```
        UNO Q  +-----------------------------------------------+
        (MPU,  |  camera -> on-device fruit/ripeness inference |
        Linux) |  C1 lidar -> on-device 2D SLAM (this) --------+--> slam_update
               +-----------------------+-----------------------+
                                       | bridge RPC (firmware/tools BRIDGE.md)
        (MCU, STM32)  +---------------v---------------+
                      |  real-time motor + servo ctrl |  the MCU firmware
                      +-------------------------------+
```
No cloud, no ROS, no GPU - 5 W edge compute doing SLAM. That's the pitch.

## Measured performance (bench.py, this laptop)
```
ms/scan  mean 14.8   p50 14.0   p95 23.4   max 35.4
peak RSS 41 MB        2 Hz budget headroom: 34x
```
The C1 runs at ~2 Hz (500 ms/scan budget). 34× laptop headroom means even a
5-10× slower UNO Q ARM core stays comfortably real-time (~75-150 ms/scan).
**Re-run `bench.py` on the UNO Q for the figure to quote to judges** (numbers go
into `docs/QUALCOMM.md`).

## Deploy on the UNO Q / Pi
```bash
cd robot/lidar/pi/slam
python3 -m venv .venv && ./.venv/bin/pip install -r requirements.txt
# runtime needs only numpy + python-socketio; matplotlib is dev-only (map render)
SERVER_URL=http://<laptop-hotspot-ip>:3001 ./run_slam.sh
```
`run_slam.sh` auto-restarts on crash/disconnect (same pattern as the C1 reader's
`run.sh`). On the headless robot pass `--map-every 0` to skip PNG rendering
(drops the matplotlib dependency entirely).

## Data flow
1. C1 reader (`lidar_node/`) emits `lidar_scan` -> hub.
2. This node subscribes (hub role `ui`), runs SLAM, emits `slam_update`.
3. Web lidar view renders the occupancy grid + pose (needs the hub relay + the
   web render - see coordination below).

## slam_update event (NEW schema - coordination required)
```jsonc
"slam_update" {"ts":0,"pose":[x,y,theta_deg],"res":0.05,
               "origin":[ox,oy],"cells":[[cx,cy],...]}  // world-m occupied cells, ≤1500
```
- **the hub**: the hub whitelists relayed events (`ROBOT_EVENTS`). Add a
  `slam_update` relay `ui -> uis` (it's a compute/telemetry event; the producing
  node connects as `ui` because it must *receive* `lidar_scan`). One handler,
  mirrors the existing relay loop.
- **the web app**: render `cells` as a ground-plane occupancy overlay (grid of
  `res`-sized squares at `origin + cell*res`) and `pose` as the robot marker,
  inside the same Three.js scene as `world.glb` + the live C1 ring. Frame is the
  robot frame (same axis map as the C1 ring - see `robot/lidar/phone/README.md`).

Until the relay lands, SLAM is fully verifiable offline: `node.py` renders
`slam_map.png` and the emit is a harmless no-op.
