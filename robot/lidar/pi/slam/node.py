#!/usr/bin/env python3
"""node.py - live on-device SLAM node.

Subscribes to the hub's `lidar_scan` stream, runs the lidar-only 2D SLAM
(icp + occupancy grid), and publishes the master-approved `slam_pose` (2 Hz)
and `slam_map` (0.5 Hz, 128x128 base64 occupancy grid) back to the hub for the
web lidar view. Also renders a map PNG periodically (offline proof + demo-backup
footage).

This is the piece that runs ON-DEVICE (Raspberry Pi now / Arduino UNO Q Linux
side for the Qualcomm on-device story) - pure numpy, no ROS. In the dev/sim
setup, scans arrive via the hub; on the real robot the same node runs beside
the C1 reader (scans routed through the hub identically).

Env / flags:
    SERVER_URL (env) or --server   hub URL (default http://localhost:3001)
    --map-out PATH                  where to render map.png (default ./slam_map.png)
    --map-every N                   render every N scans (default 20; 0 = never)
    --no-emit                       compute + render only, don't publish SLAM events
    --duration S                    run for S seconds then exit (default: forever)

Relay note: the hub relays `slam_map`/`slam_pose` robot->ui (ROBOT_EVENTS in
web/server/index.js). This node connects as `ui` so it can *receive* lidar_scan,
and emits the SLAM events back; the hub relays them to the dashboards.
"""
import argparse
import logging
import os
import signal
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from slam import Slam  # noqa: E402

log = logging.getLogger("slam.node")


class SlamNode:
    def __init__(self, server_url, map_out, map_every, emit, emit_hz=2.0):
        self.server_url = server_url
        self.map_out = map_out
        self.map_every = map_every
        self.emit = emit
        self.emit_interval = 1.0 / emit_hz if emit_hz > 0 else 0.0
        self.map_interval = 1.0 / 0.5   # slam_map capped at 0.5 Hz per schema
        self.slam = Slam()
        self._sio = None
        self._n = 0
        self._last_emit = 0.0
        self._last_map_emit = 0.0
        self._running = True

    def connect(self):
        import socketio  # lazy
        sio = socketio.Client(reconnection=True, reconnection_delay=1,
                              reconnection_delay_max=10)

        @sio.event
        def connect():
            log.info("connected to hub %s (role=ui, subscribing to lidar_scan)", self.server_url)

        @sio.event
        def disconnect():
            log.warning("disconnected (auto-reconnecting)")

        @sio.on("lidar_scan")
        def on_scan(payload):
            self._on_scan(payload)

        sio.connect(self.server_url, wait_timeout=10)   # default role 'ui' -> receives lidar_scan
        self._sio = sio

    def _on_scan(self, payload):
        pts = payload.get("points") if isinstance(payload, dict) else None
        if not pts:
            return
        t0 = time.perf_counter()
        self.slam.update(pts)
        dt_ms = (time.perf_counter() - t0) * 1000.0
        self._n += 1

        now = time.time()
        if self.emit and self._sio is not None and self._sio.connected:
            x, y, th = self.slam.pose
            if (now - self._last_emit) >= self.emit_interval:
                try:
                    self._sio.emit("slam_pose", {
                        "ts": int(now * 1000),
                        "x": round(float(x), 3),
                        "y": round(float(y), 3),
                        "theta": round(float(th), 4),   # radians
                    })
                except Exception as e:
                    log.warning("slam_pose emit failed: %s", e)
                self._last_emit = now
            if (now - self._last_map_emit) >= self.map_interval:
                try:
                    self._sio.emit("slam_map", self.slam.grid.slam_map_payload(
                        ts=int(now * 1000), center_xy=(x, y)))
                except Exception as e:
                    log.warning("slam_map emit failed: %s", e)
                self._last_map_emit = now

        if self.map_every and self._n % self.map_every == 0:
            self._render()
        if self._n % 10 == 0:
            x, y, th = self.slam.pose
            log.info("scan %d  pose=(%.2f,%.2f,%.0f°)  %.1f ms  refN=%d  lost=%s",
                     self._n, x, y, __import__("math").degrees(th), dt_ms,
                     0 if self.slam.ref is None else len(self.slam.ref), self.slam.lost)

    def _render(self):
        try:
            self.slam.grid.render(self.map_out, self.slam.trajectory)
            log.info("rendered map -> %s", self.map_out)
        except Exception as e:
            log.warning("render failed: %s", e)

    def run(self, duration=None):
        self.connect()
        signal.signal(signal.SIGTERM, lambda *_: self.stop())
        signal.signal(signal.SIGINT, lambda *_: self.stop())
        start = time.time()
        while self._running:
            time.sleep(0.2)
            if duration and (time.time() - start) >= duration:
                break
        self._render()  # final map
        if self._sio is not None:
            self._sio.disconnect()
        log.info("stopped after %d scans", self._n)

    def stop(self):
        self._running = False


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    ap = argparse.ArgumentParser(description="Live on-device 2D SLAM node")
    ap.add_argument("--server", default=os.environ.get("SERVER_URL", "http://localhost:3001"))
    ap.add_argument("--map-out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "slam_map.png"))
    ap.add_argument("--map-every", type=int, default=20)
    ap.add_argument("--no-emit", action="store_true")
    ap.add_argument("--duration", type=float, default=None)
    args = ap.parse_args()

    node = SlamNode(args.server, args.map_out, args.map_every, emit=not args.no_emit)
    try:
        node.run(duration=args.duration)
    except Exception as e:
        log.error("node error: %s", e)
        sys.exit(3)


if __name__ == "__main__":
    main()
