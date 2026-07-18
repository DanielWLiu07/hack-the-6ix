#!/usr/bin/env python3
"""Robust color+shape fruit detector - finds fruit even in cluttered scenes.

The ONNX net (trained on synthetic props) does not generalize to real photos, and
a naive "biggest colored blob" detector gets hijacked by faces/hands (skin is a
big reddish blob). This detector instead SEARCHES for each fruit's specific color
signature, so a face, a window, or a brick wall simply do not match:

    yellow (H 18-34, sat)        -> banana_ripe
    red    (H<10 or >168, sat)   -> apple_ripe   (skin removed via YCrCb first)
    green  (H 36-85, sat)        -> apple_unripe if round, banana_unripe if long

Each signature gets its own mask + gap-bridging close + shape/size gate, then all
detections are de-duplicated. Returns root-CLAUDE.md detection dicts, so it drops
into classify_folder.py / sort_pipeline.py in place of the ONNX detector.

    python3 robust_detect.py --image photo.jpg
    python3 robust_detect.py --dir folder
"""
import argparse
import json
import time
from pathlib import Path

import cv2
import numpy as np

MIN_AREA_FRAC = 0.008   # a fruit is at least this fraction of the frame


def skin_mask(bgr):
    """Skin (faces/hands) in YCrCb - well-separated from pure fruit colors."""
    y = cv2.cvtColor(bgr, cv2.COLOR_BGR2YCrCb)
    cr, cb = y[:, :, 1].astype(int), y[:, :, 2].astype(int)
    return (cr >= 135) & (cr <= 180) & (cb >= 85) & (cb <= 135)


def _clean(mask, close_k):
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((7, 7), np.uint8))
    # large close bridges gaps from marker spots / specular highlights on the fruit
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((close_k, close_k), np.uint8))
    return mask


def _shape_ok(c):
    """Compact round fruit OR clearly elongated fruit (banana). Rejects clutter."""
    area = cv2.contourArea(c)
    hull = cv2.contourArea(cv2.convexHull(c))
    x, y, w, h = cv2.boundingRect(c)
    solidity = area / max(hull, 1.0)
    extent = area / max(w * h, 1.0)
    (_, _), (rw, rh), _ = cv2.minAreaRect(c)
    aspect = max(rw, rh) / max(1.0, min(rw, rh))
    round_fruit = solidity >= 0.80 and extent >= 0.58
    elongated_fruit = aspect >= 1.8 and solidity >= 0.45 and extent >= 0.32
    return round_fruit or elongated_fruit, aspect


def _blobs(mask, img_shape, close_k):
    mask = _clean(mask.astype(np.uint8) * 255, close_k)
    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    min_area = MIN_AREA_FRAC * img_shape[0] * img_shape[1]
    out = []
    for c in cnts:
        if cv2.contourArea(c) < min_area:
            continue
        ok, aspect = _shape_ok(c)
        if ok:
            out.append((c, aspect))
    return out


def classify_all(bgr):
    """Every fruit in the frame -> list of root-schema detection dicts."""
    hsv = cv2.cvtColor(cv2.GaussianBlur(bgr, (5, 5), 0), cv2.COLOR_BGR2HSV)
    H, S, V = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    sat = (S > 60) & (V > 60) & (V < 250)
    skin = skin_mask(bgr)

    # per-signature masks (all require saturation so gray/white background is out)
    yellow = (H >= 18) & (H <= 34) & (S > 70) & (V > 90)
    red = ((H <= 10) | (H >= 168)) & sat & (~skin)   # drop skin from the red channel
    green = (H >= 36) & (H <= 88) & sat

    dets = []
    for mask, close_k, kind in ((yellow, 25, "yellow"), (red, 17, "red"), (green, 21, "green")):
        for c, aspect in _blobs(mask, bgr.shape, close_k):
            if kind == "yellow":
                fruit, ripeness = "banana", "ripe"
            elif kind == "red":
                fruit, ripeness = "apple", "ripe"
            else:  # green -> shape decides apple vs banana
                fruit, ripeness = ("banana" if aspect > 2.2 else "apple"), "unripe"
            x, y, w, h = cv2.boundingRect(c)
            area_frac = cv2.contourArea(c) / (bgr.shape[0] * bgr.shape[1])
            conf = round(float(min(0.99, 0.6 + 3.0 * area_frac)), 3)
            dets.append({"ts": int(time.time() * 1000), "fruit": fruit,
                         "ripeness": ripeness, "conf": conf,
                         "bbox": [int(x), int(y), int(w), int(h)], "_area": cv2.contourArea(c)})
    return _dedup(dets)


def _dedup(dets, iou_thresh=0.5):
    """Drop overlapping detections from different color masks (keep the larger)."""
    dets = sorted(dets, key=lambda d: d["_area"], reverse=True)
    kept = []
    for d in dets:
        if all(_iou(d["bbox"], k["bbox"]) < iou_thresh for k in kept):
            kept.append(d)
    for d in kept:
        d.pop("_area", None)
    return kept


def _iou(a, b):
    ax, ay, aw, ah = a; bx, by, bw, bh = b
    ix0, iy0 = max(ax, bx), max(ay, by)
    ix1, iy1 = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    iw, ih = max(0, ix1 - ix0), max(0, iy1 - iy0)
    inter = iw * ih
    return inter / max(1, aw * ah + bw * bh - inter)


def classify(bgr):
    """The single most prominent fruit (largest detection), or None."""
    dets = classify_all(bgr)
    if not dets:
        return None
    return max(dets, key=lambda d: d["bbox"][2] * d["bbox"][3])


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
