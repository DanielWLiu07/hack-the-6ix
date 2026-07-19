#!/usr/bin/env python3
"""Live camera preview with fruit-detection boxes drawn in real time - try it yourself.

Opens your webcam, runs the detector every frame, and draws a labelled box around
each detected fruit. Hold a fruit up to the camera and watch. Press 'q' to quit.

    python3 live_detect.py                      # color detector (best on the 3D prints)
    python3 live_detect.py --detector mediapipe # real trained net (best on real fruit)
    python3 live_detect.py --detector onnx      # our synthetic-trained net

Env: CAM_INDEX (default 0) if you have more than one camera.
"""
import argparse
import os
import time

import cv2
import numpy as np


def get_detector(kind, conf):
    if kind == "grip":
        # fingertip-gated: only fruit held by the fingers counts
        from hand_gated_detect import classify_all
        return lambda f: [d for d in classify_all(f) if d["conf"] >= conf]
    if kind == "color":
        from robust_detect import classify_all
        return lambda f: [d for d in classify_all(f) if d["conf"] >= conf]
    if kind == "mediapipe":
        from mediapipe_detect import classify_all
        return lambda f: [d for d in classify_all(f) if d["conf"] >= conf]
    import json
    from pathlib import Path
    import onnxruntime as ort
    from infer_test import detect
    classes = json.loads((Path(__file__).resolve().parent / "export/classes.json").read_text())
    size = classes.get("imgsz", 320)
    sess = ort.InferenceSession(str(Path(__file__).resolve().parent / "export/model.onnx"),
                                providers=["CPUExecutionProvider"])
    return lambda f: detect(sess, f, classes, size, conf_thres=conf)


COLORS = {"apple": (60, 60, 220), "banana": (40, 200, 230)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--detector", default="color", choices=["grip", "color", "mediapipe", "onnx"])
    ap.add_argument("--conf", type=float, default=0.2)
    args = ap.parse_args()

    detect_fn = get_detector(args.detector, args.conf)
    tips_fn = None
    if args.detector == "grip":
        from hand_gated_detect import fingertips
        tips_fn = fingertips
    cam = cv2.VideoCapture(int(os.environ.get("CAM_INDEX", 0)))
    if not cam.isOpened():
        raise SystemExit("camera not opened - set CAM_INDEX or check the webcam")

    print(f"live_detect: detector={args.detector}, conf={args.conf}. Press 'q' in the window to quit.")
    last = time.perf_counter()
    fps = 0.0
    while True:
        ok, frame = cam.read()
        if not ok:
            continue
        dets = detect_fn(frame)
        if tips_fn is not None:
            for tx, ty in tips_fn(frame):
                cv2.circle(frame, (int(tx), int(ty)), 9, (0, 255, 255), -1)
                cv2.circle(frame, (int(tx), int(ty)), 9, (0, 0, 0), 2)
        for d in dets:
            x, y, w, h = d["bbox"]
            col = COLORS.get(d["fruit"], (0, 220, 0))
            cv2.rectangle(frame, (x, y), (x + w, y + h), col, 3)
            label = f'{d["fruit"]}_{d["ripeness"]} {d["conf"]:.2f}'
            cv2.rectangle(frame, (x, y - 34), (x + len(label) * 15, y), col, -1)
            cv2.putText(frame, label, (x + 4, y - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 0), 2)
        now = time.perf_counter()
        fps = 0.9 * fps + 0.1 * (1.0 / max(now - last, 1e-6))
        last = now
        cv2.putText(frame, f"{args.detector}  {fps:.0f} FPS  {len(dets)} fruit",
                    (12, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 255, 255), 2)
        cv2.imshow("live fruit detection (press q to quit)", frame)
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break
    cam.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
