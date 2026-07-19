#!/usr/bin/env python3
"""Fingertip-gated fruit detection: no fingertips gripping it, no detection.

The demo holds the fruit BY the fingertips. This detector uses MediaPipe hand
landmarks to find the fingertips, then reports a fruit only if a fruit-colored
blob is in the grip (a fingertip inside or touching the fruit's box). With no
hand in frame it returns nothing - the fruit must be held to count.

Fruit color/shape comes from robust_detect (yellow=banana, red=apple,
green=by shape); this module just adds the fingertip gate. Same detection dicts
as the other detectors, so it drops into live_detect.py / sort_pipeline.py.

    python3 hand_gated_detect.py --image photo.jpg
    python3 hand_gated_detect.py --dir folder

Model: models/hand_landmarker.task (downloaded once; runs on-device).
"""
import argparse
import json
from pathlib import Path

import cv2

import robust_detect as R

ROOT = Path(__file__).resolve().parent
HAND_MODEL = ROOT / "models" / "hand_landmarker.task"
TIP_IDS = (4, 8, 12, 16, 20)   # thumb, index, middle, ring, pinky tips
_hl = None


def fingertips(bgr):
    """Pixel coords of every fingertip of every detected hand (empty if no hand)."""
    global _hl
    if _hl is None:
        from mediapipe.tasks.python import vision, BaseOptions
        _hl = vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(
            base_options=BaseOptions(model_asset_path=str(HAND_MODEL)),
            num_hands=2, min_hand_detection_confidence=0.4))
    import mediapipe as mp
    h, w = bgr.shape[:2]
    res = _hl.detect(mp.Image(image_format=mp.ImageFormat.SRGB,
                              data=cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)))
    tips = []
    for hand in (res.hand_landmarks or []):
        for i in TIP_IDS:
            tips.append((hand[i].x * w, hand[i].y * h))
    return tips


def _in_grip(bbox, tips, margin=0.35):
    """Is a fingertip inside the fruit box (expanded by margin)? = being held."""
    x, y, w, h = bbox
    mx, my = w * margin, h * margin
    for tx, ty in tips:
        if x - mx <= tx <= x + w + mx and y - my <= ty <= y + h + my:
            return True
    return False


def classify_all(bgr):
    tips = fingertips(bgr)
    if not tips:                      # no fingertips -> no detection
        return []
    return [d for d in R.classify_all(bgr) if _in_grip(d["bbox"], tips)]


def classify(bgr):
    dets = classify_all(bgr)
    return max(dets, key=lambda d: d["bbox"][2] * d["bbox"][3]) if dets else None


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
        n_tips = len(fingertips(img))
        dets = classify_all(img)
        if not dets:
            why = "no hand/fingertips" if n_tips == 0 else "fruit not in grip"
            print(f"{p.name}: no detection ({why})")
        else:
            s = ", ".join(f"{d['fruit']}_{d['ripeness']}({d['conf']})" for d in dets)
            print(f"{p.name}: {len(dets)} held -> {s}  [{n_tips} fingertips]")


if __name__ == "__main__":
    main()
