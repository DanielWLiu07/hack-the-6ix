"""Pick/sort state machine: [NAV ->] SEEK -> APPROACH -> ALIGN -> PICK -> SORT -> DROP.

Tick-based and non-blocking: call tick() at config.TICK_HZ; every servo move
is issued with a duration and progress is gated on bridge.is_moving(), so the
same code runs against MockBridge (sim) and the real MCU. `speed` scales all
move durations (tests use a large speed so moves are instant).

Two ways in to a pick:
  * stationary (no lidar / navigate=False): SEEK sweeps the arm in place to
    acquire a fruit, then APPROACH drives up to it. (Original PR #8 behavior.)
  * navigating (lidar feed present): an outer NAV state ROAMs the rover around
    (obstacle-safe, via nav.NavController + the Pi lidar feed) while the camera
    scans; on a detection it hands to APPROACH, which is now lidar-gated so it
    won't drive into an obstacle. After a drop it returns to NAV for the next
    plant. NAV/roam is what makes this a rover that finds fruit, not just an arm
    that reaches for fruit already in view.

Emits events through the on_emit callback:
    on_emit("detection", payload)   # root-schema detection
    on_emit("pick_event", payload)  # root-schema pick_event
    on_emit("state", state_str)     # state changes (for telemetry)
"""

import time

from . import config
from .detector import Detection
from .nav import NavController
from .navigation import approach_step, in_reach
from .servoing import bbox_error, is_centered, servo_step

IDLE, NAV, SEEK, APPROACH, ALIGN, PICK, SORT, DROP, ESTOP = (
    "IDLE", "NAV", "SEEK", "APPROACH", "ALIGN", "PICK", "SORT", "DROP", "ESTOP")

# States that command the wheels; leaving them for a non-driving state halts.
DRIVING = (NAV, APPROACH)

# Base-yaw sweep waypoints for SEEK (degrees), visited round-robin.
SEEK_SWEEP = [90, 60, 120, 40, 140]
SEEK_STEP_MS = 600


def _clamp1(v):
    return max(-1.0, min(1.0, v))


class PickStateMachine:
    def __init__(self, bridge, camera, detector, poses, on_emit=None, speed=1.0,
                 lidar=None, nav=None):
        self.bridge = bridge
        self.camera = camera
        self.detector = detector
        self.poses = poses
        self.on_emit = on_emit or (lambda kind, payload: None)
        self.speed = speed

        # outer drive-to-fruit autonomy (optional). lidar is a LidarFeed-shaped
        # feed; nav is a NavController (default is fine, tuning is via config).
        self.lidar = lidar
        self.nav = nav or NavController()
        self.navigate = False        # set by start(navigate=...)
        self.nav_status = None       # last NavCommand, for telemetry/logs

        self.state = IDLE
        self.target = None           # {"fruit": ..., "ripeness": ...} filter
        self.current_det = None      # Detection being pursued
        self.pick_started_ts = None
        self._ticks_in_state = 0
        self._settle = 0
        self._sweep_i = 0
        self._seq = None             # in-flight sequence: (steps, index)
        self._det_throttle = 0
        self.continuous = True       # go back to NAV/SEEK after DROP
        self.stats = {"picks": 0, "failures": 0}

    # control

    def start(self, target="nearest", navigate=None):
        """target: 'nearest'|'apple'|'banana' or dict {fruit, ripeness}.

        navigate: roam to a plant (NAV) before picking. Defaults to True when a
        lidar feed was supplied, else False (stationary SEEK-then-pick).
        """
        if self.state == ESTOP:
            return
        if isinstance(target, str):
            self.target = {} if target in ("nearest", "any", "") else {"fruit": target}
        else:
            self.target = {k: v for k, v in (target or {}).items()
                           if v and v not in ("any", "nearest")}
        self.navigate = (self.lidar is not None) if navigate is None else navigate
        self._transition(NAV if self.navigate else SEEK)

    def stop(self):
        self.target = None
        self.bridge.set_drive(0.0, 0.0)   # halt the wheels if we were driving
        self._transition(IDLE)

    def estop(self):
        self.bridge.estop()
        self._transition(ESTOP)

    def clear_estop(self):
        if hasattr(self.bridge, "clear_estop"):
            self.bridge.clear_estop()
        self._transition(IDLE)

    # helpers

    def _transition(self, state):
        if state != self.state:
            # leaving a driving state (NAV/APPROACH) for a non-driving one: halt
            # the wheels. Covers every exit - lost target, timeout, in-reach,
            # estop - but keeps the wheels rolling across NAV<->APPROACH.
            if self.state in DRIVING and state not in DRIVING:
                self.bridge.set_drive(0, 0)
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

    # tick

    def tick(self):
        if self.state in (IDLE, ESTOP):
            return
        self._ticks_in_state += 1
        handler = {NAV: self._tick_nav, SEEK: self._tick_seek,
                   APPROACH: self._tick_approach, ALIGN: self._tick_align,
                   PICK: self._tick_pick, SORT: self._tick_sort,
                   DROP: self._tick_drop}[self.state]
        handler()

    def _tick_nav(self):
        """Roam the rover around while the camera scans. On a detection, hand to
        APPROACH (which drives up to it); otherwise drive per the lidar roam
        planner (forward while clear, turn toward open space when blocked)."""
        det = self._detect()
        if det is not None:
            self.current_det = det
            self.pick_started_ts = time.time()
            self._transition(APPROACH)
            return
        cmd = self.nav.roam(self.lidar)
        self.bridge.set_drive(cmd.l, cmd.r)
        self.nav_status = cmd
        # never wedge silently: reset the counter so roam continues indefinitely
        # (there's simply nothing to pick yet).
        if self._ticks_in_state > config.NAV_MAX_TICKS:
            self._ticks_in_state = 0

    def _tick_seek(self):
        det = self._detect()
        if det is not None:
            self.current_det = det
            self.pick_started_ts = time.time()
            # drive up to it first; ALIGN (arm) takes over once it's in reach.
            self._transition(APPROACH)
            return
        # sweep base yaw through waypoints until something shows up
        if not self.bridge.is_moving():
            joints = self.bridge.get_joints()
            joints[0] = SEEK_SWEEP[self._sweep_i % len(SEEK_SWEEP)]
            self._sweep_i += 1
            self.bridge.move_servos(joints, self._dur(SEEK_STEP_MS))
        if self._ticks_in_state > config.SEEK_MAX_TICKS:
            self._ticks_in_state = 0  # keep sweeping; nothing else to do

    def _resume_state(self):
        """Where to go when a pursuit ends: keep roaming if navigating, else
        fall back to the stationary arm sweep."""
        return NAV if self.navigate else SEEK

    def _tick_approach(self):
        det = self._detect()
        if det is None:
            # lost sight of it while driving: stop and re-scan / re-roam
            if self._ticks_in_state > config.ALIGN_MAX_TICKS:
                self._transition(self._resume_state())
            return
        self.current_det = det
        if in_reach(det.bbox):
            self._transition(ALIGN)   # close enough; arm centers + picks
            return
        if self._ticks_in_state > config.APPROACH_MAX_TICKS:
            self._transition(self._resume_state())   # gave up; keep hunting
            return
        l, r = approach_step(det.bbox)
        # lidar safety: steer by vision, but veto/taper forward translation near
        # an obstacle or when the feed is stale (fail-safe). Rotation to hold the
        # fruit centered is always allowed; only forward creep is gated.
        if self.navigate and self.lidar is not None:
            allow, scale, _ = self.nav.forward_gate(self.lidar)
            if not allow or scale < 1.0:
                ex, _ = bbox_error(det.bbox)
                turn = config.APPROACH_TURN_GAIN * ex
                fwd = config.APPROACH_FWD * scale if allow else 0.0
                l, r = _clamp1(fwd + turn), _clamp1(fwd - turn)
        self.bridge.set_drive(l, r)

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
        home = self.poses.get("home")
        self.bridge.move_servos(home, self._dur(1200))
        if hasattr(self.camera, "spawn_fruit"):
            # present the next fruit relative to the rest pose SEEK starts from,
            # not the bin pose the arm is currently in (SEEK's base sweep may
            # not reach an extreme bin angle).
            self.camera.spawn_fruit(near_joints=home)
        self._transition(self._resume_state() if self.continuous else IDLE)
