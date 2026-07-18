"""Camera abstraction: eye-in-hand camera on the arm.

MockCamera renders a synthetic frame containing one "fruit" blob whose image
position responds to arm joints - moving base yaw shifts the blob in x,
moving shoulder shifts it in y. That closes the loop for visual-servoing
ALIGN testing with zero hardware.
"""

import random
from abc import ABC, abstractmethod

import numpy as np

from . import config


class Camera(ABC):
    @abstractmethod
    def read(self):
        """Return an HxWx3 uint8 BGR frame, or None if unavailable."""

    def close(self):
        pass


class MockCamera(Camera):
    """Synthetic scene tied to a bridge's joint state.

    The fruit sits at a world angle (base_deg, shoulder_deg). Its position in
    the frame is the error between the arm's current joints and that world
    angle, scaled - i.e. jogging the arm toward the fruit centers it, exactly
    like a real eye-in-hand camera.
    """

    # degrees of joint error that maps to half a frame of image offset
    DEG_PER_HALF_FRAME = 20.0

    # --- sim-only range model (so APPROACH's drive commands do something) ------
    # A real eye-in-hand camera grows the fruit's bbox as the rover drives up to
    # it; MockCamera otherwise has no notion of distance, so we fake it here.
    # `range` shrinks with forward drive (bigger bbox) and `base_heading` yaws
    # with differential drive (pans the fruit toward center) - closing exactly
    # the loop navigation.approach_step() steers. Reset on every spawn_fruit().
    # Advanced PER camera read() (tick-based, NOT wall-clock) so it behaves the
    # same in the 20 Hz node and in fast no-sleep test loops. At APPROACH_FWD=0.5
    # the range closes ~0.03/tick -> ~70 ticks (~3.5 s at 20 Hz) to reach in-reach.
    FAR_RANGE = 3.0          # spawn distance (arbitrary units)
    NEAR_RANGE = 0.5         # can't get closer than this
    SIZE_K = 150.0           # bbox side px = SIZE_K / range (closer -> bigger)
    SIZE_MIN_PX = 40
    SIZE_MAX_PX = 260
    RANGE_STEP = 0.06        # range units closed per read() per unit forward drive
    TURN_STEP = 0.5          # base yaw deg per read() per unit of (l - r) differential

    FRUITS = [
        ("apple", "ripe", (0, 0, 200)),      # red   (BGR)
        ("apple", "unripe", (0, 180, 0)),    # green
        ("banana", "ripe", (0, 200, 230)),   # yellow
        ("banana", "unripe", (60, 180, 60)),  # green-yellow
    ]

    def __init__(self, bridge, w=config.FRAME_W, h=config.FRAME_H, seed=None):
        self.bridge = bridge
        self.w, self.h = w, h
        self.rng = random.Random(seed)
        self.fruit = None  # (fruit, ripeness, color, base_deg, shoulder_deg)
        self.range = self.FAR_RANGE      # sim distance to fruit
        self.base_heading = 0.0          # sim rover yaw from differential drive
        self.spawn_fruit()

    def spawn_fruit(self, fruit=None, ripeness=None, near_joints=None):
        choices = self.FRUITS
        if fruit:
            choices = [f for f in choices if f[0] == fruit] or self.FRUITS
        if ripeness:
            choices = [f for f in choices if f[1] == ripeness] or choices
        kind = self.rng.choice(choices)
        # Place fruit within +-15 deg of a reference pose so it's in view.
        # near_joints lets the caller present the fruit relative to the arm's
        # SEEK/rest pose rather than wherever it currently is (e.g. a bin pose
        # after a drop, which SEEK's base sweep may not reach).
        joints = near_joints if near_joints is not None else self.bridge.get_joints()
        base = joints[0] + self.rng.uniform(-15, 15)
        shoulder = joints[1] + self.rng.uniform(-12, 12)
        self.fruit = (*kind, base, shoulder)
        # new fruit starts far away and dead ahead; APPROACH must drive up to it
        self.range = self.FAR_RANGE
        self.base_heading = 0.0

    def remove_fruit(self):
        self.fruit = None

    def fruit_class(self):
        if not self.fruit:
            return None
        return self.fruit[0], self.fruit[1]

    def _sim_step(self):
        """Advance the sim world one camera read() by the latest drive command.

        Sim-only: lets APPROACH's set_drive() commands actually move the world
        (forward closes range -> bbox grows; turning yaws heading -> fruit pans
        toward center). Tick-based (one step per read), so it's deterministic and
        behaves the same in the 20 Hz node and in fast no-sleep test loops.
        """
        drive = self.bridge.get_drive()
        fwd = (drive["l"] + drive["r"]) / 2.0
        diff = drive["l"] - drive["r"]
        self.range = max(self.NEAR_RANGE,
                         min(self.FAR_RANGE, self.range - self.RANGE_STEP * fwd))
        self.base_heading += self.TURN_STEP * diff

    def _fruit_center_px(self):
        """Where the fruit lands in the frame given current joints + rover yaw."""
        if not self.fruit:
            return None
        joints = self.bridge.get_joints()
        _, _, _, base, shoulder = self.fruit
        # base_heading (rover yaw from driving) pans the fruit just like arm yaw
        ex = (base - joints[0] - self.base_heading) / self.DEG_PER_HALF_FRAME
        ey = (shoulder - joints[1]) / self.DEG_PER_HALF_FRAME
        cx = self.w / 2 + ex * (self.w / 2)
        cy = self.h / 2 + ey * (self.h / 2)
        return cx, cy

    def visible(self):
        c = self._fruit_center_px()
        if c is None:
            return False
        cx, cy = c
        return -0.1 * self.w <= cx <= 1.1 * self.w and -0.1 * self.h <= cy <= 1.1 * self.h

    def ground_truth_bbox(self):
        """[x, y, w, h] of the synthetic fruit, or None if off-frame."""
        if not self.visible():
            return None
        cx, cy = self._fruit_center_px()
        # bbox grows as the rover closes the range (sim proxy for getting closer)
        size = int(max(self.SIZE_MIN_PX, min(self.SIZE_MAX_PX, self.SIZE_K / self.range)))
        return [int(cx - size / 2), int(cy - size / 2), size, size]

    def read(self):
        self._sim_step()   # advance the sim world by the latest drive command
        frame = np.full((self.h, self.w, 3), 40, dtype=np.uint8)
        bbox = self.ground_truth_bbox()
        if bbox:
            color = self.fruit[2]
            x, y, w, h = bbox
            x0, y0 = max(0, x), max(0, y)
            x1, y1 = min(self.w, x + w), min(self.h, y + h)
            if x1 > x0 and y1 > y0:
                frame[y0:y1, x0:x1] = color
        return frame


class CVCamera(Camera):
    """Real USB camera via OpenCV. Import deferred: cv2 optional on dev box."""

    def __init__(self, index=config.CAMERA_INDEX):
        import cv2  # noqa: deferred heavy import
        self._cv2 = cv2
        self.cap = cv2.VideoCapture(index)
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, config.FRAME_W)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, config.FRAME_H)
        if not self.cap.isOpened():
            raise RuntimeError(f"camera index {index} failed to open")

    def read(self):
        ok, frame = self.cap.read()
        return frame if ok else None

    def close(self):
        self.cap.release()
