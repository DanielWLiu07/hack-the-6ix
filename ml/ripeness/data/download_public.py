#!/usr/bin/env python3
"""Pull public apple/banana detection data from Roboflow Universe and remap
labels into our 4-class scheme.

BLOCKED without a key: needs env ROBOFLOW_API_KEY (any free roboflow.com
account → Settings → API key). Untested until a key is available.

    ROBOFLOW_API_KEY=xxx python3 data/download_public.py

Ripeness is not labeled in public sets, so each source box is auto-classified
ripe/unripe by dominant HSV hue inside the bbox (red apple→ripe, green→unripe;
yellow banana→ripe, green→unripe). Ambiguous boxes are dropped. Output merges
into data/dataset/ alongside the synthetic images (prefix `rf_`).
"""
import os
import shutil
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent
DL = ROOT / "roboflow_raw"

# (workspace, project, version, fruit) — public Universe apple/banana detection sets.
# Swap slugs freely if a download 404s; any YOLO-format det set with apple/banana works.
SOURCES = [
    ("mixed-fruits", "fruit-detection-simple", 1, None),
]

CLASSES = ["apple_ripe", "apple_unripe", "banana_ripe", "banana_unripe"]


def classify_ripeness(img, box_xyxy, fruit):
    x0, y0, x1, y1 = (int(v) for v in box_xyxy)
    crop = img[max(0, y0):y1, max(0, x0):x1]
    if crop.size == 0:
        return None
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    sat = hsv[..., 1] > 60
    if sat.sum() < 50:
        return None
    h = hsv[..., 0][sat]
    red = ((h < 12) | (h > 165)).mean()
    yellow = ((h >= 18) & (h < 36)).mean()
    green = ((h >= 38) & (h < 85)).mean()
    if fruit == "apple":
        if red > 0.5:
            return "ripe"
        if green > 0.5:
            return "unripe"
    else:
        if yellow > 0.5:
            return "ripe"
        if green > 0.5:
            return "unripe"
    return None  # ambiguous → drop


def remap_split(split_dir, split):
    kept = dropped = 0
    img_dir, lbl_dir = split_dir / "images", split_dir / "labels"
    names = None
    yaml_file = split_dir.parent / "data.yaml"
    if yaml_file.exists():
        import yaml
        names = yaml.safe_load(yaml_file.read_text()).get("names")
    for lbl in sorted(lbl_dir.glob("*.txt")):
        img_path = next((p for p in img_dir.glob(lbl.stem + ".*")), None)
        if img_path is None:
            continue
        img = cv2.imread(str(img_path))
        if img is None:
            continue
        H, W = img.shape[:2]
        out_lines = []
        for line in lbl.read_text().splitlines():
            parts = line.split()
            if len(parts) != 5:
                continue
            src_cls = int(parts[0])
            src_name = (names[src_cls] if names else str(src_cls)).lower()
            fruit = "apple" if "apple" in src_name else "banana" if "banana" in src_name else None
            if fruit is None:
                continue
            xc, yc, w, h = (float(v) for v in parts[1:])
            box = ((xc - w / 2) * W, (yc - h / 2) * H, (xc + w / 2) * W, (yc + h / 2) * H)
            ripe = classify_ripeness(img, box, fruit)
            if ripe is None:
                dropped += 1
                continue
            out_lines.append(f"{CLASSES.index(f'{fruit}_{ripe}')} {parts[1]} {parts[2]} {parts[3]} {parts[4]}")
        if not out_lines:
            continue
        dst_img = ROOT / "dataset" / "images" / split / f"rf_{img_path.name}"
        dst_lbl = ROOT / "dataset" / "labels" / split / f"rf_{lbl.name}"
        dst_img.parent.mkdir(parents=True, exist_ok=True)
        dst_lbl.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(img_path, dst_img)
        dst_lbl.write_text("\n".join(out_lines) + "\n")
        kept += 1
    return kept, dropped


def main():
    key = os.environ.get("ROBOFLOW_API_KEY")
    if not key:
        sys.exit("BLOCKED: set ROBOFLOW_API_KEY (free at roboflow.com)")
    from roboflow import Roboflow
    rf = Roboflow(api_key=key)
    DL.mkdir(exist_ok=True)
    for ws, proj, ver, _ in SOURCES:
        print(f"downloading {ws}/{proj}:{ver} …")
        ds = rf.workspace(ws).project(proj).version(ver).download(
            "yolov8", location=str(DL / f"{ws}_{proj}_{ver}"))
        for split_src, split_dst in (("train", "train"), ("valid", "val"), ("test", "train")):
            sdir = Path(ds.location) / split_src
            if sdir.exists():
                kept, dropped = remap_split(sdir, split_dst)
                print(f"  {split_src}: kept {kept} imgs, dropped {dropped} ambiguous boxes")
    print("done — merged into data/dataset/ (rf_ prefix). Retrain with train.py.")


if __name__ == "__main__":
    main()
