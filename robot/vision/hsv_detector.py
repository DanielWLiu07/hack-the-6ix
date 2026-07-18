"""HSV blob detector for 3D-printed fruit - the works-today fallback detector.

Classifies by color + shape:
  red blob                -> apple  ripe
  yellow blob             -> banana ripe
  green blob, roundish    -> apple  unripe
  green blob, elongated   -> banana unripe

detect() returns root-schema detection dicts:
    {"ts": <epoch s>, "fruit": "apple|banana", "ripeness": "ripe|unripe",
     "conf": 0.0-1.0, "bbox": [x, y, w, h]}   # bbox in pixels, ints

Tunables via env (defaults tuned on synthetic.py scenes):
    HSV_MIN_AREA   minimum blob area in px^2 (default 1200 ~= a 40px-diameter blob)

Known limit: two touching same-color fruits merge into one blob/box. Fine for
the eye-in-hand camera (one fruit centered at pick time).
"""

import os
import time

import cv2
import numpy as np

from spoilage import score_spoilage, spot_contours

MIN_AREA = int(os.environ.get("HSV_MIN_AREA", "1200"))

# (H, S, V) ranges - OpenCV hue is 0-179.
# Red wraps around hue 0 so it needs two ranges.
# Yellow: the 3D-printed banana is a PALE/pastel yellow (measured H~20 S~48-86
# V~220), so the saturation floor is 45, not the ~100 a ripe-fruit yellow hits.
# Hue floor 18 keeps skin (H<15) out; V floor 110 keeps dark background out.
RANGES = {
    "red": [((0, 120, 60), (10, 255, 255)), ((170, 120, 60), (179, 255, 255))],
    "yellow": [((18, 45, 110), (40, 255, 255))],
    "green": [((41, 70, 50), (85, 255, 255))],
}

# aspect ratio (long side / short side) above which a green blob is a banana
BANANA_ELONGATION = 1.8

_KERNEL = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))


def _color_mask(hsv, color):
    mask = None
    for lo, hi in RANGES[color]:
        m = cv2.inRange(hsv, np.array(lo), np.array(hi))
        mask = m if mask is None else cv2.bitwise_or(mask, m)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, _KERNEL)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, _KERNEL)
    return mask


def _classify(color, contour):
    """Map (color, shape) -> (fruit, ripeness)."""
    if color == "red":
        return "apple", "ripe"
    if color == "yellow":
        return "banana", "ripe"
    # green: disambiguate apple vs banana by elongation of the min-area rect
    (_, _), (w, h), _ = cv2.minAreaRect(contour)
    if min(w, h) < 1:
        return "apple", "unripe"
    elongation = max(w, h) / min(w, h)
    if elongation >= BANANA_ELONGATION:
        return "banana", "unripe"
    return "apple", "unripe"


def _confidence(contour, area, mask, bbox):
    """Heuristic confidence: solid, well-filled blobs score high."""
    hull = cv2.convexHull(contour)
    hull_area = cv2.contourArea(hull) or 1
    solidity = area / hull_area
    x, y, w, h = bbox
    roi = mask[y:y + h, x:x + w]
    fill = float(np.count_nonzero(roi)) / max(1, w * h)
    conf = 0.35 + 0.35 * solidity + 0.30 * fill
    return round(float(np.clip(conf, 0.30, 0.99)), 2)


class HSVDetector:
    """Interface shared with ONNXDetector: detect(frame_bgr, ts=None) -> [detection]."""

    name = "hsv"

    def detect(self, frame_bgr, ts=None):
        ts = ts if ts is not None else time.time()
        blurred = cv2.GaussianBlur(frame_bgr, (5, 5), 0)
        hsv = cv2.cvtColor(blurred, cv2.COLOR_BGR2HSV)
        H, W = frame_bgr.shape[:2]

        detections = []
        for color in RANGES:
            mask = _color_mask(hsv, color)
            contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            for c in contours:
                area = cv2.contourArea(c)
                if area < MIN_AREA:
                    continue
                x, y, w, h = cv2.boundingRect(c)
                # ignore blobs hugging the full frame (lighting washes)
                if w > 0.9 * W or h > 0.9 * H:
                    continue
                fruit, ripeness = _classify(color, c)
                # spoilage: dark-blemish fraction inside the fruit silhouette.
                # Use the un-blurred frame so marker spots keep their true (dark) value.
                spoil_score, spoiled = score_spoilage(frame_bgr, (x, y, w, h), c)
                detections.append({
                    "ts": ts,
                    "fruit": fruit,
                    "ripeness": ripeness,
                    "conf": _confidence(c, area, mask, (x, y, w, h)),
                    "bbox": [int(x), int(y), int(w), int(h)],
                    "spoiled": bool(spoiled),
                    "spoil_score": spoil_score,
                })
        detections.sort(key=lambda d: d["conf"], reverse=True)
        return detections


def annotate(frame, detections, extra="", draw_spots=True):
    """Draw detections onto frame (in place) for the MJPEG stream."""
    colors = {"apple": (0, 0, 255), "banana": (0, 220, 255)}
    SPOIL = (40, 40, 235)  # red-ish, BGR
    for d in detections:
        x, y, w, h = d["bbox"]
        spoiled = d.get("spoiled")
        c = SPOIL if spoiled else colors.get(d["fruit"], (255, 255, 255))
        cv2.rectangle(frame, (x, y), (x + w, y + h), c, 3 if spoiled else 2)
        label = f'{d["fruit"]} {d["ripeness"]} {d["conf"]:.2f}'
        if "spoil_score" in d:
            tag = "SPOILED" if spoiled else "fresh"
            label += f'  [{tag} {d["spoil_score"]:.2f}]'
        cv2.putText(frame, label, (x, max(12, y - 6)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, c, 1, cv2.LINE_AA)
        # circle the actual blemishes so the "why" is visible in the demo
        if draw_spots and spoiled:
            for sc in spot_contours(frame, d["bbox"]):
                (cx, cy), r = cv2.minEnclosingCircle(sc)
                cv2.circle(frame, (int(cx), int(cy)), int(max(r, 3)) + 2, SPOIL, 2)
    if extra:
        cv2.putText(frame, extra, (8, 20), cv2.FONT_HERSHEY_SIMPLEX,
                    0.6, (255, 255, 255), 1, cv2.LINE_AA)
    return frame


if __name__ == "__main__":
    # quick smoke test on one synthetic frame
    from synthetic import make_frame
    img, truth = make_frame(rng_seed=1)
    dets = HSVDetector().detect(img)
    print(f"truth={len(truth)} detected={len(dets)}")
    for d in dets:
        print(" ", d)
    annotate(img, dets)
    cv2.imwrite("/tmp/hsv_smoke.png", img)
    print("wrote /tmp/hsv_smoke.png")
