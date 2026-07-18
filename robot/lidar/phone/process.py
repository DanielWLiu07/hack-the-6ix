#!/usr/bin/env python3
"""process.py — iPhone lidar export -> optimized, aligned world.glb.

Ingests a handheld iPhone lidar scan exported from Polycam / Scaniverse / Record3D
(GLB, PLY, or OBJ, with vertex color or texture), aligns it into the robot frame
(see README.md "Coordinate conventions"), decimates + shrinks it to hit the
<15 MB web budget, and writes web/public/world.glb.

Pipeline:
    1. load (trimesh — keeps vertex colors + textures)
    2. axis fix (--z-up for Z-up PLY exports) + scale + yaw + translate  [alignment]
    3. export intermediate GLB
    4. gltf-transform optimize: weld, dedup, simplify, resize textures, prune
       (no draco/meshopt by default so a plain three.js GLTFLoader can read it;
        pass --compress for meshopt if you wire MeshoptDecoder on the web side)
    5. report final size; warn if still over budget

Requires: pip install -r requirements.txt   AND   npx @gltf-transform/cli
(the npx package auto-downloads on first run; falls back to trimesh-only export
if gltf-transform is unavailable — see --no-optimize).

Examples:
    python3 process.py scan.glb                       # align (identity) + optimize
    python3 process.py scan.ply --z-up --yaw-deg 90   # Z-up PLY, rotate to face forward
    python3 process.py scan.glb --translate 0.2 0 -1.1 --scale 1.0
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

import numpy as np

try:
    import trimesh
except ImportError:
    sys.exit("trimesh not installed — run: pip install -r requirements.txt")

_HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.normpath(os.path.join(_HERE, "..", "..", "..", "web", "public", "world.glb"))
BUDGET_BYTES = 15 * 1024 * 1024


def _rot_y(deg):
    return trimesh.transformations.rotation_matrix(np.radians(deg), [0, 1, 0])


def _rot_x(deg):
    return trimesh.transformations.rotation_matrix(np.radians(deg), [1, 0, 0])


def load_scan(path):
    scene = trimesh.load(path, process=False)
    if isinstance(scene, trimesh.Trimesh):
        scene = trimesh.Scene(scene)
    n_v = sum(len(g.vertices) for g in scene.geometry.values())
    if n_v == 0:
        sys.exit(f"{path}: no geometry found (is it a point cloud only? need a mesh export)")
    print(f"loaded {path}: {len(scene.geometry)} mesh(es), {n_v} verts")
    return scene


def align(scene, z_up=False, scale=1.0, yaw_deg=0.0, translate=(0.0, 0.0, 0.0),
          recenter_floor=False):
    """Bring the scan into the robot/three.js frame (+Y up, -Z forward, meters)."""
    T = np.eye(4)
    if z_up:  # Z-up (many PLY tools) -> Y-up
        T = _rot_x(-90.0) @ T
    if scale != 1.0:
        S = np.eye(4)
        S[0, 0] = S[1, 1] = S[2, 2] = scale
        T = S @ T
    if yaw_deg:
        T = _rot_y(yaw_deg) @ T
    scene.apply_transform(T)
    if recenter_floor:
        # drop the lowest point to y=0 and center X/Z on the bounds
        lo, hi = scene.bounds
        mid = (lo + hi) / 2.0
        scene.apply_translation([-mid[0], -lo[1], -mid[2]])
    if any(translate):
        scene.apply_translation(list(translate))
    lo, hi = scene.bounds
    print(f"aligned bounds (m): X[{lo[0]:.2f},{hi[0]:.2f}] "
          f"Y[{lo[1]:.2f},{hi[1]:.2f}] Z[{lo[2]:.2f},{hi[2]:.2f}]")
    return scene


def optimize_glb(in_glb, out_glb, simplify=0.5, texture_size=2048, compress=False):
    """Run @gltf-transform/cli to shrink under budget. Returns True on success."""
    npx = shutil.which("npx")
    if not npx:
        return False
    # curated, order matters: dedup+weld -> simplify -> texture resize -> prune
    cmds = [
        [npx, "--yes", "@gltf-transform/cli", "dedup", in_glb, out_glb],
        [npx, "--yes", "@gltf-transform/cli", "weld", out_glb, out_glb],
        [npx, "--yes", "@gltf-transform/cli", "simplify", out_glb, out_glb,
         "--ratio", str(simplify), "--error", "0.01"],
        [npx, "--yes", "@gltf-transform/cli", "resize", out_glb, out_glb,
         "--width", str(texture_size), "--height", str(texture_size)],
        [npx, "--yes", "@gltf-transform/cli", "prune", out_glb, out_glb],
    ]
    if compress:  # meshopt keeps a single-file GLB; needs MeshoptDecoder on web
        cmds.append([npx, "--yes", "@gltf-transform/cli", "meshopt", out_glb, out_glb])
    for c in cmds:
        r = subprocess.run(c, capture_output=True, text=True)
        if r.returncode != 0:
            # simplify/resize can no-op on some assets; keep going but surface it
            tail = (r.stderr or r.stdout).strip().splitlines()[-3:]
            print(f"  [gltf-transform {c[3]}] non-zero exit; continuing:\n    " +
                  "\n    ".join(tail), file=sys.stderr)
    return os.path.exists(out_glb)


def main():
    ap = argparse.ArgumentParser(description="iPhone lidar export -> optimized world.glb")
    ap.add_argument("input", help="scan file: .glb / .gltf / .ply / .obj")
    ap.add_argument("--out", default=DEFAULT_OUT, help=f"output (default: {DEFAULT_OUT})")
    ap.add_argument("--z-up", action="store_true", help="input is Z-up (rotate to Y-up)")
    ap.add_argument("--scale", type=float, default=1.0, help="uniform scale (export not in meters)")
    ap.add_argument("--yaw-deg", type=float, default=0.0, help="rotate about up-axis to face robot fwd")
    ap.add_argument("--translate", nargs=3, type=float, default=[0, 0, 0], metavar=("X", "Y", "Z"))
    ap.add_argument("--recenter-floor", action="store_true",
                    help="drop lowest point to y=0 and center X/Z (good first pass)")
    ap.add_argument("--simplify", type=float, default=0.5, help="target face ratio 0-1 (0.5=half)")
    ap.add_argument("--texture-size", type=int, default=2048, help="max texture edge px")
    ap.add_argument("--compress", action="store_true", help="meshopt compress (needs web decoder)")
    ap.add_argument("--no-optimize", action="store_true", help="skip gltf-transform (trimesh export only)")
    args = ap.parse_args()

    if not os.path.exists(args.input):
        sys.exit(f"input not found: {args.input}")

    scene = load_scan(args.input)
    scene = align(scene, z_up=args.z_up, scale=args.scale, yaw_deg=args.yaw_deg,
                  translate=tuple(args.translate), recenter_floor=args.recenter_floor)

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)

    with tempfile.TemporaryDirectory() as td:
        raw = os.path.join(td, "raw.glb")
        scene.export(raw)
        raw_mb = os.path.getsize(raw) / 1e6
        print(f"trimesh export: {raw_mb:.1f} MB")

        if args.no_optimize:
            shutil.copyfile(raw, args.out)
        else:
            ok = optimize_glb(raw, args.out, simplify=args.simplify,
                              texture_size=args.texture_size, compress=args.compress)
            if not ok:
                print("gltf-transform unavailable — writing un-optimized trimesh export "
                      "(install Node/npx or pass --no-optimize to silence)", file=sys.stderr)
                shutil.copyfile(raw, args.out)

    final = os.path.getsize(args.out)
    print(f"wrote {args.out}  ({final/1e6:.2f} MB)")
    if final > BUDGET_BYTES:
        print(f"OVER 15 MB budget by {(final-BUDGET_BYTES)/1e6:.1f} MB — lower --simplify "
              f"(e.g. 0.25) or --texture-size (e.g. 1024), or add --compress.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
