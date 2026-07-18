"""Synthetic test-image generator for the fruit detectors.

Generates frames that look roughly like 3D-printed apples/bananas on a table:
matte, uniformly-colored blobs on a noisy neutral background. Used to tune the
HSV detector and to feed pipeline/bench when no camera is attached.

Ground truth format matches the root-schema detection dict minus ts/conf:
    {"fruit": "apple"|"banana", "ripeness": "ripe"|"unripe", "bbox": [x, y, w, h]}
"""

import random

import cv2
import numpy as np

# BGR base colors for matte 3D-printed PLA under indoor light
COLORS = {
    ("apple", "ripe"): (40, 40, 200),     # red
    ("apple", "unripe"): (60, 160, 70),   # green
    ("banana", "ripe"): (50, 200, 230),   # yellow
    ("banana", "unripe"): (70, 180, 120), # yellow-green
}

CLASSES = list(COLORS.keys())


def _jitter_color(bgr, amount=25, rng=None):
    rng = rng or random
    return tuple(int(np.clip(c + rng.randint(-amount, amount), 0, 255)) for c in bgr)


def _draw_apple(img, cx, cy, r, color):
    """Roundish blob with a slight highlight; returns bbox."""
    axes = (r, int(r * random.uniform(0.85, 1.0)))
    angle = random.uniform(0, 180)
    cv2.ellipse(img, (cx, cy), axes, angle, 0, 360, color, -1, cv2.LINE_AA)
    # matte highlight
    hl = tuple(min(255, int(c * 1.25)) for c in color)
    cv2.ellipse(img, (cx - r // 3, cy - r // 3), (r // 4, r // 5), angle, 0, 360, hl, -1, cv2.LINE_AA)
    a, b = max(axes), max(axes)
    return [cx - a, cy - b, 2 * a, 2 * b]


def _draw_banana(img, cx, cy, length, color):
    """Elongated curved blob (thick polyline arc); returns bbox."""
    angle = random.uniform(0, 180)
    thickness = max(8, int(length * random.uniform(0.22, 0.30)))
    # arc as points along a shallow parabola, rotated
    t = np.linspace(-1, 1, 24)
    xs = t * (length / 2)
    ys = (t ** 2) * length * 0.18
    theta = np.deg2rad(angle)
    rx = xs * np.cos(theta) - ys * np.sin(theta) + cx
    ry = xs * np.sin(theta) + ys * np.cos(theta) + cy
    pts = np.stack([rx, ry], axis=1).astype(np.int32)
    cv2.polylines(img, [pts], False, color, thickness, cv2.LINE_AA)
    x, y, w, h = cv2.boundingRect(pts)
    pad = thickness // 2
    return [x - pad, y - pad, w + thickness, h + thickness]


def make_frame(width=640, height=480, n_fruit=None, rng_seed=None):
    """Return (frame_bgr, ground_truth_list)."""
    if rng_seed is not None:
        random.seed(rng_seed)
        np.random.seed(rng_seed)

    # neutral noisy background (table / floor)
    base = random.randint(90, 150)
    img = np.full((height, width, 3), base, np.uint8)
    noise = np.random.randint(-18, 18, (height, width, 3), dtype=np.int16)
    img = np.clip(img.astype(np.int16) + noise, 0, 255).astype(np.uint8)
    # a few background distractor smudges (low saturation, should NOT trigger)
    for _ in range(random.randint(1, 3)):
        c = random.randint(60, 180)
        tint = int(np.clip(c + random.randint(-30, 30), 0, 255))
        cv2.circle(img, (random.randint(0, width), random.randint(0, height)),
                   random.randint(20, 60), (c, c, tint), -1)

    truth = []
    n = n_fruit if n_fruit is not None else random.randint(1, 4)
    for _ in range(n):
        fruit, ripeness = random.choice(CLASSES)
        color = _jitter_color(COLORS[(fruit, ripeness)], 20)
        if fruit == "apple":
            r = random.randint(28, 55)
            cx = random.randint(r + 10, width - r - 10)
            cy = random.randint(r + 10, height - r - 10)
            bbox = _draw_apple(img, cx, cy, r, color)
        else:
            length = random.randint(90, 160)
            m = length // 2 + 20
            cx = random.randint(m, width - m)
            cy = random.randint(m, height - m)
            bbox = _draw_banana(img, cx, cy, length, color)
        truth.append({"fruit": fruit, "ripeness": ripeness, "bbox": bbox})

    # mild blur so edges aren't unrealistically crisp
    img = cv2.GaussianBlur(img, (5, 5), 0)
    return img, truth


class SyntheticCamera:
    """Drop-in stand-in for cv2.VideoCapture: .read() -> (ok, frame)."""

    def __init__(self, width=640, height=480):
        self.width, self.height = width, height
        self._i = 0

    def read(self):
        self._i += 1
        # re-randomize scene every ~30 frames so the stream visibly changes
        frame, _ = make_frame(self.width, self.height, rng_seed=self._i // 30)
        return True, frame

    def isOpened(self):
        return True

    def release(self):
        pass


if __name__ == "__main__":
    img, truth = make_frame(rng_seed=42)
    for t in truth:
        x, y, w, h = t["bbox"]
        cv2.rectangle(img, (x, y), (x + w, y + h), (255, 255, 255), 1)
    cv2.imwrite("/tmp/synthetic_sample.png", img)
    print("wrote /tmp/synthetic_sample.png;", truth)
