"""MCU bridge abstraction.

The RPC surface matches firmware/CLAUDE.md (and will be reconciled with
firmware/BRIDGE.md once fw-tools publishes it):

    set_drive(l, r)                  # normalized -1..1 tank drive
    move_servos(joints[5], duration_ms)
    heartbeat()
    estop()

MockBridge simulates servo interpolation in wall-clock time so the state
machine and pose replay behave realistically without hardware.
"""

import time
import threading
from collections import deque
from abc import ABC, abstractmethod

from . import config


class Bridge(ABC):
    @abstractmethod
    def set_drive(self, l: float, r: float) -> None: ...

    @abstractmethod
    def move_servos(self, joints, duration_ms: int) -> None: ...

    @abstractmethod
    def heartbeat(self) -> None: ...

    @abstractmethod
    def estop(self) -> None: ...

    @abstractmethod
    def get_joints(self) -> list:
        """Current (commanded/estimated) joint angles, degrees."""

    @abstractmethod
    def get_drive(self) -> dict:
        """Current drive as {"l": float, "r": float}."""

    def is_moving(self) -> bool:
        return False

    def battery_v(self) -> float:
        """Pack voltage in volts. 0.0 = not sensed (telemetry reports it raw)."""
        return 0.0

    def clear_estop(self) -> None:
        """Exit ESTOP. Default no-op for bridges without a latch."""


class MockBridge(Bridge):
    """Simulates the MCU: servos interpolate linearly over duration_ms."""

    def __init__(self, verbose: bool = False):
        self.verbose = verbose
        self._lock = threading.Lock()
        self._start = list(map(float, [90] * config.NUM_JOINTS))
        self._target = list(self._start)
        self._move_t0 = 0.0
        self._move_dur = 0.0
        self._drive = {"l": 0.0, "r": 0.0}
        self._estopped = False
        self.last_heartbeat = 0.0
        self._battery_mv = 12200.0   # freshly charged 3S pack; drains on heartbeat
        # recent (name, args) call log for tests/debug; bounded so a long
        # sim/demo run (hours of judging) never grows without limit.
        self.calls = deque(maxlen=4096)

    def _log(self, name, *args):
        self.calls.append((name, args))
        if self.verbose:
            print(f"[MockBridge] {name}{args}")

    def set_drive(self, l, r):
        with self._lock:
            if self._estopped:
                return
            self._drive = {"l": max(-1.0, min(1.0, float(l))),
                           "r": max(-1.0, min(1.0, float(r)))}
        self._log("set_drive", round(l, 2), round(r, 2))

    def move_servos(self, joints, duration_ms):
        joints = config.clamp_joints(joints)
        with self._lock:
            if self._estopped:
                return
            self._start = self._interp_unlocked()
            self._target = joints
            self._move_t0 = time.monotonic()
            self._move_dur = max(0.0, duration_ms / 1000.0)
        self._log("move_servos", [round(j, 1) for j in joints], duration_ms)

    def heartbeat(self):
        self.last_heartbeat = time.monotonic()
        # simulate a slow discharge so the dashboard battery gauge moves
        with self._lock:
            self._battery_mv = max(10500.0, self._battery_mv - 0.4)

    def battery_v(self):
        with self._lock:
            return round(self._battery_mv / 1000.0, 2)

    def estop(self):
        with self._lock:
            self._estopped = True
            self._drive = {"l": 0.0, "r": 0.0}
            # freeze servos where they are
            frozen = self._interp_unlocked()
            self._start = self._target = frozen
            self._move_dur = 0.0
        self._log("estop")

    def clear_estop(self):
        with self._lock:
            self._estopped = False
        self._log("clear_estop")

    def _interp_unlocked(self):
        if self._move_dur <= 0:
            return list(self._target)
        f = (time.monotonic() - self._move_t0) / self._move_dur
        f = max(0.0, min(1.0, f))
        return [s + (t - s) * f for s, t in zip(self._start, self._target)]

    def get_joints(self):
        with self._lock:
            return self._interp_unlocked()

    def get_drive(self):
        with self._lock:
            return dict(self._drive)

    def is_moving(self):
        with self._lock:
            if self._move_dur <= 0:
                return False
            return (time.monotonic() - self._move_t0) < self._move_dur

    @property
    def estopped(self):
        return self._estopped


class AppLabBridge(Bridge):
    """Real UNO Q bridge via Arduino App Lab Bridge RPC.

    Import is deferred so dev machines without App Lab still load the package.
    Method names follow firmware/CLAUDE.md; adjust to firmware/BRIDGE.md when
    fw-tools finalizes it.
    """

    def __init__(self):
        try:
            from arduino.app_bridge import Bridge as _RPC  # type: ignore
        except ImportError as e:  # pragma: no cover - hardware only
            raise RuntimeError(
                "Arduino App Lab bridge not available on this machine; "
                "use MockBridge (--sim)."
            ) from e
        self._rpc = _RPC()
        self._joints = [90.0] * config.NUM_JOINTS
        self._drive = {"l": 0.0, "r": 0.0}
        self._battery_mv = 0
        self._state = 0  # last MCU safety state from get_status (§2)

    def set_drive(self, l, r):  # pragma: no cover - hardware only
        self._drive = {"l": float(l), "r": float(r)}
        self._rpc.call("set_drive", float(l), float(r))

    def move_servos(self, joints, duration_ms):  # pragma: no cover
        joints = config.clamp_joints(joints)
        self._joints = joints
        self._rpc.call("move_servos", joints, int(duration_ms))

    def heartbeat(self):  # pragma: no cover
        self._rpc.call("heartbeat")

    def estop(self):  # pragma: no cover
        self._drive = {"l": 0.0, "r": 0.0}
        self._rpc.call("estop")

    def clear_estop(self):  # pragma: no cover
        self._rpc.call("clear_estop")

    def get_status(self):  # pragma: no cover
        """Poll the MCU: [state, battery_mv, j0..j4, l_pct, r_pct, ultra_cm] (§3)."""
        st = list(self._rpc.call("get_status"))
        self._state = int(st[0])
        self._battery_mv = int(st[1])
        self._joints = [float(v) for v in st[2:7]]
        self._drive = {"l": st[7] / 100.0, "r": st[8] / 100.0}
        return st

    def battery_v(self):  # pragma: no cover
        return round(self._battery_mv / 1000.0, 2)

    def mcu_state(self):  # pragma: no cover
        """Last MCU safety state code (§2); 3 == ESTOP overrides task state."""
        return self._state

    def get_joints(self):  # pragma: no cover
        return list(self._joints)

    def get_drive(self):  # pragma: no cover
        return dict(self._drive)
