#!/usr/bin/env python3
"""Scan matching (lidar odometry) for the pose-less `lidar_scan` stream.

The `lidar_scan` schema carries NO robot pose - every scan is in the *current*
robot frame (radar-style). This module recovers ego-motion by aligning each new
scan to the previous one with point-to-point ICP, then chains those relative
transforms into a global trajectory + world-frame point map. That turns the
robot-centered stream into a "SLAM-lite" map without any odometry from the base.

Numpy-only (no scipy) - brute-force nearest-neighbour is fine at <=360 pts.

Core API:
    T = icp(src, dst)                 # 3x3 homogeneous transform mapping src->dst
    mapper = ScanMapper()             # streaming accumulator
    mapper.add(points)                # feed successive scans (Nx2, robot frame)
    mapper.pose                       # current (x, y, theta) in world frame
    mapper.world_points()             # all accumulated points in world frame

Run `python scan_match.py` for a self-test that recovers a known trajectory.
"""

import math

import numpy as np


# ------------------------------------------------------------- rigid transforms

def _rot(theta):
    c, s = math.cos(theta), math.sin(theta)
    return np.array([[c, -s], [s, c]])


def make_transform(dx, dy, dtheta):
    """3x3 homogeneous SE(2) transform."""
    T = np.eye(3)
    T[:2, :2] = _rot(dtheta)
    T[0, 2], T[1, 2] = dx, dy
    return T


def transform_points(T, pts):
    """Apply a 3x3 homogeneous transform to (N,2) points."""
    if len(pts) == 0:
        return pts.reshape(0, 2)
    h = np.hstack([pts, np.ones((len(pts), 1))])
    return (h @ T.T)[:, :2]


def transform_xytheta(T):
    """Decompose a 3x3 transform into (x, y, theta)."""
    return T[0, 2], T[1, 2], math.atan2(T[1, 0], T[0, 0])


# --------------------------------------------------------------------------- NN

def _nearest(src, dst):
    """For each src point, index + sq-distance of nearest dst point (brute force)."""
    # (Ns, Nd) squared distances via broadcasting; fine for <=360x360.
    d2 = ((src[:, None, :] - dst[None, :, :]) ** 2).sum(axis=2)
    idx = d2.argmin(axis=1)
    return idx, d2[np.arange(len(src)), idx]


def _best_fit_transform(src, dst):
    """Least-squares SE(2) mapping src->dst (Umeyama / Kabsch, 2D, no scale)."""
    mu_s, mu_d = src.mean(axis=0), dst.mean(axis=0)
    S, D = src - mu_s, dst - mu_d
    H = S.T @ D
    U, _, Vt = np.linalg.svd(H)
    R = Vt.T @ U.T
    if np.linalg.det(R) < 0:          # reflection guard
        Vt[-1, :] *= -1
        R = Vt.T @ U.T
    t = mu_d - R @ mu_s
    T = np.eye(3)
    T[:2, :2] = R
    T[:2, 2] = t
    return T


# -------------------------------------------------------------------------- ICP

def icp(src, dst, max_iter=30, tol=1e-5, reject_pct=80.0, init=None):
    """Align `src` onto `dst` with point-to-point ICP.

    Returns a 3x3 transform T such that transform_points(T, src) ~= dst, plus
    the final mean correspondence error. `reject_pct` keeps only the closest
    that fraction of correspondences each iteration (robust to partial overlap /
    the moving obstacle / points entering & leaving the field of view).
    """
    src = np.asarray(src, float)
    dst = np.asarray(dst, float)
    if len(src) < 3 or len(dst) < 3:
        return (init if init is not None else np.eye(3)), float("inf")

    T = np.eye(3) if init is None else init.copy()
    cur = transform_points(T, src)
    prev_err = float("inf")
    err = float("inf")
    for _ in range(max_iter):
        idx, d2 = _nearest(cur, dst)
        thresh = np.percentile(d2, reject_pct)
        m = d2 <= thresh
        if m.sum() < 3:
            break
        step = _best_fit_transform(cur[m], dst[idx][m])
        T = step @ T
        cur = transform_points(T, src)
        err = float(np.sqrt(d2[m].mean()))
        if abs(prev_err - err) < tol:
            break
        prev_err = err
    return T, err


# ----------------------------------------------------------------- streaming map

class ScanMapper:
    """SLAM-lite front-end: scan-to-map ICP -> global trajectory + world map.

    Feed successive `lidar_scan` point arrays (robot frame). Each scan is aligned
    against the *accumulated world map* (a stable reference), not merely the
    previous scan - this is what keeps open-loop drift low, since per-scan errors
    no longer compound. A constant-velocity prior seeds each alignment so sharp
    turns still converge, and a motion-consistency gate rejects the occasional
    wild ICP result (coasting on the prior instead). The map is voxel-deduped so
    memory stays bounded over a long demo run.

    Reads the `lidar_scan` schema only (no pose in the stream) - everything here
    is recovered from geometry.
    """

    def __init__(self, voxel=0.05, accept_err=0.18,
                 gate_m=0.28, gate_rad=math.radians(22.0)):
        self.pose_T = np.eye(3)          # world <- current robot frame
        self.last_delta = np.eye(3)      # body-frame pose delta (const-vel prior)
        self.voxel = voxel
        # Absolute residual ceiling. Scan-to-map residual naturally sits higher
        # than scan-to-scan (the map has point thickness), so this is generous;
        # an adaptive median gate below catches real tracking loss.
        self.accept_err = accept_err
        self.gate_m = gate_m             # max |acceleration| in translation / step
        self.gate_rad = gate_rad         # max |angular acceleration| / step
        self._err_hist = []              # recent residuals for the adaptive gate
        self._voxels = {}                # (ix,iy) -> (x,y), world-frame map
        self._ref_cache = None           # cached coarse match reference (np array)
        self._ref_dirty = True
        self.match_voxel = max(voxel, 0.08)  # coarser grid for the ICP reference
        self.max_ref_pts = 1200          # cap NN cost against the growing map
        self.trajectory = [(0.0, 0.0, 0.0)]
        self.last_error = 0.0
        self.rejects = 0

    @property
    def pose(self):
        return transform_xytheta(self.pose_T)

    def add(self, points):
        pts = np.asarray(points, float).reshape(-1, 2)
        if len(pts) < 3:
            self.trajectory.append(transform_xytheta(self.pose_T))
            return self.pose

        ref = self._match_ref()
        if len(ref) >= 3:
            # Predict pose with constant velocity, align scan (in world frame)
            # to the map, then correct. Working in the world frame keeps the ICP
            # init near-identity because the prediction is already close, so a
            # few iterations suffice.
            pose_pred = self.pose_T @ self.last_delta
            cur_world = transform_points(pose_pred, pts)
            corr, err = icp(cur_world, ref, max_iter=15)
            pose_new = corr @ pose_pred
            delta = np.linalg.inv(self.pose_T) @ pose_new    # body-frame delta
            self.last_error = err
            ddx, ddy, ddth = transform_xytheta(
                np.linalg.inv(self.last_delta) @ delta)
            # Adaptive residual ceiling: reject only if clearly worse than the
            # recent norm (median x3), never on a residual that's just typical.
            med = float(np.median(self._err_hist)) if self._err_hist else err
            err_bad = err > self.accept_err and err > 3.0 * med
            if err_bad or math.hypot(ddx, ddy) > self.gate_m \
                    or abs(ddth) > self.gate_rad:
                delta = self.last_delta                      # distrust; coast
                self.rejects += 1
            else:
                self._err_hist.append(err)
                if len(self._err_hist) > 30:
                    self._err_hist.pop(0)
            self.last_delta = delta
            self.pose_T = self.pose_T @ delta

        self.trajectory.append(transform_xytheta(self.pose_T))
        self._accumulate(pts)
        return self.pose

    def _accumulate(self, pts):
        world = transform_points(self.pose_T, pts)
        v = self.voxel
        for x, y in world:
            self._voxels[(round(x / v), round(y / v))] = (x, y)
        self._ref_dirty = True

    def _match_ref(self):
        """Coarse, capped world-map subset used as the ICP alignment target.
        Rebuilt lazily; keeps NN cost bounded as the full map grows."""
        if self._ref_dirty or self._ref_cache is None:
            pts = self.world_points()
            if len(pts):
                v = self.match_voxel
                coarse = {}
                for x, y in pts:
                    coarse[(round(x / v), round(y / v))] = (x, y)
                arr = np.array(list(coarse.values()))
                if len(arr) > self.max_ref_pts:
                    step = int(np.ceil(len(arr) / self.max_ref_pts))
                    arr = arr[::step]
                self._ref_cache = arr
            else:
                self._ref_cache = np.zeros((0, 2))
            self._ref_dirty = False
        return self._ref_cache

    def world_points(self):
        if not self._voxels:
            return np.zeros((0, 2))
        return np.array(list(self._voxels.values()))


# -------------------------------------------------------------------- self-test

def _room_outline_points(n_per_seg=25, noise=0.01, seed=0):
    """Sample points along the sim room walls - what a real scan looks like."""
    import sim
    rng = np.random.default_rng(seed)
    pts = []
    for x0, y0, x1, y1 in sim.static_world():
        for t in np.linspace(0, 1, n_per_seg):
            pts.append((x0 + t * (x1 - x0), y0 + t * (y1 - y0)))
    p = np.array(pts)
    return p + rng.normal(0, noise, p.shape)


def _self_test():
    """Two checks: (1) ICP recovers a known transform on structured geometry;
    (2) streamed odometry tracks the sim robot with bounded drift when scans
    arrive at the lidar's native rate (~10 Hz), not the 2 Hz server throttle."""
    import sim

    # (1) Core ICP on room-like geometry, moderate rotation (within basin).
    base = _room_outline_points()
    T_true = make_transform(0.15, -0.08, 0.15)
    moved = transform_points(T_true, base)
    T_est, e = icp(base, moved)
    dx, dy, dth = transform_xytheta(T_est)
    ok_icp = (abs(dx - 0.15) < 0.02 and abs(dy + 0.08) < 0.02
              and abs(dth - 0.15) < 0.02)
    print(f"synthetic ICP: est=({dx:+.3f},{dy:+.3f},{dth:+.3f}) "
          f"true=(+0.150,-0.080,+0.150) err={e*100:.2f} cm  "
          f"{'PASS' if ok_icp else 'FAIL'}")

    # (2) Streaming odometry. Native lidar rate: RPLIDAR C1 ~10 Hz. Scan-matching
    # runs on the Pi at full rate; only the *display* stream is throttled to 2 Hz.
    robot = sim.Robot()
    rng = np.random.default_rng(3)
    mapper = ScanMapper()
    dt = 0.1                          # 10 Hz -> small inter-scan motion
    x0, y0, th0 = robot.x, robot.y, robot.theta   # sim starts theta=0
    N = 250                          # 25 s of driving
    for i in range(N):
        robot.step(dt)
        p = sim.make_payload(robot, 10.0 + i * dt, 360, rng)
        mapper.add(p["points"])

    # Mapper origin == first-scan frame == robot start (theta0=0), so the mapper
    # world frame coincides with the sim world frame; compare pose directly.
    gx, gy, gth = mapper.pose
    tx, ty = robot.x - x0, robot.y - y0
    drift = math.hypot(gx - tx, gy - ty)
    total_path = sum(
        math.hypot(mapper.trajectory[k + 1][0] - mapper.trajectory[k][0],
                   mapper.trajectory[k + 1][1] - mapper.trajectory[k][1])
        for k in range(len(mapper.trajectory) - 1))
    print(f"odometry: scans={N}  recovered end=({gx:+.2f},{gy:+.2f})  "
          f"truth end=({tx:+.2f},{ty:+.2f})  drift={drift:.3f} m  "
          f"path_len={total_path:.2f} m  map_pts={len(mapper.world_points())}  "
          f"last_icp_err={mapper.last_error*100:.1f} cm")

    # Open-loop scan-to-map drift; moving obstacle + range noise + no loop
    # closure inject error. Allow ~2 m over a ~13 m path (~15%) - this is a
    # wow-feature demo of lidar odometry, not metric-grade SLAM.
    ok_drift = drift < 2.0
    print(f"trajectory drift {'PASS' if ok_drift else 'FAIL'} "
          f"({drift:.3f} m over {total_path:.1f} m, "
          f"{100*drift/max(total_path,1e-6):.1f}%)")
    return ok_icp and ok_drift


if __name__ == "__main__":
    import sys
    sys.exit(0 if _self_test() else 1)
