"""ONNX detector wrapper for the trained ripeness model (vision-train's export).

Consumes the ultralytics YOLOv8 ONNX convention:
    input : (1, 3, H, W) float32, RGB, 0-1  (H/W read from the model)
    output: (1, 4 + num_classes, N) - cxcywh boxes + per-class scores

Expected files (defaults; override with env MODEL_PATH / CLASSES_PATH):
    ml/ripeness/export/model.onnx
    ml/ripeness/export/classes.json   # ["apple_ripe","apple_unripe","banana_ripe","banana_unripe"]
                                      # index == class id; names are "<fruit>_<ripeness>"

detect() returns the same root-schema detection dicts as HSVDetector.
"""

import json
import os
import time

import cv2
import numpy as np

_HERE = os.path.dirname(os.path.abspath(__file__))
_EXPORT_DIR = os.path.normpath(os.path.join(_HERE, "..", "..", "ml", "ripeness", "export"))

DEFAULT_MODEL = os.environ.get("MODEL_PATH", os.path.join(_EXPORT_DIR, "model.onnx"))
DEFAULT_CLASSES = os.environ.get("CLASSES_PATH", os.path.join(_EXPORT_DIR, "classes.json"))

CONF_THRESH = float(os.environ.get("ONNX_CONF", "0.35"))
NMS_THRESH = float(os.environ.get("ONNX_NMS", "0.45"))


def model_available(model_path=None):
    return os.path.isfile(model_path or DEFAULT_MODEL)


class ONNXDetector:
    name = "onnx"

    def __init__(self, model_path=None, classes_path=None):
        import onnxruntime as ort  # deferred so HSV-only boxes don't need it

        model_path = model_path or DEFAULT_MODEL
        classes_path = classes_path or DEFAULT_CLASSES
        self.session = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
        inp = self.session.get_inputs()[0]
        self.input_name = inp.name

        with open(classes_path) as f:
            meta = json.load(f)
        # classes.json is either the current dict schema
        #   {"classes":[...], "imgsz":320, "class_map":{"apple_ripe":{"fruit":..,"ripeness":..}}}
        # or a legacy plain array  ["apple_ripe", "apple_unripe", ...].
        if isinstance(meta, dict):
            self.classes = meta["classes"]
            cmap = meta.get("class_map")
            if isinstance(cmap, dict):
                self.class_map = [(cmap[c]["fruit"], cmap[c]["ripeness"])
                                  for c in self.classes]
            else:  # dict without class_map -> split the "<fruit>_<ripeness>" names
                self.class_map = [tuple(c.split("_", 1)) for c in self.classes]
            meta_imgsz = meta.get("imgsz")
        else:
            self.classes = meta
            self.class_map = [tuple(c.split("_", 1)) for c in self.classes]
            meta_imgsz = None

        # input shape like [1, 3, 320, 320]; fall back to classes.json imgsz, then 320
        h, w = inp.shape[2], inp.shape[3]
        self.in_h = h if isinstance(h, int) else (meta_imgsz or 320)
        self.in_w = w if isinstance(w, int) else (meta_imgsz or 320)

    def _letterbox(self, img):
        h, w = img.shape[:2]
        scale = min(self.in_w / w, self.in_h / h)
        nw, nh = int(round(w * scale)), int(round(h * scale))
        resized = cv2.resize(img, (nw, nh))
        canvas = np.full((self.in_h, self.in_w, 3), 114, np.uint8)
        dx, dy = (self.in_w - nw) // 2, (self.in_h - nh) // 2
        canvas[dy:dy + nh, dx:dx + nw] = resized
        return canvas, scale, dx, dy

    def detect(self, frame_bgr, ts=None):
        ts = ts if ts is not None else time.time()
        img, scale, dx, dy = self._letterbox(frame_bgr)
        blob = cv2.cvtColor(img, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        blob = np.transpose(blob, (2, 0, 1))[None]

        out = self.session.run(None, {self.input_name: blob})[0]
        preds = np.squeeze(out, 0)          # (4+nc, N)
        if preds.shape[0] > preds.shape[1]:  # tolerate (N, 4+nc) layout
            preds = preds.T
        boxes_cxcywh = preds[:4].T           # (N, 4)
        scores_all = preds[4:].T             # (N, nc)

        cls_ids = np.argmax(scores_all, axis=1)
        confs = scores_all[np.arange(len(cls_ids)), cls_ids]
        keep = confs >= CONF_THRESH
        if not np.any(keep):
            return []
        boxes_cxcywh, cls_ids, confs = boxes_cxcywh[keep], cls_ids[keep], confs[keep]

        # cxcywh (letterboxed px) -> xywh in original-frame px
        xy = boxes_cxcywh[:, :2] - boxes_cxcywh[:, 2:] / 2
        wh = boxes_cxcywh[:, 2:]
        xy[:, 0] = (xy[:, 0] - dx) / scale
        xy[:, 1] = (xy[:, 1] - dy) / scale
        wh /= scale

        rects = [[float(x), float(y), float(w), float(h)]
                 for (x, y), (w, h) in zip(xy, wh)]
        idxs = cv2.dnn.NMSBoxes(rects, confs.astype(float).tolist(),
                                CONF_THRESH, NMS_THRESH)
        idxs = np.array(idxs).flatten() if len(idxs) else []

        H, W = frame_bgr.shape[:2]
        detections = []
        for i in idxs:
            x, y, w, h = rects[i]
            x = int(np.clip(x, 0, W - 1))
            y = int(np.clip(y, 0, H - 1))
            w = int(np.clip(w, 1, W - x))
            h = int(np.clip(h, 1, H - y))
            fruit, ripeness = self.class_map[cls_ids[i]]
            detections.append({
                "ts": ts,
                "fruit": fruit,
                "ripeness": ripeness,
                "conf": round(float(confs[i]), 2),
                "bbox": [x, y, w, h],
            })
        detections.sort(key=lambda d: d["conf"], reverse=True)
        return detections
