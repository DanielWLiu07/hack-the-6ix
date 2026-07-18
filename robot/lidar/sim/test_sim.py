#!/usr/bin/env python3
"""Sanity tests for sim.py math. Run: python3 test_sim.py (no pytest needed)."""

import math

import numpy as np

import sim


def test_raycast_hits_wall():
    # single wall at x=2, ray pointing +x from origin -> range 2.0 (± noise)
    segs = np.array([[2.0, -5.0, 2.0, 5.0]])
    rng = np.random.default_rng(0)
    pts = sim.cast_scan((0.0, 0.0, 0.0), segs, beams=4, rng=rng)
    # beams at 0/90/180/270 deg; only the 0-deg beam hits
    assert len(pts) == 1, pts
    assert abs(pts[0][0] - 2.0) < 0.1 and abs(pts[0][1]) < 0.1, pts


def test_rotation_is_robot_frame():
    # same wall, robot rotated 90deg -> hit appears on robot's -90deg beam (robot frame)
    segs = np.array([[2.0, -5.0, 2.0, 5.0]])
    rng = np.random.default_rng(0)
    pts = sim.cast_scan((0.0, 0.0, math.pi / 2), segs, beams=4, rng=rng)
    assert len(pts) == 1
    assert abs(pts[0][0]) < 0.1 and abs(pts[0][1] + 2.0) < 0.1, pts


def test_payload_schema():
    robot, rng = sim.Robot(), np.random.default_rng(1)
    p = sim.make_payload(robot, 0.0, 360, rng, ts_ms=123)
    assert set(p.keys()) == {"ts", "points"}
    assert p["ts"] == 123
    assert 0 < len(p["points"]) <= 360
    for pt in p["points"]:
        assert len(pt) == 2
        assert math.hypot(pt[0], pt[1]) <= sim.MAX_RANGE_M + 0.1


def test_ranges_bounded_in_room():
    # inside the 8x6 room every hit is within the room diagonal
    robot, rng = sim.Robot(), np.random.default_rng(2)
    diag = math.hypot(8, 6)
    for i in range(20):
        robot.step(0.5)
        p = sim.make_payload(robot, i * 0.5, 360, rng)
        assert all(math.hypot(x, y) < diag for x, y in p["points"])


def test_robot_stays_in_room():
    robot = sim.Robot()
    for _ in range(2000):  # 1000 s of driving
        robot.step(0.5)
        assert -4.0 <= robot.x <= 4.0 and -3.0 <= robot.y <= 3.0, (robot.x, robot.y)


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        fn()
        print(f"PASS {fn.__name__}")
    print(f"{len(fns)} tests passed")
