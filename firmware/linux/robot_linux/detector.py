"""Detector abstraction + loaders (assignment task 4).

Priority order in load_detector():
  1. OnnxDetector  — ml/ripeness/export/model.onnx + classes.json (YOLOv8n)
  2. HSVDetector   — vision-infer's robot/vision/hsv_detector.py fallback
  3. MockDetector  — synthetic ground truth from MockCamera (dev/sim)

All detectors return a list of Detection; Detection.to_event() emits the
root-CLAUDE.md "detection" schema payload.
"""

import json
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from . import config


@dataclass
class Detection:
    fruit: str          # "apple" | "banana"
    ripeness: str       # "ripe" | "unripe"
    conf: float
    bbox: list          # [x, y, w, h] pixels

    @property
    def cls(self):
        return f"{self.fruit}_{self.ripeness}"

    def to_event(self):
        return {
            "ts": int(time.time() * 1000),
            "fruit": self.fruit,
            "ripeness": self.ripeness,
            "conf": round(float(self.conf), 3),
            "bbox": [int(v) for v in self.bbox],
        }


class MockDetector:
    """Perfect detector over MockCamera's synthetic ground truth."""

    name = "mock"

    def __init__(self, mock_camera, noise_px=4, conf=0.93):
        self.cam = mock_camera
        self.noise = noise_px
        self.conf = conf

    def detect(self, frame):
        bbox = self.cam.ground_truth_bbox()
        if bbox is None:
            return []
        fruit, ripeness = self.cam.fruit_class()
        n = self.cam.rng.randint(-self.noise, self.noise)
        bbox = [bbox[0] + n, bbox[1] + n, bbox[2], bbox[3]]
        return [Detection(fruit, ripeness, self.conf, bbox)]


class OnnxDetector:
    """YOLOv8-style ONNX detector (single-scale, 4 classes, 320px)."""

    name = "onnx"

    def __init__(self, model_path=config.MODEL_PATH, classes_path=config.CLASSES_PATH,
                 min_conf=config.MIN_CONF):
        import onnxruntime as ort
        self.session = ort.InferenceSession(str(model_path),
                                            providers=["CPUExecutionProvider"])
        inp = self.session.get_inputs()[0]
        self.input_name = inp.name
        # NCHW [1,3,S,S]; fall back to 320 if dims are dynamic
        shape = inp.shape
        self.size = int(shape[2]) if isinstance(shape[2], int) else 320
        self.classes = json.loads(Path(classes_path).read_text())
        self.min_conf = min_conf

    def _preprocess(self, frame):
        h, w = frame.shape[:2]
        scale = self.size / max(h, w)
        nh, nw = int(round(h * scale)), int(round(w * scale))
        resized = _resize_nn(frame, nh, nw)
        canvas = np.full((self.size, self.size, 3), 114, dtype=np.uint8)
        canvas[:nh, :nw] = resized
        x = canvas[:, :, ::-1].astype(np.float32) / 255.0  # BGR->RGB
        return x.transpose(2, 0, 1)[None], scale

    def detect(self, frame):
        x, scale = self._preprocess(frame)
        out = self.session.run(None, {self.input_name: x})[0]
        # YOLOv8 export: [1, 4+nc, N] -> [N, 4+nc]
        if out.ndim == 3:
            out = out[0]
        if out.shape[0] < out.shape[1]:
            out = out.T
        boxes_cxcywh = out[:, :4]
        scores = out[:, 4:]
        cls_ids = scores.argmax(axis=1)
        confs = scores[np.arange(len(scores)), cls_ids]
        keep = confs >= self.min_conf
        dets = []
        for (cx, cy, bw, bh), cid, cf in zip(
                boxes_cxcywh[keep], cls_ids[keep], confs[keep]):
            x0 = (cx - bw / 2) / scale
            y0 = (cy - bh / 2) / scale
            name = self.classes[int(cid)] if int(cid) < len(self.classes) else "apple_ripe"
            fruit, _, ripeness = name.partition("_")
            dets.append(Detection(fruit, ripeness or "ripe", float(cf),
                                  [x0, y0, bw / scale, bh / scale]))
        return _nms(dets)


class HSVDetector:
    """Adapter around vision-infer's robot/vision/hsv_detector.py."""

    name = "hsv"

    def __init__(self, module):
        self._detect = getattr(module, "detect", None) or getattr(module, "detect_fruit")

    def detect(self, frame):
        dets = []
        for d in self._detect(frame):
            # vision-infer returns root-schema detection dicts
            dets.append(Detection(d["fruit"], d["ripeness"],
                                  d.get("conf", 0.5), list(d["bbox"])))
        return dets


def _nms(dets, iou_thresh=0.45):
    dets = sorted(dets, key=lambda d: d.conf, reverse=True)
    kept = []
    for d in dets:
        if all(_iou(d.bbox, k.bbox) < iou_thresh for k in kept):
            kept.append(d)
    return kept


def _iou(a, b):
    ax0, ay0, aw, ah = a
    bx0, by0, bw, bh = b
    ix0, iy0 = max(ax0, bx0), max(ay0, by0)
    ix1, iy1 = min(ax0 + aw, bx0 + bw), min(ay0 + ah, by0 + bh)
    iw, ih = max(0.0, ix1 - ix0), max(0.0, iy1 - iy0)
    inter = iw * ih
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0


def _resize_nn(img, nh, nw):
    """Nearest-neighbor resize in pure numpy (avoids requiring cv2)."""
    h, w = img.shape[:2]
    ys = (np.arange(nh) * (h / nh)).astype(int).clip(0, h - 1)
    xs = (np.arange(nw) * (w / nw)).astype(int).clip(0, w - 1)
    return img[ys][:, xs]


def load_detector(mock_camera=None, verbose=True):
    """Best available detector: ONNX -> HSV -> Mock."""
    if config.MODEL_PATH.exists() and config.CLASSES_PATH.exists():
        try:
            det = OnnxDetector()
            if verbose:
                print(f"[detector] onnx model {config.MODEL_PATH} (input {det.size}px)")
            return det
        except Exception as e:
            if verbose:
                print(f"[detector] onnx load failed ({e}); trying HSV fallback")
    hsv_path = config.HSV_DETECTOR_DIR / "hsv_detector.py"
    if hsv_path.exists():
        try:
            sys.path.insert(0, str(config.HSV_DETECTOR_DIR))
            import hsv_detector  # type: ignore
            if verbose:
                print(f"[detector] HSV fallback from {hsv_path}")
            return HSVDetector(hsv_detector)
        except Exception as e:
            if verbose:
                print(f"[detector] HSV import failed ({e})")
    if mock_camera is not None:
        if verbose:
            print("[detector] using MockDetector (synthetic)")
        return MockDetector(mock_camera)
    raise RuntimeError("no detector available: no ONNX model, no HSV module, no mock camera")
