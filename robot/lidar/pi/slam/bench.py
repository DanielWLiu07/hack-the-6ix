#!/usr/bin/env python3
"""bench.py - SLAM per-scan latency + memory benchmark.

The Qualcomm UNO Q track wants on-device numbers. This runs the deterministic
synthetic workload through the exact SLAM pipeline and reports ms/scan (mean,
p50, p95, max) and peak RSS. Report the laptop figure now; re-run on the UNO Q
Linux side for the real on-device number.

Run:  ./.venv/bin/python bench.py            # 200 scans, 200 beams
      ./.venv/bin/python bench.py --scans 400 --beams 300
"""
import argparse
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from slam import Slam            # noqa: E402
import synth                     # noqa: E402


def peak_rss_mb():
    try:
        import resource
        r = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        # macOS reports bytes, Linux reports kilobytes
        return r / (1024 * 1024) if sys.platform == "darwin" else r / 1024
    except Exception:
        return float("nan")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--scans", type=int, default=200)
    ap.add_argument("--beams", type=int, default=200)
    ap.add_argument("--warmup", type=int, default=5)
    args = ap.parse_args()

    poses, scans = synth.dataset(steps=args.scans, beams=args.beams, seed=0)
    s = Slam()
    times = []
    for i, sc in enumerate(scans):
        t0 = time.perf_counter()
        s.update(sc)
        dt = (time.perf_counter() - t0) * 1000.0
        if i >= args.warmup:
            times.append(dt)

    t = np.array(times)
    hz_headroom = 500.0 / t.mean()          # 2 Hz budget = 500 ms/scan
    print(f"SLAM benchmark  ({args.scans} scans, {args.beams} beams, warmup {args.warmup})")
    print(f"  points/scan     : ~{len(scans[len(scans)//2])}")
    print(f"  ms/scan  mean   : {t.mean():.1f}")
    print(f"           p50    : {np.percentile(t,50):.1f}")
    print(f"           p95    : {np.percentile(t,95):.1f}")
    print(f"           max    : {t.max():.1f}")
    print(f"  final map cells : {int((s.grid.prob()>=0.7).sum())} occ, grid {s.grid.n}x{s.grid.n}")
    print(f"  ref map points  : {len(s.ref)}")
    print(f"  peak RSS (MB)   : {peak_rss_mb():.0f}")
    print(f"  2 Hz headroom   : {hz_headroom:.0f}x  ({'OK' if t.mean()<250 else 'TIGHT'} for on-device)")


if __name__ == "__main__":
    main()
