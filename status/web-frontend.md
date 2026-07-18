# web-frontend status

## [restart] DONE — recovered after crash; all 5 assigned tasks on disk + verified
Status file was lost in the crash; reconstructed state from disk. All of `web/src/` is intact and coherent. `npm run build` passes cleanly (614 modules, three.js code-split into a lazy LidarView chunk). Vite dev server (pane web.1, not mine) is up on :5173.

What's built & how to verify (open `http://localhost:5173/?sim=1` for a zero-backend demo of every page):
- **Task 1 Dashboard** (`pages/Dashboard.jsx`): state badge, battery (3S LiPo scaling), pick count, drive bars, arm-mounted camera `<img src={SERVER_URL}/stream>` with NO-STREAM fallback, arm joints, live detection + pick logs. Consumes `telemetry`/`detection`/`pick_event` via `lib/robot.jsx` context.
- **Task 2 Teleop** (`pages/Teleop.jsx`): browser Gamepad API, 10 Hz `drive` loop (tank drive L/R sticks), edge-triggered ✕/□/△ pick + ○ estop, on-screen hold-to-drive pad + pick/estop fallback buttons. Auth0 gate (`AuthGate`) active when `VITE_AUTH0_DOMAIN`/`VITE_AUTH0_CLIENT_ID` set, dev-bypass otherwise.
- **Task 3 Lidar** (`pages/LidarView.jsx`): react-three-fiber points cloud from `lidar_scan`, robot-frame (x→x, y→-z per lidar-sim's DECAY.md), 4 s fade / 16-scan ring, orbit controls, lazy-loaded.
- **Task 4 Analytics** (`pages/Analytics.jsx`): polls `GET /api/stats` (5 s), normalizes server-core/db's snake_case shape (`totals.success_rate`, `waste_avoided_kg`, `co2e_avoided_kg`, `by_bin`), falls back to session-local pick-event stats when unreachable/sim. Bins + ripeness-split bars, waste/CO₂e tiles (env-track ammo).
- **Task 5 Landing** (`App.jsx`): "Battery, not Blood." hero w/ live stat tiles + nav. Auth0 wired in `main.jsx` (`MaybeAuth0` — no-op until creds).

Browser sim (`lib/sim.js`) mirrors server-core's schemas so the whole UI runs with `?sim=1`. Real data flows through `lib/robot.jsx` Socket.IO client to `VITE_SERVER_URL` (default :3001).

## [restart+] DONE — phase-2 world.glb overlay built (colored 3D world + live C1 scan)
lidar-pi published `web/public/world.glb` + conventions (their `robot/lidar/phone/README.md`). Rebuilt `pages/LidarView.jsx` to load it and overlay the live C1 `lidar_scan` in the **same glTF frame**:
- `useGLTF('/world.glb')` (drei) renders the iPhone-lidar room; `useGLTF.preload` warms it.
- Scan mapped per lidar-pi's contract: robot `(x_fwd, y_left)` → three `(X,Y,Z) = (−y, SENSOR_H=0.15, −x)`, so green scan ring sits inside the room walls. (This replaces the old radar-frame mapping — both now share world.glb's frame.)
- Robot marker re-oriented to nose → −Z (world forward); camera/OrbitControls retargeted to frame the room; added ambient+directional light for the vertex-colored mesh.
- Robustness: model load wrapped in `<Suspense>` + a `ModelBoundary` error boundary — if `world.glb` is ever missing (e.g. pre-deploy), the scan view still renders and the toggle flips to "3D world unavailable".
- Added a "3D world (iPhone scan)" checkbox (`.lidar-toggle` in ui.css) to hide/show the mesh → falls back to the clean radar view for demo.

Verify: `npm run build` passes (GLTFLoader lands in the lazy LidarView chunk, three.js already there). `world.glb` serves 200 `model/gltf-binary` (22720 B) via vite AND is copied into `dist/`. GLB header validated (`glTF` magic, v2, length matches). Open `http://localhost:5173/lidar?sim=1` → room + fading green C1 ring; toggle works. At venue, lidar-pi swaps the real scan into the same path — zero web change needed.

## [landing-rev] DONE — stripped landing to the pure :8123 scene + corner chip
Per human revision: removed the hero copy / stats / CTA overlay panel from the landing entirely. `App.jsx` now:
- **DEV** → `:8123` scene fullscreen via `<iframe>` (`.hero-embed`, inset:0), behaving exactly as standalone — its own HUD + keyboard untouched (I add zero handlers). Only addition: one tiny low-opacity (0.5, →1 on hover) rounded chip bottom-right → `/dashboard` (`.scene-chip`).
- **PROD** guard unchanged → `ClassicHero` (kept intact) since :8123 is local-only.
- `USE_R3F_HERO` (still false) now also renders the pure-scene treatment (OrchardHero fullscreen + chip, no panel) — consistent with the "pure scene" direction; flip to promote after visual sign-off.
Removed the now-dead `HeroPanel`/`PainterlyLanding` + `.hero-overlay`/`.hero-panel` CSS. `useHeroStats` kept (ClassicHero uses it). `npm run build` clean, oxlint clean for App.jsx/App.css. Verify: `http://localhost:5173/` → fullscreen :8123 orchard, only a faint Dashboard chip in the corner.

## [re-check] DONE — world.glb overlay verified against now-live deps
Confirmed the LidarView overlay (built earlier) is intact and matches lidar-pi's now-present deliverables: `web/public/world.glb` (22720B) loads via `useGLTF('/world.glb')` with `ModelBoundary` fallback; live C1 `lidar_scan` mapped into the glTF frame `(X,Y,Z)=(−y, SENSOR_H=0.15, −x)` per `robot/lidar/phone/README.md`; toggle + robot marker present. Hub :3001 live (200) so real scans now flow. `npm run build` clean; `/world.glb` serves 200 `model/gltf-binary` in dev AND copied to `dist/`. No code change needed — nothing was missing. Verify live: `http://localhost:5173/lidar` (or `?sim=1`) → green scan ring inside the iPhone-lidar room.

## [P1] DONE — painterly r3f landing hero built + interim :8123 iframe embed wired
Two deliverables from the P1 task + the mid-task interim change, both build-clean (`npm run build` ✓, oxlint ✓ no new warnings).

**1. Fresh painterly r3f hero (end-goal)** — `src/components/OrchardHero.jsx` (all scene code written fresh):
- Loads `tree.glb` + instances 8 canopy apples + 2 ground apples from `apple.glb` (drei `useGLTF`, cloned w/ shared geometry). Models runtime-normalized via `Box3` (tree → 5u tall base at y=0; apples → 0.3u), so it's robust to authored scale.
- Scene per spec: paper bg `#dcd6c4`, `THREE.Fog #ccd5c8` near 8 far 24, camera `(5.2,2.4,6.9)`→origin fov 42, hemisphere + gentle directional + ambient, no shadows, matte flattened materials.
- Idle motion: slow camera drift (sin, ~0.3u) + apples bobbing ~1.5–2.3cm with per-instance phase + tiny sway.
- Painterly post: adapted vendored `src/vendor/painterly.js` (attribution header untouched) into r3f via a `PainterlyPass` that takes over the render loop (`useFrame` priority 1) and composites the anisotropic-Kuwahara chain to screen. Set `rtScene.colorSpace = SRGBColorSpace` + Canvas `flat` for correct brightness.
- Perf: `dpr={[1,1.5]}` cap, pipeline `renderScale 0.7`, GLBs lazy (Suspense) with a `useProgress` "painting orchard…%" badge, WebGL2/small-screen static-gradient fallback (`.hero-fallback`). Component is `lazy()`-imported so three stays out of the main bundle.
- **GLBs compressed with gltf-transform** (quantize + 1024 tex): apple 7.94MB→1.09MB, tree 3.36MB→641KB. Only `KHR_mesh_quantization` (native three support) — stock loader, no decoder needed. Originals backed up to session scratchpad.

**2. Interim landing (mid-task human change)** — `src/App.jsx` restructured into 3 modes:
- **DEV** → renders the standalone :8123 painterly scene fullscreen via `<iframe>` with hero copy/stats/CTA overlaid on a translucent paper panel. Overlay is `pointer-events:none` (scene stays interactive), panel is `pointer-events:auto`. (:8123 = `web/legacy-ui/`, treated as external embed, not refactored.)
- **PROD** → keeps the classic React hero (`:8123` doesn't exist on Vercel), guarded by `import.meta.env.DEV`.
- **`USE_R3F_HERO` flag** (currently false) → flip to promote the OrchardHero for both dev+prod, replacing both interim modes. Left false pending **visual sign-off** (painterly output can't be eyeballed from a headless build).
- Shared `HeroPanel` (copy/stats/CTA, live stats via `useRobot`) reused by iframe + r3f modes; palette harmonized to paper + green/red accents (`src/App.css`).

Verify: `npm run build` clean (OrchardHero 4.7KB gz chunk; three shared in Gltf chunk; main 103KB gz). Dev: open `http://localhost:5173/` → :8123 orchard behind the paper panel, CTAs clickable, scene draggable around it. Assets serve 200 (`/assets/tree.glb` 641KB, `/assets/apple.glb` 1.09MB). To preview the r3f hero: set `USE_R3F_HERO = true` in App.jsx.
@deploy: prod build renders ClassicHero (no :8123 dependency) — safe to ship now; promote r3f hero after someone eyeballs it at `USE_R3F_HERO=true`.

## [restart] (superseded) BLOCKED — phase-2 world.glb overlay waiting on lidar-pi
BROADCAST phase-2 asks me to render lidar-pi's `web/public/world.glb` (iPhone-lidar colored 3D reconstruction) as the environment with the live C1 scan overlaid in LidarView. lidar-pi's `robot/lidar/phone/` is still empty (no sample GLB, no conventions doc) and no `world.glb` exists yet — their ASSIGNMENTS task 4 isn't delivered. Holding; will build the overlay the moment the sample GLB + conventions land. LidarView already renders the live scan, so this is purely additive.

Note for master: server-core's hub (:3001) and lidar-sim's sim died in the crash — both are other workers' processes (not mine). Live-data pages (non-sim) need those restarted; the frontend itself is fully functional via `?sim=1` meanwhile.
