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
import { PainterlyPipeline } from '../vendor/painterly.js'

// Freshly generated Meshy controller model; kept as a local GLB so the scene
// remains self-contained in production and never depends on the generation API.
const MODEL_URL = '/assets/dualsense-manga.glb'
// Only real GLBs here (public/assets). A tint gives the paint shader clean
// colour regions to work from. There is no valid banana model in the repo, so
// a second apple stands in as the right-hand fruit.
const STAGE_PROPS = [
  { id: 'apple', label: 'Apple', url: '/assets/apple.glb', pos: [-3.8, 1.15, -0.9], rot: [0.3, -0.55, 0.2], size: 0.72, tint: '#c4382f' },
  { id: 'apple2', label: 'Apple (r)', url: '/assets/apple.glb', pos: [3.7, 1.4, -1.0], rot: [0.2, 0.65, -0.35], size: 0.66, tint: '#d0632c' },
  { id: 'crate', label: 'Crate', url: '/assets/crate.min.glb', pos: [-4.1, -1.8, -1.1], rot: [0.1, 0.55, 0], size: 1.2, tint: '#a9763f' },
  { id: 'tree', label: 'Tree', url: '/assets/tree.glb', pos: [4.2, -1.75, -1.5], rot: [0, -0.55, 0], size: 1.9, tint: '#5c8a3f' },
]
const SCENE_ITEMS = [
  { id: 'controller', label: 'Controller', pos: [0, 0, 0], rot: [0, 0, 0] },
  ...STAGE_PROPS.map(({ id, label, pos, rot }) => ({ id, label, pos, rot })),
]
const MODEL_ROT = [0, 0, 0]
const MODEL_WIDTH = 2.4
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
  { key: 'up', label: 'D-PAD', type: 'dpad', pos: [-1.18, 0.24, 0.12], target: [-0.62, 0.36, 0.28] },
  { key: 'triangle', label: '△', pos: [1.08, 0.54, 0.12], target: [0.6, 0.45, 0.28] },
  { key: 'circle', label: '○', pos: [1.26, 0.17, 0.12], target: [0.79, 0.34, 0.28] },
  { key: 'cross', label: '✕', pos: [1.25, -0.19, 0.12], target: [0.68, 0.23, 0.28] },
  { key: 'square', label: '□', pos: [1.06, -0.5, 0.12], target: [0.57, 0.34, 0.28] },
  { key: 'l1', label: 'L1/L2', pos: [-1.08, 0.9, 0.12], target: [-0.69, 0.78, 0.22] },
  { key: 'r1', label: 'R1/R2', pos: [1.08, 0.9, 0.12], target: [0.69, 0.78, 0.22] },
  { key: 'leftStick', label: 'L STICK', type: 'stick', pos: [-1.12, -0.62, 0.12], target: [-0.29, 0.02, 0.28] },
  { key: 'rightStick', label: 'R STICK', type: 'stick', pos: [1.12, -0.62, 0.12], target: [0.29, 0.02, 0.28] },
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
      <Html position={item.pos} center className="scene-control-label" distanceFactor={11}>
        <span ref={(node) => (nodes.current[index] = node)}>
          <b>{item.label}</b><em>IDLE</em>
          {item.type === 'dpad' && (
            <i className="scene-dpad" aria-hidden="true">
              <i className="scene-dpad-up" /><i className="scene-dpad-left" />
              <i className="scene-dpad-center" /><i className="scene-dpad-right" />
              <i className="scene-dpad-down" />
            </i>
          )}
          {item.type === 'stick' && <i className="scene-joy" aria-hidden="true"><i className="scene-joy-dot" /></i>}
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

  return (
    <group
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

function StageProp({ url, pos, rot, size, tint, transform }) {
  const { scene } = useGLTF(url)
  const model = useMemo(() => {
    const clone = scene.clone(true)
    // Give each prop a flat orchard colour so the paint shader has clean,
    // vivid regions to work from regardless of the GLB's baked texture.
    if (tint) {
      clone.traverse((node) => {
        if (!node.isMesh || !node.material) return
        const paint = (material) => {
          const next = material.clone()
          next.color?.set(tint)
          next.map = null
          next.emissiveMap = null
          next.roughnessMap = null
          next.metalnessMap = null
          next.vertexColors = false
          next.roughness = 0.7
          next.metalness = 0
          next.needsUpdate = true
          return next
        }
        node.material = Array.isArray(node.material)
          ? node.material.map(paint)
          : paint(node.material)
      })
    }
    const box = new THREE.Box3().setFromObject(clone)
    const dimensions = box.getSize(new THREE.Vector3())
    clone.scale.setScalar(size / (Math.max(dimensions.x, dimensions.y, dimensions.z) || 1))
    const centered = new THREE.Box3().setFromObject(clone)
    clone.position.sub(centered.getCenter(new THREE.Vector3()))
    return clone
  }, [scene, size, tint])
  return <primitive object={model} position={transform?.pos ?? pos} rotation={transform?.rot ?? rot} />
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

function SceneEditor({ transforms, setTransforms }) {
  const [selected, setSelected] = useState('controller')
  const [open, setOpen] = useState(false)
  const value = transforms[selected]
  const change = (kind, axis, next) => {
    const index = 'xyz'.indexOf(axis)
    setTransforms((previous) => ({
      ...previous,
      [selected]: {
        ...previous[selected],
        [kind]: previous[selected][kind].map((current, i) => i === index ? Number(next) : current),
      },
    }))
  }
  return (<>
    <button className="scene-editor-toggle" onClick={() => setOpen((current) => !current)}>
      {open ? 'CLOSE EDIT' : 'EDIT SCENE'}
    </button>
    {open && <aside className="scene-editor">
      <span className="scene-editor-title">SCENE EDIT</span>
      <select value={selected} onChange={(event) => setSelected(event.target.value)}>
        {SCENE_ITEMS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
      </select>
      {['pos', 'rot'].map((kind) => (
        <div className="scene-edit-row" key={kind}>
          <b>{kind === 'pos' ? 'POSITION' : 'ROTATION'}</b>
          {'xyz'.split('').map((axis, index) => (
            <label key={axis}>
              {axis}
              <input
                type="range"
                min={kind === 'pos' ? -5 : -3.14}
                max={kind === 'pos' ? 5 : 3.14}
                step="0.01"
                value={value[kind][index]}
                onChange={(event) => change(kind, axis, event.target.value)}
              />
            </label>
          ))}
        </div>
      ))}
      <button onClick={() => setTransforms(Object.fromEntries(SCENE_ITEMS.map((entry) => [entry.id, { pos: [...entry.pos], rot: [...entry.rot] }])))}>RESET</button>
    </aside>}
  </>)
}

// The same black-and-white ink pass used by the robot POV and stage pages.
// It draws silhouettes, halftones and crosshatching from the actual 3D scene.
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

// The surrounding orchard set-dressing is drawn through the shared painterly
// (anisotropic Kuwahara) pipeline from src/vendor/painterly.js, the same paint
// shader used on the landing/analytics scenes. The controller itself stays on
// the ink pass in a separate canvas layered above this one.
function PainterlyRender() {
  const { gl, scene, camera, size } = useThree()
  const pipeline = useMemo(() => {
    const p = new PainterlyPipeline(gl, { renderScale: 0.85 })
    p.kernelSize = 14
    return p
  }, [gl])
  const measured = useRef('')
  const key = `${size.width}x${size.height}`
  if (measured.current !== key) {
    measured.current = key
    const dpr = gl.getPixelRatio()
    pipeline.setSize(size.width * dpr, size.height * dpr)
  }
  useFrame(() => pipeline.render(scene, camera), 1)
  return null
}

// Full-viewport set dressing for the painterly back layer: a warm orchard
// backdrop, soil floor and a few colour strokes. It lives in the WebGL scene
// (not CSS) so the paint shader can process it as one continuous panel.
function StageWorld() {
  return (
    <>
      <color attach="background" args={['#dbe7c8']} />
      <ambientLight intensity={0.95} />
      <directionalLight position={[3, 5, 4]} intensity={1.8} />
      <directionalLight position={[-4, 1, 2]} intensity={0.65} />
      {/* sky / far backdrop */}
      <mesh position={[0, 0.1, -3.4]}>
        <planeGeometry args={[15, 9]} />
        <meshStandardMaterial color="#cfe0b3" roughness={1} />
      </mesh>
      {/* warm soil floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.45, -0.45]}>
        <planeGeometry args={[15, 10]} />
        <meshStandardMaterial color="#c7a267" roughness={0.95} />
      </mesh>
      {/* Angular colour strokes give the outer frame depth and motion. */}
      <mesh position={[-5.1, 2.5, -1.8]} rotation={[0, 0, -0.22]}>
        <boxGeometry args={[2.4, 0.12, 0.15]} />
        <meshStandardMaterial color="#6f9a4b" roughness={1} />
      </mesh>
      <mesh position={[5.0, -0.5, -1.8]} rotation={[0, 0, 0.35]}>
        <boxGeometry args={[2.2, 0.1, 0.15]} />
        <meshStandardMaterial color="#c9803a" roughness={1} />
      </mesh>
      <mesh position={[-4.9, -1.0, -2]} rotation={[0, 0, 0.72]}>
        <boxGeometry args={[1.7, 0.09, 0.12]} />
        <meshStandardMaterial color="#8a5a34" roughness={1} />
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
    const active = Math.min(1, Math.abs(lx) + Math.abs(ly) + Math.abs(rx) + Math.abs(ry))
    const baseZ = stage ? 7 : 4.2
    camera.position.x = THREE.MathUtils.damp(camera.position.x, (lx + rx) * 0.16, 5, dt)
    camera.position.y = THREE.MathUtils.damp(camera.position.y, (ly + ry) * 0.1, 5, dt)
    camera.position.z = THREE.MathUtils.damp(camera.position.z, baseZ - active * 0.28, 5, dt)
    aim.set((lx + rx) * 0.04, (ly + ry) * 0.025, 0)
    camera.lookAt(aim)
  })
  return null
}

export default function ControllerModel({ stateRef, annotate = true, stage = false }) {
  const localRef = useRef({})
  const ref = stateRef || localRef
  const [transforms, setTransforms] = useState(() => Object.fromEntries(
    SCENE_ITEMS.map((item) => [item.id, { pos: [...item.pos], rot: [...item.rot] }]),
  ))
  if (stage) {
    // Two stacked canvases: the surrounding orchard is drawn through the paint
    // shader in the back layer, the controller through the ink pass in a
    // transparent front layer so it composites cleanly over the painting.
    return (
      <div className="ctrl-hero ctrl-hero-stage">
        <div className="ctrl-canvas ctrl-canvas-hero ctrl-canvas-stage" aria-hidden>
          <Canvas
            className="stage-world-canvas"
            dpr={[1, 1.8]}
            gl={{ alpha: false, antialias: true }}
            camera={{ position: [0, 0, 7], fov: 40 }}
          >
            <StageWorld />
            {STAGE_PROPS.map((prop) => (
              <PropBoundary key={prop.id}>
                <Suspense fallback={null}>
                  <StageProp {...prop} transform={transforms[prop.id]} />
                </Suspense>
              </PropBoundary>
            ))}
            {/* <PainterlyRender /> */}
            <CameraRig stateRef={ref} stage />
          </Canvas>
          <Canvas
            className="stage-controller-canvas"
            dpr={[1, 1.8]}
            gl={{ alpha: true, antialias: true }}
            camera={{ position: [0, 0, 7], fov: 40 }}
          >
            <ambientLight intensity={0.9} />
            <hemisphereLight args={[0xffffff, 0x2a2f2a, 0.6]} />
            <directionalLight position={[3, 4, 5]} intensity={1.5} />
            <directionalLight position={[-4, 1, 2]} intensity={0.6} />
            <directionalLight position={[0, 2, -4]} intensity={0.7} />
            <Suspense fallback={null}>
              <DualSense transform={transforms.controller} stateRef={ref} liveLabels />
            </Suspense>
            {/* <MangaRender /> */}
            <CameraRig stateRef={ref} stage />
          </Canvas>
        </div>
        <SceneEditor transforms={transforms} setTransforms={setTransforms} />
      </div>
    )
  }

  return (
    <div className="ctrl-hero">
      <div className="ctrl-canvas ctrl-canvas-hero" aria-hidden>
        <Canvas
          dpr={[1, 1.8]}
          gl={{ alpha: true, antialias: true }}
          camera={{ position: [0, 0, 4.2], fov: 34 }}
        >
          <ambientLight intensity={0.9} />
          <hemisphereLight args={[0xffffff, 0x2a2f2a, 0.6]} />
          <directionalLight position={[3, 4, 5]} intensity={1.5} />
          <directionalLight position={[-4, 1, 2]} intensity={0.6} />
          <directionalLight position={[0, 2, -4]} intensity={0.7} />
          <Suspense fallback={null}>
            <DualSense transform={transforms.controller} stateRef={ref} liveLabels={false} />
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
