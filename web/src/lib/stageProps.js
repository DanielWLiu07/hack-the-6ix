// Catalog of props that can be dropped into the /stage manga room and the
// default arrangement placed behind the monkey. Each catalog entry fits its
// GLB to `height` world-units (monkey is ~2.4 tall) and rests it on the floor;
// the stage's shared drag/slider/keyboard rig then manipulates it like the
// monkey and the painting. Adding a row here adds it to the "add prop" palette.

// Floor plane: the monkey sits at MONKEY_POS.y (-1.731) with its feet on 0,
// so props share this Y to stand on the same ground.
export const FLOOR = -1.731

// url points at public/assets. The tech-lab set is produced by
// scripts/meshy-lab-batch.mjs; a prop whose GLB is missing simply does not
// appear (StageProp swallows the load error), so the palette degrades cleanly.
export const PROP_CATALOG = [
  // Tech-lab set (Meshy) - the "stuff behind the monkey".
  { id: 'server-rack', label: 'server rack', url: '/assets/server-rack.glb', height: 2.3, lab: true },
  { id: 'storage-shelf', label: 'storage shelf', url: '/assets/storage-shelf.glb', height: 2.2, lab: true },
  { id: 'lab-bench', label: 'lab bench', url: '/assets/lab-bench.glb', height: 1.25, lab: true },
  { id: 'control-console', label: 'console', url: '/assets/control-console.glb', height: 1.35, lab: true },
  { id: 'robot-arm-lab', label: 'robot arm', url: '/assets/robot-arm-lab.glb', height: 1.8, lab: true, anim: 'scan' },
  { id: 'oscilloscope', label: 'oscilloscope', url: '/assets/oscilloscope.glb', height: 1.0, lab: true },
  // Existing assets - handy fillers, available immediately.
  { id: 'crate', label: 'crate', url: '/assets/crate.min.glb', height: 1.0 },
  { id: 'tv', label: 'tv', url: '/assets/tv.glb', height: 0.9 },
  { id: 'tree', label: 'tree', url: '/assets/tree.glb', height: 3.2 },
  { id: 'controller', label: 'controller', url: '/assets/controller.glb', height: 0.6 },
  { id: 'apple', label: 'apple', url: '/assets/apple.glb', height: 0.42 },
  { id: 'banana', label: 'banana', url: '/assets/banana2.glb', height: 0.5 },
  { id: 'banana-bunch', label: 'banana bunch', url: '/assets/banana-bunch.glb', height: 0.7 },
]

export const CATALOG_BY_ID = Object.fromEntries(PROP_CATALOG.map((p) => [p.id, p]))

// Opening arrangement: a lab spread behind and around the monkey to fill the
// dark room. Positions are the outer draggable group's world position; the
// operator is free to drag / slider / delete any of them from here.
export const DEFAULT_PLACEMENT = [
  { id: 'p-rack', catalogId: 'server-rack', position: [-2.869, -1.842, -1.47], rotation: [0, 0.5, 0] },
  { id: 'p-shelf', catalogId: 'storage-shelf', position: [2.85, FLOOR, -1.35], rotation: [0, -0.55, 0] },
  { id: 'p-arm', catalogId: 'robot-arm-lab', position: [-1.616, -1.712, -2.355], rotation: [-0.062, 1.368, -0.052], scale: [0.98, 0.98, 0.98] },
  { id: 'p-bench', catalogId: 'lab-bench', position: [-1.873, -1.678, -0.214], rotation: [0, 0.7, 0] },
  { id: 'p-console', catalogId: 'control-console', position: [1.917, -1.671, -0.366], rotation: [0, -0.7, 0] },
  { id: 'p-scope', catalogId: 'oscilloscope', position: [-3.378, -1.874, 0.588], rotation: [0, 0.8, 0] },
  { id: 'p-crate', catalogId: 'crate', position: [1.536, -1.439, 0.622], rotation: [0, -0.3, 0] },
  { id: 'p-bunch1', catalogId: 'banana-bunch', position: [-1.698, -0.422, -0.108], rotation: [0, 0.4, 2.368] },
]
