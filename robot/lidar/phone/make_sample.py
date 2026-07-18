#!/usr/bin/env python3
"""make_sample.py - generate a synthetic colored "world" GLB.

This exists so web-frontend can build & test the 3D lidar view BEFORE a real
iPhone lidar scan exists. It emits a small, vertex-colored room (floor, four
walls, a table, and a couple of fruit-colored props) authored in the SAME
coordinate frame that `process.py` targets and that web-frontend overlays the
live C1 `lidar_scan` points onto. See README.md ("Coordinate conventions").

Frame (glTF / three.js, right-handed):
    +Y = up          (robot +Z)
    +X = right       (robot -Y, i.e. robot's right)
    -Z = into scene  (robot +X, forward)
Units: meters. Origin: robot base at scan start (floor at y=0).

Usage:
    python3 make_sample.py [--out ../../web/public/world.glb] [--room 4 3 2.5]

No args needed for the default demo asset.
"""
import argparse
import os
import sys

import numpy as np

try:
    import trimesh
except ImportError:
    sys.exit("trimesh not installed - run: pip install -r requirements.txt")

# repo-root-relative default output (matches web-frontend's loader path)
_HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.normpath(os.path.join(_HERE, "..", "..", "..", "web", "public", "world.glb"))


def _box(size, translate, color):
    """Axis-aligned box mesh with a uniform vertex color (RGBA 0-255)."""
    m = trimesh.creation.box(extents=size)
    m.apply_translation(translate)
    rgba = np.tile(np.array(color, dtype=np.uint8), (len(m.vertices), 1))
    m.visual = trimesh.visual.ColorVisuals(m, vertex_colors=rgba)
    return m


def _sphere(radius, translate, color):
    m = trimesh.creation.icosphere(subdivisions=2, radius=radius)
    m.apply_translation(translate)
    rgba = np.tile(np.array(color, dtype=np.uint8), (len(m.vertices), 1))
    m.visual = trimesh.visual.ColorVisuals(m, vertex_colors=rgba)
    return m


def build_room(width=4.0, depth=3.0, height=2.5):
    """A believable little scanned room. width=X, depth=Z(forward), height=Y."""
    t = 0.05  # wall thickness
    parts = []

    # floor (subtle warm grey), centered under the robot origin, extending forward (-Z)
    parts.append(_box([width, t, depth], [0, -t / 2, -depth / 2], [140, 132, 120, 255]))
    # back wall (far, at -depth), cool grey
    parts.append(_box([width, height, t], [0, height / 2, -depth], [120, 128, 150, 255]))
    # left wall (robot's left = +X? no: +X is right) -> left wall at -X
    parts.append(_box([t, height, depth], [-width / 2, height / 2, -depth / 2], [150, 130, 130, 255]))
    # right wall at +X
    parts.append(_box([t, height, depth], [width / 2, height / 2, -depth / 2], [130, 150, 135, 255]))

    # a table in front of the robot (demo pick surface), wood-brown
    tw, td, th = 1.0, 0.6, 0.75
    tx, tz = 0.0, -1.6
    parts.append(_box([tw, 0.05, td], [tx, th, tz], [150, 110, 70, 255]))
    for dx in (-tw / 2 + 0.06, tw / 2 - 0.06):
        for dz in (-td / 2 + 0.06, td / 2 - 0.06):
            parts.append(_box([0.06, th, 0.06], [tx + dx, th / 2, tz + dz], [110, 80, 50, 255]))

    # fruit props on the table (match the demo story: apple + banana bins)
    parts.append(_sphere(0.06, [tx - 0.25, th + 0.08, tz], [200, 45, 40, 255]))   # ripe red apple
    parts.append(_sphere(0.06, [tx + 0.05, th + 0.08, tz + 0.1], [120, 190, 60, 255]))  # unripe green apple
    # banana-ish: a stretched yellow blob
    ban = _sphere(0.05, [tx + 0.28, th + 0.06, tz - 0.05], [225, 205, 55, 255])
    ban.apply_scale([2.0, 0.7, 0.7])
    ban.apply_translation([tx + 0.28 - (tx + 0.28), 0, 0])  # keep in place after scale-about-origin
    parts.append(ban)

    scene = trimesh.util.concatenate(parts)
    return scene


def main():
    ap = argparse.ArgumentParser(description="Generate a synthetic colored world.glb")
    ap.add_argument("--out", default=DEFAULT_OUT, help=f"output GLB path (default: {DEFAULT_OUT})")
    ap.add_argument("--room", nargs=3, type=float, metavar=("W", "D", "H"),
                    default=[4.0, 3.0, 2.5], help="room width depth height in meters")
    args = ap.parse_args()

    mesh = build_room(*args.room)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    mesh.export(args.out)
    size = os.path.getsize(args.out)
    print(f"wrote {args.out}  ({size/1024:.1f} KB, {len(mesh.vertices)} verts, "
          f"{len(mesh.faces)} faces)")
    if size > 15 * 1024 * 1024:
        print("WARNING: >15 MB - unexpected for the synthetic sample", file=sys.stderr)


if __name__ == "__main__":
    main()
