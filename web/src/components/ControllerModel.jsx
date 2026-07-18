// ControllerModel: renders an accurate PlayStation DualSense (public/assets/
// controller.glb) as the centered hero of the Teleop page and REPLICATES the
// physical controller live. The downloaded mesh is a single un-rigged piece, so
// on top of the static shell we overlay a thin reactive rig aligned to it:
//   - two thumbstick proxies that tilt with the real sticks
//   - a glow that lights each face button / d-pad direction as it is pressed
//   - numbered callout badges that also light on press
// All of it is driven from the live input ref Teleop writes from the Gamepad
// API + keyboard, so the on-screen pad mirrors the one in your hands.
//
// Input ref shape (all optional):
//   { lx, ly, rx, ry, btn: { cross, circle, square, triangle, up, down, left, right, ... } }

import { Component, Suspense, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html, Line, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { MangaPass } from '../lib/mangaPass.js'
import { CanvasGuard, SAFE_DPR } from '../lib/canvasGuard.jsx'

// Freshly generated Meshy controller model; kept as a local GLB so the scene
// remains self-contained in production and never depends on the generation API.
const MODEL_URL = '/assets/dualsense-manga.glb'
// Catalog of assets the scene editor can drop in. All entries are validated
// GLBs in public/assets. To add Meshy-generated props, export the GLB into
// public/assets and add a line here; it then shows up in the editor's library.
// apple.glb ships a washed-out material that ignores a colour override, so any
// tinted entry gets a fresh flat material (see StageProp).
const PROP_LIBRARY = [
  { key: 'banana', label: 'Banana', geo: 'banana', scale: 1.3, tint: '#e6c02e' },
  { key: 'apple', label: 'Apple', url: '/assets/apple.glb', scale: 0.72, tint: '#c4382f' },
  { key: 'crate', label: 'Crate', url: '/assets/crate.min.glb', scale: 1.2 },
  { key: 'tree', label: 'Tree', url: '/assets/tree.glb', scale: 1.9 },
  { key: 'tv', label: 'TV', url: '/assets/tv.glb', scale: 1.0 },
  { key: 'monkey', label: 'Monkey', url: '/assets/monkey.glb', scale: 1.0 },
]

// Initial scene dressing: apples AND bananas. Each item carries its own full
// transform (pos / rot / scale) and is fully editable/removable at runtime.
const DEFAULT_ITEMS = [
  { id: 'apple-1', url: '/assets/apple.glb', label: 'Apple', pos: [-4.02, 1.53, -0.9], rot: [0.3, -0.55, 0.2], scale: 1.98, tint: '#c4382f' },
  { id: 'banana-1', geo: 'banana', label: 'Banana', pos: [3.98, 1.81, -1], rot: [0.15, 0.4, 0.5], scale: 2.42, tint: '#e6c02e' },
  { id: 'crate-1', url: '/assets/crate.min.glb', label: 'Crate', pos: [-3.99, -0.71, -1.1], rot: [0.36, 0.55, 0], scale: 2.22 },
  { id: 'banana-2', geo: 'banana', label: 'Banana', pos: [0.17, -1.6, -0.6], rot: [-0.24, 0.24, -0.15], scale: 2.26, tint: '#e0b83a' },
  { id: 'tree-1', url: '/assets/tree.glb', label: 'Tree', pos: [4.44, -1.19, -1.5], rot: [0, -0.55, 0], scale: 3.46 },
]

let addCounter = 0
const nextItemId = (key) => `${key}-${(addCounter += 1)}`
const MODEL_ROT = [0, 0, 0]
const MODEL_WIDTH = 2.4
// The controller is the centered hero; it stays fixed at the origin.
const CONTROLLER_TRANSFORM = { pos: [0, 0, 0], rot: [0, 0, 0] }
// face buttons + d-pad glow anchors (on the model surface)

// callout badges (offset outward from each control so they do not cover it)
const CONTROLS = [
  { n: 1, pos: [-0.3, -0.5, 0.45], name: 'Left stick', act: 'drive: left track', key: 'W / S',
    hot: (s) => Math.abs(s.ly || 0) > 0.06 || Math.abs(s.lx || 0) > 0.06 },
  { n: 2, pos: [0.3, -0.5, 0.45], name: 'Right stick', act: 'drive: right track', key: 'A / D',
    hot: (s) => Math.abs(s.ry || 0) > 0.06 || Math.abs(s.rx || 0) > 0.06 },
  { n: 3, pos: [-0.66, 0.62, 0.45], name: 'D-pad', act: 'steer', key: 'Arrows',
    hot: (s) => ((s.btn?.up || 0) + (s.btn?.down || 0) + (s.btn?.left || 0) + (s.btn?.right || 0)) > 0.5 },
  { n: 4, pos: [0.6, 0.64, 0.45], glyph: '△', name: 'Triangle', act: 'pick banana', key: 'L',
    hot: (s) => (s.btn?.triangle || 0) > 0.5 },
  { n: 5, pos: [1.0, 0.34, 0.45], glyph: '○', name: 'Circle', act: 'E-STOP', key: 'Space',
    hot: (s) => (s.btn?.circle || 0) > 0.5 },
  { n: 6, pos: [0.88, 0.05, 0.45], glyph: '✕', name: 'Cross', act: 'pick nearest', key: 'J',
    hot: (s) => (s.btn?.cross || 0) > 0.5 },
  { n: 7, pos: [0.38, 0.5, 0.45], glyph: '□', name: 'Square', act: 'pick apple', key: 'K',
    hot: (s) => (s.btn?.square || 0) > 0.5 },
]

// A thumbstick proxy (dark base + concave cap) sat over the model's stick so it
// visibly tilts with the real one.
const LIVE_LABELS = [
  { key: 'up', label: 'D-PAD', type: 'dpad', pos: [-1.85, 0.32, 0.12], target: [-0.62, 0.34, 0.28] },
  { key: 'triangle', label: '△', pos: [1.7, 0.86, 0.12], target: [0.53, 0.45, 0.28] },
  { key: 'circle', label: '○', pos: [1.95, 0.34, 0.12], target: [0.69, 0.34, 0.28] },
  { key: 'cross', label: '✕', pos: [1.92, -0.24, 0.12], target: [0.53, 0.22, 0.28] },
  { key: 'square', label: '□', pos: [1.92, -0.72, 0.12], target: [0.37, 0.34, 0.28] },
  { key: 'l1', label: 'L1/L2', pos: [-1.7, 1.3, 0.12], target: [-0.52, 0.55, 0.22] },
  { key: 'r1', label: 'R1/R2', pos: [1.7, 1.3, 0.12], target: [0.52, 0.55, 0.22] },
  { key: 'leftStick', label: 'L STICK', type: 'stick', pos: [-1.9, -1.28, 0.12], target: [-0.27, 0.05, 0.28] },
  { key: 'rightStick', label: 'R STICK', type: 'stick', pos: [1.9, -1.28, 0.12], target: [0.27, 0.05, 0.28] },
]

function LiveLabels({ stateRef }) {
  const nodes = useRef([])
  useFrame(() => {
    const input = stateRef.current || {}
    const buttons = input.btn || {}
    for (let index = 0; index < LIVE_LABELS.length; index++) {
      const node = nodes.current[index]
      if (!node) continue
      const key = LIVE_LABELS[index].key
      const type = LIVE_LABELS[index].type
      if (type === 'stick') {
        const x = key === 'leftStick' ? input.lx || 0 : input.rx || 0
        const y = key === 'leftStick' ? input.ly || 0 : input.ry || 0
        node.querySelector('em').textContent = `X ${x.toFixed(2)}  Y ${y.toFixed(2)}`
        node.querySelector('.scene-joy-dot').style.transform = `translate(${x * 7}px, ${-y * 7}px)`
        continue
      }
      const pressed = key === 'l1'
        ? (buttons.l1 || buttons.l2)
        : key === 'r1'
          ? (buttons.r1 || buttons.r2)
          : buttons[key]
      node.classList.toggle('on', Boolean(pressed))
      node.querySelector('em').textContent = pressed ? 'PRESSED' : 'IDLE'
      if (type === 'dpad') {
        for (const direction of ['up', 'down', 'left', 'right']) {
          node.querySelector(`.scene-dpad-${direction}`).classList.toggle('on', Boolean(buttons[direction]))
        }
      }
    }
  })
  return LIVE_LABELS.map((item, index) => (
    <group key={item.key}>
      <Line points={[item.pos, item.target]} color="#151515" lineWidth={0.75} transparent opacity={0.55} />
      <mesh position={item.target}>
        <sphereGeometry args={[0.025, 10, 10]} />
        <meshBasicMaterial color="#151515" />
      </mesh>
      <Html position={item.pos} center className="scene-control-label" distanceFactor={8.5} zIndexRange={[2, 0]}>
        <span ref={(node) => (nodes.current[index] = node)}>
          <b>{item.label}</b><em>IDLE</em>
          {item.type === 'dpad' && (
            <i className="scene-dpad" aria-hidden="true">
              <i className="scene-dpad-up" /><i className="scene-dpad-left" />
              <i className="scene-dpad-center" /><i className="scene-dpad-right" />
              <i className="scene-dpad-down" />
            </i>
          )}
          {item.type === 'stick' && (
            <i className="scene-joy-wrap" aria-hidden="true">
              <i className="scene-joy"><i className="scene-joy-dot" /></i>
            </i>
          )}
        </span>
      </Html>
    </group>
  ))
}

function DualSense({ transform, stateRef, liveLabels }) {
  const { scene } = useGLTF(MODEL_URL)
  const model = useMemo(() => {
    const clone = scene.clone(true)
    // The source asset ships with a dark shell. Give every shell mesh the
    // standard white DualSense finish while keeping the stick overlays dark.
    clone.traverse((node) => {
      if (!node.isMesh || !node.material) return
      const wasArray = Array.isArray(node.material)
      const materials = wasArray ? node.material : [node.material]
      const whiteMaterials = materials.map((material) => {
        const white = material.clone()
        white.color.set(0xf4f6f8)
        white.roughness = 0.56
        white.metalness = 0.05
        // The GLB's baked dark texture was overriding the material colour in
        // the centre shell. Use a clean untextured white finish throughout.
        white.map = null
        white.normalMap = null
        white.roughnessMap = null
        white.metalnessMap = null
        white.aoMap = null
        white.emissiveMap = null
        white.vertexColors = false
        white.needsUpdate = true
        return white
      })
      node.material = wasArray ? whiteMaterials : whiteMaterials[0]
    })
    return clone
  }, [scene])
  useLayoutEffect(() => {
    const box = new THREE.Box3().setFromObject(model)
    const size = new THREE.Vector3()
    box.getSize(size)
    const s = MODEL_WIDTH / (Math.max(size.x, size.y, size.z) || 1)
    model.scale.setScalar(s)
    const b2 = new THREE.Box3().setFromObject(model)
    const c = new THREE.Vector3()
    b2.getCenter(c)
    model.position.sub(c)
  }, [model])

  // Subtle idle float for the controller. Animating the whole group (model +
  // annotations together) keeps the callout lines locked to the buttons.
  const groupRef = useRef()
  useFrame((state) => {
    const g = groupRef.current
    if (!g) return
    const t = state.clock.elapsedTime
    g.position.y = transform.pos[1] + Math.sin(t * 0.45) * 0.04
    g.rotation.x = MODEL_ROT[0] + transform.rot[0] + Math.sin(t * 0.5) * 0.012
    g.rotation.y = MODEL_ROT[1] + transform.rot[1] + Math.sin(t * 0.32) * 0.035
  })

  return (
    <group
      ref={groupRef}
      position={transform.pos}
      rotation={[
        MODEL_ROT[0] + transform.rot[0],
        MODEL_ROT[1] + transform.rot[1],
        MODEL_ROT[2] + transform.rot[2],
      ]}
    >
      <primitive object={model} />
      {liveLabels && <LiveLabels stateRef={stateRef} />}
    </group>
  )
}

// Gentle idle animation (bob + slow sway) applied on an INNER group so it never
// fights the base transform on the outer group (drag + editor own that). Each
// prop is desynced by a per-id seed so they do not move in lockstep.
function AnimatedProp({ id, children }) {
  const ref = useRef()
  const seed = useMemo(() => {
    let h = 0
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 997
    return (h / 997) * Math.PI * 2
  }, [id])
  useFrame((state) => {
    const g = ref.current
    if (!g) return
    const t = state.clock.elapsedTime + seed
    g.position.y = Math.sin(t * 0.5) * 0.045
    g.rotation.y = Math.sin(t * 0.28) * 0.06
    g.rotation.z = Math.cos(t * 0.4) * 0.02
  })
  return <group ref={ref}>{children}</group>
}

// Pointer drag in a camera-facing plane at the object's depth. Window-level
// listeners on grab (rather than r3f pointer capture, which did not track
// reliably) keep the drag alive when the cursor leaves the mesh. The new
// position is written back to scene state so the editor and drag stay in sync.
function usePropDrag(id, pos, onDragMove) {
  const { camera, gl, raycaster } = useThree()
  const plane = useMemo(() => new THREE.Plane(), [])
  const normal = useMemo(() => new THREE.Vector3(), [])
  const hit = useMemo(() => new THREE.Vector3(), [])
  const offset = useMemo(() => new THREE.Vector3(), [])
  const pointer = useMemo(() => new THREE.Vector2(), [])
  const posRef = useRef(pos)
  posRef.current = pos

  const onPointerDown = (e) => {
    if (!onDragMove) return
    e.stopPropagation()
    camera.getWorldDirection(normal)
    plane.setFromNormalAndCoplanarPoint(normal, e.point)
    const p = posRef.current
    offset.copy(e.point).sub(new THREE.Vector3(p[0], p[1], p[2]))
    document.body.style.cursor = 'grabbing'

    const onMove = (ev) => {
      const rect = gl.domElement.getBoundingClientRect()
      pointer.set(
        ((ev.clientX - rect.left) / rect.width) * 2 - 1,
        -((ev.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(pointer, camera)
      if (raycaster.ray.intersectPlane(plane, hit)) {
        onDragMove(id, [hit.x - offset.x, hit.y - offset.y, hit.z - offset.z])
      }
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.cursor = ''
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  return {
    onPointerDown,
    onPointerOver: (e) => { if (onDragMove) { e.stopPropagation(); document.body.style.cursor = 'grab' } },
    onPointerOut: () => { document.body.style.cursor = '' },
  }
}

function StageProp({ id, url, pos, rot, scale, tint, onDragMove }) {
  const { scene } = useGLTF(url)
  // Normalize the mesh to unit size + centered ONCE; pos/rot/scale are applied
  // on the wrapping group so live editing (scale slider) stays cheap.
  const model = useMemo(() => {
    const clone = scene.clone(true)
    // Replace tinted props with a fresh flat material. Cloning the GLB's own
    // material and overriding the colour did not take (apple.glb rendered near
    // white); a brand-new MeshStandardMaterial gives a clean, vivid region.
    if (tint) {
      const flat = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.72, metalness: 0 })
      clone.traverse((node) => {
        if (node.isMesh) node.material = flat
      })
    }
    const box = new THREE.Box3().setFromObject(clone)
    const dimensions = box.getSize(new THREE.Vector3())
    clone.scale.setScalar(1 / (Math.max(dimensions.x, dimensions.y, dimensions.z) || 1))
    const centered = new THREE.Box3().setFromObject(clone)
    clone.position.sub(centered.getCenter(new THREE.Vector3()))
    return clone
  }, [scene, tint])
  const bind = usePropDrag(id, pos, onDragMove)
  return (
    <group position={pos} rotation={rot} scale={scale} {...bind}>
      <AnimatedProp id={id}>
        <primitive object={model} />
      </AnimatedProp>
    </group>
  )
}

// No valid banana GLB exists in the repo, so the banana is a procedural mesh: a
// curved tube tapered at both ends. Normalized to unit size + centered so the
// scale field behaves like every other prop. Reads well as a manga silhouette.
function makeBananaGeometry() {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.95, -0.15, 0),
    new THREE.Vector3(-0.55, 0.32, 0.02),
    new THREE.Vector3(0, 0.5, 0),
    new THREE.Vector3(0.55, 0.32, -0.02),
    new THREE.Vector3(0.95, -0.15, 0),
  ])
  const tub = 80
  const rad = 14
  const geo = new THREE.TubeGeometry(curve, tub, 0.2, rad, false)
  const position = geo.attributes.position
  for (let i = 0; i <= tub; i++) {
    const t = i / tub
    const s = 0.22 + 0.78 * Math.pow(Math.sin(Math.PI * t), 0.6) // pointy ends, fat middle
    const c = curve.getPointAt(t)
    for (let j = 0; j <= rad; j++) {
      const idx = i * (rad + 1) + j
      position.setXYZ(
        idx,
        c.x + (position.getX(idx) - c.x) * s,
        c.y + (position.getY(idx) - c.y) * s,
        c.z + (position.getZ(idx) - c.z) * s,
      )
    }
  }
  position.needsUpdate = true
  geo.computeVertexNormals()
  geo.computeBoundingBox()
  const size = geo.boundingBox.getSize(new THREE.Vector3())
  const center = geo.boundingBox.getCenter(new THREE.Vector3())
  geo.translate(-center.x, -center.y, -center.z)
  const norm = 1 / (Math.max(size.x, size.y, size.z) || 1)
  geo.scale(norm, norm, norm)
  return geo
}

function BananaProp({ id, pos, rot, scale, tint, onDragMove }) {
  const geometry = useMemo(() => makeBananaGeometry(), [])
  const bind = usePropDrag(id, pos, onDragMove)
  return (
    <group position={pos} rotation={rot} scale={scale} {...bind}>
      <AnimatedProp id={id}>
        <mesh geometry={geometry}>
          <meshStandardMaterial color={tint || '#e6c02e'} roughness={0.7} metalness={0} />
        </mesh>
      </AnimatedProp>
    </group>
  )
}

// One broken/missing prop asset must never take the whole scene (and the
// controller layered above it) down. Drop just that prop and keep going.
class PropBoundary extends Component {
  state = { dead: false }
  static getDerivedStateFromError() {
    return { dead: true }
  }
  render() {
    return this.state.dead ? null : this.props.children
  }
}

// Serialize the live scene into a ready-to-paste DEFAULT_ITEMS array so a
// layout arranged in the editor can be copied back into the source as the new
// default. Values are rounded so the snippet stays readable.
function serializeItems(items) {
  const r = (n) => Math.round(n * 100) / 100
  const lines = items.map((it) => {
    const parts = [`id: '${it.id}'`]
    if (it.geo) parts.push(`geo: '${it.geo}'`)
    if (it.url) parts.push(`url: '${it.url}'`)
    parts.push(`label: '${it.label}'`)
    parts.push(`pos: [${it.pos.map(r).join(', ')}]`)
    parts.push(`rot: [${it.rot.map(r).join(', ')}]`)
    parts.push(`scale: ${r(it.scale)}`)
    if (it.tint) parts.push(`tint: '${it.tint}'`)
    return `  { ${parts.join(', ')} },`
  })
  return `const DEFAULT_ITEMS = [\n${lines.join('\n')}\n]`
}

// Runtime scene editor: add props from the library, remove them, and edit the
// full transform (position / rotation / scale) of any object in the scene.
function SceneEditor({ items, setItems }) {
  const [copied, setCopied] = useState(false)
  const [open, setOpen] = useState(false)
  const [selectedId, setSelectedId] = useState(items[0]?.id ?? null)
  const [addKey, setAddKey] = useState(PROP_LIBRARY[0].key)
  const selected = items.find((it) => it.id === selectedId) ?? items[0] ?? null

  const patchAxis = (kind, axis, next) => {
    const index = 'xyz'.indexOf(axis)
    setItems((prev) => prev.map((it) => it.id === selected.id
      ? { ...it, [kind]: it[kind].map((c, i) => (i === index ? Number(next) : c)) }
      : it))
  }
  const patchScale = (next) => setItems((prev) => prev.map((it) =>
    it.id === selected.id ? { ...it, scale: Number(next) } : it))

  const addItem = () => {
    const lib = PROP_LIBRARY.find((l) => l.key === addKey)
    if (!lib) return
    const id = nextItemId(lib.key)
    const item = { id, url: lib.url, geo: lib.geo, label: lib.label, pos: [0, 0.5, 0], rot: [0, 0, 0], scale: lib.scale, tint: lib.tint }
    setItems((prev) => [...prev, item])
    setSelectedId(id)
  }
  const duplicateItem = () => {
    if (!selected) return
    const id = nextItemId(selected.label.toLowerCase().replace(/\W+/g, '-'))
    setItems((prev) => [...prev, { ...selected, id, pos: [selected.pos[0] + 0.6, selected.pos[1], selected.pos[2]] }])
    setSelectedId(id)
  }
  const removeItem = () => {
    if (!selected) return
    setItems((prev) => prev.filter((it) => it.id !== selected.id))
    setSelectedId((prev) => {
      const rest = items.filter((it) => it.id !== selected.id)
      return prev === selected.id ? (rest[0]?.id ?? null) : prev
    })
  }
  const resetScene = () => {
    setItems(DEFAULT_ITEMS.map((it) => ({ ...it, pos: [...it.pos], rot: [...it.rot] })))
    setSelectedId(DEFAULT_ITEMS[0].id)
  }
  const copyScene = () => {
    const text = serializeItems(items)
    const done = () => { setCopied(true); window.setTimeout(() => setCopied(false), 1600) }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => window.prompt('Copy the scene values:', text))
    } else {
      window.prompt('Copy the scene values:', text)
    }
  }

  return (<>
    <button className="scene-editor-toggle" onClick={() => setOpen((current) => !current)}>
      {open ? 'CLOSE EDIT' : 'EDIT SCENE'}
    </button>
    {open && <aside className="scene-editor">
      <span className="scene-editor-title">SCENE EDIT</span>

      <div className="scene-edit-add">
        <select value={addKey} onChange={(e) => setAddKey(e.target.value)}>
          {PROP_LIBRARY.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
        </select>
        <button onClick={addItem}>ADD</button>
      </div>

      <div className="scene-edit-sep">OBJECTS ({items.length})</div>
      <select value={selected?.id ?? ''} onChange={(e) => setSelectedId(e.target.value)}>
        {items.map((it) => <option key={it.id} value={it.id}>{it.label}</option>)}
      </select>

      {selected && <>
        {['pos', 'rot'].map((kind) => (
          <div className="scene-edit-row" key={kind}>
            <b>{kind === 'pos' ? 'POSITION' : 'ROTATION'}</b>
            {'xyz'.split('').map((axis, index) => (
              <label key={axis}>
                {axis}
                <input
                  type="range"
                  min={kind === 'pos' ? -6 : -3.14}
                  max={kind === 'pos' ? 6 : 3.14}
                  step="0.01"
                  value={selected[kind][index]}
                  onChange={(e) => patchAxis(kind, axis, e.target.value)}
                />
              </label>
            ))}
          </div>
        ))}
        <div className="scene-edit-row">
          <b>SCALE</b>
          <label>
            s
            <input type="range" min="0.1" max="4" step="0.01" value={selected.scale}
              onChange={(e) => patchScale(e.target.value)} />
          </label>
        </div>
        <div className="scene-edit-actions">
          <button onClick={duplicateItem}>DUPLICATE</button>
          <button onClick={removeItem}>REMOVE</button>
        </div>
      </>}

      <div className="scene-edit-actions">
        <button onClick={copyScene}>{copied ? 'COPIED' : 'COPY VALUES'}</button>
        <button className="scene-edit-reset" onClick={resetScene}>RESET</button>
      </div>
    </aside>}
  </>)
}

// Single manga ink pass over the WHOLE stage (world + controller + every prop).
// The full scene reads as one continuous black-and-white manga panel.
function MangaRender() {
  const { gl, scene, camera, size } = useThree()
  const pass = useMemo(() => new MangaPass(gl, { grit: 0.8, ink: 0.035 }), [gl])
  const measured = useRef('')
  const key = `${size.width}x${size.height}`
  if (measured.current !== key) {
    measured.current = key
    const dpr = gl.getPixelRatio()
    pass.setSize(size.width * dpr, size.height * dpr)
  }
  useFrame(() => pass.render(scene, camera), 1)
  return null
}

// Full-viewport ink set-dressing: the manga panel behind the controller. Lives
// in the WebGL scene (not CSS) so Teleop reads as one continuous manga panel.
function StageWorld() {
  return (
    <>
      <ambientLight intensity={0.9} />
      <directionalLight position={[3, 5, 4]} intensity={1.8} />
      <directionalLight position={[-4, 1, 2]} intensity={0.65} />
      <mesh position={[0, 0.1, -3.4]}>
        <planeGeometry args={[15, 9]} />
        <meshStandardMaterial color="#eeeeea" roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.45, -0.45]}>
        <planeGeometry args={[15, 10]} />
        <meshStandardMaterial color="#b7b7b1" roughness={0.95} />
      </mesh>
      {/* Angular ink-panel fragments give the outer frame depth and motion. */}
      <mesh position={[-5.1, 2.5, -1.8]} rotation={[0, 0, -0.22]}>
        <boxGeometry args={[2.4, 0.12, 0.15]} />
        <meshStandardMaterial color="#262626" roughness={1} />
      </mesh>
      <mesh position={[5.0, -0.5, -1.8]} rotation={[0, 0, 0.35]}>
        <boxGeometry args={[2.2, 0.1, 0.15]} />
        <meshStandardMaterial color="#262626" roughness={1} />
      </mesh>
      <mesh position={[-4.9, -1.0, -2]} rotation={[0, 0, 0.72]}>
        <boxGeometry args={[1.7, 0.09, 0.12]} />
        <meshStandardMaterial color="#262626" roughness={1} />
      </mesh>
    </>
  )
}

function CameraRig({ stateRef, stage }) {
  const { camera } = useThree()
  const aim = useMemo(() => new THREE.Vector3(), [])
  useFrame((_, dt) => {
    const st = stateRef.current || {}
    const lx = st.lx || 0
    const ly = st.ly || 0
    const rx = st.rx || 0
    const ry = st.ry || 0
    const baseZ = stage ? 7 : 4.2
    // Sticks pan the camera for parallax; a bit more travel on the full stage.
    // Keep Z fixed (no zoom): the distanceFactor'd annotations must not resize
    // as the camera moves, and only Z distance changes their scale.
    const panX = stage ? 0.45 : 0.16
    const panY = stage ? 0.3 : 0.1
    camera.position.x = THREE.MathUtils.damp(camera.position.x, (lx + rx) * panX, 4, dt)
    camera.position.y = THREE.MathUtils.damp(camera.position.y, (ly + ry) * panY, 4, dt)
    camera.position.z = baseZ
    aim.set((lx + rx) * (stage ? 0.12 : 0.04), (ly + ry) * (stage ? 0.08 : 0.025), 0)
    camera.lookAt(aim)
  })
  return null
}

export default function ControllerModel({ stateRef, annotate = true, stage = false }) {
  const localRef = useRef({})
  const ref = stateRef || localRef
  const [items, setItems] = useState(() => DEFAULT_ITEMS.map((it) => ({ ...it, pos: [...it.pos], rot: [...it.rot] })))
  const moveItem = (id, pos) => setItems((prev) => prev.map((it) => (it.id === id ? { ...it, pos } : it)))
  if (stage) {
    // One canvas, one manga pass over the whole scene (world + controller +
    // every prop) so everything reads as one black-and-white manga panel. The
    // sticks pan the camera (CameraRig) for parallax while driving. Props are
    // runtime state, fully add/remove/transform-able.
    return (
      <div className="ctrl-hero ctrl-hero-stage">
        <div className="ctrl-canvas ctrl-canvas-hero ctrl-canvas-stage" aria-hidden>
          <Canvas
            className="stage-world-canvas"
            dpr={SAFE_DPR}
            gl={{ alpha: false, antialias: true }}
            camera={{ position: [0, 0, 7], fov: 40 }}
          >
            <CanvasGuard />
            <color attach="background" args={['#e8e7df']} />
            <StageWorld />
            <Suspense fallback={null}>
              <DualSense transform={CONTROLLER_TRANSFORM} stateRef={ref} liveLabels />
            </Suspense>
            {items.map((item) => (
              <PropBoundary key={item.id}>
                <Suspense fallback={null}>
                  {item.geo === 'banana' ? (
                    <BananaProp
                      id={item.id}
                      pos={item.pos}
                      rot={item.rot}
                      scale={item.scale}
                      tint={item.tint}
                      onDragMove={moveItem}
                    />
                  ) : (
                    <StageProp
                      id={item.id}
                      url={item.url}
                      pos={item.pos}
                      rot={item.rot}
                      scale={item.scale}
                      tint={item.tint}
                      onDragMove={moveItem}
                    />
                  )}
                </Suspense>
              </PropBoundary>
            ))}
            <MangaRender />
            <CameraRig stateRef={ref} stage />
          </Canvas>
        </div>
        <SceneEditor items={items} setItems={setItems} />
      </div>
    )
  }

  return (
    <div className="ctrl-hero">
      <div className="ctrl-canvas ctrl-canvas-hero" aria-hidden>
        <Canvas
          dpr={SAFE_DPR}
          gl={{ alpha: true, antialias: true }}
          camera={{ position: [0, 0, 4.2], fov: 34 }}
        >
          <CanvasGuard />
          <ambientLight intensity={0.9} />
          <hemisphereLight args={[0xffffff, 0x2a2f2a, 0.6]} />
          <directionalLight position={[3, 4, 5]} intensity={1.5} />
          <directionalLight position={[-4, 1, 2]} intensity={0.6} />
          <directionalLight position={[0, 2, -4]} intensity={0.7} />
          <Suspense fallback={null}>
            <DualSense transform={CONTROLLER_TRANSFORM} stateRef={ref} liveLabels={false} />
          </Suspense>
          <CameraRig stateRef={ref} stage={false} />
        </Canvas>
      </div>
      {annotate && (
        <ol className="ctrl-legend">
          {CONTROLS.map((c) => (
            <li key={c.n}>
              <span className="ln">{c.n}</span>
              <span className="lname">
                {c.glyph ? <b className="lglyph">{c.glyph}</b> : null}
                {c.name}
              </span>
              <span className="lact">{c.act}</span>
              <kbd>{c.key}</kbd>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

useGLTF.preload(MODEL_URL)
