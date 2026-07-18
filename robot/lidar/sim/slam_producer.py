#!/usr/bin/env python3
"""SLAM producer: lidar_scan -> slam_pose + slam_map (master-approved schema).

Subscribes to the hub's `lidar_scan` stream (from the sim today, the real
RPLIDAR C1 later - identical input), recovers pose with scan-to-map ICP
(`scan_match.ScanMapper`), fuses a log-odds occupancy grid (`occupancy`), and
publishes:

    slam_pose {ts, x, y, theta}                      ~2 Hz   (theta in RADIANS)
    slam_map  {ts, resolution, width, height, origin, data}   <=0.5 Hz

per the root CLAUDE.md schema addendum. This is the producer side of the SLAM
map feature; the web lidar page renders the grid under the live scan.

Usage:
    python slam_producer.py                        # against $SERVER_URL hub
    python slam_producer.py --duration 60
    python slam_producer.py --stdout               # no hub: print payloads (debug)

Deps: numpy, python-socketio[client] (hub mode). --stdout needs numpy only.
"""

import argparse
import json
import math
import os
import sys
import time

import numpy as np

import scan_match as sm
from occupancy import OccupancyGrid

MAP_HZ = 0.5           # schema cap for slam_map
POSE_HZ = 2.0          # slam_pose is cheap; pose marker stays responsive


class SlamProducer:
    def __init__(self, resolution=0.08, size=128):
        self.mapper = sm.ScanMapper()
        self.grid = OccupancyGrid(resolution=resolution, size=size,
                                  origin=(-(size * resolution) / 2,
                                          -(size * resolution) / 2))
        self.n = 0

    def on_scan(self, points):
        """Feed one lidar_scan; returns current pose (x, y, theta_rad)."""
        pts = np.asarray(points, float).reshape(-1, 2)
        self.mapper.add(pts)
        x, y, th = self.mapper.pose
        world = sm.transform_points(self.mapper.pose_T, pts)
        self.grid.integrate((x, y), world)
        self.n += 1
        return x, y, th

    def pose_payload(self, ts):
        x, y, th = self.mapper.pose
        return {"ts": int(ts), "x": round(float(x), 3), "y": round(float(y), 3),
                "theta": round(float(th), 4)}          # radians

    def map_payload(self, ts):
        return self.grid.slam_map_payload(ts)


def run_stdout(rate, once=False):
    """Drive the internal sim directly and print payloads (no hub)."""
    import sim
    robot, rng, prod = sim.Robot(), np.random.default_rng(1), SlamProducer()
    dt = 1.0 / 10.0
    i = 0
    while True:
        robot.step(dt)
        p = sim.make_payload(robot, 10 + i * dt, 360, rng)
        prod.on_scan(p["points"])
        i += 1
        if i % 5 == 0 or once:
            ts = int(time.time() * 1000)
            print(json.dumps({"slam_pose": prod.pose_payload(ts)}))
            print(json.dumps({"slam_map": prod.map_payload(ts)})[:120] + "...")
            if once:
                return
        time.sleep(dt)


def run_hub(server_url, duration, rate=10.0, emit_scan=True):
    """Drive the internal sim and publish as a ROBOT client.

    The hub only relays robot-role events to uis, and a robot client cannot also
    receive `lidar_scan`. So the SLAM producer owns the scan source directly: it
    drives the sim, and emits `lidar_scan` (throttled to 2 Hz for the schema),
    `slam_pose` (2 Hz), and `slam_map` (<=0.5 Hz) as one coherent robot, so the
    web's scan-decay view and the SLAM map always agree. On the Pi the same role
    applies, with the real lidar reader as the scan source (coordinate: lidar-pi).
    """
    import socketio
    import sim

    prod = SlamProducer()
    sio = socketio.Client(reconnection=True, reconnection_delay=1,
                          reconnection_delay_max=10)

    @sio.event
    def connect():
        print(f"[slam] connected to {server_url} as role=robot", file=sys.stderr)

    @sio.event
    def disconnect():
        print("[slam] disconnected (auto-reconnecting)", file=sys.stderr)

    while True:
        try:
            sio.connect(server_url, auth={"role": "robot"}, wait_timeout=10)
            break
        except Exception:
            print(f"[slam] {server_url} unreachable, retry in 2s", file=sys.stderr)
            time.sleep(2)

    robot, rng = sim.Robot(), np.random.default_rng()
    dt = 1.0 / rate
    t_sim = 0.0
    last_scan = last_pose = last_map = 0.0
    start = time.time()
    try:
        while duration is None or (time.time() - start) < duration:
            step_start = time.monotonic()
            robot.step(dt)
            t_sim += dt
            payload = sim.make_payload(robot, t_sim, 360, rng)
            prod.on_scan(payload["points"])
            now = time.time()
            if sio.connected:
                if emit_scan and now - last_scan >= 0.5:      # lidar_scan 2 Hz
                    sio.emit("lidar_scan", payload)
                    last_scan = now
                if now - last_pose >= 1.0 / POSE_HZ:
                    sio.emit("slam_pose", prod.pose_payload(now * 1000))
                    last_pose = now
                if now - last_map >= 1.0 / MAP_HZ:
                    sio.emit("slam_map", prod.map_payload(now * 1000))
                    last_map = now
                    s = prod.grid.stats()
                    x, y, th = prod.mapper.pose
                    print(f"[slam] scan {prod.n:4d} pose=({x:+.2f},{y:+.2f},"
                          f"{math.degrees(th):+.0f}deg) grid free={s['free']} "
                          f"occ={s['occ']} unknown={s['unknown']}", file=sys.stderr)
            time.sleep(max(0.0, dt - (time.monotonic() - step_start)))
    except KeyboardInterrupt:
        pass
    finally:
        sio.disconnect()
        print(f"[slam] stopped after {prod.n} scans", file=sys.stderr)


def main():
    ap = argparse.ArgumentParser(description="SLAM producer (slam_pose/slam_map)")
    ap.add_argument("--server", default=os.environ.get("SERVER_URL",
                                                       "http://localhost:3001"))
    ap.add_argument("--duration", type=float, default=None,
                    help="seconds then exit (default: forever)")
    ap.add_argument("--stdout", action="store_true",
                    help="drive internal sim, print payloads (no hub)")
    ap.add_argument("--once", action="store_true", help="one payload then exit")
    args = ap.parse_args()

    if args.stdout or args.once:
        run_stdout(10.0, once=args.once)
    else:
        run_hub(args.server, args.duration)


if __name__ == "__main__":
    main()
