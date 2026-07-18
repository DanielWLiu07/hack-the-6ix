"""Spoilage / blemish scoring for detected fruit.

Orthogonal to ripeness: a fruit can be ripe AND spoiled. We measure the fraction
of a fruit's silhouette covered by blemishes (bruises, rot, marker spots).

Key lesson from real data: marker/bruise spots are NOT absolutely dark - on a
pale printed banana the spots still sit at Value ~100+. What separates them is
that they are *relative* to the fruit's own body: darker than the fruit's median
lightness, and/or less yellow. So we threshold **relative to each fruit's own
Lab statistics**, not against fixed values. On the captured dataset this signal
separates fresh vs spoiled at AUC ~0.86 (vs ~0.5 for the old absolute-dark test).

    score, spoiled = score_spoilage(frame_bgr, bbox, contour)

Env tunables:
    SPOIL_DARK_DELTA    L must be this far below the fruit median to be a blemish (default 32)
    SPOIL_YELLOW_DELTA  Lab-b this far below the fruit median = less-yellow blemish (default 16)
    SPOIL_THRESHOLD     blemish fraction at/above which `spoiled` is True (default 0.03)
    SPOIL_MIN_SPOT      min blemish blob area px^2 (default 10; kills speckle)
"""

import os

import cv2
import numpy as np

DARK_DELTA = float(os.environ.get("SPOIL_DARK_DELTA", "32"))
YELLOW_DELTA = float(os.environ.get("SPOIL_YELLOW_DELTA", "16"))
THRESHOLD = float(os.environ.get("SPOIL_THRESHOLD", "0.03"))
MIN_SPOT = int(os.environ.get("SPOIL_MIN_SPOT", "10"))

_SPOT_KERNEL = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))


def _silhouette(bbox, contour, off):
    """Binary mask (roi-sized) of the fruit body. Prefer the exact detection
    contour (HSV path); fall back to the whole bbox (ONNX path)."""
    x0, y0, w, h = bbox
    if contour is not None:
        sil = np.zeros((h, w), np.uint8)
        shifted = contour.reshape(-1, 2) - [off[0], off[1]]
        cv2.drawContours(sil, [shifted.astype(np.int32)], -1, 255, thickness=-1)
        return sil
    return np.full((h, w), 255, np.uint8)


def _blemish(frame_bgr, bbox, contour):
    """(roi-sized blemish mask, silhouette mask) using per-fruit adaptive Lab."""
    x, y, w, h = bbox
    H, W = frame_bgr.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(W, x + w), min(H, y + h)
    if x1 <= x0 or y1 <= y0:
        return None, None
    roi = frame_bgr[y0:y1, x0:x1]
    sil = _silhouette((x0, y0, x1 - x0, y1 - y0), contour, (x0, y0))
    m = sil > 0
    if m.sum() < 50:
        return None, None
    lab = cv2.cvtColor(roi, cv2.COLOR_BGR2LAB).astype(np.float32)
    L, B = lab[:, :, 0], lab[:, :, 2]
    medL, medB = np.median(L[m]), np.median(B[m])
    # blemish = inside fruit AND (relatively dark OR relatively less-yellow)
    blem = (m & ((L < medL - DARK_DELTA) | (B < medB - YELLOW_DELTA))).astype(np.uint8) * 255
    blem = cv2.morphologyEx(blem, cv2.MORPH_OPEN, _SPOT_KERNEL)
    return blem, sil


def score_spoilage(frame_bgr, bbox, contour=None):
    """Return (spoil_score in [0,1], spoiled bool) for one detected fruit."""
    blem, sil = _blemish(frame_bgr, bbox, contour)
    if blem is None:
        return 0.0, False
    sil_area = int(np.count_nonzero(sil)) or 1
    spoil_px = 0
    contours, _ = cv2.findContours(blem, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for c in contours:
        a = cv2.contourArea(c)
        if a >= MIN_SPOT:
            spoil_px += a
    score = round(float(np.clip(spoil_px / sil_area, 0.0, 1.0)), 3)
    return score, score >= THRESHOLD


def spot_contours(frame_bgr, bbox, contour=None):
    """Frame-coordinate contours of the blemishes, for drawing overlays."""
    blem, _ = _blemish(frame_bgr, bbox, contour)
    if blem is None:
        return []
    x0, y0 = max(0, bbox[0]), max(0, bbox[1])
    out = []
    contours, _ = cv2.findContours(blem, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for c in contours:
        if cv2.contourArea(c) >= MIN_SPOT:
            out.append(c + [x0, y0])
    return out
