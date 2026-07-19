"""Socket.IO client that ships `lidar_scan` events to the laptop hub.

Payload (docs/SCHEMAS.md, do not drift):
    "lidar_scan" {"ts": <epoch_s>, "points": [[x, y], ...]}   # meters, ≤360
"""

import logging
import time

log = logging.getLogger("lidar.emitter")


class ScanEmitter:
    def __init__(self, server_url: str):
        self.server_url = server_url
        self._sio = None

    def connect(self):
        import socketio  # lazy: unit tests don't need it

        sio = socketio.Client(
            reconnection=True,
            reconnection_delay=1,
            reconnection_delay_max=10,
        )

        @sio.event
        def connect():
            log.info("socket.io connected to %s", self.server_url)

        @sio.event
        def disconnect():
            log.warning("socket.io disconnected (auto-reconnecting)")

        sio.connect(self.server_url, wait_timeout=10)
        self._sio = sio

    def emit_scan(self, points: "list[list[float]]", ts: "float|None" = None):
        """Send one lidar_scan. Silently drops the frame while disconnected -
        stale scans are worthless, the next one arrives in ≤0.5 s."""
        if self._sio is None or not self._sio.connected:
            return False
        payload = {"ts": ts if ts is not None else time.time(), "points": points}
        try:
            self._sio.emit("lidar_scan", payload)
            return True
        except Exception as e:
            log.warning("emit failed: %s", e)
            return False

    def close(self):
        if self._sio is not None:
            try:
                self._sio.disconnect()
            except Exception:
                pass
            self._sio = None
