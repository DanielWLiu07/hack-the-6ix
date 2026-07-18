"""Synthetic data augmentation for the spoilage classifier.

Three gaps in the captured set, three targeted synthetics:

  * PROCEDURAL SPOILAGE — paint realistic marker/bruise spots inside the banana
    silhouette of CLEAN frames. Multiplies the spoiled class; because each
    synthetic-spoiled shares its fresh frame's background, the only fresh-vs-
    spoiled signal is the spots -> the model can't shortcut on scene.
  * BACKGROUND RANDOMIZATION — cut the banana out (HSV mask) and composite it,
    with random rotate/scale/position + feathered edges, onto varied backgrounds
    (real 'empty' frames + procedural). Attacks the "only ~5 scenes" overfitting
    that plain spoilage-synthesis can't fix (all its bgs are the original 5).
  * PHOTOMETRIC AUG — brightness/contrast/hue/gamma/noise variants for lighting.

LEAKAGE-SAFE: reads only ei_export/training/ (run prepare_ei.py first) and writes
only into training/. The real testing/ set is never touched — evaluate there.

    ../../robot/vision/.venv/bin/python synthesize.py --per-fresh 5 --bg 4

Domain-gap caveat: synthetic approximates reality. Keep a few real scenes; treat
synthetic as a multiplier and trust only the REAL test set. Background randomization
helps the CNN (which can overfit to scene); it won't move a color-only baseline.
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
DATASET = os.path.join(HERE, "dataset")
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
    return cv2.erode(sil, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))


def paint_spoiled(img, sil):
    H, W = img.shape[:2]
    ys, xs = np.where(sil > 0)
    if len(xs) == 0:
        return img
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
    return np.clip(img.astype(np.float32) * (1 - a) + color * a, 0, 255).astype(np.uint8)


def photometric(img):
    out = img.astype(np.float32)
    out *= rng.uniform(0.75, 1.25)
    out = (out - 128) * rng.uniform(0.85, 1.2) + 128
    out = np.clip(out, 0, 255).astype(np.uint8)
    hsv = cv2.cvtColor(out, cv2.COLOR_BGR2HSV).astype(np.int16)
    hsv[:, :, 0] = (hsv[:, :, 0] + int(rng.integers(-6, 7))) % 180
    hsv[:, :, 1] = np.clip(hsv[:, :, 1] * rng.uniform(0.85, 1.15), 0, 255)
    out = cv2.cvtColor(np.clip(hsv, 0, 255).astype(np.uint8), cv2.COLOR_HSV2BGR)
    if rng.random() < 0.5:
        noise = rng.normal(0, 6, out.shape)
        out = np.clip(out.astype(np.float32) + noise, 0, 255).astype(np.uint8)
    return out


def _procedural_bg(H, W):
    kind = rng.integers(0, 4)
    if kind == 0:                                        # solid
        bg = np.full((H, W, 3), rng.integers(20, 230, 3).tolist(), np.uint8)
    elif kind == 1:                                      # vertical gradient
        c0, c1 = rng.integers(0, 255, 3), rng.integers(0, 255, 3)
        t = np.linspace(0, 1, H)[:, None, None]
        bg = (c0 * (1 - t) + c1 * t).astype(np.uint8) * np.ones((1, W, 1), np.uint8)
    elif kind == 2:                                      # colored noise
        bg = rng.integers(0, 255, (H // 8, W // 8, 3), dtype=np.uint8)
        bg = cv2.resize(bg, (W, H), interpolation=cv2.INTER_LINEAR)
    else:                                                # random clutter
        bg = np.full((H, W, 3), rng.integers(30, 200, 3).tolist(), np.uint8)
        for _ in range(int(rng.integers(4, 12))):
            p1 = (int(rng.integers(0, W)), int(rng.integers(0, H)))
            p2 = (int(rng.integers(0, W)), int(rng.integers(0, H)))
            cv2.rectangle(bg, p1, p2, rng.integers(0, 255, 3).tolist(), -1)
    if rng.random() < 0.5:
        bg = cv2.GaussianBlur(bg, (0, 0), rng.uniform(1, 6))
    return bg


def _load_bg_pool(H, W, n_proc=16):
    pool = []
    for f in sorted(glob.glob(os.path.join(DATASET, "empty", "*.jpg")))[:40]:
        im = cv2.imread(f)
        if im is not None:
            pool.append(cv2.resize(im, (W, H)))
    pool += [_procedural_bg(H, W) for _ in range(n_proc)]
    return pool


def composite_on_bg(img, sil, bg_pool):
    """Cut the banana out and paste it (random affine, feathered) onto a random
    background. Returns (new_frame, warped_sil) so spots can be painted after."""
    H, W = img.shape[:2]
    ys, xs = np.where(sil > 0)
    cx, cy = float(xs.mean()), float(ys.mean())
    ang = rng.uniform(-25, 25)
    scale = rng.uniform(0.6, 1.15)
    M = cv2.getRotationMatrix2D((cx, cy), ang, scale)
    # random translation, keeping the banana centroid on-frame
    M[0, 2] += rng.uniform(-0.18, 0.18) * W
    M[1, 2] += rng.uniform(-0.18, 0.18) * H
    banana = cv2.warpAffine(img, M, (W, H), flags=cv2.INTER_LINEAR, borderValue=0)
    wsil = cv2.warpAffine(sil, M, (W, H), flags=cv2.INTER_NEAREST, borderValue=0)
    alpha = cv2.GaussianBlur(wsil.astype(np.float32), (0, 0), 2.0) / 255.0
    alpha = np.clip(alpha, 0, 1)[..., None]
    bg = bg_pool[int(rng.integers(len(bg_pool)))].astype(np.float32)
    out = bg * (1 - alpha) + banana.astype(np.float32) * alpha
    return np.clip(out, 0, 255).astype(np.uint8), wsil


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-fresh", type=int, default=5, help="synthetic-spoiled per clean frame")
    ap.add_argument("--aug-fresh", type=int, default=2, help="photometric fresh variants per frame")
    ap.add_argument("--bg", type=int, default=4, help="background-randomized composites per clean frame")
    args = ap.parse_args()

    fresh_dir = os.path.join(TRAIN, "fresh")
    spoil_dir = os.path.join(TRAIN, "spoiled")
    if not os.path.isdir(fresh_dir):
        raise SystemExit("run prepare_ei.py first (need ei_export/training/fresh)")
    os.makedirs(spoil_dir, exist_ok=True)
    files = [f for f in sorted(glob.glob(os.path.join(fresh_dir, "*.jpg")))
             if "synth." not in f and "aug." not in f and "bg." not in f]
    H, W = cv2.imread(files[0]).shape[:2]
    bg_pool = _load_bg_pool(H, W)

    made = {"synth_spoiled": 0, "aug_fresh": 0, "bg_fresh": 0, "bg_spoiled": 0}
    skipped = 0
    for f in files:
        img = cv2.imread(f)
        sil = banana_sil(img)
        if sil is None:
            skipped += 1
            continue
        stem = os.path.splitext(os.path.basename(f))[0]
        for k in range(args.per_fresh):
            cv2.imwrite(os.path.join(spoil_dir, f"synth.{stem}.{k}.jpg"), paint_spoiled(img, sil))
            made["synth_spoiled"] += 1
        for k in range(args.aug_fresh):
            cv2.imwrite(os.path.join(fresh_dir, f"aug.{stem}.{k}.jpg"), photometric(img))
            made["aug_fresh"] += 1
        for k in range(args.bg):
            comp, wsil = composite_on_bg(img, sil, bg_pool)
            if k % 2 == 0:  # half fresh on new bg, half spoiled on new bg
                cv2.imwrite(os.path.join(fresh_dir, f"bg.{stem}.{k}.jpg"), comp)
                made["bg_fresh"] += 1
            else:
                cv2.imwrite(os.path.join(spoil_dir, f"bg.{stem}.{k}.jpg"), paint_spoiled(comp, wsil))
                made["bg_spoiled"] += 1

    def count(d):
        return len(glob.glob(os.path.join(d, "*.jpg")))
    print(f"clean frames used: {len(files)}  (skipped {skipped} w/o a banana)")
    print(f"generated: {made}")
    print(f"training now: fresh={count(fresh_dir)}  spoiled={count(spoil_dir)}")
    print(f"backgrounds in pool: {len(bg_pool)} (real empty + procedural)")
    print("testing/ untouched (REAL only) — evaluate there.")


if __name__ == "__main__":
    main()
