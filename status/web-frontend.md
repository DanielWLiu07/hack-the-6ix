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

## [monkey-page] WIP — /stage scaffold live: humanoid rigged B&W manga monkey + TV + live landing + zoom-out
Assets (all via Meshy, agents): `public/assets/monkey.glb` = HUMANOID rigged cartoon monkey, 1.1MB, 24-bone Mixamo skeleton, 3 clips (Idle/Walk/Run). `public/assets/tv.glb` = flatscreen TV 469KB (screen faces +Z, ~1.75×1.22 screen area). Manga shader now FULLY B&W (`lib/mangaPass.js`).
`src/pages/MonkeyStage.jsx` (route `/stage`, lazy in main.jsx): opens screen-filling the TV (iframe `/scene/index.html` via drei `Html transform`), camera zooms out 2.6s (easeInOutCubic) to a room pose revealing the TV + monkey; monkey plays Idle + rises from below; funky Katie Roze navbar fades in; whole room B&W-manga-shaded (screen stays crisp color — DOM iframe, post can't touch it, as intended). Build+lint clean, verified via headless screenshots.
KEY FIX: never `scene.clone()` a skinned mesh (skeleton bind breaks → parts explode); render the gltf directly with transforms on wrapper groups.
STILL TO TUNE (needs live eyes): camera framing (monkey too large/right-cut), TV frame blends into dark bg (matte-black → manga-black on dark room — needs a floor/lighter room so it reads), navbar text visibility (only brand emoji showing), monkey scale/placement. Iterating with human.

## [stage transition + look] DONE (pending human eyeball)
- HEIST TRANSITION (priority): landing (App.jsx) listens for the scene's `postMessage({type:'ht6-scene',phase})`. On 'ascent' warms the HTTP cache for tv.glb+monkey.glb (fetch, no three in main bundle). On 'complete' shows a paper crossfade (`.page-crossfade`, never black) and navigates to /stage with router state `{fromLanding:true}`.
- STAGE ENTRANCE: when arriving fromLanding, EntranceRig starts the camera tight on the TV screen (it plays the same scene = seamless) and eases to the room framing over 1.8s, then hands to OrbitControls. Direct /stage visits skip the entrance. Old CameraRig frame-zoom retired; IntroSequence.jsx is unused/orphan (no conflict) - left in place.
- LOOK: /stage is now big blocky Suzanne monkey CENTERED, dark room with a focused spotLight ON the monkey (dark kept, monkey lit), grainier B&W manga. Full OrbitControls so zoom/position is hand-tunable.
- NAVBAR: uses Katie Roze (landing font), painted after the Canvas at max z-index. Renders in the DOM (font verified valid: real contours + metrics) BUT does not composite in headless-swiftshader screenshots (DOM text over WebGL artifact; the box paints, text layer is dropped). Needs a real-browser eyeball - should render fine there.
STILL TUNING with human: exact framing, TV placement, nav confirmation.
NEXT: SLAM consumer per lidar-sim's coordination notes.

## [style+data+pov+monkey batch] DONE
- STYLE SWEEP (mandatory) DONE: removed all emojis + em/en dashes + box-drawing dashes from my web/src files. Emoji removals: brand apples in Layout+MonkeyStage nav, fruit emojis in Dashboard rows (now plain text), Teleop PS-button glyphs. Build + lint clean.
- DATA RULE (mandatory): my pages already compliant - Dashboard + landing stats read live via useRobot (hub); no in-component dummy arrays. (Analytics/POV are web-extra owned.)
- /pov REWIRE (priority) DONE: `/pov` now embeds the ORIGINAL scene POV at `/scene/pov.html` fullscreen (new `src/pages/PovScene.jsx`, iframe + Dashboard chip). React POV kept at `/pov-live`. pov.html 200, build clean. @web-extra (RobotPOV owner): your React POV is at /pov-live now, not dropped.
- BLOCKY MONKEY DONE (agent): monkey.glb is now a blocky voxel/Suzanne humanoid, 2377 tris, rigged (24 Mixamo bones, Walk/Run/Idle), 188KB. Renders assembled + grainy B&W manga on /stage. Manga pushed grittier/grainier (grit 0.75) per "too cartoony" note. Reframed smaller + camera back. flatShading OFF (re-broke skinning; geo already faceted).
- NEXT: SLAM consumer (slam_map occupancy grid + slam_pose marker under the live scan in LidarView) - schema read, will coordinate with lidar-sim.

## [CLAIMS] web-frontend file ownership (per [web scale-up]) — extras: do NOT edit these
I (web-frontend) am ACTIVELY working these — CLAIMED, hands off unless you ping me:
- `src/App.jsx`, `src/App.css` — landing + landing ladder + the new monkey/TV "home" experience
- `src/components/OrchardHero.jsx` — r3f painterly hero (WebGL2 fallback)
- `src/components/MonkeyMascot.jsx`, `src/lib/mangaPass.js` — B&W manga monkey renderer + shader
- `src/components/IntroSequence.jsx` and any new `MonkeyPage`/`MonkeyStage`/`SceneNav` files (monkey-page build)
- `public/assets/*.glb` (tree/apple/monkey/tv), `public/scene/`, `public/fonts/`, `index.html`, `src/vendor/painterly.js`
- `src/main.jsx` routing table — SHARED: coordinate via status before adding/changing routes
- `src/ui.css` — SHARED control-room styles: coordinate before editing (I only touch mascot/landing-adjacent rules)

AVAILABLE for extras to claim (I authored them but am not actively editing): `src/pages/Dashboard.jsx`, `src/pages/Teleop.jsx`, `src/pages/LidarView.jsx`, `src/pages/Analytics.jsx`, `src/components/Layout.jsx`. Claim in YOUR status file before editing; tell me and I'll note it here.

## [landing-probe + monkey] DONE — 1:1 scene landing (probe ladder) + manga monkey mascot
Landing (final human decision): self-hosted 1:1 scene restored at `public/scene/` (gitignored). `App.jsx` probe ladder: no WebGL2 → ClassicHero; `/scene/index.html` present AND is the real scene (body has `id="gl"`, not the SPA shell's `id="root"`) → fullscreen iframe + SceneChip; absent → OrchardHero fallback. Verified: probe detects the real scene, landing renders the painterly meadow/sky/POMME. Build+lint clean. Master deploys.
Monkey mascot: generated a cartoony monkey via Meshy (scripts/meshy-gen.mjs, key in .env.local) → 13.5MB → optimized to 4.99MB (quantize + 512 webp) → `public/assets/monkey.glb`. New `src/lib/mangaPass.js` = self-contained manga post (procedural halftone/crosshatch/paper + sobel ink outlines + tone bands, alpha cutout — the orchard-scene MangaPass + its textures were deleted, so this is original). `src/components/MonkeyMascot.jsx` renders it on a transparent canvas; wired into Dashboard (fixed bottom-right, click-through, `.monkey-mascot`). **Verified rendering** via headless Chrome — manga ink/halftone monkey composites cleanly over the dashboard. Build+lint clean.
Rigging: delegated to a background agent (Meshy auto-rigging via input_task_id → rigged GLB → optimize preserving skin/joints → monkey.glb). Still running; will swap in the rigged model + I'll re-verify when it lands.

## [landing-final] DONE — landing = OrchardHero ONLY (per priority revert); render verified
Churn resolved to a clean end state. Sequence: tried r3f-parity → master self-hosted the real scene at /scene/ → human PRIORITY REVERT to OrchardHero-only. Final `App.jsx`: `WEBGL2 ? (OrchardHero + SceneChip) : ClassicHero`. Deleted all interim machinery — SceneEmbed, the probe Landing, `?nolocalscene`, every `/scene/` reference (public/scene being deleted). Reconciled the import breakage master introduced (had removed useState/useEffect while my probe used them → `useState is not defined` crash; gone now).
Parity work wasn't wasted: OrchardHero gained (from natureScene.js constants) a painted **sky dome** (paper→blue wash `0.62,0.745,0.80` + hill ridges, ported fully-grown w/ slow drift) + a **meadow ground** (`meadow()` noise field, grass-green tint, manual fog) + **camera FOV 25** (the long-lens 2D-storybook look; was 42). **Render verified** via headless Chrome (swiftshader): sky + green meadow + tree + canopy/ground apples + painterly Kuwahara all render, no GLSL/runtime errors, chip overlaid. `npm run build` + oxlint clean. Master deploys.
Note: `public/scene/` (self-hosted 1:1 scene) is gone per revert; if it ever returns it's gitignored so won't reach Vercel anyway — OrchardHero is the durable self-contained landing.

## [landing-promote] DONE — r3f painterly orchard is the landing; verified rendering; interim machinery deleted
Master flipped `USE_R3F_HERO=true` + deployed prod. **Verified it actually renders** (not just builds): drove headless Chrome (swiftshader WebGL2) against the dev landing → screenshot shows the orchard tree, canopy + ground apples, paper bg + fog, and the anisotropic-Kuwahara painterly treatment all rendering correctly; GLBs (quantized) load fine. Prod is safe.
Cleanup (per directive): `App.jsx` stripped to `landing = OrchardHero` — deleted the flag, `DevLanding`, `OrchardSceneEmbed`, the :8123 probe, and `ORCHARD_SCENE_URL`. Kept `ClassicHero` **only** as the WebGL2-failure fallback (`WEBGL2` capability check). Re-screenshotted after the rewrite → no regression.
Self-containment [master task] resolved by this: the landing no longer depends on :8123 AT ALL (it's the self-contained r3f scene), so a fresh clone can never hit a dead iframe — WebGL2 present → orchard, absent → ClassicHero. All `legacy-ui`→`orchard-scene` naming updated along the way (only :8123/LEGACY_* identifiers existed in src; renamed). `npm run build` + oxlint clean.
Also staged this session (not wired into the live landing): `components/IntroSequence.jsx` (apple→monkey mascot intro, awaiting a real monkey model), `scripts/meshy-gen.mjs` + gitignored `web/.env.local` for Meshy 3D-model generation (human pasting key), subset brand font `public/fonts/katieroze.woff2` (2.4KB). Manga shader (`orchard-scene/styles.js` `MangaPass`) located for a future port; its 3 textures (halftone/crosshatch/paper) not yet found in-repo.

## [qa+navbar] DONE — responsive QA fixes + funky Katie Roze navbar
QA (sim data, desktop + phone): fixed 2 real overflow bugs — (1) Analytics `BarRow` value label on the max bar (pct=100%) overflowed the track → now anchors inside the bar when pct>80 (`.vz-val.inside`, dark ink); (2) Dashboard/`.loglist` rows overflowed panel at phone width → `flex-wrap: wrap`. Rest of pages reviewed OK (grids collapse to 1-col <900px, cards auto-fit, padgrid fixed 208px fits phone).
Funky navbar (human request): subset the project's 25MB `legacy-ui/fonts/KatieRoze.otf` — its bulk is `SVG ` (14MB) + `sbix` (10MB) color-glyph tables; dropped those + subset to ASCII → **`public/fonts/katieroze.woff2` = 2.4KB**, self-hosted (offline-safe, no CDN). `@font-face` in index.css, `--ui-display` var in ui.css; restyled `.topbar` brand (1.95rem) + nav page-names (1.4rem) in Katie Roze with green active pills. Live on all control-room pages (Layout topbar). `npm run build` clean; font in dist + served `font/woff2`.
Open questions to human: page taxonomy (their "robot view / robot data" idea) + landing→app intro transition (apple flies up → monkey mascot) — not built, awaiting direction.

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
