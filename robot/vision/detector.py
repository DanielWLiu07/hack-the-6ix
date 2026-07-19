"""Unified detector loader - THE import surface for the Linux node.

Usage (from firmware/linux, with robot/vision on sys.path):

    from detector import load_detector
    det = load_detector()                 # ONNX if model exists, else HSV
    dets = det.detect(frame_bgr)          # list of root-schema detection dicts

Every detector exposes:
    .name    "hsv" | "onnx"
    .detect(frame_bgr, ts=None) -> [{"ts","fruit","ripeness","conf","bbox"}]

Env:
    DETECTOR      force "hsv" or "onnx" (default: auto)
    MODEL_PATH    ONNX model (default ml/ripeness/export/model.onnx)
    CLASSES_PATH  class names JSON (default alongside model)
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from hsv_detector import HSVDetector, annotate  # noqa: F401  (annotate re-exported)


def load_detector(prefer=None):
    """prefer: None/'auto', 'hsv', or 'onnx'. Auto uses ONNX when the model
    file exists and loads cleanly, else falls back to HSV (never raises)."""
    prefer = prefer or os.environ.get("DETECTOR", "auto").lower()
    if prefer == "hsv":
        return HSVDetector()

    from onnx_detector import ONNXDetector, model_available
    if prefer == "onnx":
        return ONNXDetector()  # explicit request: let load errors surface
    if model_available():
        try:
            return ONNXDetector()
        except Exception as e:  # model present but broken -> don't kill the robot
            print(f"[detector] ONNX load failed ({e}); falling back to HSV",
                  file=sys.stderr)
    return HSVDetector()
