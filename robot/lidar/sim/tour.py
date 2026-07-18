#!/usr/bin/env python3
"""Scripted room-tour renderer — backup demo footage of the lidar SLAM-lite map.

Drives the synthetic robot on a deterministic tour of the room, feeds every scan
through scan_match.ScanMapper (scan-to-map ICP odometry), and renders a video of
the *global* occupancy map building up in real time: the recovered trajectory,
the live scan, and the accumulated world map. This is the "wow" artifact — a
coherent room map assembled from a pose-less `lidar_scan` stream, no external
odometry.

Usage:
    python tour.py                       # -> tour.mp4 (+ tour_map.png final frame)
    python tour.py out.gif               # GIF instead (pillow)
    python tour.py out.mp4 --seconds 25 --fps 12

Requires matplotlib + pillow (GIF) / ffmpeg (mp4). Deterministic (fixed seed) so
the footage is reproducible.
"""

import argparse
import math

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.animation import FFMpegWriter, PillowWriter

import scan_match as sm
import sim

LIDAR_HZ = 10.0          # native scan rate the matcher runs at
DISPLAY_HZ = 2.0         # frames rendered per sim-second (matches the web stream)


def _robot_marker(ax, x, y, th, color="#ff9500"):
    """Draw an oriented triangle for the robot at world pose."""
    L = 0.28
    tip = (x + L * math.cos(th), y + L * math.sin(th))
    left = (x + 0.6 * L * math.cos(th + 2.5), y + 0.6 * L * math.sin(th + 2.5))
    right = (x + 0.6 * L * math.cos(th - 2.5), y + 0.6 * L * math.sin(th - 2.5))
    return ax.fill([tip[0], left[0], right[0]], [tip[1], left[1], right[1]],
                   color=color, zorder=5)


def run_tour(seconds, seed=7):
    """Drive the tour, returning per-display-frame snapshots for rendering."""
    robot = sim.Robot()
    rng = np.random.default_rng(seed)
    mapper = sm.ScanMapper()
    dt = 1.0 / LIDAR_HZ
    every = max(1, round(LIDAR_HZ / DISPLAY_HZ))   # internal scans per frame
    n_scans = int(seconds * LIDAR_HZ)

    frames = []
    for i in range(n_scans):
        robot.step(dt)
        payload = sim.make_payload(robot, 10 + i * dt, 360, rng)
        mapper.add(payload["points"])
        if i % every == 0:
            px, py, pth = mapper.pose
            live = sm.transform_points(mapper.pose_T, np.array(payload["points"]))
            frames.append({
                "map": mapper.world_points().copy(),
                "live": live,
                "traj": np.array([(t[0], t[1]) for t in mapper.trajectory]),
                "pose": (px, py, pth),
                "err": mapper.last_error,
                "scan_i": i,
            })
    return frames, mapper


def render(frames, out, fps):
    # Fixed extent covering the whole 8x6 room + margin (world frame).
    fig, ax = plt.subplots(figsize=(8, 6.2), facecolor="#0b0f14")
    ax.set_facecolor("#0b0f14")
    ax.set_xlim(-5.5, 5.5)
    ax.set_ylim(-4.2, 4.2)
    ax.set_aspect("equal")
    ax.tick_params(colors="#4a5568", labelsize=8)
    for s in ax.spines.values():
        s.set_color("#1f2933")
    ax.set_title("", color="white", fontsize=13, loc="left")

    map_sc = ax.scatter([], [], s=2, c="#3b6ea5", alpha=0.55, zorder=1)
    live_sc = ax.scatter([], [], s=6, c="#22d3ee", alpha=0.95, zorder=3)
    (traj_ln,) = ax.plot([], [], "-", color="#ff9500", lw=1.4, alpha=0.8, zorder=2)
    robot_patch = [None]
    txt = ax.text(0.015, 0.975, "", transform=ax.transAxes, color="#cbd5e1",
                  fontsize=10, va="top", family="monospace")

    writer = _pick_writer(out, fps)
    with writer.saving(fig, out, dpi=110):
        for k, f in enumerate(frames):
            m = f["map"]
            map_sc.set_offsets(m if len(m) else np.empty((0, 2)))
            live_sc.set_offsets(f["live"] if len(f["live"]) else np.empty((0, 2)))
            traj_ln.set_data(f["traj"][:, 0], f["traj"][:, 1])
            if robot_patch[0]:
                robot_patch[0][0].remove()
            px, py, pth = f["pose"]
            robot_patch[0] = _robot_marker(ax, px, py, pth)
            ax.set_title("Lidar SLAM-lite — live occupancy map from pose-less scans",
                         color="white", fontsize=12, loc="left")
            txt.set_text(f"scan {f['scan_i']:4d}   map {len(m):5d} pts   "
                         f"match {f['err']*100:4.1f} cm")
            writer.grab_frame()
    plt.close(fig)


def _pick_writer(out, fps):
    if out.lower().endswith(".gif"):
        return PillowWriter(fps=fps)
    try:
        return FFMpegWriter(fps=fps, bitrate=2400,
                            metadata={"title": "lidar tour"})
    except Exception:
        return PillowWriter(fps=fps)


def save_final_png(frames, mapper, path):
    """A single hero still: the completed map + full trajectory."""
    fig, ax = plt.subplots(figsize=(8, 6.2), facecolor="#0b0f14")
    ax.set_facecolor("#0b0f14")
    m = mapper.world_points()
    traj = np.array([(t[0], t[1]) for t in mapper.trajectory])
    ax.scatter(m[:, 0], m[:, 1], s=2.2, c="#3b6ea5", alpha=0.6)
    ax.plot(traj[:, 0], traj[:, 1], "-", color="#ff9500", lw=1.6, alpha=0.85)
    px, py, pth = mapper.pose
    _robot_marker(ax, px, py, pth)
    ax.set_aspect("equal")
    ax.set_xlim(-5.5, 5.5)
    ax.set_ylim(-4.2, 4.2)
    ax.tick_params(colors="#4a5568", labelsize=8)
    for s in ax.spines.values():
        s.set_color("#1f2933")
    ax.set_title(f"Reconstructed room map — {len(m)} pts, "
                 f"{len(traj)} poses", color="white", fontsize=12, loc="left")
    fig.savefig(path, dpi=130, facecolor="#0b0f14", bbox_inches="tight")
    plt.close(fig)


def main():
    ap = argparse.ArgumentParser(description="Scripted lidar room-tour renderer")
    ap.add_argument("out", nargs="?", default="tour.mp4",
                    help="output video (.mp4 or .gif); default tour.mp4")
    ap.add_argument("--seconds", type=float, default=16.0,
                    help="tour duration in sim-seconds (default 16; longer = "
                         "more coverage but more open-loop drift smear)")
    ap.add_argument("--fps", type=int, default=10, help="output fps (default 10)")
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args()

    print(f"[tour] driving {args.seconds:.0f}s tour at {LIDAR_HZ:.0f} Hz "
          f"({int(args.seconds*LIDAR_HZ)} scans)...")
    frames, mapper = run_tour(args.seconds, seed=args.seed)
    gx, gy, _ = mapper.pose
    print(f"[tour] {len(frames)} frames, final map {len(mapper.world_points())} pts, "
          f"end pose ({gx:+.2f},{gy:+.2f}), last match {mapper.last_error*100:.1f} cm, "
          f"{mapper.rejects} gated steps")
    print(f"[tour] rendering -> {args.out} ...")
    render(frames, args.out, args.fps)
    png = args.out.rsplit(".", 1)[0] + "_map.png"
    save_final_png(frames, mapper, png)
    print(f"[tour] wrote {args.out} and {png}")


if __name__ == "__main__":
    main()
