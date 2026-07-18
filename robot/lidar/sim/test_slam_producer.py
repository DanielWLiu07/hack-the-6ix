#!/usr/bin/env python3
"""Tests for the SLAM producer: occupancy grid + slam_map/slam_pose payloads.
Run: python3 test_slam_producer.py (no pytest needed)."""

import base64
import json
import math

import numpy as np

import sim
from occupancy import OccupancyGrid, FREE, OCC, UNKNOWN
from slam_producer import SlamProducer


def test_grid_payload_decodes_to_schema():
    g = OccupancyGrid(resolution=0.08, size=128)
    # a robot at origin sees a wall 2 m ahead (world +x)
    g.integrate((0.0, 0.0), np.array([[2.0, 0.0], [2.0, 0.1], [2.0, -0.1]]))
    p = g.slam_map_payload(ts=123)
    assert set(p) == {"ts", "resolution", "width", "height", "origin", "data"}
    raw = base64.b64decode(p["data"])
    arr = np.frombuffer(raw, np.uint8)
    assert len(arr) == p["width"] * p["height"] == 128 * 128
    assert set(np.unique(arr)).issubset({FREE, OCC, UNKNOWN})


def test_grid_marks_wall_occupied_and_path_free():
    # origin centered so the 2 m wall lands inside the 128*0.05 = 6.4 m grid
    g = OccupancyGrid(resolution=0.05, size=128, origin=(-3.2, -3.2))
    # repeat the same scan so log-odds crosses the render thresholds
    for _ in range(4):
        g.integrate((0.0, 0.0), np.array([[2.0, 0.0]]))
    arr = g.to_uint8().reshape(g.h, g.w)
    wall = g.to_cell([[2.0, 0.0]])[0]
    mid = g.to_cell([[1.0, 0.0]])[0]
    assert arr[wall[1], wall[0]] == OCC, "wall cell should be occupied"
    assert arr[mid[1], mid[0]] == FREE, "cell along the beam should be free"


def test_pose_payload_schema_and_native_types():
    prod = SlamProducer()
    prod.on_scan(sim.make_payload(sim.Robot(), 0.0, 360, np.random.default_rng(0))["points"])
    p = prod.pose_payload(ts=5)
    assert set(p) == {"ts", "x", "y", "theta"}
    assert isinstance(p["x"], float) and isinstance(p["theta"], float)
    assert isinstance(p["ts"], int)


def test_payloads_json_serializable():
    prod = SlamProducer()
    robot, rng = sim.Robot(), np.random.default_rng(1)
    for i in range(30):
        robot.step(0.1)
        prod.on_scan(sim.make_payload(robot, 10 + i * 0.1, 360, rng)["points"])
    # json.dumps raises on numpy scalars -> proves payloads are socketio-safe
    json.dumps(prod.pose_payload(1)) and json.dumps(prod.map_payload(1))


def test_producer_builds_map_and_tracks():
    prod = SlamProducer()
    robot, rng = sim.Robot(), np.random.default_rng(3)
    x0, y0 = robot.x, robot.y
    for i in range(200):
        robot.step(0.1)
        prod.on_scan(sim.make_payload(robot, 10 + i * 0.1, 360, rng)["points"])
    gx, gy, th = prod.mapper.pose
    drift = math.hypot(gx - (robot.x - x0), gy - (robot.y - y0))
    assert drift < 2.0, f"odometry drift {drift:.2f} m too high"
    s = prod.grid.stats()
    assert s["occ"] > 100 and s["free"] > 500, f"grid looks empty: {s}"
    assert -math.pi <= th <= math.pi


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        fn()
        print(f"PASS {fn.__name__}")
    print(f"{len(fns)} tests passed")
