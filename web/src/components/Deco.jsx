// Deco: the Data Aggregation page decoration layer. A manga-shaded 3D scene
// (a crusty noise backdrop + placeable GLB props, all run through the app's real
// mangaPass shader) plus an on-page editor to transform each prop: position and
// rotation on all 3 axes, and a SINGLE uniform-scale slider. Extras: click in the
// scene to place, duplicate, snap-to-grid, and save/load the layout to
// localStorage. One WebGL canvas (fixed, behind the UI, pointer-events none
// except while placing) so it never blocks the data. Lazy so three/r3f stays out
// of the data path.

import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { MangaPass } from '../lib/mangaPass.js'
import { CanvasGuard, SAFE_DPR } from '../lib/canvasGuard.jsx'

// The data / robot / orchard prop set (the ones we built for this page).
const PALETTE = [
  { key: 'server', label: 'Server', url: '/assets/server.min.glb' },
  { key: 'monitor', label: 'Monitor', url: '/assets/monitor.min.glb' },
  { key: 'harddrive', label: 'Hard drive', url: '/assets/harddrive.min.glb' },
  { key: 'floppy', label: 'Floppy', url: '/assets/floppy.min.glb' },
  { key: 'chip', label: 'Microchip', url: '/assets/chip.min.glb' },
  { key: 'magnifier', label: 'Magnifier', url: '/assets/magnifier.min.glb' },
  { key: 'battery', label: 'Battery', url: '/assets/battery.min.glb' },
  { key: 'robotarm', label: 'Robot arm', url: '/assets/robotarm.min.glb' },
  { key: 'monkey', label: 'Monkey', url: '/assets/monkey.glb' },
  { key: 'apple', label: 'Apple', url: '/assets/apple.glb' },
  { key: 'banana', label: 'Banana', url: '/assets/banana.min.glb' },
  { key: 'crate', label: 'Crate', url: '/assets/crate.min.glb' },
  { key: 'basket', label: 'Basket', url: '/assets/basket.min.glb' },
  { key: 'barrel', label: 'Barrel', url: '/assets/barrel.min.glb' },
  { key: 'haybale', label: 'Hay bale', url: '/assets/haybale.min.glb' },
  { key: 'tree', label: 'Tree', url: '/assets/tree.glb' },
]
const labelOf = (url) => PALETTE.find((p) => p.url === url)?.label ?? 'Prop'
const heightOf = () => 1
const byKey = Object.fromEntries(PALETTE.map((p) => [p.key, p.url]))

// Saved arrangement (exported from the editor's "Copy layout").
const DEFAULT_PLACEMENT = [
  { catalogId: 'server', position: [-5.788, -4.207, 0], rotation: [-0.342, 0.498, -0.062], scale: 2.36 },
  { catalogId: 'magnifier', position: [-5.954, -1.123, 0], rotation: [-0.382, 0.798, -0.962], scale: 1.64 },
  { catalogId: 'apple', position: [-4.951, 0.144, 0], rotation: [0.338, 0.278, 0], scale: 1 },
  { catalogId: 'robotarm', position: [-5.34, 2.731, 0], rotation: [-2.482, -2.022, 0.218], scale: 1.64 },
  { catalogId: 'banana', position: [4.764, 0.973, 0], rotation: [0, 1.738, 1.938], scale: 1.62 },
  { catalogId: 'haybale', position: [5.481, -3.525, 0], rotation: [0, -0.742, 0.158], scale: 1 },
  { catalogId: 'crate', position: [5.297, -2.401, 0], rotation: [0, -0.902, 0], scale: 1.18 },
  { catalogId: 'battery', position: [4.885, -0.847, 0], rotation: [0.258, 1.738, 0.938], scale: 1.22 },
]
const presetObjects = () =>
  DEFAULT_PLACEMENT.filter((p) => byKey[p.catalogId]).map((p) => ({
    id: ++_uid,
    url: byKey[p.catalogId],
    pos: [...p.position],
    rot: [...p.rotation],
    scale: p.scale,
  }))

let _uid = 0
const mkObj = (url, over = {}) => ({
  id: ++_uid,
  url,
  pos: [0, 0, 0],
  rot: [0, 0, 0],
  scale: 1,
  ...over,
})

// Props render in front of the data as a transparent mangaPass cutout, so they
// are clearly visible; the paper/screentone page background is CSS on .az.

// invisible plane behind the props: pointer-down on empty space grabs the
// currently-selected prop so you can drag it from anywhere.
function DragPlane({ onGrab }) {
  return (
    <mesh
      position={[0, 0, -0.5]}
      onPointerDown={(e) => {
        e.stopPropagation()
        onGrab()
      }}
    >
      <planeGeometry args={[80, 80]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  )
}

// While a prop is being dragged, move it along the z=0 plane under the pointer.
function Dragger({ dragId, patchRef, setDragId }) {
  const { camera, gl } = useThree()
  useEffect(() => {
    if (dragId == null) return undefined
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)
    const ray = new THREE.Raycaster()
    const ndc = new THREE.Vector2()
    const pt = new THREE.Vector3()
    const el = gl.domElement
    const move = (ev) => {
      const r = el.getBoundingClientRect()
      ndc.x = ((ev.clientX - r.left) / r.width) * 2 - 1
      ndc.y = -((ev.clientY - r.top) / r.height) * 2 + 1
      ray.setFromCamera(ndc, camera)
      if (ray.ray.intersectPlane(plane, pt)) patchRef.current(dragId, { pos: [pt.x, pt.y, 0] })
    }
    const up = () => setDragId(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [dragId, camera, gl, patchRef, setDragId])
  return null
}

// ---- one placed prop ----------------------------------------------------
function Prop({ url, pos, rot, scale, onDown }) {
  const { scene } = useGLTF(url)
  const model = useMemo(() => {
    const m = scene.clone(true)
    // Meshy models are dark metallic PBR; through mangaPass they read as solid
    // black. Render every prop as a uniform LIGHT matte material (drop the dark
    // albedo/metal/emissive maps, keep normals for surface detail) so the lights
    // shade the shape and mangaPass draws a recognizable inked line drawing.
    // Clone materials so the useGLTF cache is untouched.
    m.traverse((o) => {
      if (!o.isMesh || !o.material) return
      const fix = (mat) => {
        const c = mat.clone()
        if ('metalness' in c) c.metalness = 0
        if ('metalnessMap' in c) c.metalnessMap = null
        if ('roughness' in c) c.roughness = 0.7
        if ('roughnessMap' in c) c.roughnessMap = null
        if ('map' in c) c.map = null // drop the dark colour texture
        if ('color' in c && c.color) c.color.set('#cfcfcf')
        if ('emissive' in c && c.emissive) c.emissive.setScalar(0)
        if ('emissiveMap' in c) c.emissiveMap = null
        if ('aoMap' in c) c.aoMap = null
        c.needsUpdate = true
        return c
      }
      o.material = Array.isArray(o.material) ? o.material.map(fix) : fix(o.material)
    })
    const box = new THREE.Box3().setFromObject(m)
    const size = new THREE.Vector3()
    box.getSize(size)
    const maxDim = Math.max(size.x, size.y, size.z) || 1
    m.scale.setScalar(heightOf(url) / maxDim) // fit to the catalog height (real sizes)
    const b2 = new THREE.Box3().setFromObject(m)
    const c = new THREE.Vector3()
    b2.getCenter(c)
    m.position.x -= c.x
    m.position.z -= c.z
    m.position.y -= b2.min.y // feet on the ground
    return m
  }, [scene, url])
  return (
    <group
      position={pos}
      rotation={rot}
      scale={scale}
      onPointerDown={onDown ? (e) => { e.stopPropagation(); onDown() } : undefined}
    >
      <primitive object={model} />
    </group>
  )
}

function MangaRender() {
  const { gl, scene, camera, size } = useThree()
  const pass = useMemo(() => new MangaPass(gl, { grit: 0.5, ink: 0.06 }), [gl])
  useLayoutEffect(() => {
    const dpr = gl.getPixelRatio()
    pass.setSize(Math.max(2, size.width * dpr), Math.max(2, size.height * dpr))
  }, [pass, gl, size])
  useFrame(() => pass.render(scene, camera), 1)
  return null
}

function DecoScene({ objects, placing, grabSelected, onDown, dragId, patchRef, setDragId }) {
  return (
    <div className={`az-crust${placing ? ' placing' : ''}`} aria-hidden={!placing}>
      <Canvas
        flat
        dpr={SAFE_DPR}
        gl={{ alpha: true, antialias: true, premultipliedAlpha: false }}
        camera={{ position: [0, 0.4, 8], fov: 42, near: 0.1, far: 100 }}
        onCreated={({ camera }) => camera.lookAt(0, -0.7, -1.2)}
      >
        <CanvasGuard />
        <hemisphereLight args={['#ffffff', '#7a7a7a', 1.1]} />
        <directionalLight position={[4, 6, 5]} intensity={1.3} />
        <ambientLight intensity={0.4} />
        {placing && <DragPlane onGrab={grabSelected} />}
        <Suspense fallback={null}>
          {objects.map((o) => (
            <Prop
              key={o.id}
              url={o.url}
              pos={o.pos}
              rot={o.rot}
              scale={o.scale}
              onDown={placing ? () => onDown(o.id) : undefined}
            />
          ))}
        </Suspense>
        {placing && <Dragger dragId={dragId} patchRef={patchRef} setDragId={setDragId} />}
        <MangaRender />
      </Canvas>
    </div>
  )
}

// ---- editor -------------------------------------------------------------
function Axis({ label, min, max, step, value, onChange }) {
  return (
    <label className="deco-slider">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      <b>{value.toFixed(label === 'S' ? 2 : 1)}</b>
    </label>
  )
}

function DecoEditor(props) {
  const {
    objects, selId, setSelId, pick, setPick, addObject, duplicate,
    removeSelected, clearAll, copyAll, exportLayout, patch, placing, setPlacing, snap, setSnap,
  } = props
  const [open, setOpen] = useState(true)
  const [posEd, setPosEd] = useState(null) // dragged panel position (null = default corner)
  const [copied, setCopied] = useState(false)
  const grab = useRef(null)
  const sel = objects.find((o) => o.id === selId)

  const doExport = async () => {
    const ok = await exportLayout()
    setCopied(ok)
    window.setTimeout(() => setCopied(false), 1400)
  }

  // drag the whole panel by its header so it never blocks the view
  const startMove = (e) => {
    if (e.target.closest('.deco-x')) return
    const panel = e.currentTarget.parentElement
    const r = panel.getBoundingClientRect()
    grab.current = { dx: e.clientX - r.left, dy: e.clientY - r.top }
    const move = (ev) =>
      setPosEd({
        x: Math.max(4, ev.clientX - grab.current.dx),
        y: Math.max(4, ev.clientY - grab.current.dy),
      })
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  if (!open) {
    return (
      <button className="deco-toggle" onClick={() => setOpen(true)}>EDIT DECO</button>
    )
  }
  return (
    <div
      className="deco-editor"
      style={posEd ? { left: posEd.x, top: posEd.y, right: 'auto' } : undefined}
    >
      <div className="deco-head" onPointerDown={startMove}>
        <span>DECO EDITOR</span>
        <button className="deco-x" onClick={() => setOpen(false)} aria-label="close">x</button>
      </div>

      <div className="deco-add">
        <select value={pick} onChange={(e) => setPick(e.target.value)}>
          {PALETTE.map((p) => (
            <option key={p.key} value={p.key}>{p.label}</option>
          ))}
        </select>
        <button onClick={() => addObject(PALETTE.find((p) => p.key === pick).url)}>+ Add</button>
      </div>

      <div className="deco-row2">
        <button className={placing ? 'on' : ''} onClick={() => setPlacing((v) => !v)}>
          {placing ? 'Editing scene' : 'Edit in scene'}
        </button>
        <label className="deco-check">
          <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} />
          snap
        </label>
      </div>
      {placing && (
        <div className="deco-hint">drag anywhere to move the selected prop</div>
      )}

      {objects.length > 0 && (
        <div className="deco-list">
          {objects.map((o, i) => (
            <button key={o.id} className={o.id === selId ? 'on' : ''} onClick={() => setSelId(o.id)}>
              {labelOf(o.url)} {i + 1}
            </button>
          ))}
        </div>
      )}

      {sel && (
        <div className="deco-controls">
          <div className="deco-grp">POSITION</div>
          <Axis label="X" min={-6} max={6} step={0.05} value={sel.pos[0]} onChange={(v) => patch(sel.id, { pos: [v, sel.pos[1], sel.pos[2]] })} />
          <Axis label="Y" min={-5} max={5} step={0.05} value={sel.pos[1]} onChange={(v) => patch(sel.id, { pos: [sel.pos[0], v, sel.pos[2]] })} />
          <Axis label="Z" min={-6} max={4} step={0.05} value={sel.pos[2]} onChange={(v) => patch(sel.id, { pos: [sel.pos[0], sel.pos[1], v] })} />
          <div className="deco-grp">ROTATION</div>
          <Axis label="X" min={-Math.PI} max={Math.PI} step={0.02} value={sel.rot[0]} onChange={(v) => patch(sel.id, { rot: [v, sel.rot[1], sel.rot[2]] })} />
          <Axis label="Y" min={-Math.PI} max={Math.PI} step={0.02} value={sel.rot[1]} onChange={(v) => patch(sel.id, { rot: [sel.rot[0], v, sel.rot[2]] })} />
          <Axis label="Z" min={-Math.PI} max={Math.PI} step={0.02} value={sel.rot[2]} onChange={(v) => patch(sel.id, { rot: [sel.rot[0], sel.rot[1], v] })} />
          <div className="deco-grp">SCALE</div>
          <Axis label="S" min={0.2} max={3} step={0.02} value={sel.scale} onChange={(v) => patch(sel.id, { scale: v })} />
          <div className="deco-row2">
            <button onClick={() => duplicate(sel.id)}>Duplicate</button>
            <button className="deco-danger" onClick={removeSelected}>Remove</button>
          </div>
        </div>
      )}

      {objects.length > 0 && (
        <>
          <button className="deco-export" onClick={doExport}>
            {copied ? 'Copied to clipboard' : `Copy layout (${objects.length})`}
          </button>
          <div className="deco-row2 deco-bulk">
            <button onClick={copyAll}>Duplicate all</button>
            <button onClick={clearAll}>Clear all</button>
          </div>
        </>
      )}
    </div>
  )
}

export default function Deco() {
  const [objects, setObjects] = useState(presetObjects) // load the saved arrangement
  const [selId, setSelId] = useState(null)
  const [pick, setPick] = useState(PALETTE[0].key)
  const [placing, setPlacing] = useState(false)
  const [snap, setSnap] = useState(false)
  const [dragId, setDragId] = useState(null)
  const patchRef = useRef(null)

  const snapV = (v) => (snap ? Math.round(v * 4) / 4 : v)
  const snapPos = (p) => p.map(snapV)

  const addObject = (url, pos = [0, 0, 0]) => {
    const o = mkObj(url, { pos: snapPos(pos) })
    setObjects((prev) => [...prev, o])
    setSelId(o.id)
    setPlacing(true) // drop into edit mode so it can be dragged right away
  }
  const grabSelected = () => {
    if (selId != null) setDragId(selId)
  }
  const duplicate = (id) => {
    setObjects((prev) => {
      const src = prev.find((o) => o.id === id)
      if (!src) return prev
      const o = mkObj(src.url, {
        pos: [src.pos[0] + 0.6, src.pos[1], src.pos[2]],
        rot: [...src.rot],
        scale: src.scale,
      })
      setSelId(o.id)
      return [...prev, o]
    })
  }
  const removeSelected = () => {
    setObjects((prev) => {
      const next = prev.filter((o) => o.id !== selId)
      setSelId(next[next.length - 1]?.id ?? null)
      return next
    })
  }
  const clearAll = () => {
    setObjects([])
    setSelId(null)
  }
  const copyAll = () => {
    setObjects((prev) => [
      ...prev,
      ...prev.map((o) =>
        mkObj(o.url, {
          pos: [o.pos[0] + 0.6, o.pos[1], o.pos[2]],
          rot: [...o.rot],
          scale: o.scale,
        }),
      ),
    ])
  }
  // serialize the current arrangement into a placement array + copy to clipboard
  const exportLayout = async () => {
    const keyOf = (url) => PALETTE.find((p) => p.url === url)?.key ?? url
    const round = (a) => a.map((n) => +n.toFixed(3))
    const data = objects.map((o, i) => ({
      id: `p-${keyOf(o.url)}-${i + 1}`,
      catalogId: keyOf(o.url),
      position: round(o.pos),
      rotation: round(o.rot),
      scale: +o.scale.toFixed(3),
    }))
    const text = `export const DEFAULT_PLACEMENT = ${JSON.stringify(data, null, 2)}\n`
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      return false
    }
  }
  const patch = (id, p) =>
    setObjects((prev) =>
      prev.map((o) => (o.id === id ? { ...o, ...(p.pos ? { ...p, pos: snapPos(p.pos) } : p) } : o)),
    )
  patchRef.current = patch
  const onDown = (id) => {
    setSelId(id)
    setDragId(id)
  }

  return (
    <>
      <DecoScene
        objects={objects}
        placing={placing}
        grabSelected={grabSelected}
        onDown={onDown}
        dragId={dragId}
        patchRef={patchRef}
        setDragId={setDragId}
      />
      {/* transparent input layer while editing: drags the selected prop without
          hiding the data (the 3D canvas stays behind at z0) */}
      {placing && (
        <div
          className="deco-catcher"
          onPointerDown={(e) => {
            e.preventDefault()
            grabSelected()
          }}
          aria-hidden
        />
      )}
      <DecoEditor
        objects={objects}
        selId={selId}
        setSelId={setSelId}
        pick={pick}
        setPick={setPick}
        addObject={addObject}
        duplicate={duplicate}
        removeSelected={removeSelected}
        clearAll={clearAll}
        copyAll={copyAll}
        exportLayout={exportLayout}
        patch={patch}
        placing={placing}
        setPlacing={setPlacing}
        snap={snap}
        setSnap={setSnap}
      />
    </>
  )
}
