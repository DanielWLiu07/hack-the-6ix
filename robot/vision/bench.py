"""FPS/latency benchmark for the fruit detectors.

Run:  python3 bench.py [--detector hsv|onnx|auto] [--frames 300] [--size 640x480]

Measures pure inference latency (detect() only, capture excluded) over
synthetic frames, prints a human summary plus one machine-readable JSON line
(`BENCH {...}`) for status reports.

This is the harness for the Qualcomm-track on-device numbers: run it on the
laptop now, re-run unchanged on the UNO Q Linux side once flashed and quote
that JSON line in the writeup.
"""

import argparse
import json
import platform
import statistics
import time

from synthetic import make_frame


def bench(detector, frames=300, width=640, height=480, warmup=10):
    # pre-generate scenes so image synthesis isn't measured
    scenes = [make_frame(width, height, rng_seed=i)[0] for i in range(min(frames, 50))]

    for i in range(warmup):
        detector.detect(scenes[i % len(scenes)])

    latencies = []
    n_dets = 0
    t_start = time.perf_counter()
    for i in range(frames):
        frame = scenes[i % len(scenes)]
        t0 = time.perf_counter()
        dets = detector.detect(frame)
        latencies.append(time.perf_counter() - t0)
        n_dets += len(dets)
    wall = time.perf_counter() - t_start

    lat_ms = sorted(l * 1000 for l in latencies)
    p = lambda q: lat_ms[min(len(lat_ms) - 1, int(q * len(lat_ms)))]
    return {
        "detector": detector.name,
        "frames": frames,
        "size": f"{width}x{height}",
        "fps": round(frames / wall, 1),
        "latency_ms": {
            "mean": round(statistics.mean(lat_ms), 2),
            "median": round(statistics.median(lat_ms), 2),
            "p95": round(p(0.95), 2),
            "max": round(lat_ms[-1], 2),
        },
        "detections_per_frame": round(n_dets / frames, 2),
        "machine": f"{platform.machine()} {platform.system()}",
        "cpu": platform.processor() or platform.machine(),
    }


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--detector", default="auto", choices=["hsv", "onnx", "auto"])
    ap.add_argument("--frames", type=int, default=300)
    ap.add_argument("--size", default="640x480")
    args = ap.parse_args()
    w, h = (int(v) for v in args.size.split("x"))

    from detector import load_detector
    det = load_detector(prefer=args.detector)

    r = bench(det, args.frames, w, h)
    lm = r["latency_ms"]
    print(f"{r['detector']} @ {r['size']} on {r['machine']}: "
          f"{r['fps']} fps | mean {lm['mean']} ms, median {lm['median']} ms, "
          f"p95 {lm['p95']} ms | {r['detections_per_frame']} det/frame")
    print("BENCH", json.dumps(r))
