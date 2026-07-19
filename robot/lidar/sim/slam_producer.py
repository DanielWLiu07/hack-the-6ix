#!/usr/bin/env python3
"""SLAM producer: lidar_scan -> slam_pose + slam_map (schema).

Subscribes to the hub's `lidar_scan` stream (from the sim today, the real
RPLIDAR C1 later - identical input), recovers pose with scan-to-map ICP
(`scan_match.ScanMapper`), fuses a log-odds occupancy grid (`occupancy`), and
publishes:

    slam_pose {ts, x, y, theta}                      ~2 Hz   (theta in RADIANS)
    slam_map  {ts, resolution, width, height, origin, data}   <=0.5 Hz

per the docs/SCHEMAS.md schema addendum. This is the producer side of the SLAM
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
import nav

MAP_HZ = 0.5           # schema cap for slam_map
POSE_HZ = 2.0          # slam_pose is cheap; pose marker stays responsive

# Navigation goals are clamped to the (sim) room interior so a stray click on
# empty ground can't drive the rover out of the mapped area. static_world() is an
# 8x6 m room centred on the origin; stay a little inside the walls.
ROOM_X = (-3.6, 3.6)
ROOM_Y = (-2.6, 2.6)


class SlamProducer:
    def __init__(self, resolution=0.08, size=128):
        self.mapper = sm.ScanMapper()
        self.grid = OccupancyGrid(resolution=resolution, size=size,
                                  origin=(-(size * resolution) / 2,
                                          -(size * resolution) / 2))
        self.n = 0
        self.pose = (0.0, 0.0, 0.0)   # last pose used for the map (published)

    def on_scan(self, points):
        """Feed one lidar_scan; recover pose with ICP. Returns (x,y,theta_rad).

        Open-loop ICP drifts over long runs; for the sim nav demo prefer
        on_scan_gt (known-pose occupancy mapping) so map+pose+goal share a frame."""
        pts = np.asarray(points, float).reshape(-1, 2)
        self.mapper.add(pts)
        x, y, th = self.mapper.pose
        world = sm.transform_points(self.mapper.pose_T, pts)
        self.grid.integrate((x, y), world)
        self.pose = (x, y, th)
        self.n += 1
        return x, y, th

    def on_scan_gt(self, points, pose):
        """Known-pose occupancy mapping: fold a robot-frame scan into the grid at
        the given (x, y, theta). Stable map + exact pose (no ICP drift), which is
        what the navigation demo needs (the real Pi uses on_scan/ICP instead)."""
        x, y, th = pose
        pts = np.asarray(points, float).reshape(-1, 2)
        c, s = math.cos(th), math.sin(th)
        world = pts @ np.array([[c, -s], [s, c]]).T + np.array([x, y])
        self.grid.integrate((x, y), world)
        self.pose = (float(x), float(y), float(th))
        self.n += 1
        return self.pose

    def pose_payload(self, ts):
        x, y, th = self.pose
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
    applies, with the real lidar reader as the scan source (coordinate: the lidar node).
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

    robot, rng = sim.Robot(), np.random.default_rng()
    # Sim mapping mode. Default: fold scans at the sim's known pose so the map is
    # stable and the published pose is exact - map, pose, nav goal and driving all
    # share ONE frame (open-loop ICP drifts metres over a long run, which breaks
    # click-to-navigate). SLAM_ICP=1 restores scan-matching for SLAM demos.
    use_icp = os.environ.get("SLAM_ICP") == "1"
    # Build the map with an opening patrol lap, then HOLD position so the scan
    # and map stop sweeping - the rover only moves again to drive to a clicked
    # goal. SLAM_PATROL_SEC=0 keeps it patrolling forever (old behaviour).
    patrol_sec = float(os.environ.get("SLAM_PATROL_SEC", "52"))

    # Operator navigation: nav_goal comes in on a background thread, the main loop
    # plans over the live grid and drives the robot. `pending` hands the click
    # across threads; simple assignment is atomic enough under the GIL.
    navq = {"pending": None}   # {"x","y"} to plan, {"cancel":True}, or None

    @sio.on("nav_goal")
    def on_nav_goal(payload):
        if not isinstance(payload, dict):
            return
        if payload.get("cancel"):
            navq["pending"] = {"cancel": True}
            return
        try:
            navq["pending"] = {"x": float(payload["x"]), "y": float(payload["y"])}
        except (KeyError, TypeError, ValueError):
            pass

    def emit_nav(goal, points, active, reached):
        if not sio.connected:
            return
        sio.emit("nav_path", {
            "ts": int(time.time() * 1000),
            "goal": goal,
            "points": [[round(float(px), 3), round(float(py), 3)] for px, py in points][:512],
            "active": bool(active),
            "reached": bool(reached),
        })

    while True:
        try:
            sio.connect(server_url, auth={"role": "robot"}, wait_timeout=10)
            break
        except Exception:
            print(f"[slam] {server_url} unreachable, retry in 2s", file=sys.stderr)
            time.sleep(2)

    dt = 1.0 / rate
    t_sim = 0.0
    last_scan = last_pose = last_map = last_nav = 0.0
    cur_goal = None            # active destination [x,y] in SLAM frame, or None

    # Pre-build the whole map with a fast internal patrol lap (NO emit), then park
    # the rover and hold. The dashboard sees a complete, static map from the first
    # frame and the robot never appears to wander/spin - it just sits in the mapped
    # room until an operator clicks a destination. (Set SLAM_PREBUILD=0 to instead
    # watch it map live.) On the real Pi this whole block is skipped (use_icp).
    prebuild = os.environ.get("SLAM_PREBUILD", "1") != "0"
    if not use_icp and prebuild:
        lap = int(os.environ.get("SLAM_PREBUILD_SCANS", "520"))
        for _ in range(lap):
            robot.step(dt)
            p = sim.make_payload(robot, t_sim, 360, rng)
            t_sim += dt
            prod.on_scan_gt(p["points"], (robot.x, robot.y, robot.theta))
        robot.hold = True   # frozen from the first emitted frame
        print(f"[slam] map pre-built ({prod.n} scans) - rover parked + holding",
              file=sys.stderr)

    start = time.time()
    try:
        while duration is None or (time.time() - start) < duration:
            step_start = time.monotonic()

            # opening patrol lap builds the map, then hold so it stops sweeping
            if patrol_sec > 0 and not robot.hold and (time.time() - start) > patrol_sec:
                robot.hold = True
                print("[slam] map built - holding position (click to navigate)",
                      file=sys.stderr)

            # --- navigation: consume a click, plan, drive, report ---
            req = navq["pending"]
            if req is not None:
                navq["pending"] = None
                if req.get("cancel"):
                    robot.clear_goal()
                    cur_goal = None
                    emit_nav(None, [], active=False, reached=False)
                    print("[slam] nav goal cancelled", file=sys.stderr)
                else:
                    # Clamp inside the room: a click on empty ground past the map
                    # projects far away (perspective), which would fling the rover
                    # out of the room and drag the rolling grid with it.
                    gx = min(max(req["x"], ROOM_X[0]), ROOM_X[1])
                    gy = min(max(req["y"], ROOM_Y[0]), ROOM_Y[1])
                    goal = [round(gx, 3), round(gy, 3)]
                    px, py, _ = prod.pose
                    path = nav.plan_path(prod.grid.to_uint8(),
                                         prod.grid.origin, prod.grid.res,
                                         (px, py), goal)
                    robot.set_goal(path)
                    cur_goal = goal
                    emit_nav(goal, path, active=True, reached=False)
                    last_nav = time.time()
                    print(f"[slam] nav goal ({goal[0]:+.2f},{goal[1]:+.2f}) "
                          f"path={len(path)} pts", file=sys.stderr)

            robot.step(dt)
            t_sim += dt

            if cur_goal is not None and robot.goal_reached:
                robot.goal_reached = False
                emit_nav(cur_goal, [], active=False, reached=True)
                print(f"[slam] nav goal reached ({cur_goal[0]:+.2f},"
                      f"{cur_goal[1]:+.2f})", file=sys.stderr)
                cur_goal = None

            payload = sim.make_payload(robot, t_sim, 360, rng)
            if use_icp:
                prod.on_scan(payload["points"])
            else:
                prod.on_scan_gt(payload["points"], (robot.x, robot.y, robot.theta))
            now = time.time()
            if sio.connected:
                if emit_scan and now - last_scan >= 0.5:      # lidar_scan 2 Hz
                    sio.emit("lidar_scan", payload)
                    last_scan = now
                if now - last_pose >= 1.0 / POSE_HZ:
                    sio.emit("slam_pose", prod.pose_payload(now * 1000))
                    last_pose = now
                # re-broadcast the active route ~1 Hz so a UI joining mid-drive
                # still sees where the robot is headed (hub also caches the last).
                if cur_goal is not None and robot.goal_path and now - last_nav >= 1.0:
                    remaining = [cur_goal] if not robot.goal_path else robot.goal_path[robot.goal_idx:]
                    emit_nav(cur_goal, [(px_, py_) for px_, py_ in remaining], active=True, reached=False)
                    last_nav = now
                if now - last_map >= 1.0 / MAP_HZ:
                    sio.emit("slam_map", prod.map_payload(now * 1000))
                    last_map = now
                    s = prod.grid.stats()
                    x, y, th = prod.pose
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
