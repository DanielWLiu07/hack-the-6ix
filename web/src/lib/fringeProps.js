// Catalog + baked layout for the POV machine-fringe (RobotFringe). The fringe
// is the manga-cutout machinery that hangs into the top of every /pov tab; its
// GLB props load from /scene/models/. Two lists:
//
//   FRINGE_MODELS - every GLB the editor can drop in (the "add prop" palette).
//   FRINGE_PROPS  - the placement the fringe renders by default.
//
// Edit the layout live at /pov?tab=cam&edit=1 (drag / sliders / arrows), then
// "copy props" and paste the emitted FRINGE_PROPS array back over the one below
// to make the new arrangement the default. Add a Meshy-generated GLB to
// /scene/models/ plus a row in FRINGE_MODELS to grow the palette (see
// scripts/meshy-fringe-batch.mjs).

// Longest-edge target (world units) a freshly added prop is fit to, and the
// depth plane the fringe props sit on. Keep new props near this z so they read
// at the same scale as the rest of the machinery.
export const FRINGE_DEFAULT_SCALE = 1.15
export const FRINGE_DEFAULT_Z = -1.3

// Palette: what the editor can add. `file` is under /scene/models/. A model
// whose GLB is missing simply never appears (the loader swallows the error), so
// the palette degrades cleanly while a Meshy batch is still running.
export const FRINGE_MODELS = [
  { id: 'vent2', label: 'vent', file: 'vent2.glb' },
  { id: 'manifold', label: 'manifold', file: 'manifold.glb' },
  { id: 'console', label: 'console', file: 'console.glb' },
  { id: 'beacon', label: 'beacon', file: 'beacon.glb' },
  { id: 'camhead2', label: 'cam head', file: 'camhead2.glb' },
  { id: 'infosign', label: 'info sign', file: 'infosign.glb' },
]

// Baked layout. x/y are fringe-local (the fringe group is lifted so y ~ 5-7 is
// the top edge), s is the longest-edge fit, rz is roll. Optional: z depth
// (defaults to FRINGE_DEFAULT_Z), rx/ry pitch/yaw (default 0). Emitted verbatim
// by the editor's "copy props".
export const FRINGE_PROPS = [
  { file: 'vent2.glb', x: -1.573, y: 6.024, s: 1.25, rz: 0.05 },
  { file: 'manifold.glb', x: -7.9, y: 5.85, s: 2.1, rz: 0 },
  { file: 'console.glb', x: 3.84, y: 6.29, s: 1.35, rz: -0.07 },
  { file: 'beacon.glb', x: 7.6, y: 5.65, s: 0.85, rz: 0.1 },
  { file: 'vent2.glb', x: -8.55, y: 4.62, s: 1.05, rz: -0.18 },
  { file: 'vent2.glb', x: 8.52, y: 4.56, s: 1.05, rz: 0.18 },
  { file: 'console.glb', x: -5.2, y: 6.54, s: 0.92, rz: 0.12 },
  { file: 'beacon.glb', x: -0.1, y: 6.84, s: 0.72, rz: 0 },
  { file: 'manifold.glb', x: 5.92, y: 6.1, s: 1.15, rz: -0.08 },
  { file: 'camhead2.glb', x: -4.35, y: 6.98, s: 1.15, rz: 0.09 },
  { file: 'infosign.glb', x: 4.75, y: 6.92, s: 1.35, rz: -0.06 },
  { file: 'camhead2.glb', x: 8.15, y: 6.35, s: 0.9, rz: 0.16 },
  { file: 'manifold.glb', x: -5.904, y: 0.412, s: 2.426, ry: 0.678, rz: -0.577 },
  { file: 'vent2.glb', x: -4.387, y: 0.051, s: 1.368, ry: 0.298, rz: 0, z: -1.16 },
  { file: 'beacon.glb', x: 6.257, y: 0.258, s: 1.38, rz: 0.573, z: -1.68 },
  { file: 'infosign.glb', x: 4.687, y: 0.285, s: 1.575, ry: 0.198, rz: 0 },
  { file: 'camhead2.glb', x: 3.437, y: 0.369, s: 1.15, ry: -0.627, rz: 0.533 },
]
