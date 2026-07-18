"""SLAM unit + offline-integration tests. Pure numpy, no hardware.

Run: cd robot/lidar/pi/slam && python3 -m pytest tests/ -q
"""
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from icp import apply_T, decompose, icp, make_T          # noqa: E402
from occupancy import OccupancyGrid                        # noqa: E402
from slam import Slam, voxel_downsample                    # noqa: E402
import synth                                               # noqa: E402


# ---- ICP -----------------------------------------------------------------
def test_icp_recovers_known_transform():
    # Realistic input: a room scan (not a random/gridded cloud, which alias under
    # nearest-neighbour matching). Point-to-point ICP on discretely-sampled beams
    # nails translation and recovers rotation within a couple degrees — the small
    # residual bias is corrected in SLAM by map accumulation (see drift test).
    scan = synth.cast_scan((0, 0, 0), synth.room_segments(), beams=180)
    T_true = make_T(0.3, 0.2, math.radians(12))
    dst = apply_T(T_true, scan)
    T_est, err = icp(scan, dst)
    x, y, th = decompose(T_est)
    assert err < 0.07
    assert abs(x - 0.3) < 0.02 and abs(y - 0.2) < 0.02
    assert abs(th - math.radians(12)) < math.radians(2.5)


def test_icp_robust_to_outliers():
    rng = np.random.default_rng(2)
    src = rng.uniform(-3, 3, (150, 2))
    T_true = make_T(0.2, 0.1, math.radians(5))
    dst = apply_T(T_true, src)
    dst[:20] += rng.uniform(-5, 5, (20, 2))       # 13% gross outliers
    T_est, _ = icp(src, dst, reject_pct=70)
    x, y, th = decompose(T_est)
    assert abs(x - 0.2) < 0.06 and abs(y - 0.1) < 0.06
    assert abs(th - math.radians(5)) < math.radians(2)


def test_icp_degenerate_inputs():
    T, err = icp(np.zeros((0, 2)), np.zeros((0, 2)))
    assert err == float("inf")
    assert np.allclose(T, np.eye(3))


# ---- occupancy grid ------------------------------------------------------
def test_occupancy_free_and_occupied():
    g = OccupancyGrid(res=0.1, size_m=8.0)
    # one beam straight ahead, endpoint at (2,0)
    g.integrate(sensor_xy=[0, 0], world_points=[[2.0, 0.0]])
    p = g.prob()
    # endpoint cell occupied
    end = g.w2g([[2.0, 0.0]])[0]
    assert p[end[1], end[0]] > 0.6
    # a cell midway along the beam should read free-er than the occupied endpoint
    # (a single L_FREE pass ≈ 0.40; assert clearly below the occupied endpoint)
    mid = g.w2g([[1.0, 0.0]])[0]
    assert p[mid[1], mid[0]] < 0.45
    assert p[mid[1], mid[0]] < p[end[1], end[0]]


def test_occupancy_grows_past_bounds():
    g = OccupancyGrid(res=0.1, size_m=2.0)     # tiny 2 m grid
    n0 = g.n
    g.integrate(sensor_xy=[0, 0], world_points=[[5.0, 5.0]])  # way outside
    assert g.n > n0
    end = g.w2g([[5.0, 5.0]])[0]
    assert g._in_bounds(np.array([end[0]]), np.array([end[1]]))[0]


def test_occupied_cells_capped():
    g = OccupancyGrid(res=0.05, size_m=10.0)
    rng = np.random.default_rng(3)
    pts = rng.uniform(-3, 3, (500, 2))
    for _ in range(6):
        g.integrate([0, 0], pts)
    cells = g.occupied_cells(cap=100)
    assert len(cells) <= 100
    assert all(len(c) == 2 for c in cells)


# ---- voxel ---------------------------------------------------------------
def test_voxel_downsample_dedups():
    pts = np.array([[0.01, 0.01], [0.02, 0.02], [1.0, 1.0]])
    out = voxel_downsample(pts, 0.1)
    assert len(out) == 2      # first two collapse into one voxel


# ---- offline SLAM integration -------------------------------------------
def test_slam_tracks_loop_with_bounded_drift():
    poses, scans = synth.dataset(steps=120, beams=180, seed=0)
    s = Slam()
    est = []
    for sc in scans:
        x, y, th = s.update(sc)
        est.append((x, y))
    est = np.array(est)
    gt = np.array([(p[0], p[1]) for p in poses])
    # SLAM bootstraps its own gauge frame (robot at origin, heading 0) — the map is
    # correct up to a global rigid transform. Map the estimate into the GT world
    # frame using the known initial pose (R(theta0), gt[0]) before measuring drift.
    th0 = poses[0][2]
    R = np.array([[math.cos(th0), -math.sin(th0)], [math.sin(th0), math.cos(th0)]])
    est_world = (R @ est.T).T + gt[0]
    err = np.linalg.norm(est_world - gt, axis=1)
    assert err.mean() < 0.10, f"mean drift {err.mean():.3f} m too high"
    assert err.max() < 0.30, f"max drift {err.max():.3f} m too high"


def test_slam_map_is_coherent():
    _, scans = synth.dataset(steps=100, beams=180, seed=1)
    s = Slam()
    for sc in scans:
        s.update(sc)
    p = s.grid.prob()
    occ = (p >= 0.7).sum()
    free = (p <= 0.3).sum()
    assert occ > 100, "map has too few occupied cells — walls not captured"
    assert free > occ, "map should have more free space than walls"
    payload = s.slam_update_payload(ts=123)
    assert payload["ts"] == 123 and len(payload["pose"]) == 3
    assert len(payload["cells"]) > 0
