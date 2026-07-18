#!/usr/bin/env python3
"""Export trained weights -> export/model.onnx (+ int8 quantized model.int8.onnx).

    python3 export.py                              # uses runs/detect/v0/weights/best.pt
    python3 export.py --weights path/to/best.pt

Deliverable contract (root CLAUDE.md): export/model.onnx + export/classes.json.
firmware/linux loads model.onnx via onnxruntime; model.int8.onnx is the smaller/
faster variant for the UNO Q if accuracy holds (check with infer_test.py).
"""
import argparse
import random
import shutil
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent
EXPORT = ROOT / "export"

# metadata keys ultralytics/quantizer stamp that are safe + useful to keep in a
# judged artifact (no local paths / usernames). Everything else is dropped.
SAFE_META_KEYS = {"names", "imgsz", "task", "stride", "batch", "channels", "author"}


def sanitize_onnx(path):
    """Strip machine-identifying metadata from an exported .onnx in place.

    Ultralytics stamps meta[description] = "... trained on <ABS PATH>/dataset.yaml"
    which leaks the local username/path into a shipped, judge-visible artifact.
    We clear the doc_string and keep only a curated, path-free metadata allowlist.
    """
    import onnx
    m = onnx.load(str(path))
    m.doc_string = ""
    kept = [p for p in m.metadata_props
            if p.key in SAFE_META_KEYS and "/Users/" not in p.value]
    del m.metadata_props[:]
    m.metadata_props.extend(kept)
    onnx.save(m, str(path))


def letterbox(img, size):
    """Match ultralytics preprocessing: BGR->RGB, letterbox to size, /255, CHW."""
    h, w = img.shape[:2]
    r = min(size / h, size / w)
    nh, nw = round(h * r), round(w * r)
    resized = cv2.resize(img, (nw, nh))
    canvas = np.full((size, size, 3), 114, np.uint8)
    top, left = (size - nh) // 2, (size - nw) // 2
    canvas[top:top + nh, left:left + nw] = resized
    x = canvas[:, :, ::-1].astype(np.float32) / 255.0
    return np.ascontiguousarray(x.transpose(2, 0, 1))[None]


def quantize_int8(onnx_path, imgsz):
    from onnxruntime.quantization import (CalibrationDataReader, QuantFormat,
                                          QuantType, quantize_static)

    calib_dir = ROOT / "data" / "dataset" / "images" / "val"
    imgs = sorted(calib_dir.glob("*.jpg"))
    if not imgs:
        print(f"no calibration images in {calib_dir}; skipping int8")
        return None
    random.seed(0)
    imgs = random.sample(imgs, min(100, len(imgs)))

    class Reader(CalibrationDataReader):
        def __init__(self):
            self.it = iter(imgs)

        def get_next(self):
            p = next(self.it, None)
            if p is None:
                return None
            return {"images": letterbox(cv2.imread(str(p)), imgsz)}

    out = EXPORT / "model.int8.onnx"
    quantize_static(str(onnx_path), str(out), Reader(),
                    quant_format=QuantFormat.QDQ,
                    activation_type=QuantType.QUInt8,
                    weight_type=QuantType.QInt8)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", default=str(ROOT / "runs/detect/v0/weights/best.pt"))
    ap.add_argument("--imgsz", type=int, default=320)
    ap.add_argument("--no-int8", action="store_true")
    args = ap.parse_args()

    from ultralytics import YOLO
    EXPORT.mkdir(exist_ok=True)

    model = YOLO(args.weights)
    onnx_out = model.export(format="onnx", imgsz=args.imgsz, opset=12, simplify=True)
    shutil.copy(onnx_out, EXPORT / "model.onnx")
    shutil.copy(ROOT / "classes.json", EXPORT / "classes.json")
    sanitize_onnx(EXPORT / "model.onnx")  # scrub local paths/username before shipping
    print(f"-> {EXPORT/'model.onnx'} ({(EXPORT/'model.onnx').stat().st_size/1e6:.1f} MB)")

    if not args.no_int8:
        try:
            q = quantize_int8(EXPORT / "model.onnx", args.imgsz)
            if q:
                sanitize_onnx(q)  # quantizer re-stamps the leaky description; scrub again
                print(f"-> {q} ({q.stat().st_size/1e6:.1f} MB)")
        except Exception as e:  # int8 is an optimization, never block the deliverable
            print(f"int8 quantization failed ({e}); model.onnx still valid")


if __name__ == "__main__":
    main()
