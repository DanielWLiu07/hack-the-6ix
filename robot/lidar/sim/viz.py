#!/usr/bin/env python3
"""Debug viewer: render N accumulated sim scans to a PNG (age-faded, robot at
origin) — a quick visual check that scans look like the room and a preview of
the DECAY.md effect. Requires matplotlib (not in requirements.txt on purpose;
install ad hoc: `.venv/bin/pip install matplotlib`).

Usage: python viz.py [out.png] [n_scans]
"""

import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

import sim


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "scan_preview.png"
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 8

    robot, rng, dt = sim.Robot(), np.random.default_rng(7), 0.5
    for _ in range(40):  # let the robot get moving first
        robot.step(dt)

    fig, ax = plt.subplots(figsize=(7, 7), facecolor="black")
    ax.set_facecolor("black")
    for i in range(n):
        robot.step(dt)
        p = sim.make_payload(robot, 20.0 + i * dt, 360, rng)
        pts = np.array(p["points"])
        age = (n - 1 - i) / n  # oldest scan most faded
        ax.scatter(pts[:, 0], pts[:, 1], s=3, color="cyan", alpha=max(0.08, 1 - age))
    ax.plot(0, 0, marker=(3, 0, -90), color="orange", markersize=14)  # robot, +x forward
    ax.set_aspect("equal")
    ax.set_xlabel("x fwd (m)", color="white")
    ax.set_ylabel("y left (m)", color="white")
    ax.tick_params(colors="white")
    ax.set_title(f"{n} scans, robot frame, age fade", color="white")
    fig.savefig(out, dpi=120, facecolor="black", bbox_inches="tight")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
