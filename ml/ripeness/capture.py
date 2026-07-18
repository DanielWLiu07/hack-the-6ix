#!/usr/bin/env python3
"""Venue capture + HSV auto-label for the real 3D-printed props.

TWO intake paths, same auto-label + review + merge + finetune loop:

A) File drop (humans photograph props with a phone/camera -> drop into raw/):
    put photos in raw/apple_ripe/, raw/apple_unripe/, ... (one fruit per photo),
    then read raw/README.md, then
    python3 capture.py --ingest         # HSV auto-boxes every raw/<class>/*.jpg

B) Live burst (arm camera in front of one fruit at a time):
    python3 capture.py --label apple_ripe --n 80
    -> captures 80 frames (move the fruit/camera during the burst).

Both write YOLO images+labels into data/real/ and an annotated preview per frame
in data/real/preview/ - flip through previews, delete bad pairs, done.

Then merge into the training set and finetune (~30 min total loop):
    python3 capture.py --merge          # copies data/real -> data/dataset (90/10 split)
    python3 train.py --epochs 15 --weights runs/detect/v0/weights/best.pt --name v1
    python3 export.py --weights runs/detect/v1/weights/best.pt

Env: CAM_INDEX (default 0).
"""
import argparse
import os
import random
import shutil
import time
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent
REAL = ROOT / "data" / "real"
RAW = ROOT / "raw"
CLASSES = ["apple_ripe", "apple_unripe", "banana_ripe", "banana_unripe"]
IMG_EXTS = (".jpg", ".jpeg", ".png", ".bmp", ".webp")

# HSV ranges (OpenCV H:0-179) for the printed prop colors - tune at venue if
# needed by running with --debug-mask and watching the mask window.
HSV_RANGES = {
    "apple_ripe":    [((0, 90, 60), (12, 255, 255)), ((165, 90, 60), (179, 255, 255))],
    "apple_unripe":  [((38, 70, 50), (85, 255, 255))],
    "banana_ripe":   [((18, 90, 80), (36, 255, 255))],
    "banana_unripe": [((30, 60, 60), (55, 255, 255))],
}


def auto_box(frame, label, min_area=800):
    """Largest color blob for `label` -> (x0, y0, x1, y1) or None."""
    hsv = cv2.cvtColor(cv2.GaussianBlur(frame, (5, 5), 0), cv2.COLOR_BGR2HSV)
    mask = np.zeros(hsv.shape[:2], np.uint8)
    for lo, hi in HSV_RANGES[label]:
        mask |= cv2.inRange(hsv, np.array(lo), np.array(hi))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return None, mask
    c = max(cnts, key=cv2.contourArea)
    if cv2.contourArea(c) < min_area:
        return None, mask
    x, y, w, h = cv2.boundingRect(c)
    return (x, y, x + w, y + h), mask


def burst(label, n, delay, debug_mask):
    cls = CLASSES.index(label)
    cam = cv2.VideoCapture(int(os.environ.get("CAM_INDEX", 0)))
    assert cam.isOpened(), "camera not found - set CAM_INDEX"
    (REAL / "images").mkdir(parents=True, exist_ok=True)
    (REAL / "labels").mkdir(parents=True, exist_ok=True)
    (REAL / "preview").mkdir(parents=True, exist_ok=True)

    saved = skipped = 0
    t_start = int(time.time())
    print(f"capturing {n} frames of {label} - move the fruit around! Ctrl-C to stop early")
    while saved < n:
        ok, frame = cam.read()
        if not ok:
            continue
        box, mask = auto_box(frame, label)
        if debug_mask:
            cv2.imshow("mask", mask)
            cv2.imshow("frame", frame)
            cv2.waitKey(1)
        if box is None:
            skipped += 1
            time.sleep(delay)
            continue
        x0, y0, x1, y1 = box
        H, W = frame.shape[:2]
        stem = f"{label}_{t_start}_{saved:04d}"
        cv2.imwrite(str(REAL / "images" / f"{stem}.jpg"), frame)
        with open(REAL / "labels" / f"{stem}.txt", "w") as f:
            f.write(f"{cls} {(x0+x1)/2/W:.6f} {(y0+y1)/2/H:.6f} "
                    f"{(x1-x0)/W:.6f} {(y1-y0)/H:.6f}\n")
        prev = frame.copy()
        cv2.rectangle(prev, (x0, y0), (x1, y1), (255, 255, 255), 2)
        cv2.putText(prev, label, (x0, max(12, y0 - 4)), 0, 0.6, (255, 255, 255), 2)
        cv2.imwrite(str(REAL / "preview" / f"{stem}.jpg"), prev)
        saved += 1
        if saved % 10 == 0:
            print(f"  {saved}/{n} (skipped {skipped} no-detection frames)")
        time.sleep(delay)
    cam.release()
    print(f"done: {saved} labeled frames in {REAL} - review data/real/preview/, "
          f"delete bad pairs from images/+labels/, then --merge")


def ingest():
    """Auto-label every photo dropped in raw/<class>/ -> data/real/ (YOLO format).

    Humans sort phone/camera photos into raw/apple_ripe/, raw/banana_unripe/, ...
    (one fruit per photo, see raw/README.md). This HSV-boxes each by its class
    color - no live camera needed. Photos where no blob is found are reported so
    a human can re-shoot or hand-label them; nothing is silently dropped.
    """
    (REAL / "images").mkdir(parents=True, exist_ok=True)
    (REAL / "labels").mkdir(parents=True, exist_ok=True)
    (REAL / "preview").mkdir(parents=True, exist_ok=True)

    total_saved = 0
    failures = []  # (class, filename) where HSV found no fruit
    for label in CLASSES:
        cls = CLASSES.index(label)
        src_dir = RAW / label
        if not src_dir.is_dir():
            continue
        imgs = sorted(p for p in src_dir.iterdir()
                      if p.suffix.lower() in IMG_EXTS)
        saved = 0
        for p in imgs:
            frame = cv2.imread(str(p))
            if frame is None:
                failures.append((label, p.name + " (unreadable)"))
                continue
            box, _ = auto_box(frame, label)
            if box is None:
                failures.append((label, p.name))
                continue
            x0, y0, x1, y1 = box
            H, W = frame.shape[:2]
            stem = f"raw_{label}_{p.stem}"
            cv2.imwrite(str(REAL / "images" / f"{stem}.jpg"), frame)
            with open(REAL / "labels" / f"{stem}.txt", "w") as f:
                f.write(f"{cls} {(x0+x1)/2/W:.6f} {(y0+y1)/2/H:.6f} "
                        f"{(x1-x0)/W:.6f} {(y1-y0)/H:.6f}\n")
            prev = frame.copy()
            cv2.rectangle(prev, (x0, y0), (x1, y1), (255, 255, 255), 2)
            cv2.putText(prev, label, (x0, max(12, y0 - 4)), 0, 0.6, (255, 255, 255), 2)
            cv2.imwrite(str(REAL / "preview" / f"{stem}.jpg"), prev)
            saved += 1
        total_saved += saved
        print(f"  {label}: {saved}/{len(imgs)} labeled")

    print(f"\ningested {total_saved} labeled frames into {REAL}")
    if failures:
        print(f"{len(failures)} photo(s) had no detectable fruit "
              f"(re-shoot with a contrasting background, or hand-label):")
        for label, name in failures:
            print(f"  - raw/{label}/{name}")
    print("Next: review data/real/preview/, delete bad pairs from images/+labels/, "
          "then `python3 capture.py --merge`")


def merge(val_frac=0.1):
    imgs = sorted((REAL / "images").glob("*.jpg"))
    assert imgs, "nothing captured yet"
    random.seed(0)
    random.shuffle(imgs)
    n_val = max(1, int(len(imgs) * val_frac))
    for i, img in enumerate(imgs):
        split = "val" if i < n_val else "train"
        lbl = REAL / "labels" / (img.stem + ".txt")
        if not lbl.exists():
            continue
        for kind, src in (("images", img), ("labels", lbl)):
            dst = ROOT / "data" / "dataset" / kind / split / f"real_{src.name}"
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy(src, dst)
    print(f"merged {len(imgs)} real frames into data/dataset ({n_val} -> val). "
          f"Now: python3 train.py --epochs 15 --weights runs/detect/v0/weights/best.pt --name v1")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--label", choices=CLASSES)
    ap.add_argument("--n", type=int, default=80)
    ap.add_argument("--delay", type=float, default=0.15)
    ap.add_argument("--debug-mask", action="store_true")
    ap.add_argument("--ingest", action="store_true",
                    help="auto-label existing photos in raw/<class>/ (no camera)")
    ap.add_argument("--merge", action="store_true")
    args = ap.parse_args()
    if args.ingest:
        ingest()
    elif args.merge:
        merge()
    else:
        assert args.label, "need --label <class>, --ingest, or --merge"
        burst(args.label, args.n, args.delay, args.debug_mask)
