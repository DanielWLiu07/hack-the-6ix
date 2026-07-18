#!/usr/bin/env python3
"""Robust single-fruit color+shape classifier - works on REAL fruit, not just props.

The ONNX net is trained on synthetic solid-color props and does not generalize to
real photographed fruit (a real red apple reads as banana because of its yellow
blush and shading). This detector sidesteps that: it segments the dominant fruit,
votes on its OVERALL color (robust to local blush/highlights), and uses shape to
break the one ambiguous case. Our 4 classes are color-coded, which makes color a
near-unique key:

    red    -> apple_ripe      (red only exists for apples)
    yellow -> banana_ripe     (yellow only exists for bananas)
    green  -> apple_unripe if round, banana_unripe if elongated

Returns the same root-CLAUDE.md detection dicts as infer_test.py, so it drops into
classify_folder.py / sort_pipeline.py in place of the ONNX detector.

    python3 robust_detect.py --image photo.jpg
    python3 robust_detect.py --dir folder
"""
import argparse
import json
import time
from pathlib import Path

import cv2
import numpy as np

# OpenCV hue is 0-179. Buckets for the printed/real fruit colors.
def color_bucket(hue):
    if hue < 13 or hue >= 165:
        return "red"
    if 13 <= hue < 36:
        return "yellow"
    if 36 <= hue < 90:
        return "green"
    return "other"


def is_fruit_shape(c, img_shape):
    """Reject non-fruit blobs (leaves, hands, clutter, full-frame backgrounds).

    Real fruit is a solid, compact blob that fills most of its bounding box.
    Measured separation on real photos: fruit sits at solidity >0.85 / extent
    >0.65; foliage/blossoms/drawings fall well below. We do NOT reject frame-
    filling blobs - a fruit legitimately fills the frame on close eye-in-hand
    approach (that killed a valid close-up of green apples).
    """
    area = cv2.contourArea(c)
    hull = cv2.contourArea(cv2.convexHull(c))
    x, y, w, h = cv2.boundingRect(c)
    solidity = area / max(hull, 1.0)      # convex + compact -> ~1 for fruit
    extent = area / max(w * h, 1.0)       # fills its bbox -> high for fruit
    (_, _), (rw, rh), _ = cv2.minAreaRect(c)
    aspect = max(rw, rh) / max(1.0, min(rw, rh))
    round_fruit = solidity >= 0.82 and extent >= 0.60           # apple / fruit pile
    elongated_fruit = aspect >= 2.0 and solidity >= 0.5 and extent >= 0.35  # single banana
    return round_fruit or elongated_fruit


def fruit_contours(bgr, min_area_frac=0.004, gate=True):
    """All colorful fruit blobs vs plain background (white/gray/black).

    gate=True applies is_fruit_shape() so leaves/hands/clutter are not reported as
    fruit. gate=False returns every colored blob (used for diagnostics/tuning).
    """
    hsv = cv2.cvtColor(cv2.GaussianBlur(bgr, (5, 5), 0), cv2.COLOR_BGR2HSV)
    s, v = hsv[:, :, 1], hsv[:, :, 2]
    mask = ((s > 45) & (v > 35) & (v < 250)).astype(np.uint8) * 255
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((7, 7), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    min_area = min_area_frac * bgr.shape[0] * bgr.shape[1]
    out = [c for c in cnts if cv2.contourArea(c) >= min_area]
    if gate:
        out = [c for c in out if is_fruit_shape(c, bgr.shape)]
    return out, hsv


def _classify_contour(c, hsv):
    """One fruit blob -> root-schema detection. Shape picks fruit, color picks ripeness."""
    blob = np.zeros(hsv.shape[:2], np.uint8)
    cv2.drawContours(blob, [c], -1, 255, -1)
    hues = hsv[:, :, 0][blob > 0]
    sats = hsv[:, :, 1][blob > 0]
    hues = hues[sats > 45]
    if len(hues) == 0:
        return None
    votes = {"red": 0, "yellow": 0, "green": 0, "other": 0}
    for h in hues:
        votes[color_bucket(int(h))] += 1
    fruit_votes = {k: votes[k] for k in ("red", "yellow", "green")}
    total_fruit = max(1, sum(fruit_votes.values()))
    color = max(fruit_votes, key=fruit_votes.get)
    green_frac = fruit_votes["green"] / total_fruit

    # shape FIRST: bananas are strongly elongated; apples are round-ish.
    (_, _), (rw, rh), _ = cv2.minAreaRect(c)
    aspect = max(rw, rh) / max(1.0, min(rw, rh))
    fruit = "banana" if aspect > 2.2 else "apple"
    # ripeness: green plurality -> unripe, otherwise ripe (red/yellow are ripe cues)
    ripeness = "unripe" if (color == "green" or green_frac > 0.55) else "ripe"

    x, y, w, h = cv2.boundingRect(c)
    conf_color = fruit_votes[color] / total_fruit
    conf = round(float(min(0.99, 0.55 + 0.44 * conf_color)), 3)
    return {"ts": int(time.time() * 1000), "fruit": fruit, "ripeness": ripeness,
            "conf": conf, "bbox": [int(x), int(y), int(w), int(h)]}


def classify_all(bgr):
    """Every fruit in the frame -> list of root-schema detection dicts."""
    cnts, hsv = fruit_contours(bgr)
    out = [_classify_contour(c, hsv) for c in cnts]
    return [d for d in out if d is not None]


def classify(bgr):
    """The single dominant fruit (largest blob), or None. Back-compat helper."""
    cnts, hsv = fruit_contours(bgr)
    if not cnts:
        return None
    return _classify_contour(max(cnts, key=cv2.contourArea), hsv)


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--image")
    g.add_argument("--dir")
    args = ap.parse_args()
    exts = (".jpg", ".jpeg", ".png", ".bmp", ".webp")
    paths = [Path(args.image)] if args.image else sorted(
        p for p in Path(args.dir).rglob("*") if p.suffix.lower() in exts)
    for p in paths:
        img = cv2.imread(str(p))
        if img is None:
            print(f"{p.name}: unreadable"); continue
        dets = classify_all(img)
        if not dets:
            print(f"{p.name}: no fruit found")
        else:
            summary = ", ".join(f"{d['fruit']}_{d['ripeness']}({d['conf']})" for d in dets)
            print(f"{p.name}: {len(dets)} fruit -> {summary}")


if __name__ == "__main__":
    main()
