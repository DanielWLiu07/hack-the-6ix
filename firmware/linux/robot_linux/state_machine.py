"""Pick/sort state machine: SEEK -> ALIGN -> PICK -> SORT -> DROP.

Tick-based and non-blocking: call tick() at config.TICK_HZ; every servo move
is issued with a duration and progress is gated on bridge.is_moving(), so the
same code runs against MockBridge (sim) and the real MCU. `speed` scales all
move durations (tests use a large speed so moves are instant).

Emits events through the on_emit callback:
    on_emit("detection", payload)   # root-schema detection
    on_emit("pick_event", payload)  # root-schema pick_event
    on_emit("state", state_str)     # state changes (for telemetry)
"""

import time

from . import config
from .detector import Detection
from .servoing import is_centered, servo_step

IDLE, SEEK, ALIGN, PICK, SORT, DROP, ESTOP = (
    "IDLE", "SEEK", "ALIGN", "PICK", "SORT", "DROP", "ESTOP")

# Base-yaw sweep waypoints for SEEK (degrees), visited round-robin.
SEEK_SWEEP = [90, 60, 120, 40, 140]
SEEK_STEP_MS = 600


class PickStateMachine:
    def __init__(self, bridge, camera, detector, poses, on_emit=None, speed=1.0):
        self.bridge = bridge
        self.camera = camera
        self.detector = detector
        self.poses = poses
        self.on_emit = on_emit or (lambda kind, payload: None)
        self.speed = speed

        self.state = IDLE
        self.target = None           # {"fruit": ..., "ripeness": ...} filter
        self.current_det = None      # Detection being pursued
        self.pick_started_ts = None
        self._ticks_in_state = 0
        self._settle = 0
        self._sweep_i = 0
        self._seq = None             # in-flight sequence: (steps, index)
        self._det_throttle = 0
        self.continuous = True       # go back to SEEK after DROP
        self.stats = {"picks": 0, "failures": 0}

    # ------------------------------------------------------------- control

    def start(self, target="nearest"):
        """target: 'nearest'|'apple'|'banana' or dict {fruit, ripeness}."""
        if self.state == ESTOP:
            return
        if isinstance(target, str):
            self.target = {} if target in ("nearest", "any", "") else {"fruit": target}
        else:
            self.target = {k: v for k, v in (target or {}).items()
                           if v and v not in ("any", "nearest")}
        self._transition(SEEK)

    def stop(self):
        self.target = None
        self._transition(IDLE)

    def estop(self):
        self.bridge.estop()
        self._transition(ESTOP)

    def clear_estop(self):
        if hasattr(self.bridge, "clear_estop"):
            self.bridge.clear_estop()
        self._transition(IDLE)

    # ------------------------------------------------------------- helpers

    def _transition(self, state):
        if state != self.state:
            self.state = state
            self._ticks_in_state = 0
            self._settle = 0
            self._seq = None
            self.on_emit("state", state)

    def _dur(self, ms):
        return max(0, int(ms / self.speed))

    def _matches(self, det: Detection):
        if det.conf < config.MIN_CONF:
            return False
        for k in ("fruit", "ripeness"):
            want = (self.target or {}).get(k)
            if want and getattr(det, k) != want:
                return False
        return True

    def _detect(self):
        frame = self.camera.read()
        if frame is None:
            return None
        dets = [d for d in self.detector.detect(frame) if self._matches(d)]
        if not dets:
            return None
        # nearest = biggest bbox area
        det = max(dets, key=lambda d: d.bbox[2] * d.bbox[3])
        self._det_throttle += 1
        if self._det_throttle % 5 == 1:  # ~4 Hz at 20 Hz tick
            self.on_emit("detection", det.to_event())
        return det

    def _run_sequence(self, name):
        """Advance a pose sequence one non-blocking step. True when done."""
        if self._seq is None:
            self._seq = (list(self.poses.sequences[name]), 0, False)
        steps, i, issued = self._seq
        if self.bridge.is_moving():
            return False
        if issued:
            i, issued = i + 1, False
        if i >= len(steps):
            self._seq = None
            return True
        pose_name, dur = steps[i][0], self._dur(steps[i][1])
        if pose_name == "grip_open_here":
            joints = self.bridge.get_joints()
            joints[4] = config.GRIPPER_OPEN
            self.bridge.move_servos(joints, dur)
        else:
            self.bridge.move_servos(self.poses.get(pose_name), dur)
        self._seq = (steps, i, True)
        return False

    # ---------------------------------------------------------------- tick

    def tick(self):
        if self.state in (IDLE, ESTOP):
            return
        self._ticks_in_state += 1
        handler = {SEEK: self._tick_seek, ALIGN: self._tick_align,
                   PICK: self._tick_pick, SORT: self._tick_sort,
                   DROP: self._tick_drop}[self.state]
        handler()

    def _tick_seek(self):
        det = self._detect()
        if det is not None:
            self.current_det = det
            self.pick_started_ts = time.time()
            self._transition(ALIGN)
            return
        # sweep base yaw through waypoints until something shows up
        if not self.bridge.is_moving():
            joints = self.bridge.get_joints()
            joints[0] = SEEK_SWEEP[self._sweep_i % len(SEEK_SWEEP)]
            self._sweep_i += 1
            self.bridge.move_servos(joints, self._dur(SEEK_STEP_MS))
        if self._ticks_in_state > config.SEEK_MAX_TICKS:
            self._ticks_in_state = 0  # keep sweeping; nothing else to do

    def _tick_align(self):
        det = self._detect()
        if det is None:
            if self._ticks_in_state > config.ALIGN_MAX_TICKS:
                self._transition(SEEK)
            return
        self.current_det = det
        if is_centered(det.bbox):
            self._settle += 1
            if self._settle >= config.ALIGN_SETTLE_TICKS:
                self._transition(PICK)
            return
        self._settle = 0
        if self._ticks_in_state > config.ALIGN_MAX_TICKS:
            self._transition(SEEK)
            return
        if not self.bridge.is_moving():
            new = servo_step(self.bridge.get_joints(), det.bbox)
            self.bridge.move_servos(new, self._dur(120))

    def _tick_pick(self):
        if self._run_sequence("pick"):
            # in sim, the fruit is now in the gripper: stop rendering it
            if hasattr(self.camera, "remove_fruit"):
                self.camera.remove_fruit()
            self._transition(SORT)

    def _tick_sort(self):
        cls = self.current_det.cls if self.current_det else "apple_ripe"
        if self._ticks_in_state == 1:
            self.bridge.move_servos(self.poses.get(cls), self._dur(1400))
            return
        if not self.bridge.is_moving():
            self._transition(DROP)

    def _tick_drop(self):
        if not self._run_sequence("drop"):
            return
        det = self.current_det
        dur_ms = int((time.time() - (self.pick_started_ts or time.time())) * 1000)
        self.on_emit("pick_event", {
            "ts": int(time.time() * 1000),
            "fruit": det.fruit if det else "apple",
            "ripeness": det.ripeness if det else "ripe",
            "bin": det.cls if det else "apple_ripe",
            "success": True,
            "duration_ms": dur_ms,
        })
        self.stats["picks"] += 1
        self.current_det = None
        if hasattr(self.camera, "spawn_fruit"):
            self.camera.spawn_fruit()
        self.bridge.move_servos(self.poses.get("home"), self._dur(1200))
        self._transition(SEEK if self.continuous else IDLE)
