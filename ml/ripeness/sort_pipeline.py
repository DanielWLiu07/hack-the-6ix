#!/usr/bin/env python3
"""End-to-end demo: a photo goes in, the ML classifies it, it gets sorted.

    photo -> ONNX detector -> detection event -> sort decision -> pick_event

Prints the exact root-CLAUDE.md `detection` and `pick_event` JSON for each photo
(zero deps beyond the detector), so you can watch a stored image get routed to
its bin. With --emit it also pushes those events to the live hub so the sort
shows up on the web dashboard (needs python-socketio + the hub on SERVER_URL).

    python3 sort_pipeline.py --image photo.jpg
    python3 sort_pipeline.py --dir photos --emit          # live to dashboard
    python3 sort_pipeline.py --image photo.jpg --server http://localhost:3001

The bin rule matches firmware/linux's state machine exactly (bin = fruit_ripeness),
so this is the same sort decision the real robot makes, just driven from a file
instead of the arm camera.
"""
import argparse
import json
import os
import time
from pathlib import Path

import cv2
import onnxruntime as ort

from infer_test import detect
from robust_detect import classify as color_classify

ROOT = Path(__file__).resolve().parent
IMG_EXTS = (".jpg", ".jpeg", ".png", ".bmp", ".webp")
# 4-bin sort scheme (root CLAUDE.md). Falls back to fruit-only if a 2-bin rig.
BINS = ("apple_ripe", "apple_unripe", "banana_ripe", "banana_unripe")


def sort_bin(fruit, ripeness):
    """Which bin this fruit goes in. Matches state_machine.py (det.cls)."""
    return f"{fruit}_{ripeness}"


def run_one(sess, classes, size, path, conf, use_color=False):
    img = cv2.imread(str(path))
    if img is None:
        return None
    if use_color:
        # color+shape detector: robust on REAL fruit, one dominant fruit per frame
        d = color_classify(img)
        dets = [d] if d and d["conf"] >= conf else []
    else:
        dets = detect(sess, img, classes, size, conf_thres=conf)
    if not dets:
        return {"image": str(path), "detection": None, "pick_event": None}
    top = max(dets, key=lambda d: d["conf"])
    ts = int(time.time() * 1000)
    detection = {  # root schema: detection
        "ts": ts, "fruit": top["fruit"], "ripeness": top["ripeness"],
        "conf": top["conf"], "bbox": top["bbox"],
    }
    bin_name = sort_bin(top["fruit"], top["ripeness"])
    pick_event = {  # root schema: pick_event
        "ts": ts, "fruit": top["fruit"], "ripeness": top["ripeness"],
        "bin": bin_name, "success": True, "duration_ms": 8000,
    }
    return {"image": str(path), "detection": detection, "pick_event": pick_event}


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--image", help="single photo")
    g.add_argument("--dir", help="folder of photos")
    ap.add_argument("--model", default=str(ROOT / "export/model.onnx"))
    ap.add_argument("--detector", default="color", choices=["color", "onnx"],
                    help="color = robust on real fruit incl clutter (default); onnx = trained net (best on synthetic props)")
    ap.add_argument("--conf", type=float, default=0.35)
    ap.add_argument("--emit", action="store_true", help="push events to the live hub")
    ap.add_argument("--server", default=os.environ.get("SERVER_URL", "http://localhost:3001"))
    args = ap.parse_args()

    use_color = args.detector == "color"
    # color mode needs no trained model; only load ONNX for the net path
    if use_color:
        sess, classes, size = None, None, None
    else:
        classes = json.loads((Path(args.model).parent / "classes.json").read_text())
        size = classes.get("imgsz", 320)
        sess = ort.InferenceSession(args.model, providers=["CPUExecutionProvider"])

    if args.image:
        paths = [Path(args.image)]
    else:
        paths = sorted(p for p in Path(args.dir).rglob("*") if p.suffix.lower() in IMG_EXTS)

    sio = None
    if args.emit:
        try:
            import socketio
            sio = socketio.Client()
            # role=robot so the hub accepts detection/pick_event; sim=true so the
            # panic switch does not treat this file-driven feed as the real robot.
            sio.connect(args.server, auth={"role": "robot", "sim": True}, wait_timeout=5)
            print(f"# connected to hub {args.server} as robot(sim)")
        except Exception as e:
            print(f"# --emit off: cannot reach hub ({e}); printing events only")
            sio = None

    for p in paths:
        r = run_one(sess, classes, size, p, args.conf, use_color=use_color)
        if r is None:
            print(f"{p.name}: unreadable")
            continue
        if r["detection"] is None:
            print(f"{p.name}: NO detection above conf {args.conf} -> nothing to sort")
            continue
        d, pe = r["detection"], r["pick_event"]
        print(f"\n=== {p.name} ===")
        print("detection ", json.dumps(d))
        print("sorted to ", pe["bin"], "->", json.dumps(pe))
        if sio:
            sio.emit("detection", d)
            time.sleep(0.2)
            sio.emit("pick_event", pe)
            print(f"# emitted to dashboard: {pe['bin']}")

    if sio:
        time.sleep(0.5)
        sio.disconnect()


if __name__ == "__main__":
    main()
