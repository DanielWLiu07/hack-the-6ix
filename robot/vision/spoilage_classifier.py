"""Pluggable spoilage classifier: HSV detector localizes -> we classify the crop.

Backends (env SPOILAGE_BACKEND):
  * "classical" (default) — trust the detector's adaptive-Lab spoil_score
    (spoilage.py). Zero deps, works today.
  * "onnx"               — run an Edge-Impulse-exported image classifier on the
    banana crop. Set SPOILAGE_MODEL=/path/model.onnx and (optionally)
    SPOILAGE_CLASSES="fresh,spoiled". Hot-swaps in when we have the trained model.

Both expose the same call:

    clf = load_spoilage_classifier()
    patch = clf.classify(frame_bgr, det)      # det has at least "bbox"
    det.update(patch)                          # sets spoiled / spoil_score / label

Design intent (see docs/QUALCOMM_PLAN.md): the classifier is the single spoilage
authority for the runtime, so swapping classical -> Edge Impulse is one env var and
touches nothing else. On the UNO Q the same interface wraps an App Lab Brick.
"""

import os

from spoilage import THRESHOLD, score_spoilage


class ClassicalSpoilage:
    name = "classical"

    def classify(self, frame_bgr, det):
        # prefer the detector's contour-based score if it already computed one
        if "spoil_score" in det:
            score = float(det["spoil_score"])
            spoiled = bool(det.get("spoiled", score >= THRESHOLD))
        else:
            score, spoiled = score_spoilage(frame_bgr, det["bbox"])
        return {"spoiled": spoiled, "spoil_score": round(score, 3),
                "label": "spoiled" if spoiled else "fresh"}


class ModelSpoilage:
    """Edge Impulse (or any) image classifier over the banana crop, via onnxruntime."""
    name = "onnx"

    def __init__(self, model_path, classes):
        import onnxruntime as ort
        self.classes = classes
        self.sess = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
        inp = self.sess.get_inputs()[0]
        self.input_name = inp.name
        shape = inp.shape  # e.g. [1,96,96,3] (NHWC) or [1,3,96,96] (NCHW)
        # detect layout + size, tolerating dynamic (str/None) dims
        dims = [d if isinstance(d, int) else 0 for d in shape]
        if len(dims) == 4 and dims[1] == 3:
            self.layout, self.h, self.w = "NCHW", dims[2] or 96, dims[3] or 96
        else:
            self.layout, self.h, self.w = "NHWC", (dims[1] or 96), (dims[2] or 96)
        self.is_int = "int" in (inp.type or "")  # int8/uint8 quantized input

    def _preprocess(self, crop_bgr):
        import cv2
        import numpy as np
        rgb = cv2.cvtColor(cv2.resize(crop_bgr, (self.w, self.h)), cv2.COLOR_BGR2RGB)
        if self.is_int:
            x = rgb.astype("uint8")
        else:
            x = rgb.astype("float32") / 255.0
        if self.layout == "NCHW":
            x = x.transpose(2, 0, 1)
        return x[None]  # add batch dim

    def classify(self, frame_bgr, det):
        import numpy as np
        x, y, w, h = det["bbox"]
        H, W = frame_bgr.shape[:2]
        x0, y0, x1, y1 = max(0, x), max(0, y), min(W, x + w), min(H, y + h)
        crop = frame_bgr[y0:y1, x0:x1]
        if crop.size == 0:
            return {"spoiled": False, "spoil_score": 0.0, "label": "fresh"}
        try:
            out = self.sess.run(None, {self.input_name: self._preprocess(crop)})[0]
            p = np.asarray(out).ravel().astype("float32")
            if p.sum() <= 0 or p.max() > 1.0 + 1e-3:   # logits -> softmax
                p = np.exp(p - p.max()); p = p / p.sum()
            idx = int(p.argmax())
            label = self.classes[idx] if idx < len(self.classes) else str(idx)
            si = self.classes.index("spoiled") if "spoiled" in self.classes else idx
            score = float(p[si]) if si < len(p) else float(p[idx])
        except Exception:
            # never crash the runtime on a bad frame; fall back to fresh/neutral
            return {"spoiled": False, "spoil_score": 0.0, "label": "fresh"}
        return {"spoiled": label == "spoiled", "spoil_score": round(score, 3), "label": label}


def load_spoilage_classifier():
    """Factory. classical by default; onnx model when SPOILAGE_BACKEND=onnx and a
    readable SPOILAGE_MODEL is present (else logs to stderr and stays classical)."""
    backend = os.environ.get("SPOILAGE_BACKEND", "classical").lower()
    if backend in ("onnx", "model", "ei"):
        path = os.environ.get("SPOILAGE_MODEL", "")
        classes = [c.strip() for c in os.environ.get("SPOILAGE_CLASSES", "fresh,spoiled").split(",")]
        if path and os.path.isfile(path):
            try:
                return ModelSpoilage(path, classes)
            except Exception as e:  # missing onnxruntime, bad model, ...
                import sys
                print(f"[spoilage] model backend failed ({e}); using classical", file=sys.stderr)
        else:
            import sys
            print(f"[spoilage] SPOILAGE_MODEL not found ({path!r}); using classical", file=sys.stderr)
    return ClassicalSpoilage()


if __name__ == "__main__":
    # self-check on a synthetic spotted banana (classical backend)
    import cv2
    import numpy as np
    from hsv_detector import HSVDetector
    img = np.full((480, 640, 3), (60, 60, 60), np.uint8)
    cv2.ellipse(img, (320, 240), (150, 60), 0, 0, 360, (40, 220, 235), -1)
    for _ in range(5):
        cv2.circle(img, (280 + np.random.randint(80), 220 + np.random.randint(40)), 10, (15, 15, 15), -1)
    clf = load_spoilage_classifier()
    print("backend:", clf.name)
    for d in HSVDetector().detect(img):
        d.update(clf.classify(img, d))
        print(" ", {k: d[k] for k in ("fruit", "spoiled", "spoil_score", "label")})
