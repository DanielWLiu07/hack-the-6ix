#!/usr/bin/env python3
"""Alternative CV: MediaPipe ObjectDetector (real trained net) + color ripeness.

Unlike the color detector (robust_detect.py), this uses a real object-detection
model (EfficientDet-Lite, COCO-trained) that has actual "banana" and "apple"
classes. It finds the fruit by learned appearance, so it works even when the
banana is held in a cluttered scene - the hand/face are separate COCO classes it
simply ignores. Ripeness is then read from the color inside each detected box
(yellow banana = ripe, green = unripe; red apple = ripe, green = unripe).

Returns the same docs/SCHEMAS.md detection dicts as the other detectors, so it
drops into sort_pipeline.py / camera_detect.py via classify()/classify_all().

    python3 mediapipe_detect.py --image photo.jpg
    python3 mediapipe_detect.py --dir folder

Model: models/efficientdet_lite0.tflite (downloaded once; runs fully on-device).
"""
import argparse
import json
import time
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent
MODEL = ROOT / "models" / "efficientdet_lite0.tflite"
FRUIT_LABELS = {"banana", "apple"}
_det = None


def _detector(score=0.15):   # low: we filter to banana/apple, so non-fruit classes drop out anyway
    global _det
    if _det is None:
        from mediapipe.tasks.python import vision, BaseOptions
        opts = vision.ObjectDetectorOptions(
            base_options=BaseOptions(model_asset_path=str(MODEL)),
            score_threshold=score, max_results=10)
        _det = vision.ObjectDetector.create_from_options(opts)
    return _det


def _ripeness(bgr_box, fruit):
    """Median hue inside the box -> ripe/unripe by fruit color coding."""
    if bgr_box.size == 0:
        return "ripe"
    hsv = cv2.cvtColor(bgr_box, cv2.COLOR_BGR2HSV)
    s = hsv[:, :, 1]
    hue = hsv[:, :, 0][s > 50]
    if len(hue) == 0:
        return "ripe"
    green = ((hue >= 36) & (hue <= 88)).mean()
    if green > 0.5:                 # mostly green -> unripe (both fruits)
        return "unripe"
    return "ripe"                   # yellow banana / red apple -> ripe


def classify_all(bgr):
    import mediapipe as mp
    det = _detector()
    mp_img = mp.Image(image_format=mp.ImageFormat.SRGB,
                      data=cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB))
    res = det.detect(mp_img)
    H, W = bgr.shape[:2]
    out = []
    for d in res.detections:
        cat = d.categories[0]
        name = (cat.category_name or "").lower()
        if name not in FRUIT_LABELS:
            continue
        bb = d.bounding_box
        x, y = max(0, bb.origin_x), max(0, bb.origin_y)
        w, h = bb.width, bb.height
        box = bgr[y:min(H, y + h), x:min(W, x + w)]
        out.append({"ts": int(time.time() * 1000), "fruit": name,
                    "ripeness": _ripeness(box, name), "conf": round(float(cat.score), 3),
                    "bbox": [int(x), int(y), int(w), int(h)]})
    return out


def classify(bgr):
    dets = classify_all(bgr)
    return max(dets, key=lambda d: d["conf"]) if dets else None


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
            s = ", ".join(f"{d['fruit']}_{d['ripeness']}({d['conf']})" for d in dets)
            print(f"{p.name}: {len(dets)} -> {s}")


if __name__ == "__main__":
    main()
