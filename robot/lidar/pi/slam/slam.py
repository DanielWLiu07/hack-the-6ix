"""slam.py — lidar-only 2D SLAM front-end (scan-to-map).

Ties icp.py (motion estimation) + occupancy.py (the map). Consumes the
pose-less `lidar_scan` stream and maintains a global robot pose + occupancy
grid, with zero odometry. Self-contained, pure numpy — deploys on-device
(Pi / UNO Q Linux side).

Usage:
    s = Slam()
    for scan in scans:            # scan: (N,2) robot-frame meters
        x, y, theta = s.update(scan)
    s.grid.render("map.png", s.trajectory)
"""
import math

import numpy as np

from icp import apply_T, decompose, icp, make_T
from occupancy import OccupancyGrid


def voxel_downsample(pts, voxel):
    """Keep one point per `voxel`-sized cell (dedup dense scans cheaply)."""
    if len(pts) == 0:
        return pts
    keys = np.floor(np.asarray(pts) / voxel).astype(np.int64)
    _, idx = np.unique(keys, axis=0, return_index=True)
    return np.asarray(pts)[np.sort(idx)]


class Slam:
    def __init__(self, res=0.05, map_size_m=16.0, ref_voxel=0.08,
                 ref_cap=4000, accept_err=0.22, keyframe_dist=0.15,
                 keyframe_rot=math.radians(8)):
        self.grid = OccupancyGrid(res=res, size_m=map_size_m)
        self.pose_T = np.eye(3)              # world <- robot
        self.prev_delta = np.eye(3)          # last inter-scan motion (ICP seed)
        self.trajectory = []                 # [(x,y), ...] world
        self.ref = None                      # (M,2) world-frame map points for ICP
        self.ref_voxel = ref_voxel
        self.ref_cap = ref_cap
        self.accept_err = accept_err
        self.kf_dist = keyframe_dist
        self.kf_rot = keyframe_rot
        self._last_kf = np.array([0.0, 0.0, 0.0])
        self.n_updates = 0
        self.last_err = 0.0
        self.lost = False

    @property
    def pose(self):
        return decompose(self.pose_T)

    def update(self, scan):
        """Integrate one robot-frame scan. Returns (x, y, theta_rad)."""
        scan = np.asarray(scan, dtype=np.float64)
        scan = scan[np.isfinite(scan).all(axis=1)] if len(scan) else scan
        self.n_updates += 1

        if self.ref is None or len(scan) < 3:
            # bootstrap: first scan defines the world origin/frame
            self._integrate(scan)
            self._add_ref(apply_T(self.pose_T, scan))
            x, y, th = self.pose
            self.trajectory.append((x, y))
            return x, y, th

        # scan-to-map ICP: seed with prev pose * constant-velocity motion prior
        init = self.prev_delta @ self.pose_T
        world_pred = apply_T(init, scan)
        T_corr, err = icp(world_pred, self.ref, init=np.eye(3))
        self.last_err = err

        if err <= self.accept_err:
            new_pose = T_corr @ init
            self.lost = False
        else:
            # match failed (occlusion / fast turn) — coast on the motion prior
            new_pose = init
            self.lost = True

        self.prev_delta = new_pose @ np.linalg.inv(self.pose_T)
        self.pose_T = new_pose
        self._integrate(scan)

        x, y, th = self.pose
        self.trajectory.append((x, y))
        # only grow the ICP reference on meaningful motion (keyframe) — bounds cost + drift
        if self._is_keyframe(x, y, th) and not self.lost:
            self._add_ref(apply_T(self.pose_T, scan))
            self._last_kf = np.array([x, y, th])
        return x, y, th

    # -- internals ---------------------------------------------------------
    def _integrate(self, scan):
        if len(scan) == 0:
            return
        world = apply_T(self.pose_T, scan)
        sensor = self.pose_T[:2, 2]
        self.grid.integrate(sensor, world)

    def _add_ref(self, world_pts):
        world_pts = voxel_downsample(world_pts, self.ref_voxel)
        if self.ref is None:
            self.ref = world_pts
        else:
            self.ref = np.vstack([self.ref, world_pts])
        self.ref = voxel_downsample(self.ref, self.ref_voxel)
        if len(self.ref) > self.ref_cap:                 # keep most-recent
            self.ref = self.ref[-self.ref_cap:]

    def _is_keyframe(self, x, y, th):
        dx = math.hypot(x - self._last_kf[0], y - self._last_kf[1])
        dth = abs((th - self._last_kf[2] + math.pi) % (2 * math.pi) - math.pi)
        return dx >= self.kf_dist or dth >= self.kf_rot

    def slam_update_payload(self, ts, cap=1500):
        """Build the `slam_update` Socket.IO payload (see PLAN.md schema)."""
        x, y, th = self.pose
        return {
            "ts": ts,
            "pose": [round(x, 3), round(y, 3), round(math.degrees(th), 2)],
            "res": self.grid.res,
            "origin": [round(float(self.grid.origin[0]), 3),
                       round(float(self.grid.origin[1]), 3)],
            "cells": self.grid.occupied_cells(cap=cap),
        }
