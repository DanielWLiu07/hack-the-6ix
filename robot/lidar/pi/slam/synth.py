"""synth.py — synthetic room + trajectory raycaster for offline SLAM testing.

Generates ground-truth robot poses and the corresponding robot-frame
`lidar_scan` point sets, so slam.py can be validated without hardware and
bench.py has a deterministic workload. Deterministic given a seed.
"""
import math

import numpy as np


def _box(cx, cy, w, h):
    x0, x1 = cx - w / 2, cx + w / 2
    y0, y1 = cy - h / 2, cy + h / 2
    return [(x0, y0, x1, y0), (x1, y0, x1, y1), (x1, y1, x0, y1), (x0, y1, x0, y0)]


def room_segments():
    """A structured 8x6 m room with obstacles — good SLAM features."""
    segs = []
    segs += _box(0, 0, 8.0, 6.0)      # outer walls
    segs += _box(-2.4, 1.6, 1.0, 0.8)  # crate
    segs += _box(2.6, -1.8, 0.9, 0.9)  # crate
    segs += _box(2.2, 1.9, 1.4, 0.6)   # bench
    return np.array(segs, dtype=np.float64)


def loop_trajectory(steps=120, radius=2.0):
    """A smooth loop through the room (returns list of (x,y,theta))."""
    poses = []
    for i in range(steps):
        t = 2 * math.pi * i / steps
        x = radius * math.cos(t)
        y = 1.2 * math.sin(t)
        # heading tangent to the path
        theta = math.atan2(1.2 * math.cos(t) * (2 * math.pi / steps),
                           -radius * math.sin(t) * (2 * math.pi / steps))
        poses.append((x, y, theta))
    return poses


def cast_scan(pose, segments, beams=180, max_range=8.0, rng=None, noise=0.01):
    """Raycast `beams` rays from pose=(x,y,theta) against wall segments.
    Returns (K,2) ROBOT-FRAME hit points (x fwd, y left)."""
    x, y, theta = pose
    angs = np.linspace(-math.pi, math.pi, beams, endpoint=False)
    pts = []
    for a in angs:
        wa = a + theta
        dx, dy = math.cos(wa), math.sin(wa)
        best = max_range
        for sx0, sy0, sx1, sy1 in segments:
            ex, ey = sx1 - sx0, sy1 - sy0
            denom = dx * ey - dy * ex
            if abs(denom) < 1e-12:
                continue
            tt = ((sx0 - x) * ey - (sy0 - y) * ex) / denom
            uu = ((sx0 - x) * dy - (sy0 - y) * dx) / denom
            if tt > 1e-4 and 0 <= uu <= 1 and tt < best:
                best = tt
        if best < max_range:
            r = best + (rng.normal(0, noise) if rng is not None else 0.0)
            pts.append((r * math.cos(a), r * math.sin(a)))   # robot frame
    return np.array(pts, dtype=np.float64) if pts else np.zeros((0, 2))


def dataset(steps=120, beams=180, seed=0):
    """(ground_truth_poses, robot_frame_scans) for a loop through the room."""
    rng = np.random.default_rng(seed)
    segs = room_segments()
    poses = loop_trajectory(steps=steps)
    scans = [cast_scan(p, segs, beams=beams, rng=rng) for p in poses]
    return poses, scans
