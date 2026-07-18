"""Dataset quality benchmark for the spoilage capture set.

Reports, per label: count, fruit-detection rate, blur (Laplacian variance -
lower = blurrier), exposure (over/under-exposed fraction), banana size/position
spread (framing variety), and near-duplicate rate within bursts (the usual
capture pitfall: 10 near-identical frames = ~1 real sample of variety).

    ../../robot/vision/.venv/bin/python benchmark.py
"""

import glob
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "robot", "vision"))
from hsv_detector import HSVDetector  # noqa: E402

DATASET = os.path.join(os.path.dirname(__file__), "dataset")
LABELS = ["fresh", "spoiled", "apple", "empty"]
BLUR_MIN = 60.0        # Laplacian var below this reads as soft/blurry
DUP_CORR = 0.985       # downscaled-frame correlation above this = near-duplicate

det = HSVDetector()


def _metrics(path):
    img = cv2.imread(path)
    g = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blur = cv2.Laplacian(g, cv2.CV_64F).var()
    over = float((g > 250).mean())
    under = float((g < 8).mean())
    dets = det.detect(img)
    fruits = {d["fruit"] for d in dets}
    top = max(dets, key=lambda d: d["conf"], default=None)
    bbox = top["bbox"] if top else None
    small = cv2.resize(g, (32, 24)).astype(np.float32).ravel()
    small = (small - small.mean()) / (small.std() + 1e-6)
    return dict(blur=blur, over=over, under=under, fruits=fruits, bbox=bbox,
                area=(bbox[2] * bbox[3] if bbox else 0), sig=small)


def _dupes(sigs):
    n = len(sigs)
    if n < 2:
        return 0
    dup = 0
    for i in range(1, n):  # compare consecutive (bursts are time-ordered)
        c = float(np.dot(sigs[i - 1], sigs[i]) / len(sigs[i]))
        if c > DUP_CORR:
            dup += 1
    return dup


def main():
    print(f"{'label':8} {'imgs':>5} {'fruit%':>7} {'blurry%':>8} {'overexp%':>9} "
          f"{'dup%':>6} {'framing(area cv)':>16}")
    print("-" * 64)
    grand = 0
    for lb in LABELS:
        files = sorted(glob.glob(os.path.join(DATASET, lb, "*.jpg")))
        if not files:
            continue
        want = {"fresh": "banana", "spoiled": "banana", "apple": "apple"}.get(lb)
        ms = [_metrics(f) for f in files]
        n = len(ms)
        grand += n
        fruit_ok = sum(1 for m in ms if want is None or want in m["fruits"]) / n
        blurry = sum(1 for m in ms if m["blur"] < BLUR_MIN) / n
        overexp = sum(1 for m in ms if m["over"] > 0.15) / n
        dup = _dupes([m["sig"] for m in ms]) / n
        areas = np.array([m["area"] for m in ms if m["area"] > 0], float)
        area_cv = (areas.std() / areas.mean()) if len(areas) > 1 else 0.0
        print(f"{lb:8} {n:5d} {fruit_ok*100:6.0f}% {blurry*100:7.0f}% "
              f"{overexp*100:8.0f}% {dup*100:5.0f}% {area_cv:15.2f}")
    print("-" * 64)
    print(f"total images: {grand}")
    print("\nread: fruit% = has the right fruit (label quality); blurry% low is good;")
    print("dup% = consecutive near-identical frames (high => little real variety per burst);")
    print("framing(area cv) = spread of fruit size in frame (higher => more distance/scale variety).")


if __name__ == "__main__":
    main()
