"""icp.py — compact 2D point-to-point ICP (SE(2) lidar odometry).

Pure numpy, no scipy. Aligns a source scan onto a reference point set and
returns the rigid transform (x, y, theta) that best maps source→reference.
Used by slam.py as the scan-matching front-end that recovers robot motion
from the pose-less `lidar_scan` stream.
"""
import math

import numpy as np


def rot(theta):
    c, s = math.cos(theta), math.sin(theta)
    return np.array([[c, -s], [s, c]], dtype=np.float64)


def make_T(x, y, theta):
    """3x3 homogeneous SE(2)."""
    T = np.eye(3)
    T[:2, :2] = rot(theta)
    T[0, 2], T[1, 2] = x, y
    return T


def apply_T(T, pts):
    """Apply 3x3 transform to (N,2) points."""
    pts = np.asarray(pts, dtype=np.float64)
    if len(pts) == 0:
        return pts.reshape(0, 2)
    h = np.hstack([pts, np.ones((len(pts), 1))])
    return (h @ T.T)[:, :2]


def decompose(T):
    """(x, y, theta) from a 3x3 transform."""
    return float(T[0, 2]), float(T[1, 2]), math.atan2(T[1, 0], T[0, 0])


def _nearest(src, dst):
    """Brute-force NN: for each src point, index+sq-dist of nearest dst point.

    O(len(src)*len(dst)); both are capped (≤360 scan pts, subsampled ref) so
    this stays cheap enough for on-device 2 Hz. Chunked to bound peak memory.
    """
    n, m = len(src), len(dst)
    idx = np.empty(n, dtype=np.int64)
    d2 = np.empty(n, dtype=np.float64)
    step = max(1, 4096 // max(1, m))
    for i in range(0, n, step):
        s = src[i:i + step]                       # (k,2)
        diff = s[:, None, :] - dst[None, :, :]    # (k,m,2)
        dd = np.einsum('kmc,kmc->km', diff, diff)
        j = dd.argmin(axis=1)
        idx[i:i + step] = j
        d2[i:i + step] = dd[np.arange(len(s)), j]
    return idx, d2


def _best_fit(src, dst):
    """Least-squares SE(2) mapping src→dst (Umeyama/Kabsch, 2D, no scale)."""
    mu_s = src.mean(axis=0)
    mu_d = dst.mean(axis=0)
    H = (src - mu_s).T @ (dst - mu_d)
    U, _, Vt = np.linalg.svd(H)
    R = Vt.T @ U.T
    if np.linalg.det(R) < 0:          # reflection guard
        Vt[-1] *= -1
        R = Vt.T @ U.T
    t = mu_d - R @ mu_s
    T = np.eye(3)
    T[:2, :2] = R
    T[:2, 2] = t
    return T


def icp(src, dst, max_iter=24, tol=1e-5, reject_pct=75.0, init=None):
    """Align `src` (N,2) onto `dst` (M,2). Returns (T, rms_error).

    reject_pct: keep the closest `reject_pct`% of correspondences each iter
    (robust to the moving obstacle / partial overlap). init: optional 3x3
    motion prior (e.g. previous inter-scan delta) to seed convergence.
    """
    src = np.asarray(src, dtype=np.float64)
    dst = np.asarray(dst, dtype=np.float64)
    if len(src) < 3 or len(dst) < 3:
        return (init if init is not None else np.eye(3)), float("inf")

    T = init.copy() if init is not None else np.eye(3)
    cur = apply_T(T, src)
    prev_err = float("inf")
    err = float("inf")
    for _ in range(max_iter):
        idx, d2 = _nearest(cur, dst)
        thresh = np.percentile(d2, reject_pct)
        keep = d2 <= max(thresh, 1e-9)
        if keep.sum() < 3:
            break
        step = _best_fit(cur[keep], dst[idx[keep]])
        T = step @ T
        cur = apply_T(T, src)
        err = math.sqrt(float(np.mean(d2[keep])))
        if abs(prev_err - err) < tol:
            break
        prev_err = err
    return T, err
