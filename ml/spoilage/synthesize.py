"""Synthetic data augmentation for the spoilage classifier.

Two problems in the captured set: too few spoiled examples, and too few distinct
scenes (backgrounds memorized). This targets both, cheaply and controllably:

  * PROCEDURAL SPOILAGE — paint realistic marker/bruise spots (dark irregular
    blobs + strokes) inside the banana silhouette of CLEAN frames. Because each
    synthetic-spoiled shares its fresh frame's background, the ONLY fresh-vs-
    spoiled signal is the spots -> the model is forced to learn spots, not scene.
  * PHOTOMETRIC AUG — brightness/contrast/hue/gamma/noise variants of fresh
    frames, for lighting robustness.

LEAKAGE-SAFE: reads only ei_export/training/ (run prepare_ei.py first) and writes
only into training/. The real testing/ set is never touched — evaluate there.

    ../../robot/vision/.venv/bin/python synthesize.py --per-fresh 5

Domain-gap caveat: synthetic spots approximate real marker. Keep collecting a few
real scenes; treat synthetic as a multiplier, and trust only the REAL test set.
"""

import argparse
import glob
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "robot", "vision"))
from hsv_detector import _color_mask  # noqa: E402

HERE = os.path.dirname(__file__)
TRAIN = os.path.join(HERE, "ei_export", "training")
rng = np.random.default_rng(20260718)


def banana_sil(img):
    hsv = cv2.cvtColor(cv2.GaussianBlur(img, (5, 5), 0), cv2.COLOR_BGR2HSV)
    cnts, _ = cv2.findContours(_color_mask(hsv, "yellow"),
                               cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return None
    cnt = max(cnts, key=cv2.contourArea)
    if cv2.contourArea(cnt) < 1500:
        return None
    H, W = img.shape[:2]
    sil = np.zeros((H, W), np.uint8)
    cv2.drawContours(sil, [cnt], -1, 255, -1)
    return cv2.erode(sil, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))


def paint_spoiled(img, sil):
    H, W = img.shape[:2]
    ys, xs = np.where(sil > 0)
    if len(xs) == 0:
        return None
    spot = np.zeros((H, W), np.float32)
    for _ in range(int(rng.integers(1, 4))):            # bruise-like blobs
        i = rng.integers(len(xs)); cx, cy = int(xs[i]), int(ys[i])
        r = int(rng.integers(6, 16)); blob = np.zeros((H, W), np.uint8)
        for _ in range(int(rng.integers(3, 7))):
            cv2.circle(blob, (cx + int(rng.integers(-r, r)), cy + int(rng.integers(-r, r))),
                       int(rng.integers(r // 2 + 1, r + 1)), 255, -1)
        spot = np.maximum(spot, blob.astype(np.float32))
    for _ in range(int(rng.integers(0, 3))):            # marker strokes
        i = rng.integers(len(xs)); cx, cy = int(xs[i]), int(ys[i]); pts = [(cx, cy)]
        for _ in range(int(rng.integers(3, 6))):
            cx += int(rng.integers(-22, 22)); cy += int(rng.integers(-14, 14)); pts.append((cx, cy))
        cv2.polylines(spot, [np.array(pts, np.int32)], False, 255, int(rng.integers(2, 5)))
    spot = cv2.GaussianBlur(spot, (5, 5), 0) / 255.0
    spot *= (sil > 0)
    a = (spot * rng.uniform(0.5, 0.82))[..., None]
    color = np.array([rng.uniform(30, 55), rng.uniform(32, 55), rng.uniform(42, 70)], np.float32)
    out = img.astype(np.float32) * (1 - a) + color * a
    return np.clip(out, 0, 255).astype(np.uint8)


def photometric(img):
    out = img.astype(np.float32)
    out *= rng.uniform(0.75, 1.25)                       # brightness
    out = (out - 128) * rng.uniform(0.85, 1.2) + 128     # contrast
    out = np.clip(out, 0, 255).astype(np.uint8)
    hsv = cv2.cvtColor(out, cv2.COLOR_BGR2HSV).astype(np.int16)
    hsv[:, :, 0] = (hsv[:, :, 0] + int(rng.integers(-6, 7))) % 180  # hue
    hsv[:, :, 1] = np.clip(hsv[:, :, 1] * rng.uniform(0.85, 1.15), 0, 255)
    out = cv2.cvtColor(np.clip(hsv, 0, 255).astype(np.uint8), cv2.COLOR_HSV2BGR)
    if rng.random() < 0.5:
        out = cv2.add(out, rng.normal(0, 6, out.shape).astype(np.int16).clip(-30, 30).astype(np.uint8))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-fresh", type=int, default=5, help="synthetic-spoiled per clean frame")
    ap.add_argument("--aug-fresh", type=int, default=2, help="photometric fresh variants per frame")
    args = ap.parse_args()

    fresh_dir = os.path.join(TRAIN, "fresh")
    spoil_dir = os.path.join(TRAIN, "spoiled")
    if not os.path.isdir(fresh_dir):
        raise SystemExit("run prepare_ei.py first (need ei_export/training/fresh)")
    os.makedirs(spoil_dir, exist_ok=True)
    files = [f for f in sorted(glob.glob(os.path.join(fresh_dir, "*.jpg")))
             if "synth." not in f and "aug." not in f]
    made_sp = made_fr = skipped = 0
    for f in files:
        img = cv2.imread(f)
        sil = banana_sil(img)
        if sil is None:
            skipped += 1
            continue
        stem = os.path.splitext(os.path.basename(f))[0]
        for k in range(args.per_fresh):
            v = paint_spoiled(img, sil)
            if v is not None:
                cv2.imwrite(os.path.join(spoil_dir, f"synth.{stem}.{k}.jpg"), v); made_sp += 1
        for k in range(args.aug_fresh):
            cv2.imwrite(os.path.join(fresh_dir, f"aug.{stem}.{k}.jpg"), photometric(img)); made_fr += 1

    def count(d):
        return len(glob.glob(os.path.join(d, "*.jpg")))
    print(f"clean frames used: {len(files)}  (skipped {skipped} w/o a banana)")
    print(f"+ {made_sp} synthetic-spoiled, + {made_fr} photometric-fresh (training only)")
    print(f"training now: fresh={count(fresh_dir)}  spoiled={count(spoil_dir)}")
    print(f"testing/ untouched (REAL only) — evaluate there.")


if __name__ == "__main__":
    main()
