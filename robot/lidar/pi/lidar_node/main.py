"""Entry point: lidar → processing → Socket.IO, throttled to EMIT_HZ.

Run:  python -m lidar_node.main
Env:  SERVER_URL, LIDAR_PORT, LIDAR_BAUD, EMIT_HZ, MAX_POINTS,
      ANGLE_OFFSET_DEG, ANGLE_CCW  (see config.py)

Exit codes: 0 clean stop, 2 NO_DEVICE, 3 server unreachable at startup.
run.sh restarts us on any non-zero exit with a delay.
"""

import logging
import signal
import sys
import time

from . import config
from .detect import NoDeviceError
from .emitter import ScanEmitter
from .processing import scan_to_points
from .reader import LidarReader

log = logging.getLogger("lidar.main")

_running = True


def _stop(signum, _frame):
    global _running
    log.info("signal %s — shutting down", signum)
    _running = False


def run() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)

    log.info(
        "lidar node starting: server=%s port=%s emit=%.1fHz max_pts=%d",
        config.SERVER_URL, config.LIDAR_PORT or "(autodetect)",
        config.EMIT_HZ, config.MAX_POINTS,
    )

    emitter = ScanEmitter(config.SERVER_URL)
    try:
        emitter.connect()
    except Exception as e:
        log.error("cannot reach server %s: %s", config.SERVER_URL, e)
        return 3

    if config.LIDAR_MOCK:
        from .reader import MockLidarReader

        reader = MockLidarReader()
    else:
        reader = LidarReader(port=config.LIDAR_PORT, baud=config.LIDAR_BAUD)
    try:
        port = reader.connect()
    except NoDeviceError as e:
        log.error("%s", e)
        emitter.close()
        return 2

    log.info("reading scans from %s", port)
    min_period = 1.0 / config.EMIT_HZ if config.EMIT_HZ > 0 else 0.0
    last_emit = 0.0
    emitted = 0
    try:
        for sweep in reader.scans():
            if not _running:
                break
            now = time.time()
            if now - last_emit < min_period:
                continue  # lidar spins ~5-10 Hz; skip sweeps between emits
            points = scan_to_points(
                sweep,
                max_points=config.MAX_POINTS,
                min_range_m=config.MIN_RANGE_M,
                max_range_m=config.MAX_RANGE_M,
                angle_offset_deg=config.ANGLE_OFFSET_DEG,
                ccw=bool(config.ANGLE_CCW),
            )
            if not points:
                continue
            emitter.emit_scan(points, ts=now)
            last_emit = now
            emitted += 1
            if emitted % 20 == 0:
                log.info("emitted %d scans (last: %d pts)", emitted, len(points))
    except Exception as e:
        # Serial hiccup mid-stream: exit non-zero, run.sh restarts us.
        log.error("scan stream died: %s", e)
        return 1
    finally:
        reader.disconnect()
        emitter.close()
    return 0


if __name__ == "__main__":
    sys.exit(run())
