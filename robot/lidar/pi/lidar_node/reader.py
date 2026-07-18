"""Lidar scan source: yields full revolutions as (angle_deg, distance_m) lists.

Backends (lazy-imported, first available wins):
  1. pyrplidar          — measurement stream with start_flag per revolution
  2. rplidar-roboticia  — iter_scans() yields whole revolutions

Both cover RPLIDAR A1/A2-style serial protocols. All hardware imports stay
inside methods so unit tests run without any lidar libs installed.
"""

import logging
import time

from .detect import NoDeviceError, find_lidar_port

log = logging.getLogger("lidar.reader")


class MockLidarReader:
    """Drop-in LidarReader that synthesizes sweeps of a 4×4 m room at ~7 Hz.

    Enables end-to-end testing (and a venue demo fallback) with zero hardware:
    LIDAR_MOCK=1 python -m lidar_node.main
    """

    def connect(self) -> str:
        log.warning("MOCK lidar active — synthesizing scans")
        return "mock://room4x4"

    def disconnect(self):
        pass

    def scans(self):
        import math

        t = 0.0
        while True:
            sweep = []
            for i in range(720):
                a = i * 0.5
                # square room walls + a slowly orbiting obstacle
                r = math.radians(a % 90.0 - 45.0)
                d = 2.0 / max(math.cos(r), 0.2)
                obst_ang = (t * 30.0) % 360.0
                if abs((a - obst_ang + 180.0) % 360.0 - 180.0) < 8.0:
                    d = 1.0
                sweep.append((a, d))
            yield sweep
            t += 1.0 / 7.0
            time.sleep(1.0 / 7.0)  # real A1 spins ~5.5-10 Hz


class LidarReader:
    """Owns the serial connection; `scans()` yields one full 360° sweep."""

    def __init__(self, port: str = "", baud: int = 115200):
        self.port = port
        self.baud = baud
        self._backend = None
        self._dev = None

    # -- lifecycle -----------------------------------------------------

    def connect(self) -> str:
        """Resolve the port and open it. Raises NoDeviceError if absent."""
        resolved = find_lidar_port(self.port)
        last_err: "Exception|None" = None

        try:
            from pyrplidar import PyRPlidar

            dev = PyRPlidar()
            dev.connect(port=resolved, baudrate=self.baud, timeout=3)
            dev.set_motor_pwm(500)
            time.sleep(2)  # let the motor spin up
            self._dev, self._backend = dev, "pyrplidar"
            log.info("connected via pyrplidar on %s", resolved)
            return resolved
        except ImportError:
            pass
        except Exception as e:  # port exists but handshake failed
            last_err = e

        try:
            from rplidar import RPLidar

            dev = RPLidar(resolved, baudrate=self.baud, timeout=3)
            dev.start_motor()
            self._dev, self._backend = dev, "rplidar"
            log.info("connected via rplidar-roboticia on %s", resolved)
            return resolved
        except ImportError:
            pass
        except Exception as e:
            last_err = e

        if last_err is not None:
            raise NoDeviceError(
                f"NO_DEVICE: found port {resolved} but lidar handshake failed: {last_err}"
            )
        raise NoDeviceError(
            "NO_DEVICE: no lidar backend installed "
            "(pip install pyrplidar or rplidar-roboticia)"
        )

    def disconnect(self):
        if self._dev is None:
            return
        try:
            if self._backend == "pyrplidar":
                self._dev.stop()
                self._dev.set_motor_pwm(0)
                self._dev.disconnect()
            elif self._backend == "rplidar":
                self._dev.stop()
                self._dev.stop_motor()
                self._dev.disconnect()
        except Exception:
            pass  # already gone — we're tearing down anyway
        self._dev = None
        self._backend = None

    # -- scanning ------------------------------------------------------

    def scans(self):
        """Generator of full revolutions: each item is [(angle_deg, dist_m), ...].

        Raises RuntimeError if called before connect(); propagates serial
        errors to the caller (main loop handles reconnect).
        """
        if self._dev is None:
            raise RuntimeError("scans() before connect()")
        if self._backend == "pyrplidar":
            yield from self._scans_pyrplidar()
        else:
            yield from self._scans_rplidar()

    def _scans_pyrplidar(self):
        gen = self._dev.start_scan_express(4)
        current: "list[tuple[float, float]]" = []
        for m in gen():
            if m.start_flag and current:
                yield current
                current = []
            if m.distance > 0:  # 0 = invalid return
                current.append((m.angle, m.distance / 1000.0))

    def _scans_rplidar(self):
        # iter_scans yields [(quality, angle_deg, distance_mm), ...] per sweep
        for sweep in self._dev.iter_scans(max_buf_meas=3000):
            yield [(a, d / 1000.0) for (_q, a, d) in sweep if d > 0]
