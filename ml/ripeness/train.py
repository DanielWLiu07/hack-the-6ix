#!/usr/bin/env python3
"""Train YOLOv8n fruit-type+ripeness detector at 320px.

    python3 train.py                    # full run on data/dataset
    python3 train.py --epochs 15 --weights runs/detect/v0/weights/best.pt
                                        # quick venue finetune from a prior run

Best weights land in runs/detect/<name>/weights/best.pt. Then run export.py.
"""
import argparse
from pathlib import Path

import torch
from ultralytics import YOLO

ROOT = Path(__file__).resolve().parent


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", default="yolov8n.pt",
                    help="starting weights (yolov8n.pt or a prior best.pt for finetune)")
    ap.add_argument("--data", default=str(ROOT / "dataset.yaml"))
    ap.add_argument("--epochs", type=int, default=40)
    ap.add_argument("--imgsz", type=int, default=320)
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--name", default="v0")
    ap.add_argument("--device", default=None,
                    help="override device; default auto-picks mps/cuda/cpu")
    args = ap.parse_args()

    device = args.device or (
        "mps" if torch.backends.mps.is_available()
        else 0 if torch.cuda.is_available() else "cpu")

    model = YOLO(args.weights)
    model.train(
        data=args.data,
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        device=device,
        name=args.name,
        project=str(ROOT / "runs" / "detect"),
        exist_ok=True,
        patience=15,
        # props are color-coded: keep hue shifts tiny or ripe/unripe collapses
        hsv_h=0.005, hsv_s=0.4, hsv_v=0.5,
        degrees=15, translate=0.15, scale=0.5, fliplr=0.5, flipud=0.1,
        mosaic=1.0,
        workers=4,
        verbose=True,
    )
    metrics = model.val(data=args.data, imgsz=args.imgsz, device=device)
    print(f"\nmAP50={metrics.box.map50:.3f} mAP50-95={metrics.box.map:.3f}")
    print(f"best weights: {ROOT}/runs/detect/{args.name}/weights/best.pt")


if __name__ == "__main__":
    main()
