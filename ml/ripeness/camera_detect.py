#!/usr/bin/env python3
"""Live camera fruit detection - the on-device loop for the UNO Q MPU.

Grabs frames from the arm camera, runs detection every frame, prints each
root-CLAUDE.md detection and (with --emit) streams them to the hub so the
dashboard updates in real time. This is the exact loop that runs on the UNO Q's
Linux side; inference stays on the board (onnxruntime CPU or the pure-cv2 color
detector), never in the cloud.

    python3 camera_detect.py                      # camera 0, onnx model
    python3 camera_detect.py --detector color     # robust on real fruit
    python3 camera_detect.py --emit               # live to the dashboard
    python3 camera_detect.py --source synth        # no camera: synthetic fruit (test/demo)

Env: CAM_INDEX (default 0), SERVER_URL (default http://localhost:3001).
On the UNO Q this runs unchanged; --source synth lets you verify the loop off-board.
"""
import argparse
import json
import os
import time
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent


def open_source(source):
    """Return a callable next_frame() -> BGR image, or raise for a dead camera."""
    if source == "synth":
        from data.make_synth import make_image  # reuse the synthetic renderer
        rng = np.random.RandomState(0)
        def nxt():
            # vary the seed each call so the fruit moves/changes
            s = int(rng.randint(0, 1_000_000))
            np.random.seed(s)
            import random as _r; _r.seed(s)
            img, _ = make_image()
            return img
        return nxt
    cam = cv2.VideoCapture(int(os.environ.get("CAM_INDEX", 0)))
    if not cam.isOpened():
        raise RuntimeError("camera not opened - set CAM_INDEX, check the arm camera, "
                           "or use --source synth to test the loop without hardware")
    def nxt():
        ok, frame = cam.read()
        return frame if ok else None
    return nxt


def make_detector(kind, model, conf):
    if kind == "color":
        from robust_detect import classify_all
        return lambda frame: [d for d in classify_all(frame) if d["conf"] >= conf]
    import onnxruntime as ort
    from infer_test import detect
    classes = json.loads((Path(model).parent / "classes.json").read_text())
    size = classes.get("imgsz", 320)
    sess = ort.InferenceSession(model, providers=["CPUExecutionProvider"])
    return lambda frame: detect(sess, frame, classes, size, conf_thres=conf)


def connect_hub(server):
    import socketio
    sio = socketio.Client()
    sio.connect(server, auth={"role": "robot", "sim": True}, wait_timeout=5)
    return sio


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="camera", choices=["camera", "synth"])
    ap.add_argument("--detector", default="color", choices=["color", "onnx"],
                    help="color = robust on real fruit incl clutter (default); onnx = trained net")
    ap.add_argument("--model", default=str(ROOT / "export/model.onnx"))
    ap.add_argument("--conf", type=float, default=0.35)
    ap.add_argument("--emit", action="store_true", help="stream detections to the hub")
    ap.add_argument("--server", default=os.environ.get("SERVER_URL", "http://localhost:3001"))
    ap.add_argument("--max-frames", type=int, default=0, help="stop after N frames (0=forever)")
    ap.add_argument("--fps-every", type=int, default=30, help="print an FPS line every N frames")
    args = ap.parse_args()

    next_frame = open_source(args.source)
    detect_fn = make_detector(args.detector, args.model, args.conf)
    sio = connect_hub(args.server) if args.emit else None
    if sio:
        print(f"# streaming detections to {args.server}")

    n, t0, lat = 0, time.perf_counter(), []
    print(f"# camera_detect: source={args.source} detector={args.detector} (Ctrl-C to stop)")
    try:
        while True:
            frame = next_frame()
            if frame is None:
                continue
            t = time.perf_counter()
            dets = detect_fn(frame)
            lat.append(time.perf_counter() - t)
            for d in dets:
                print(json.dumps(d))
                if sio:
                    sio.emit("detection", d)
            n += 1
            if args.fps_every and n % args.fps_every == 0:
                fps = n / (time.perf_counter() - t0)
                print(f"# {n} frames, {fps:.1f} FPS avg, {1000*np.mean(lat[-args.fps_every:]):.1f} ms/infer")
            if args.max_frames and n >= args.max_frames:
                break
    except KeyboardInterrupt:
        pass
    finally:
        if sio:
            sio.disconnect()
    dt = time.perf_counter() - t0
    print(f"# done: {n} frames in {dt:.1f}s ({n/max(dt,1e-6):.1f} FPS)")


if __name__ == "__main__":
    main()
