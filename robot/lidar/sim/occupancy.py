#!/usr/bin/env python3
"""Compact log-odds occupancy grid for the SLAM producer.

Turns a stream of (pose, world-frame scan points) into a probabilistic
occupancy grid, then serializes it to the master-approved `slam_map` payload:

    uint8 grid, row-major, values: 0 = free, 100 = occupied, 255 = unknown.

Each scan raycasts: cells the beam passes through are evidence of free space,
the endpoint cell is evidence of occupied. Log-odds accumulation denoises the
moving obstacle and range noise (a single stray hit cannot flip a cell). Numpy
only. Grid is fixed size (<=128x128 per schema) with a fixed world origin.
"""

import base64

import numpy as np

FREE, OCC, UNKNOWN = 0, 100, 255

L_FREE = -0.4          # log-odds delta for a cell a beam passed through
L_OCC = 0.85           # log-odds delta for a beam endpoint
L_CLAMP = 6.0          # keep log-odds bounded so cells can still change
OCC_THRESH = 0.5       # log-odds above this renders occupied
FREE_THRESH = -0.5     # below this renders free


class OccupancyGrid:
    def __init__(self, resolution=0.08, size=128, origin=None):
        self.res = float(resolution)
        self.w = self.h = int(size)
        # Default: center the grid on the world origin (span = size*res).
        if origin is None:
            half = self.w * self.res / 2.0
            origin = (-half, -half)
        self.origin = np.asarray(origin, float)   # world coord of cell (0,0) corner
        self.log = np.zeros((self.h, self.w), np.float32)

    # -- world <-> cell -------------------------------------------------

    def to_cell(self, xy):
        """(N,2) world meters -> (N,2) int cell indices (ix, iy)."""
        c = np.floor((np.asarray(xy, float) - self.origin) / self.res).astype(int)
        return c

    def _in_bounds(self, ix, iy):
        return (ix >= 0) & (ix < self.w) & (iy >= 0) & (iy < self.h)

    # -- integration ----------------------------------------------------

    def _maybe_recenter(self, pose_xy):
        """Rolling grid: if the robot nears an edge, shift the grid to re-center
        it (np.roll + clear the vacated strip) so the map never clips as the
        robot explores. Keeps fine resolution within the 128-cell cap."""
        r = self.to_cell(pose_xy).reshape(2)
        margin = self.w // 4
        cx, cy = self.w // 2, self.h // 2
        sx = cx - r[0] if (r[0] < margin or r[0] >= self.w - margin) else 0
        sy = cy - r[1] if (r[1] < margin or r[1] >= self.h - margin) else 0
        if sx or sy:
            self.log = np.roll(self.log, (sy, sx), axis=(0, 1))
            if sx > 0:
                self.log[:, :sx] = 0
            elif sx < 0:
                self.log[:, sx:] = 0
            if sy > 0:
                self.log[:sy, :] = 0
            elif sy < 0:
                self.log[sy:, :] = 0
            # keep world positions fixed: origin shifts opposite the roll
            self.origin = self.origin - np.array([sx, sy], float) * self.res

    def integrate(self, pose_xy, points_world):
        """Fuse one scan. pose_xy: robot world (x,y). points_world: (N,2)."""
        pts = np.asarray(points_world, float).reshape(-1, 2)
        if len(pts) == 0:
            return
        self._maybe_recenter(pose_xy)
        r0 = self.to_cell(pose_xy).reshape(2)
        ends = self.to_cell(pts)                       # (N,2)
        free = np.zeros((self.h, self.w), bool)
        for ex, ey in ends:
            # sample the ray robot->endpoint in cell space, mark interior free
            n = max(abs(ex - r0[0]), abs(ey - r0[1]))
            if n <= 1:
                continue
            xs = np.linspace(r0[0], ex, n + 1).round().astype(int)[:-1]
            ys = np.linspace(r0[1], ey, n + 1).round().astype(int)[:-1]
            m = self._in_bounds(xs, ys)
            free[ys[m], xs[m]] = True
        self.log[free] += L_FREE
        # occupied endpoints (win over free if a cell is both)
        ex, ey = ends[:, 0], ends[:, 1]
        m = self._in_bounds(ex, ey)
        np.add.at(self.log, (ey[m], ex[m]), L_OCC)
        np.clip(self.log, -L_CLAMP, L_CLAMP, out=self.log)

    # -- serialization --------------------------------------------------

    def to_uint8(self):
        g = np.full((self.h, self.w), UNKNOWN, np.uint8)
        g[self.log <= FREE_THRESH] = FREE
        g[self.log >= OCC_THRESH] = OCC
        return g

    def slam_map_payload(self, ts):
        g = self.to_uint8()
        return {
            "ts": int(ts),
            "resolution": round(self.res, 4),
            "width": self.w,
            "height": self.h,
            "origin": [round(float(self.origin[0]), 3),
                       round(float(self.origin[1]), 3)],
            "data": base64.b64encode(g.tobytes()).decode("ascii"),
        }

    def stats(self):
        g = self.to_uint8()
        return {"free": int((g == FREE).sum()),
                "occ": int((g == OCC).sum()),
                "unknown": int((g == UNKNOWN).sum())}
