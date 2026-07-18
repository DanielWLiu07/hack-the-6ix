# robot/lidar/phone/ — iPhone lidar → colored 3D world

The **second** lidar system (don't conflate with the robot's RPLIDAR C1 2D scan).
A handheld iPhone lidar scan of the demo scene → one optimized, vertex-colored
`web/public/world.glb` that the web dashboard renders as the 3D environment, with
the **live C1 `lidar_scan` point cloud overlaid** in the same coordinate frame.

```
Polycam / Scaniverse / Record3D  ──►  process.py  ──►  web/public/world.glb
   (GLB / PLY / OBJ export)            (align + shrink)     (three.js loads it)
```

## Phone capture app (`app.py`) — connect your phone at the venue

A mobile-first web server you open **on the iPhone** to close the capture loop
without touching the laptop:

```bash
cd robot/lidar/phone && python3 app.py        # serves 0.0.0.0:8092, prints the phone URL
# phone (same wifi/hotspot) → http://<laptop-ip>:8092  (or scan the QR it's paired with)
```

Flow: scan the scene in Polycam/Scaniverse (LiDAR mode) → export GLB → upload on
the page → the server runs `process.py` → writes `web/public/world.glb` → the
dashboard's 3D view swaps to your real scan. Stdlib-only (no Flask). Verified
end-to-end (upload → optimize → world.glb reload). Env: `PORT` (8092), `WORLD_OUT`.

## Quick start

```bash
pip install -r requirements.txt            # trimesh + numpy (npx used for optimize)

# No real scan yet? Generate the synthetic sample so the web view has SOMETHING:
python3 make_sample.py                      # writes ../../../web/public/world.glb (~22 KB)

# Real scan (once someone captures one at the venue):
python3 process.py scan.glb                 # aligns (identity) + optimizes to <15 MB
python3 process.py scan.ply --z-up --recenter-floor --yaw-deg 90
```

`web/public/world.glb` already exists (the synthetic sample) — **web-frontend can
build against it now**. Re-run `process.py` at the venue to swap in the real scan;
same output path, no web code change needed.

## Coordinate conventions  ⭐ web-frontend read this

`world.glb` is authored in the **glTF / three.js frame** (right-handed, meters):

| axis        | direction        | robot-frame equivalent |
|-------------|------------------|------------------------|
| **+Y**      | up               | robot +Z (up)          |
| **+X**      | right            | robot **−Y**           |
| **−Z**      | into the scene   | robot **+X** (forward) |

Origin = robot base at scan start; **floor sits at y = 0**. Units are **meters**
(ARKit/Polycam export metric — keep `--scale 1.0` unless the tool lied).

### Overlaying the live C1 scan

`lidar_scan` points arrive as `[[x, y], …]` in the **robot frame** (x forward,
y left, meters, on the ground plane). To plot them in the same three.js scene as
`world.glb`, map each point:

```js
// robot (x_fwd, y_left) → three.js (X, Y, Z)
const X = -y;          // robot left(+y) → three.js left(−X); robot right → +X
const Y = SENSOR_H;    // C1 mount height in meters (≈0.15); scan is one horizontal slice
const Z = -x;          // robot forward(+x) → into scene (−Z)
```

That's it — no rotation matrix needed, it's just an axis swap + negation. The C1
ring will sit inside the `world.glb` room at the correct place and heading.
(If the physical C1 is mounted rotated, lidar-pi bakes that into `ANGLE_OFFSET_DEG`
on the Pi side, so the points you receive are already in the robot frame above.)

### Loading (plain three.js, no decoder needed)

```js
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
new GLTFLoader().load('/world.glb', (gltf) => scene.add(gltf.scene));
```

Default `process.py` output uses **no draco/meshopt compression**, so a stock
`GLTFLoader` reads it directly. Only if you run `process.py --compress` do you
need `MeshoptDecoder` wired up — coordinate first.

## process.py options

| flag                | purpose |
|---------------------|---------|
| `--z-up`            | input is Z-up (many PLY exporters) → rotate to Y-up |
| `--scale S`         | uniform scale if the export isn't in meters |
| `--yaw-deg D`       | rotate about up-axis so the room faces robot-forward |
| `--translate X Y Z` | nudge origin onto the robot base |
| `--recenter-floor`  | drop lowest point to y=0 + center X/Z (good first pass) |
| `--simplify R`      | target face ratio (default 0.5); lower = smaller file |
| `--texture-size N`  | max texture edge px (default 2048) |
| `--compress`        | meshopt compress (needs web-side decoder) |
| `--no-optimize`     | trimesh export only (skip gltf-transform) |

**Alignment is a per-scan nudge**, done once at the venue: run with
`--recenter-floor` first, eyeball it in the dashboard, then add `--yaw-deg` /
`--translate` until the C1 ring lines up with the walls. Budget target: **<15 MB**
(process.py exits non-zero and tells you which knob to turn if you blow it).

## viewer.html — standalone 3D viewer (executable conventions + demo backup)

A self-contained three.js page that loads `world.glb` **and** overlays the live
C1 `lidar_scan` ring (decaying cyan→blue) in the same frame — the conventions
above, made runnable. It's the reference web-frontend copies into the dashboard
lidar view, and it doubles as offline demo-backup footage.

```bash
cd robot/lidar/phone && python3 -m http.server 8091
open "http://localhost:8091/viewer.html"            # live hub + Vite-served world.glb
open "http://localhost:8091/viewer.html?demo=1"     # synthetic ring, no backend needed
```

Query params: `?server=` (hub URL, default `:3001`), `?world=` (GLB URL, default
`http://localhost:5173/world.glb`), `?height=` (C1 mount height, default 0.15 m),
`?demo=1` (force synthetic ring). Auto-falls back to the synthetic ring if no live
scan arrives in 3 s, so the view never looks dead. Verified rendering in headless
Chrome against both the live hub (real sim scans, ~171 pts) and demo mode.

## Files

- `app.py` — **phone capture app**: mobile upload page → process.py → world.glb
- `make_sample.py` — synthetic colored room → `world.glb` (zero real-scan dependency)
- `process.py` — real ingest → align → optimize → `world.glb`
- `viewer.html` — standalone 3D viewer: world.glb + live C1 ring + **SLAM occupancy overlay** (reference + demo)
- `requirements.txt` — trimesh + numpy (optimize shells out to `npx @gltf-transform/cli`)
- `samples/` — scratch dir for scan files (git-ignored except this note)

## Stretch (task 5, not started)

Record3D / WebXR **live** RGBD streaming from the phone instead of a static
export — only if everything else is done. Static export is the demo.
