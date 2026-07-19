#!/usr/bin/env python3
"""Batch-classify a folder of apple/banana photos and route each to its sort bin.

This is the ML side of the "apple storage" flow: point it at a directory of
stored photos, it runs the on-device ONNX detector over each and returns, per
image, the detected fruit + ripeness + confidence + the sort bin it belongs in.

    python3 classify_folder.py --dir path/to/photos
    python3 classify_folder.py --dir photos --model export/model.int8.onnx --conf 0.25
    python3 classify_folder.py --dir photos --json out.json   # machine-readable

Bins follow docs/SCHEMAS.md: apple_ripe, apple_unripe, banana_ripe, banana_unripe.
Decode logic is shared with infer_test.py (the same path firmware/linux runs
on-device), so results here match what the robot would emit as detection events.
"""
import argparse
import json
from pathlib import Path

import cv2
import onnxruntime as ort

from infer_test import detect

ROOT = Path(__file__).resolve().parent
IMG_EXTS = (".jpg", ".jpeg", ".png", ".bmp", ".webp")


def bin_for(fruit, ripeness):
    """Sort bin for a detection. 4-bin scheme = fruit_ripeness."""
    return f"{fruit}_{ripeness}"


def classify_dir(dir_path, model_path, conf, annotate_dir=None):
    classes = json.loads((Path(model_path).parent / "classes.json").read_text())
    size = classes.get("imgsz", 320)
    sess = ort.InferenceSession(str(model_path), providers=["CPUExecutionProvider"])

    imgs = sorted(p for p in Path(dir_path).rglob("*") if p.suffix.lower() in IMG_EXTS)
    results = []
    for p in imgs:
        img = cv2.imread(str(p))
        if img is None:
            results.append({"image": str(p), "error": "unreadable"})
            continue
        dets = detect(sess, img, classes, size, conf_thres=conf)
        # top detection drives the bin (one fruit per stored photo is the norm)
        top = max(dets, key=lambda d: d["conf"], default=None)
        results.append({
            "image": str(p),
            "n_detections": len(dets),
            "top": None if top is None else {
                "fruit": top["fruit"], "ripeness": top["ripeness"],
                "conf": top["conf"], "bin": bin_for(top["fruit"], top["ripeness"]),
            },
            "all": [{"fruit": d["fruit"], "ripeness": d["ripeness"],
                     "conf": d["conf"], "bin": bin_for(d["fruit"], d["ripeness"]),
                     "bbox": d["bbox"]} for d in dets],
        })
        if annotate_dir:
            Path(annotate_dir).mkdir(parents=True, exist_ok=True)
            for d in dets:
                x, y, w, h = d["bbox"]
                cv2.rectangle(img, (x, y), (x + w, y + h), (255, 255, 255), 2)
                cv2.putText(img, f'{bin_for(d["fruit"], d["ripeness"])} {d["conf"]}',
                            (x, max(14, y - 5)), 0, 0.6, (255, 255, 255), 2)
            cv2.imwrite(str(Path(annotate_dir) / f"{p.stem}_out.jpg"), img)
    return results


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True, help="folder of photos to classify")
    ap.add_argument("--model", default=str(ROOT / "export/model.onnx"))
    ap.add_argument("--conf", type=float, default=0.35)
    ap.add_argument("--json", default=None, help="write full results to this JSON file")
    ap.add_argument("--annotate", default=None, help="dir to write boxed previews")
    args = ap.parse_args()

    results = classify_dir(args.dir, args.model, args.conf, args.annotate)

    bins = {}
    for r in results:
        t = r.get("top")
        label = t["bin"] if t else "NO_DETECTION"
        bins[label] = bins.get(label, 0) + 1
        name = Path(r["image"]).name
        if t:
            print(f"{name:32s} -> {t['bin']:14s} (conf {t['conf']}, {r['n_detections']} det)")
        else:
            print(f"{name:32s} -> NO_DETECTION ({r.get('error', 'no boxes above conf')})")

    print("\nbin tally:", json.dumps(bins))
    if args.json:
        Path(args.json).write_text(json.dumps(results, indent=2))
        print(f"# full results -> {args.json}")


if __name__ == "__main__":
    main()
