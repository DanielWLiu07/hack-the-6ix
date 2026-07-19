#!/usr/bin/env python3
"""RPLIDAR C1 2D SLAM node (rewrite) - GPIO UART -> slam_pose + slam_map + lidar_scan.

Design goals after the first version diverged to ~300 m of phantom drift on a
STATIONARY sensor:

1. Correct, documented geometry. RPLIDAR reports angle clockwise from the front
   marker; we convert to a right-handed robot frame (x forward, y left).
2. Odometry that CANNOT drift in place. Scan-to-scan point-to-point ICP with:
     - trimmed correspondences (robust to the moving obstacle / partial overlap),
     - a residual gate (a bad match contributes no motion),
     - a physical per-scan limit (reject implausible jumps),
     - a STATIONARITY DEAD-BAND: motion below the sensor noise floor snaps to
       exactly zero. A still lidar therefore holds pose (0,0,0) forever instead
       of integrating noise into hundreds of metres.
3. A probabilistic log-odds occupancy grid (Bresenham free-space ray-casting,
   endpoint = occupied), rolling so it follows the robot, capped 128x128 per the
   schema. This denoises dynamic objects and yields a clean room map.

Self-contained (numpy + pyserial + python-socketio). Emits per root-CLAUDE.md:
  lidar_scan {ts, points:[[x,y]]}                 ~4 Hz
  slam_pose  {ts, x, y, theta}   (theta RADIANS)  ~4 Hz
  slam_map   {ts, resolution, width, height, origin, data(base64 uint8)}  <=0.5 Hz

The SLAM core (icp / OccupancyGrid / SlamCore) is import-safe and unit-tested in
test_c1_slam.py without any hardware.
"""

import argparse
import base64
import math
import os
import sys
import time

import numpy as np

# ------------------------------------------------------------------ geometry

def scan_to_xy(angles_deg, dists_m, angle_offset_deg=0.0):
    """(angle_deg, dist_m) -> (N,2) robot-frame metres. RPLIDAR angle is
    clockwise-from-front; negate to get a right-handed x-fwd/y-left frame."""
    a = np.radians(-(np.asarray(angles_deg) + angle_offset_deg))
    d = np.asarray(dists_m)
    return np.stack([d * np.cos(a), d * np.sin(a)], axis=1)


def _mat(dx, dy, dth):
    c, s = math.cos(dth), math.sin(dth)
    return np.array([[c, -s, dx], [s, c, dy], [0, 0, 1.0]])


def _decompose(T):
    return T[0, 2], T[1, 2], math.atan2(T[1, 0], T[0, 0])


def _apply(T, pts):
    if len(pts) == 0:
        return pts.reshape(0, 2)
    return pts @ T[:2, :2].T + T[:2, 2]


# ----------------------------------------------------------------------- ICP

def icp(src, dst, init=None, max_iter=30, trim=0.75, tol=1e-5):
    """Trimmed point-to-point ICP aligning src onto dst. Returns (T, rms) where
    transform_points(T, src) ~= dst. `trim` keeps only that fraction of the
    closest correspondences each iteration (robust to outliers / dynamic points)."""
    src = np.asarray(src, float)
    dst = np.asarray(dst, float)
    T = np.eye(3) if init is None else init.copy()
    if len(src) < 10 or len(dst) < 10:
        return T, float("inf")
    prev = float("inf")
    rms = float("inf")
    for _ in range(max_iter):
        cur = _apply(T, src)
        # nearest neighbour (brute force is fine for <=400 pts)
        d2 = ((cur[:, None, :] - dst[None, :, :]) ** 2).sum(axis=2)
        idx = d2.argmin(axis=1)
        nn = d2[np.arange(len(cur)), idx]
        k = max(5, int(len(nn) * trim))
        keep = np.argpartition(nn, k - 1)[:k]
        S, D = cur[keep], dst[idx[keep]]
        # best-fit rigid transform (Umeyama, 2D)
        mu_s, mu_d = S.mean(0), D.mean(0)
        H = (S - mu_s).T @ (D - mu_d)
        U, _, Vt = np.linalg.svd(H)
        R = Vt.T @ U.T
        if np.linalg.det(R) < 0:
            Vt[-1] *= -1
            R = Vt.T @ U.T
        step = np.eye(3)
        step[:2, :2] = R
        step[:2, 2] = mu_d - R @ mu_s
        T = step @ T
        rms = float(np.sqrt(nn[keep].mean()))
        if abs(prev - rms) < tol:
            break
        prev = rms
    return T, rms


# ------------------------------------------------------------- occupancy grid

FREE, OCC, UNKNOWN = 0, 100, 255


class OccupancyGrid:
    """Log-odds occupancy grid, rolling to keep the robot centred. Serializes to
    the slam_map payload (uint8 row-major, 0=free 100=occ 255=unknown)."""

    L_FREE, L_OCC, L_CLAMP = -0.35, 0.9, 5.0
    T_FREE, T_OCC = -0.4, 0.4

    def __init__(self, resolution=0.05, size=128):
        self.res = float(resolution)
        self.n = int(size)
        self.log = np.zeros((self.n, self.n), np.float32)
        half = self.n * self.res / 2.0
        self.origin = np.array([-half, -half], float)  # world coord of cell (0,0)

    def _cell(self, xy):
        return np.floor((np.asarray(xy, float) - self.origin) / self.res).astype(int)

    def _recenter(self, pose_xy):
        r = self._cell(pose_xy).reshape(2)
        m = self.n // 4
        c = self.n // 2
        sx = c - r[0] if (r[0] < m or r[0] >= self.n - m) else 0
        sy = c - r[1] if (r[1] < m or r[1] >= self.n - m) else 0
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
            self.origin = self.origin - np.array([sx, sy], float) * self.res

    def integrate(self, pose_xy, world_pts):
        pts = np.asarray(world_pts, float).reshape(-1, 2)
        if len(pts) == 0:
            return
        self._recenter(pose_xy)
        r0 = self._cell(pose_xy).reshape(2)
        ends = self._cell(pts)
        in_b = lambda ix, iy: (ix >= 0) & (ix < self.n) & (iy >= 0) & (iy < self.n)
        free = np.zeros((self.n, self.n), bool)
        # Bresenham-ish free ray for each beam (interior cells free, endpoint occ)
        for ex, ey in ends:
            steps = max(abs(ex - r0[0]), abs(ey - r0[1]))
            if steps <= 1:
                continue
            xs = np.rint(np.linspace(r0[0], ex, steps + 1)).astype(int)[:-1]
            ys = np.rint(np.linspace(r0[1], ey, steps + 1)).astype(int)[:-1]
            ok = in_b(xs, ys)
            free[ys[ok], xs[ok]] = True
        self.log[free] += self.L_FREE
        ex, ey = ends[:, 0], ends[:, 1]
        ok = in_b(ex, ey)
        np.add.at(self.log, (ey[ok], ex[ok]), self.L_OCC)
        np.clip(self.log, -self.L_CLAMP, self.L_CLAMP, out=self.log)

    def to_uint8(self):
        g = np.full((self.n, self.n), UNKNOWN, np.uint8)
        g[self.log <= self.T_FREE] = FREE
        g[self.log >= self.T_OCC] = OCC
        return g

    def payload(self, ts):
        g = self.to_uint8()
        return {
            "ts": int(ts),
            "resolution": round(self.res, 4),
            "width": self.n,
            "height": self.n,
            "origin": [round(float(self.origin[0]), 3), round(float(self.origin[1]), 3)],
            "data": base64.b64encode(g.tobytes()).decode("ascii"),
        }

    def stats(self):
        g = self.to_uint8()
        return {"free": int((g == FREE).sum()), "occ": int((g == OCC).sum()),
                "unknown": int((g == UNKNOWN).sum())}


# ------------------------------------------------------------------ SLAM core

class SlamCore:
    """Scan-to-scan ICP odometry + occupancy grid, with anti-drift gating.

    The gates, in order, are what stop the phantom drift:
      reject  - ICP residual too high (bad geometry / big scene change): coast.
      limit   - motion beyond a physical per-scan bound: reject as spurious.
      deadband- motion below the sensor noise floor: snap to exactly ZERO.
    """

    def __init__(self, resolution=0.05, size=128,
                 dead_trans=0.012, dead_rot=math.radians(0.6),
                 max_trans=0.35, max_rot=math.radians(25.0), accept_rms=0.10):
        self.grid = OccupancyGrid(resolution, size)
        self.pose = np.eye(3)                 # world <- robot
        self.prev = None                      # previous scan points
        self.vel = np.eye(3)                  # last accepted body-frame delta
        self.dead_trans, self.dead_rot = dead_trans, dead_rot
        self.max_trans, self.max_rot = max_trans, max_rot
        self.accept_rms = accept_rms
        self.trajectory = [(0.0, 0.0, 0.0)]
        self.last_rms = 0.0
        self.rejects = 0
        self.n = 0

    def update(self, pts):
        pts = np.asarray(pts, float).reshape(-1, 2)
        moved = False
        if self.prev is not None and len(pts) >= 10:
            delta, rms = icp(pts, self.prev, init=self.vel)
            self.last_rms = rms
            dx, dy, dth = _decompose(delta)
            trans = math.hypot(dx, dy)
            if rms > self.accept_rms:                       # reject: bad match
                dx = dy = dth = 0.0
                self.rejects += 1
            elif trans > self.max_trans or abs(dth) > self.max_rot:  # reject: implausible
                dx = dy = dth = 0.0
                self.rejects += 1
            elif trans < self.dead_trans and abs(dth) < self.dead_rot:  # dead-band
                dx = dy = dth = 0.0
            else:
                moved = True
            delta = _mat(dx, dy, dth)
            self.vel = delta if moved else np.eye(3)
            self.pose = self.pose @ delta
        self.prev = pts
        self.n += 1
        # integrate the scan into the world map at the current pose
        self.grid.integrate(self.pose[:2, 2], _apply(self.pose, pts))
        self.trajectory.append(_decompose(self.pose))
        return _decompose(self.pose)

    def pose_payload(self, ts):
        x, y, th = _decompose(self.pose)
        return {"ts": int(ts), "x": round(float(x), 3), "y": round(float(y), 3),
                "theta": round(float(th), 4)}


# ------------------------------------------------------------------ C1 reader

class C1Reader:
    """RPLIDAR C1 over a serial port. Spins the motor via SET_MOTOR_PWM (there is
    no DTR line on the GPIO wiring), starts a standard scan, and yields full 360
    revolutions as [(angle_deg, dist_mm), ...]."""

    def __init__(self, port, baud=460800, motor_pwm=660):
        import serial
        self.s = serial.Serial(port, baud, timeout=0.5)
        self.pwm = motor_pwm

    def _cmd(self, c, payload=b""):
        pkt = bytes([0xA5, c])
        if payload:
            pkt += bytes([len(payload)]) + payload
            k = 0
            for b in pkt:
                k ^= b
            pkt += bytes([k])
        self.s.write(pkt)
        self.s.flush()

    def start(self):
        self._cmd(0x25); time.sleep(0.3); self.s.reset_input_buffer()   # STOP
        self._cmd(0xF0, bytes([self.pwm & 0xFF, (self.pwm >> 8) & 0xFF]))  # motor
        time.sleep(2.0)
        self._cmd(0x20); self.s.read(7)                                # START_SCAN

    def scans(self):
        buf = bytearray(); cur = []
        while True:
            chunk = self.s.read(2048)
            if chunk:
                buf += chunk
            while len(buf) >= 5:
                b0 = buf[0]
                if ((b0 & 1) == ((b0 >> 1) & 1)) or not (buf[1] & 1):
                    buf.pop(0); continue                               # resync
                node = buf[:5]; del buf[:5]
                start = node[0] & 1
                ang = (((node[2] << 7) | (node[1] >> 1)) / 64.0) % 360.0
                dist = ((node[4] << 8) | node[3]) / 4.0                 # mm
                if start and cur:
                    yield cur
                    cur = []
                if dist > 0:
                    cur.append((ang, dist))

    def stop(self):
        try:
            self._cmd(0x25); self.s.close()
        except Exception:
            pass


# ----------------------------------------------------------------------- main

def run(server_url, port, duration=None):
    import socketio
    sio = socketio.Client(reconnection=True, reconnection_delay=1, reconnection_delay_max=5)

    @sio.event
    def connect():
        print("[c1slam] connected", server_url, file=sys.stderr)

    while True:
        try:
            sio.connect(server_url, auth={"role": "robot"}, wait_timeout=10); break
        except Exception:
            print("[c1slam] hub unreachable, retry 2s", file=sys.stderr); time.sleep(2)

    slam = SlamCore(resolution=float(os.environ.get("SLAM_RES", "0.05")))
    reader = C1Reader(port, motor_pwm=int(os.environ.get("MOTOR_PWM", "660")))
    reader.start()
    offset = float(os.environ.get("ANGLE_OFFSET_DEG", "0"))
    t_scan = t_pose = t_map = 0.0
    start = time.time()
    try:
        for rev in reader.scans():
            if duration and time.time() - start > duration:
                break
            angs = np.array([a for a, _ in rev])
            dists = np.array([d / 1000.0 for _, d in rev])
            pts = scan_to_xy(angs, dists, offset)
            slam.update(pts)
            now = time.time()
            if sio.connected and now - t_scan >= 0.25:
                # lidar_scan carries ROBOT-frame points (x fwd, y left). The web
                # viewport re-applies slam_pose to place them on the world map, so
                # emitting world-frame here double-transforms it (the live sweep
                # drifts/rotates off the map once the rover moves). Send pts as-is
                # to match sim.py / server sim.js and this module's own docstring.
                out = pts if len(pts) <= 360 else pts[:: math.ceil(len(pts) / 360)]
                sio.emit("lidar_scan", {"ts": int(now * 1000),
                         "points": [[round(float(x), 3), round(float(y), 3)] for x, y in out]})
                t_scan = now
            if sio.connected and now - t_pose >= 0.25:
                sio.emit("slam_pose", slam.pose_payload(now * 1000)); t_pose = now
            if sio.connected and now - t_map >= 2.0:
                sio.emit("slam_map", slam.grid.payload(now * 1000)); t_map = now
                x, y, th = _decompose(slam.pose)
                st = slam.grid.stats()
                print(f"[c1slam] pose=({x:+.2f},{y:+.2f},{math.degrees(th):+.0f}d) "
                      f"rms={slam.last_rms*100:.1f}cm rej={slam.rejects} "
                      f"occ={st['occ']} free={st['free']}", file=sys.stderr)
    finally:
        reader.stop(); sio.disconnect()


def main():
    ap = argparse.ArgumentParser(description="RPLIDAR C1 2D SLAM node")
    ap.add_argument("--server", default=os.environ.get("SERVER_URL", "http://localhost:3001"))
    ap.add_argument("--port", default=os.environ.get("LIDAR_PORT", "/dev/ttyAMA0"))
    ap.add_argument("--duration", type=float, default=None)
    run(ap.parse_args().server, ap.parse_args().port, ap.parse_args().duration)


if __name__ == "__main__":
    main()
