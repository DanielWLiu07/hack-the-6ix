"""occupancy.py - log-odds 2D occupancy grid.

The map SLAM builds. Each scan (already in the WORLD frame + the sensor origin)
is integrated with a beam model: cells the beam passes through are marked free,
the endpoint cell is marked occupied, accumulated in log-odds so noise and the
moving obstacle wash out. Pure numpy, fixed-size auto-growing grid, ARM-friendly.

Coordinates: world meters, +x/+y. Grid is indexed [row=y, col=x]; cell (0,0) is
at world `origin`. Call `integrate()` per scan, `render()`/`occupied_cells()` to
read out.
"""
import base64

import numpy as np

# log-odds increments (clamped) - tuned for a 2 Hz noisy scan
L_OCC = 0.85
L_FREE = -0.40
L_MIN, L_MAX = -5.0, 5.0
OCC_THRESH = 0.7          # P(occupied) above this = "occupied" in readouts
FREE_THRESH = 0.3         # P(occupied) below this = "free" in readouts


class OccupancyGrid:
    def __init__(self, res=0.05, size_m=16.0, origin=None):
        self.res = float(res)
        n = int(round(size_m / res))
        self.n = n
        # origin = world coords of grid cell (0,0). Default centers the map.
        self.origin = np.array(origin if origin is not None else [-size_m / 2, -size_m / 2],
                               dtype=np.float64)
        self.log = np.zeros((n, n), dtype=np.float32)

    # world<->grid
    def w2g(self, pts):
        """World (N,2) meters -> integer grid (col=x, row=y)."""
        g = np.floor((np.asarray(pts, dtype=np.float64) - self.origin) / self.res).astype(np.int64)
        return g  # columns: [gx, gy]

    def _in_bounds(self, gx, gy):
        return (gx >= 0) & (gx < self.n) & (gy >= 0) & (gy < self.n)

    def _grow_if_needed(self, gpts):
        """Expand the grid (and shift origin) if points fall outside. Keeps the
        map unbounded without pre-allocating huge arrays."""
        if len(gpts) == 0:
            return
        lo = gpts.min(axis=0)
        hi = gpts.max(axis=0)
        pad = 20
        need_lo = np.minimum(lo - pad, 0)
        need_hi = np.maximum(hi + pad, self.n)
        if (need_lo >= 0).all() and (need_hi <= self.n).all():
            return
        add_lo = np.maximum(-need_lo, 0)                    # cells to prepend [x,y]
        new_n = int(max(need_hi[0] + add_lo[0], need_hi[1] + add_lo[1]))
        new_log = np.zeros((new_n, new_n), dtype=np.float32)
        ox, oy = int(add_lo[0]), int(add_lo[1])
        new_log[oy:oy + self.n, ox:ox + self.n] = self.log
        self.log = new_log
        self.n = new_n
        self.origin = self.origin - np.array([ox, oy]) * self.res

    # integration
    def integrate(self, sensor_xy, world_points):
        """Fuse one scan. sensor_xy: robot position in world (2,).
        world_points: (N,2) beam endpoints already in world frame."""
        world_points = np.asarray(world_points, dtype=np.float64)
        if len(world_points) == 0:
            return
        g_end = self.w2g(world_points)
        g_src = self.w2g(np.asarray(sensor_xy, dtype=np.float64)[None, :])[0]
        self._grow_if_needed(np.vstack([g_end, g_src[None, :]]))
        g_end = self.w2g(world_points)                      # recompute after possible shift
        g_src = self.w2g(np.asarray(sensor_xy)[None, :])[0]

        # free space: Bresenham along every beam, vectorized per-beam
        for gx, gy in g_end:
            self._ray_free(g_src[0], g_src[1], gx, gy)
        # occupied endpoints
        ex, ey = g_end[:, 0], g_end[:, 1]
        m = self._in_bounds(ex, ey)
        np.add.at(self.log, (ey[m], ex[m]), L_OCC)
        np.clip(self.log, L_MIN, L_MAX, out=self.log)

    def _ray_free(self, x0, y0, x1, y1):
        """Mark cells along the beam (excluding endpoint) as free (Bresenham)."""
        dx = abs(x1 - x0)
        dy = -abs(y1 - y0)
        sx = 1 if x0 < x1 else -1
        sy = 1 if y0 < y1 else -1
        err = dx + dy
        x, y = x0, y0
        n = self.n
        log = self.log
        while True:
            if x == x1 and y == y1:
                break
            if 0 <= x < n and 0 <= y < n:
                v = log[y, x] + L_FREE
                log[y, x] = v if v > L_MIN else L_MIN
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x += sx
            if e2 <= dx:
                err += dx
                y += sy

    # readouts
    def prob(self):
        """P(occupied) grid in [0,1]."""
        return 1.0 - 1.0 / (1.0 + np.exp(self.log))

    def occupied_cells(self, cap=1500):
        """List of occupied cells as WORLD-meter [x,y] centers, capped/decimated
        for the `slam_update` payload."""
        ys, xs = np.where(self.prob() >= OCC_THRESH)
        if len(xs) == 0:
            return []
        if len(xs) > cap:                                   # even decimation
            keep = np.linspace(0, len(xs) - 1, cap).astype(np.int64)
            xs, ys = xs[keep], ys[keep]
        wx = self.origin[0] + (xs + 0.5) * self.res
        wy = self.origin[1] + (ys + 0.5) * self.res
        return np.column_stack([wx, wy]).round(3).tolist()

    def slam_map_payload(self, ts, center_xy, size=128):
        """Serialize the `slam_map` payload (docs/SCHEMAS.md).

        This grid grows unbounded, but the schema caps the map at 128x128 cells.
        So crop a `size`-cell window at the grid's native resolution centered on
        the robot (`center_xy`, world meters), pad anything outside the grid with
        UNKNOWN, and threshold to the wire encoding: 0=free 100=occupied
        255=unknown, row-major (index = y*width + x)."""
        n = int(size)
        p = self.prob()
        native = np.full(self.log.shape, 255, np.uint8)
        native[p <= FREE_THRESH] = 0
        native[p >= OCC_THRESH] = 100

        gx, gy = self.w2g(np.asarray(center_xy, dtype=np.float64)[None, :])[0]
        x0 = int(gx) - n // 2
        y0 = int(gy) - n // 2
        out = np.full((n, n), 255, np.uint8)
        sx0, sy0 = max(0, x0), max(0, y0)
        sx1, sy1 = min(self.n, x0 + n), min(self.n, y0 + n)
        if sx1 > sx0 and sy1 > sy0:
            dx0, dy0 = sx0 - x0, sy0 - y0
            out[dy0:dy0 + (sy1 - sy0), dx0:dx0 + (sx1 - sx0)] = native[sy0:sy1, sx0:sx1]

        return {
            "ts": int(ts),
            "resolution": round(self.res, 4),
            "width": n,
            "height": n,
            "origin": [round(float(self.origin[0] + x0 * self.res), 3),
                       round(float(self.origin[1] + y0 * self.res), 3)],
            "data": base64.b64encode(out.tobytes()).decode("ascii"),
        }

    def render(self, path, trajectory=None):
        """Save a PNG (occupied=black, free=white, unknown=grey). Optional
        trajectory: list/array of world (x,y) drawn as a red-ish path."""
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        p = self.prob()
        img = np.full_like(p, 0.5)                          # unknown grey
        img[p >= OCC_THRESH] = 0.0                          # occupied black
        img[p <= 0.3] = 1.0                                 # free white
        fig, ax = plt.subplots(figsize=(6, 6), dpi=110)
        extent = [self.origin[0], self.origin[0] + self.n * self.res,
                  self.origin[1], self.origin[1] + self.n * self.res]
        ax.imshow(img, cmap="gray", origin="lower", extent=extent, vmin=0, vmax=1)
        if trajectory is not None and len(trajectory) > 1:
            tr = np.asarray(trajectory)
            ax.plot(tr[:, 0], tr[:, 1], "-", color="#e64553", lw=1.5, label="robot path")
            ax.plot(tr[-1, 0], tr[-1, 1], "o", color="#1e66f5", ms=6)
            ax.legend(loc="upper right", fontsize=8)
        ax.set_title("C1 SLAM occupancy grid")
        ax.set_xlabel("x (m)"); ax.set_ylabel("y (m)")
        fig.tight_layout()
        fig.savefig(path)
        plt.close(fig)
        return path
