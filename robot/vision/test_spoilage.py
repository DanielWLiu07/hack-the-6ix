"""Spoilage scoring sanity checks: clean fruit reads fresh, blemished reads spoiled."""
import cv2
import numpy as np

from hsv_detector import HSVDetector
from spoilage import score_spoilage


def _yellow_banana(spots=0, spot_r=10):
    """640x480 BGR frame with one yellow banana ellipse, optional black spots."""
    img = np.full((480, 640, 3), (60, 60, 60), np.uint8)  # dark-grey bg
    center, axes = (320, 240), (140, 60)
    cv2.ellipse(img, center, axes, 0, 0, 360, (40, 220, 235), -1)  # BGR ~ yellow
    rng = np.random.default_rng(0)
    for _ in range(spots):
        dx = int(rng.integers(-axes[0] + spot_r, axes[0] - spot_r))
        dy = int(rng.integers(-axes[1] + spot_r, axes[1] - spot_r))
        cv2.circle(img, (center[0] + dx, center[1] + dy), spot_r, (15, 15, 15), -1)
    return img


def _banana(dets):
    b = [d for d in dets if d["fruit"] == "banana"]
    return b[0] if b else None


def main():
    det = HSVDetector()

    clean = _banana(det.detect(_yellow_banana(spots=0)))
    assert clean is not None, "clean banana not detected"
    assert not clean["spoiled"], f"clean banana flagged spoiled: {clean['spoil_score']}"
    print(f"clean:   spoil_score={clean['spoil_score']:.3f} spoiled={clean['spoiled']}  OK")

    spotted = _banana(det.detect(_yellow_banana(spots=6, spot_r=12)))
    assert spotted is not None, "spotted banana not detected"
    assert spotted["spoiled"], f"spotted banana NOT flagged: {spotted['spoil_score']}"
    print(f"spotted: spoil_score={spotted['spoil_score']:.3f} spoiled={spotted['spoiled']}  OK")

    assert spotted["spoil_score"] > clean["spoil_score"], "spotted should score higher"

    # monotonic-ish: more/bigger spots -> higher score
    a = _banana(det.detect(_yellow_banana(spots=2, spot_r=8)))["spoil_score"]
    b = _banana(det.detect(_yellow_banana(spots=8, spot_r=14)))["spoil_score"]
    assert b > a, f"expected more blemishes to score higher ({b} !> {a})"
    print(f"dose-response: 2 small={a:.3f} < 8 large={b:.3f}  OK")

    print("\nALL SPOILAGE TESTS PASSED")


if __name__ == "__main__":
    main()
