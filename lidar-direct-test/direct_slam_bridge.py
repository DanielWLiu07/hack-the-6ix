#!/usr/bin/env python3
"""Bridge: teammate's direct C1 WebSocket  ->  our hub as lidar_scan + SLAM.

The teammate's lidar_direct_server.py streams raw C1 sweeps over a WebSocket as
{"points": [[angle_deg, distance_mm], ...]}. This bridge:

  1. connects to that WebSocket (real Pi, or the synthetic_feed.py stand-in),
  2. converts polar mm -> robot-frame cartesian meters,
  3. runs our lidar-only 2D SLAM (sim/scan_match + sim/occupancy via SlamProducer),
  4. emits `lidar_scan` + `slam_pose` + `slam_map` to the hub,

so the dashboard's SLAM view renders the direct C1 stream WITH the occupancy map.
This is the glue that folds the teammate's pipeline into our architecture.

Usage:
  python3 direct_slam_bridge.py --ws ws://localhost:8765 --server http://localhost:3001
"""
import argparse
import asyncio
import json
import math
import os
import sys
import time

import websockets
import socketio

# reuse our SLAM (ScanMapper + log-odds OccupancyGrid) from the sim package
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                "..", "robot", "lidar", "sim"))
from slam_producer import SlamProducer  # noqa: E402

MIN_M, MAX_M = 0.10, 12.0
MAP_HZ, POSE_HZ, SCAN_HZ = 0.5, 2.0, 2.0


def polar_to_xy(points):
    """[[angle_deg, dist_mm], ...] -> [[x_m, y_m], ...] robot frame, range-filtered."""
    out = []
    for a, dmm in points:
        d = dmm / 1000.0
        if d < MIN_M or d > MAX_M:
            continue
        r = math.radians(a)
        out.append([d * math.cos(r), d * math.sin(r)])
    return out


async def ws_stream(ws_url):
    while True:
        try:
            async with websockets.connect(ws_url, max_size=2**22) as ws:
                print(f"[bridge] connected to direct lidar {ws_url}", file=sys.stderr, flush=True)
                async for raw in ws:
                    try:
                        yield json.loads(raw)
                    except Exception:
                        continue
        except Exception as e:
            print(f"[bridge] {ws_url} down ({e}), retry 2s", file=sys.stderr, flush=True)
            await asyncio.sleep(2)


async def run(ws_url, sio):
    prod = SlamProducer()
    last_scan = last_pose = last_map = 0.0
    n = 0
    async for msg in ws_stream(ws_url):
        pts = polar_to_xy(msg.get("points", []))
        if len(pts) < 5:
            continue
        x, y, th = prod.on_scan(pts)
        n += 1
        now = time.time()
        if not sio.connected:
            continue
        if now - last_scan >= 1.0 / SCAN_HZ:
            sio.emit("lidar_scan", {"ts": int(now * 1000),
                                    "points": [[round(p[0], 3), round(p[1], 3)] for p in pts[:360]]})
            last_scan = now
        if now - last_pose >= 1.0 / POSE_HZ:
            sio.emit("slam_pose", prod.pose_payload(now * 1000))
            last_pose = now
        if now - last_map >= 1.0 / MAP_HZ:
            sio.emit("slam_map", prod.map_payload(now * 1000))
            last_map = now
            s = prod.grid.stats()
            print(f"[bridge] scan {n:4d} pose=({x:+.2f},{y:+.2f},{math.degrees(th):+.0f}deg) "
                  f"occ={s['occ']} free={s['free']} unknown={s['unknown']}", file=sys.stderr, flush=True)


def main():
    ap = argparse.ArgumentParser(description="direct C1 WebSocket -> hub lidar_scan + SLAM")
    ap.add_argument("--ws", default=os.environ.get("DIRECT_WS", "ws://localhost:8765"))
    ap.add_argument("--server", default=os.environ.get("SERVER_URL", "http://localhost:3001"))
    args = ap.parse_args()

    sio = socketio.Client(reconnection=True, reconnection_delay=1, reconnection_delay_max=10)

    @sio.event
    def connect():
        print(f"[bridge] hub connected {args.server} as role=robot", file=sys.stderr, flush=True)

    while True:
        try:
            sio.connect(args.server, auth={"role": "robot"}, wait_timeout=10)
            break
        except Exception:
            print(f"[bridge] hub {args.server} unreachable, retry 2s", file=sys.stderr, flush=True)
            time.sleep(2)

    try:
        asyncio.run(run(args.ws, sio))
    except KeyboardInterrupt:
        pass
    finally:
        sio.disconnect()


if __name__ == "__main__":
    main()
