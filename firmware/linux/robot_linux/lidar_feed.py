"""LidarFeed - Uno Q-side client for the Pi's direct lidar autonomy feed.

Consumes the newline-delimited-JSON TCP stream served by
robot/lidar/pi/direct_feed.py (Pi -> Uno Q, no hub, no internet, stdlib only).
Runs a background reader thread and exposes the latest obstacle summary + SLAM
pose to the decision stack. All accessors are non-blocking and return None when
the feed is stale, so the state machine can fail safe (treat "no fresh lidar" as
"assume something is close / don't drive forward").

Zero third-party deps (stdlib socket + json), matching the Pi side - a control
input shouldn't hinge on a package install on the board.

Wiring into robot_node (sketch):

    from robot_linux.lidar_feed import LidarFeed
    lidar = LidarFeed(os.environ.get("LIDAR_FEED_HOST", "rpi.local")).start()
    ...
    # in the drive / APPROACH step, before commanding forward:
    clr = lidar.forward_clearance()          # meters, or None if stale
    if clr is not None and clr < STOP_DIST_M:
        drive_forward = 0.0                  # reflex stop; sonar remains the hard backstop

This module is a STUB: it delivers fresh data to robot_node but does not itself
change driving logic - that wiring lives in the state machine and is gated on a
real hardware drive-test.
"""
import json
import socket
import threading
import time


class LidarFeed:
    def __init__(self, host="rpi.local", port=8766, stale_ms=600):
        self.host = host
        self.port = int(port)
        self.stale_s = stale_ms / 1000.0
        self._lock = threading.Lock()
        self._latest = None          # last decoded message dict
        self._rx = 0.0               # monotonic time of last message
        self._stop = threading.Event()
        self._thread = None

    # -- lifecycle -----------------------------------------------------------
    def start(self):
        if self._thread and self._thread.is_alive():
            return self
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, daemon=True, name="lidar-feed")
        self._thread.start()
        return self

    def stop(self):
        self._stop.set()

    def _run(self):
        while not self._stop.is_set():
            try:
                sock = socket.create_connection((self.host, self.port), timeout=3)
                sock.settimeout(1.0)
                buf = b""
                while not self._stop.is_set():
                    try:
                        chunk = sock.recv(4096)
                    except socket.timeout:
                        continue
                    if not chunk:
                        break                       # peer closed
                    buf += chunk
                    while b"\n" in buf:
                        line, buf = buf.split(b"\n", 1)
                        if not line.strip():
                            continue
                        try:
                            msg = json.loads(line)
                        except (ValueError, TypeError):
                            continue
                        with self._lock:
                            self._latest = msg
                            self._rx = time.monotonic()
                sock.close()
            except Exception:
                time.sleep(1.0)                     # connect failed / dropped: back off, retry

    # -- accessors (non-blocking, None when stale) ---------------------------
    def is_fresh(self):
        with self._lock:
            return self._latest is not None and (time.monotonic() - self._rx) <= self.stale_s

    def _get(self):
        with self._lock:
            if self._latest is None or (time.monotonic() - self._rx) > self.stale_s:
                return None
            return self._latest

    def raw(self):
        return self._get()

    def pose(self):
        m = self._get()
        return m.get("pose") if m else None

    def nearest(self):
        """{'range': m, 'bearing': deg} of the closest return, or None."""
        m = self._get()
        return m.get("nearest") if m else None

    def forward_clearance(self):
        """Min range (m) in the forward cone, or None if stale/empty."""
        m = self._get()
        return m.get("forward_clearance") if m else None

    def sectors(self):
        m = self._get()
        return m.get("sectors") if m else None


if __name__ == "__main__":
    import os, sys
    host = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("LIDAR_FEED_HOST", "rpi.local")
    port = int(sys.argv[2]) if len(sys.argv) > 2 else int(os.environ.get("LIDAR_FEED_PORT", "8766"))
    print(f"[lidar_feed] connecting {host}:{port} (Ctrl-C to stop)")
    feed = LidarFeed(host, port).start()
    try:
        while True:
            time.sleep(0.5)
            if not feed.is_fresh():
                print("stale / waiting...")
                continue
            print(f"fwd_clear={feed.forward_clearance()}m  nearest={feed.nearest()}  pose={feed.pose()}")
    except KeyboardInterrupt:
        feed.stop()
        print("\nbye")
