#!/usr/bin/env python3
"""Smoke-test the exported ONNX model on one image - no ultralytics needed.

    python3 infer_test.py                          # picks a val image automatically
    python3 infer_test.py --image path.jpg --model export/model.int8.onnx

Prints root-schema `detection` dicts (one per line, JSON) and writes
infer_test_out.jpg with boxes drawn. This is exactly the decode logic
firmware/linux should replicate: onnxruntime + numpy + cv2 only.
"""
import argparse
import json
import time
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort

ROOT = Path(__file__).resolve().parent


def preprocess(img, size):
    h, w = img.shape[:2]
    r = min(size / h, size / w)
    nh, nw = round(h * r), round(w * r)
    canvas = np.full((size, size, 3), 114, np.uint8)
    top, left = (size - nh) // 2, (size - nw) // 2
    canvas[top:top + nh, left:left + nw] = cv2.resize(img, (nw, nh))
    x = canvas[:, :, ::-1].astype(np.float32) / 255.0
    return np.ascontiguousarray(x.transpose(2, 0, 1))[None], r, top, left


def detect(sess, img, classes, size, conf_thres=0.35, iou_thres=0.45):
    """Run one frame → list of root-schema detection dicts (bbox in pixels)."""
    x, r, top, left = preprocess(img, size)
    (out,) = sess.run(None, {sess.get_inputs()[0].name: x})
    pred = out[0].T  # (N, 4+nc): cx, cy, w, h, cls scores
    scores = pred[:, 4:]
    cls_ids = scores.argmax(1)
    confs = scores[np.arange(len(scores)), cls_ids]
    keep = confs > conf_thres
    pred, cls_ids, confs = pred[keep], cls_ids[keep], confs[keep]

    # undo letterbox → original pixel coords, xywh with top-left origin
    boxes = []
    for cx, cy, w, h in pred[:, :4]:
        bx = (cx - w / 2 - left) / r
        by = (cy - h / 2 - top) / r
        boxes.append([bx, by, w / r, h / r])
    idxs = cv2.dnn.NMSBoxes(boxes, confs.tolist(), conf_thres, iou_thres)
    dets = []
    for i in np.array(idxs).flatten():
        name = classes["classes"][cls_ids[i]]
        x0, y0, bw, bh = (int(round(v)) for v in boxes[i])
        dets.append({
            "ts": int(time.time() * 1000),
            "fruit": classes["class_map"][name]["fruit"],
            "ripeness": classes["class_map"][name]["ripeness"],
            "conf": round(float(confs[i]), 3),
            "bbox": [x0, y0, bw, bh],
        })
    return dets


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=str(ROOT / "export/model.onnx"))
    ap.add_argument("--image", default=None)
    ap.add_argument("--conf", type=float, default=0.35)
    args = ap.parse_args()

    image = args.image
    if image is None:
        vals = sorted((ROOT / "data/dataset/images/val").glob("*.jpg"))
        assert vals, "no --image given and no val images found (run data/make_synth.py)"
        image = str(vals[0])

    classes = json.loads((Path(args.model).parent / "classes.json").read_text())
    size = classes.get("imgsz", 320)
    sess = ort.InferenceSession(args.model, providers=["CPUExecutionProvider"])
    img = cv2.imread(image)
    assert img is not None, f"cannot read {image}"

    t0 = time.time()
    dets = detect(sess, img, classes, size, args.conf)
    dt = time.time() - t0

    for d in dets:
        print(json.dumps(d))
    print(f"# {len(dets)} detections in {dt*1000:.0f} ms ({1/dt:.1f} FPS single-frame, laptop CPU)")

    for d in dets:
        x, y, w, h = d["bbox"]
        cv2.rectangle(img, (x, y), (x + w, y + h), (255, 255, 255), 2)
        cv2.putText(img, f'{d["fruit"]}_{d["ripeness"]} {d["conf"]}',
                    (x, max(12, y - 4)), 0, 0.5, (255, 255, 255), 1)
    out_path = ROOT / "infer_test_out.jpg"
    cv2.imwrite(str(out_path), img)
    print(f"# annotated → {out_path}")


if __name__ == "__main__":
    main()
