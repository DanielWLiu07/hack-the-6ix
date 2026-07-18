"""Eval harness: score a detector against synthetic ground truth.

Run:  python3 test_detector.py [--frames 100] [--detector hsv|onnx|auto]

Reports precision/recall on (fruit, ripeness, IoU>0.3) matches. Used to tune
HSV ranges; also validates that every emitted dict conforms to the root
`detection` schema.
"""

import argparse
import sys

from synthetic import make_frame


def iou(a, b):
    ax, ay, aw, ah = a
    bx, by, bw, bh = b
    x1, y1 = max(ax, bx), max(ay, by)
    x2, y2 = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    union = aw * ah + bw * bh - inter
    return inter / union if union else 0.0


def check_schema(d):
    assert set(d) == {"ts", "fruit", "ripeness", "conf", "bbox"}, f"keys: {set(d)}"
    assert d["fruit"] in ("apple", "banana"), d["fruit"]
    assert d["ripeness"] in ("ripe", "unripe"), d["ripeness"]
    assert isinstance(d["conf"], float) and 0.0 <= d["conf"] <= 1.0, d["conf"]
    assert isinstance(d["bbox"], list) and len(d["bbox"]) == 4, d["bbox"]
    assert all(isinstance(v, int) for v in d["bbox"]), d["bbox"]
    assert isinstance(d["ts"], (int, float)), d["ts"]


def evaluate(detector, frames=100, iou_thresh=0.3, verbose=False):
    tp = fp = fn = wrong_class = 0
    for i in range(frames):
        img, truth = make_frame(rng_seed=1000 + i)
        dets = detector.detect(img)
        for d in dets:
            check_schema(d)
        matched_truth = set()
        for d in dets:
            best_j, best_iou = -1, 0.0
            for j, t in enumerate(truth):
                if j in matched_truth:
                    continue
                v = iou(d["bbox"], t["bbox"])
                if v > best_iou:
                    best_j, best_iou = j, v
            if best_iou >= iou_thresh:
                matched_truth.add(best_j)
                t = truth[best_j]
                if d["fruit"] == t["fruit"] and d["ripeness"] == t["ripeness"]:
                    tp += 1
                else:
                    wrong_class += 1
                    if verbose:
                        print(f"frame {i}: {t['fruit']}/{t['ripeness']} "
                              f"detected as {d['fruit']}/{d['ripeness']}")
            else:
                fp += 1
        fn += len(truth) - len(matched_truth)

    total_truth = tp + wrong_class + fn
    precision = tp / max(1, tp + fp + wrong_class)
    recall = tp / max(1, total_truth)
    return {"frames": frames, "tp": tp, "fp": fp, "fn": fn,
            "wrong_class": wrong_class,
            "precision": round(precision, 3), "recall": round(recall, 3)}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--frames", type=int, default=100)
    ap.add_argument("--detector", default="hsv", choices=["hsv", "onnx", "auto"])
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    if args.detector == "hsv":
        from hsv_detector import HSVDetector
        det = HSVDetector()
    else:
        from detector import load_detector
        det = load_detector(prefer=args.detector)

    result = evaluate(det, args.frames, verbose=args.verbose)
    print(f"detector={det.name} {result}")
    # recall gate is 0.85: touching same-color fruits merge into one blob and
    # fail the IoU match — known HSV limit, not a regression signal
    ok = result["precision"] >= 0.9 and result["recall"] >= 0.85
    print("PASS" if ok else "NEEDS TUNING")
    sys.exit(0 if ok else 1)
