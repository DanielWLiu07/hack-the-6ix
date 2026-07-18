#!/usr/bin/env python3
"""Sanity tests for scan_match.py. Run: python3 test_scan_match.py (no pytest)."""

import math

import numpy as np

import scan_match as sm
import sim


def _room_scan(seed=0, noise=0.01):
    rng = np.random.default_rng(seed)
    pts = []
    for x0, y0, x1, y1 in sim.static_world():
        for t in np.linspace(0, 1, 30):
            pts.append((x0 + t * (x1 - x0), y0 + t * (y1 - y0)))
    p = np.array(pts)
    return p + rng.normal(0, noise, p.shape)


def test_transform_roundtrip():
    T = sm.make_transform(0.4, -0.2, 0.3)
    pts = np.random.default_rng(0).uniform(-2, 2, (50, 2))
    back = sm.transform_points(np.linalg.inv(T), sm.transform_points(T, pts))
    assert np.allclose(back, pts, atol=1e-9)
    dx, dy, dth = sm.transform_xytheta(T)
    assert abs(dx - 0.4) < 1e-9 and abs(dy + 0.2) < 1e-9 and abs(dth - 0.3) < 1e-9


def test_icp_recovers_known_transform():
    # ICP needs structured geometry (walls), not random points.
    base = _room_scan()
    T_true = sm.make_transform(0.15, -0.08, 0.15)
    moved = sm.transform_points(T_true, base)
    T_est, err = sm.icp(base, moved)
    dx, dy, dth = sm.transform_xytheta(T_est)
    assert abs(dx - 0.15) < 0.02 and abs(dy + 0.08) < 0.02 and abs(dth - 0.15) < 0.02
    assert err < 0.02


def test_icp_robust_to_outliers():
    # Add spurious points (a moving obstacle) to one cloud; rejection should
    # keep the estimate close despite ~15% junk correspondences.
    base = _room_scan(seed=1)
    T_true = sm.make_transform(0.1, 0.05, 0.08)
    moved = sm.transform_points(T_true, base)
    junk = np.random.default_rng(9).uniform(-1, 1, (int(0.15 * len(base)), 2))
    moved = np.vstack([moved, junk])
    T_est, _ = sm.icp(base, moved)
    dx, dy, dth = sm.transform_xytheta(T_est)
    assert abs(dx - 0.1) < 0.04 and abs(dy - 0.05) < 0.04 and abs(dth - 0.08) < 0.04


def test_icp_degenerate_input():
    # Too few points -> returns the init transform, never raises.
    T, err = sm.icp(np.zeros((2, 2)), _room_scan())
    assert np.allclose(T, np.eye(3)) and not math.isfinite(err)


def test_mapper_identity_when_static():
    # A stationary robot: pose must not wander.
    m = sm.ScanMapper()
    scan = _room_scan(seed=2)
    for _ in range(10):
        m.add(scan)
    x, y, th = m.pose
    assert math.hypot(x, y) < 0.05 and abs(th) < math.radians(2)


def test_mapper_tracks_trajectory():
    # Full sim drive at native lidar rate: bounded open-loop drift + clean map.
    robot, rng, m = sim.Robot(), np.random.default_rng(3), sm.ScanMapper()
    dt = 0.1
    x0, y0 = robot.x, robot.y
    for i in range(250):
        robot.step(dt)
        m.add(sim.make_payload(robot, 10 + i * dt, 360, rng)["points"])
    gx, gy, _ = m.pose
    drift = math.hypot(gx - (robot.x - x0), gy - (robot.y - y0))
    assert drift < 2.0, f"drift {drift:.2f} m too high"
    assert len(m.world_points()) > 500, "map suspiciously sparse"
    assert len(m.trajectory) == 251


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        fn()
        print(f"PASS {fn.__name__}")
    print(f"{len(fns)} tests passed")
