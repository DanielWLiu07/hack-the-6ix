#!/usr/bin/env python3
"""Synthetic lidar simulator.

Drives a fake robot around a synthetic room and emits `lidar_scan` Socket.IO
events matching the docs/SCHEMAS.md schema:

    "lidar_scan" {"ts": <epoch ms>, "points": [[x, y], ...]}   # meters, robot frame, <=360 pts

Usage:
    python sim.py                     # connect to $SERVER_URL (default http://localhost:3001), emit at 2 Hz
    python sim.py --stdout            # no server; print one JSON payload per line (pipe/debug)
    python sim.py --once              # print a single scan and exit (schema check)
    python sim.py --rate 5 --beams 240

Requires: numpy, python-socketio[client] (see requirements.txt). --stdout/--once
work with numpy alone.
"""

import argparse
import json
import math
import os
import sys
import time

import numpy as np

MAX_RANGE_M = 8.0        # beams longer than this return no point (like a real lidar)
RANGE_NOISE_SIGMA = 0.012  # ~1.2 cm gaussian range noise
DROPOUT_PROB = 0.02      # fraction of beams randomly lost (dark/spec surfaces)


# world model

def _box(cx, cy, w, h):
    """Axis-aligned box -> 4 wall segments [(x1,y1,x2,y2), ...]."""
    x0, x1 = cx - w / 2, cx + w / 2
    y0, y1 = cy - h / 2, cy + h / 2
    return [(x0, y0, x1, y0), (x1, y0, x1, y1), (x1, y1, x0, y1), (x0, y1, x0, y0)]


def _ngon(cx, cy, r, n=8):
    """Regular n-gon (approximates a round pillar / person)."""
    pts = [(cx + r * math.cos(2 * math.pi * i / n),
            cy + r * math.sin(2 * math.pi * i / n)) for i in range(n)]
    return [(*pts[i], *pts[(i + 1) % n]) for i in range(n)]


def static_world():
    """An 8x6 m room with a few crates and a pillar. Origin at room center."""
    segs = []
    segs += _box(0.0, 0.0, 8.0, 6.0)          # outer walls
    segs += _box(-2.4, 1.6, 1.0, 0.8)         # crate
    segs += _box(2.6, -1.8, 0.9, 0.9)         # crate
    segs += _box(2.2, 1.9, 1.4, 0.6)          # bench along a wall
    segs += _ngon(-1.8, -1.7, 0.30)           # pillar
    return np.array(segs, dtype=np.float64)


# A person-ish moving obstacle pacing back and forth.
def moving_obstacle(t):
    x = 0.6 + 1.2 * math.sin(0.35 * t)
    y = 0.2 + 0.6 * math.sin(0.22 * t + 1.0)
    return np.array(_ngon(x, y, 0.22, n=6), dtype=np.float64)


# Waypoint loop the robot patrols (stays clear of obstacles).
WAYPOINTS = np.array([
    [-2.8, -0.2], [-2.4, 2.0], [0.0, 2.2], [1.2, 0.6],
    [3.0, 0.2], [2.8, -2.2], [0.2, -2.3], [-2.6, -2.2],
])
ROBOT_SPEED = 0.45       # m/s
TURN_RATE = 1.8          # rad/s max yaw rate


class Robot:
    """Kinematic robot with limited turn rate. Patrols WAYPOINTS by default; when
    a nav goal path is set (set_goal), it chases that path instead and reports
    goal_reached on arrival, then resumes patrol."""

    def __init__(self):
        self.x, self.y = WAYPOINTS[0]
        self.theta = 0.0
        self.wp = 1
        self.goal_path = None      # list of (x, y) world waypoints, or None
        self.goal_idx = 0
        self.goal_reached = False  # latched True the tick the final point is hit
        self.hold = False          # True = stay put (no patrol) until a goal

    def set_goal(self, path):
        """Start navigating along `path` (world (x,y) list, last = destination)."""
        if not path:
            return
        self.goal_path = [tuple(p) for p in path]
        self.goal_idx = 0
        self.goal_reached = False

    def clear_goal(self):
        self.goal_path = None
        self.goal_idx = 0

    def _seek(self, tx, ty, dt):
        """Turn-rate-limited drive toward (tx,ty). Returns distance to it."""
        dx, dy = tx - self.x, ty - self.y
        dist = math.hypot(dx, dy)
        desired = math.atan2(dy, dx)
        err = (desired - self.theta + math.pi) % (2 * math.pi) - math.pi
        self.theta += max(-TURN_RATE * dt, min(TURN_RATE * dt, err))
        # slow down while turning hard so the path looks natural
        speed = ROBOT_SPEED * max(0.25, math.cos(min(abs(err), math.pi / 2)))
        self.x += speed * dt * math.cos(self.theta)
        self.y += speed * dt * math.sin(self.theta)
        return dist

    def step(self, dt):
        if self.goal_path is not None:
            tx, ty = self.goal_path[self.goal_idx]
            dist = self._seek(tx, ty, dt)
            final = self.goal_idx >= len(self.goal_path) - 1
            if dist < (0.12 if final else 0.22):
                if final:
                    self.goal_reached = True
                    self.goal_path = None
                else:
                    self.goal_idx += 1
            return
        if self.hold:
            return  # map built: stay put until an operator declares a goal
        tx, ty = WAYPOINTS[self.wp]
        dist = self._seek(tx, ty, dt)
        if dist < 0.15:
            self.wp = (self.wp + 1) % len(WAYPOINTS)


# raycasting

def cast_scan(pose, segments, beams, rng):
    """Raycast `beams` evenly-spaced rays from pose=(x,y,theta) against
    segments (S,4). Returns robot-frame cartesian points, (N,2), N<=beams."""
    x, y, theta = pose
    ang_robot = np.linspace(0.0, 2 * np.pi, beams, endpoint=False)
    ang_world = ang_robot + theta
    d = np.stack([np.cos(ang_world), np.sin(ang_world)], axis=1)      # (B,2)

    p = segments[:, 0:2]                                              # (S,2)
    r = segments[:, 2:4] - p                                          # (S,2)
    o = np.array([x, y])
    po = p - o                                                        # (S,2)

    # solve o + t*d = p + u*r  (2D cross products, broadcast B x S)
    def cross(a, b):
        return a[..., 0] * b[..., 1] - a[..., 1] * b[..., 0]

    denom = cross(d[:, None, :], r[None, :, :])                       # (B,S)
    with np.errstate(divide="ignore", invalid="ignore"):
        t = cross(po[None, :, :], r[None, :, :]) / denom
        u = cross(po[None, :, :], d[:, None, :]) / denom
    valid = (np.abs(denom) > 1e-12) & (t > 1e-6) & (u >= 0.0) & (u <= 1.0)
    t = np.where(valid, t, np.inf)
    ranges = t.min(axis=1)                                            # (B,)

    ranges += rng.normal(0.0, RANGE_NOISE_SIGMA, beams)
    keep = np.isfinite(ranges) & (ranges > 0.05) & (ranges <= MAX_RANGE_M)
    keep &= rng.random(beams) > DROPOUT_PROB

    r_k, a_k = ranges[keep], ang_robot[keep]
    return np.stack([r_k * np.cos(a_k), r_k * np.sin(a_k)], axis=1)


def make_payload(robot, t_sim, beams, rng, ts_ms=None):
    segs = np.vstack([static_world(), moving_obstacle(t_sim)])
    pts = cast_scan((robot.x, robot.y, robot.theta), segs, beams, rng)
    if len(pts) > 360:  # schema: downsample to <=360 points
        pts = pts[:: math.ceil(len(pts) / 360)]
    return {
        "ts": int(time.time() * 1000) if ts_ms is None else ts_ms,
        "points": [[round(float(px), 3), round(float(py), 3)] for px, py in pts],
    }


# runners

def run_stdout(rate, beams, once=False):
    robot, rng, t_sim, dt = Robot(), np.random.default_rng(42), 0.0, 1.0 / rate
    while True:
        robot.step(dt)
        t_sim += dt
        print(json.dumps(make_payload(robot, t_sim, beams, rng)), flush=True)
        if once:
            return
        time.sleep(dt)


def run_socketio(server_url, rate, beams):
    import socketio  # python-socketio[client]

    sio = socketio.Client(reconnection=True, reconnection_delay=1,
                          reconnection_delay_max=5)

    @sio.event
    def connect():
        print(f"[sim] connected to {server_url}", file=sys.stderr)

    @sio.event
    def disconnect():
        print("[sim] disconnected, retrying...", file=sys.stderr)

    while True:  # outer loop: survive the server not being up yet
        try:
            # role=robot: the hub only relays lidar_scan to uis from robots.
            sio.connect(server_url, auth={"role": "robot"})
            break
        except socketio.exceptions.ConnectionError:
            print(f"[sim] server {server_url} unreachable, retry in 2 s",
                  file=sys.stderr)
            time.sleep(2)

    robot, rng, t_sim, dt = Robot(), np.random.default_rng(), 0.0, 1.0 / rate
    while True:
        start = time.monotonic()
        robot.step(dt)
        t_sim += dt
        if sio.connected:
            sio.emit("lidar_scan", make_payload(robot, t_sim, beams, rng))
        time.sleep(max(0.0, dt - (time.monotonic() - start)))


def main():
    ap = argparse.ArgumentParser(description="Synthetic lidar_scan emitter")
    ap.add_argument("--server", default=os.environ.get("SERVER_URL", "http://localhost:3001"))
    ap.add_argument("--rate", type=float, default=2.0, help="scans per second (default 2)")
    ap.add_argument("--beams", type=int, default=360, help="rays per scan (default 360)")
    ap.add_argument("--stdout", action="store_true", help="print payloads instead of emitting")
    ap.add_argument("--once", action="store_true", help="print one payload and exit")
    args = ap.parse_args()

    if args.once or args.stdout:
        run_stdout(args.rate, args.beams, once=args.once)
    else:
        run_socketio(args.server, args.rate, args.beams)


if __name__ == "__main__":
    main()
