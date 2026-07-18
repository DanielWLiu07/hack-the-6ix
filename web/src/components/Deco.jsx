// Deco: the Data Aggregation page decoration layer. A manga-shaded 3D scene
// (a crusty noise backdrop + placeable GLB props, all run through the app's real
// mangaPass shader) plus an on-page editor to transform each prop: position and
// rotation on all 3 axes, and a SINGLE uniform-scale slider. One WebGL canvas
// (fixed, behind the UI, pointer-events none) so it never blocks the data; the
// editor is a plain DOM panel on top. Lazy so three/r3f stays out of the data
// path.

import { Suspense, useLayoutEffect, useMemo, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { MangaPass } from '../lib/mangaPass.js'
import { CanvasGuard, SAFE_DPR } from '../lib/canvasGuard.jsx'

// Props that can be placed (all optimized + on disk). Grouped: data infra,
// the robot/pitch story, and the orchard/fruit set.
const PALETTE = [
  // data / analytics
  { key: 'server', label: 'Server', url: '/assets/server.min.glb' },
  { key: 'monitor', label: 'Monitor', url: '/assets/monitor.min.glb' },
  { key: 'harddrive', label: 'Hard drive', url: '/assets/harddrive.min.glb' },
  { key: 'floppy', label: 'Floppy', url: '/assets/floppy.min.glb' },
  { key: 'chip', label: 'Microchip', url: '/assets/chip.min.glb' },
  { key: 'magnifier', label: 'Magnifier', url: '/assets/magnifier.min.glb' },
  // robot / pitch
  { key: 'battery', label: 'Battery', url: '/assets/battery.min.glb' },
  { key: 'robotarm', label: 'Robot arm', url: '/assets/robotarm.min.glb' },
  { key: 'monkey', label: 'Monkey', url: '/assets/monkey.glb' },
  // orchard / fruit
  { key: 'apple', label: 'Apple', url: '/assets/apple.glb' },
  { key: 'banana', label: 'Banana', url: '/assets/banana.min.glb' },
  { key: 'crate', label: 'Crate', url: '/assets/crate.min.glb' },
  { key: 'basket', label: 'Basket', url: '/assets/basket.min.glb' },
  { key: 'barrel', label: 'Barrel', url: '/assets/barrel.min.glb' },
  { key: 'haybale', label: 'Hay bale', url: '/assets/haybale.min.glb' },
  { key: 'tree', label: 'Tree', url: '/assets/tree.glb' },
]
const labelOf = (url) => PALETTE.find((p) => p.url === url)?.label ?? 'Prop'

let _uid = 0
const mkObj = (url, over = {}) => ({
  id: ++_uid,
  url,
  pos: [0, 0, 0],
  rot: [0, 0, 0],
  scale: 1,
  ...over,
})

// Nothing pre-placed; the operator adds props from the editor.
const DEFAULT_OBJECTS = []

// ---- crusty manga noise backdrop (inside-out sphere) --------------------
const NOISE_VERT = /* glsl */ `
  varying vec3 vP;
  void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`
const NOISE_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vP;
  float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
  float fbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<5;i++){ v+=a*n(p); p=p*2.0+1.7; a*=0.5; } return v; }
  void main(){
    vec3 d = normalize(vP);
    vec2 uv = vec2(atan(d.z, d.x), d.y) * 2.4;
    float f = fbm(uv * 3.2);
    gl_FragColor = vec4(vec3(0.62 + f * 0.38), 1.0);
  }`

function Crust() {
  const mat = useMemo(
    () => new THREE.ShaderMaterial({
      vertexShader: NOISE_VERT,
      fragmentShader: NOISE_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
    }),
    [],
  )
  return <mesh material={mat}><sphereGeometry args={[26, 32, 16]} /></mesh>
}

// ---- one placed prop ----------------------------------------------------
function Prop({ url, pos, rot, scale }) {
  const { scene } = useGLTF(url)
  const model = useMemo(() => {
    const m = scene.clone(true)
    const box = new THREE.Box3().setFromObject(m)
    const size = new THREE.Vector3()
    box.getSize(size)
    const maxDim = Math.max(size.x, size.y, size.z) || 1
    m.scale.setScalar(1 / maxDim) // normalize to unit size; group applies user scale
    const b2 = new THREE.Box3().setFromObject(m)
    const c = new THREE.Vector3()
    b2.getCenter(c)
    m.position.sub(c)
    return m
  }, [scene])
  return (
    <group position={pos} rotation={rot} scale={scale}>
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

function DecoScene({ objects }) {
  return (
    <div className="az-crust" aria-hidden>
      <Canvas
        flat
        dpr={SAFE_DPR}
        gl={{ alpha: true, antialias: true, premultipliedAlpha: false }}
        camera={{ position: [0, 0, 7], fov: 46, near: 0.1, far: 100 }}
      >
        <CanvasGuard />
        <hemisphereLight args={['#ffffff', '#7a7a7a', 1.1]} />
        <directionalLight position={[4, 6, 5]} intensity={1.3} />
        <ambientLight intensity={0.4} />
        <Crust />
        <Suspense fallback={null}>
          {objects.map((o) => (
            <Prop key={o.id} url={o.url} pos={o.pos} rot={o.rot} scale={o.scale} />
          ))}
        </Suspense>
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

function DecoEditor({ objects, selId, setSelId, addObject, removeSelected, patch }) {
  const [open, setOpen] = useState(true)
  const [pick, setPick] = useState(PALETTE[0].key)
  const sel = objects.find((o) => o.id === selId)

  if (!open) {
    return (
      <button className="deco-toggle" onClick={() => setOpen(true)}>
        EDIT DECO
      </button>
    )
  }
  return (
    <div className="deco-editor">
      <div className="deco-head">
        <span>DECO EDITOR</span>
        <button className="deco-x" onClick={() => setOpen(false)} aria-label="close">
          x
        </button>
      </div>

      <div className="deco-add">
        <select value={pick} onChange={(e) => setPick(e.target.value)}>
          {PALETTE.map((p) => (
            <option key={p.key} value={p.key}>{p.label}</option>
          ))}
        </select>
        <button onClick={() => addObject(PALETTE.find((p) => p.key === pick).url)}>
          + Add
        </button>
      </div>

      <div className="deco-list">
        {objects.map((o, i) => (
          <button
            key={o.id}
            className={o.id === selId ? 'on' : ''}
            onClick={() => setSelId(o.id)}
          >
            {labelOf(o.url)} {i + 1}
          </button>
        ))}
      </div>

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
          <button className="deco-remove" onClick={removeSelected}>Remove selected</button>
        </div>
      )}
    </div>
  )
}

// Note: props load on demand (when added), not preloaded, so the page stays light.

export default function Deco() {
  const [objects, setObjects] = useState(DEFAULT_OBJECTS)
  const [selId, setSelId] = useState(DEFAULT_OBJECTS[0]?.id ?? null)

  const addObject = (url) => {
    const o = mkObj(url, { pos: [0, 0, 0], scale: 1 })
    setObjects((prev) => [...prev, o])
    setSelId(o.id)
  }
  const removeSelected = () => {
    setObjects((prev) => {
      const next = prev.filter((o) => o.id !== selId)
      setSelId(next[next.length - 1]?.id ?? null)
      return next
    })
  }
  const patch = (id, p) =>
    setObjects((prev) => prev.map((o) => (o.id === id ? { ...o, ...p } : o)))

  return (
    <>
      <DecoScene objects={objects} />
      <DecoEditor
        objects={objects}
        selId={selId}
        setSelId={setSelId}
        addObject={addObject}
        removeSelected={removeSelected}
        patch={patch}
      />
    </>
  )
}

