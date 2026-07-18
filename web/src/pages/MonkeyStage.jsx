// MonkeyStage - the "monkey page". The landing scene lives here NOT as a TV
// rectangle but as an amorphous painted SPLASH (a watercolor-masked iframe)
// floating in a dark manga room, a smooth full-body Suzanne character lit beside it.
// Arriving from the landing, the splash fills the viewport (mirroring the scene
// the user just left) then the camera eases back and it settles as a hanging
// painting. Direct visits skip to the settled state. Fully orbit-controllable.

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html, useAnimations, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { MangaPass } from '../lib/mangaPass.js'
import { CanvasGuard, SAFE_DPR } from '../lib/canvasGuard.jsx'
import { buildRig, applyPose } from '../lib/poseRig.js'
import { StageProp, PropBoundary } from '../components/StageProp.jsx'
import { PROP_CATALOG, CATALOG_BY_ID, DEFAULT_PLACEMENT, FLOOR } from '../lib/stageProps.js'

// Webcam pose capture is heavy (MediaPipe wasm), so it only loads when the
// operator turns on mimic mode.
const MimicCam = lazy(() => import('../components/MimicCam.jsx'))
import '../App.css'

// Fresh Meshy-generated cartoon monkey, arms out in a T-pose (a clean static
// mesh - no skinning weights to break). The rig/mimic code below no-ops when
// there are no bones, so it just renders in this cheerful arms-up pose.
const SUZANNE_FULLBODY_URL = '/assets/suzanne-tpose.glb'
// the painted splash: a wide floating plane, hung upper-left, facing the camera
const SPLASH = { w: 2.95, h: 1.85, pos: [0.034, -1.037, 0.312], rot: [0, 0, 0], scale: [0.59, 0.58, 0.59] }
const MONKEY_POS = [0.086, -1.731, 0.764]
const ORBIT_TARGET = [0, 1.15, 0.3]
const CAM_HOME = [0, 1.5, 5.6]

// Procedural watercolor blob: white, feathered ALPHA edges on transparent, with
// multi-octave radius noise so the boundary reads torn/bled, not a soft oval.
// One canvas drives BOTH the CSS mask (alpha) and the halo mesh map (alpha).
function makeSplashCanvas(w, h) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  const cx = w / 2
  const cy = h / 2
  const R = Math.min(w, h) * 0.4
  ctx.fillStyle = '#fff'
  ctx.shadowColor = '#fff'
  ctx.shadowBlur = Math.min(w, h) * 0.045
  // a few overlapping perturbed lobes union into an organic splash
  for (let pass = 0; pass < 3; pass++) {
    const ox = (Math.random() - 0.5) * w * 0.06
    const oy = (Math.random() - 0.5) * h * 0.06
    ctx.beginPath()
    const N = 150
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2
      const n =
        0.7 +
        0.17 * Math.sin(a * 3 + pass) +
        0.1 * Math.sin(a * 7 + pass * 2) +
        0.06 * Math.sin(a * 15 + pass) +
        (Math.random() - 0.5) * 0.05
      const rx = R * n * (w / Math.min(w, h))
      const ry = R * n * (h / Math.min(w, h))
      const x = cx + ox + Math.cos(a) * rx
      const y = cy + oy + Math.sin(a) * ry
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.closePath()
    ctx.fill()
  }
  return c
}

function useSplash() {
  return useMemo(() => {
    const mask = makeSplashCanvas(768, 480)
    const maskTexture = new THREE.CanvasTexture(mask)
    maskTexture.colorSpace = THREE.SRGBColorSpace

    // The stage must work in a clean clone too, where /public/scene is not
    // checked in. This is a deliberately small painted orchard poster used
    // instead of embedding the SPA back into itself.
    const poster = document.createElement('canvas')
    poster.width = 1024
    poster.height = 640
    const ctx = poster.getContext('2d')
    const sky = ctx.createLinearGradient(0, 0, 0, poster.height)
    sky.addColorStop(0, '#a9c5cd')
    sky.addColorStop(0.49, '#dce0c9')
    sky.addColorStop(0.5, '#71835b')
    sky.addColorStop(1, '#334a24')
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, poster.width, poster.height)
    for (let i = 0; i < 85; i++) {
      const x = Math.random() * poster.width
      const y = 290 + Math.random() * 350
      ctx.strokeStyle = `rgba(${48 + (i % 4) * 18}, ${74 + (i % 5) * 14}, ${27 + (i % 3) * 12}, .28)`
      ctx.lineWidth = 8 + Math.random() * 25
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + (Math.random() - .5) * 135, y - 50 - Math.random() * 120)
      ctx.stroke()
    }
    ctx.fillStyle = '#4a321f'
    ctx.fillRect(445, 175, 58, 290)
    for (let i = 0; i < 36; i++) {
      const a = (i / 36) * Math.PI * 2
      const r = 105 + Math.sin(i * 4.7) * 35
      ctx.fillStyle = i % 3 ? '#49632f' : '#607a35'
      ctx.beginPath()
      ctx.arc(474 + Math.cos(a) * r, 207 + Math.sin(a) * r * .65, 44 + (i % 5) * 7, 0, Math.PI * 2)
      ctx.fill()
    }
    for (let i = 0; i < 10; i++) {
      ctx.fillStyle = '#d7523d'
      ctx.beginPath()
      ctx.arc(385 + (i % 5) * 46, 145 + Math.floor(i / 5) * 75 + (i % 2) * 16, 14, 0, Math.PI * 2)
      ctx.fill()
    }
    const posterTexture = new THREE.CanvasTexture(poster)
    posterTexture.colorSpace = THREE.SRGBColorSpace
    return { url: mask.toDataURL('image/png'), maskTexture, posterTexture }
  }, [])
}

// The painting: the live scene iframe as a plain rectangle filling the splash
// plane, hung as a canvas in the manga room. `live` gates the heavy WebGL scene
// iframe - while the landing's own fullscreen scene is running we show the light
// poster instead, so two full scenes never run at once (Chrome kills the GPU
// process under that combined load).
// Chunky TV static drawn into a canvas, sized to fill the painting. Holds full,
// then fades - the envelope covers the landing->stage handoff and clears as the
// camera zooms out. Lives inside the painting's drei Html, so ONLY the screen
// scrambles (not the monkey or the room).
function FuzzCanvas({ w, h, fuzzRef }) {
  const ref = useRef(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return undefined
    const ctx = canvas.getContext('2d')
    const lw = Math.max(2, Math.floor(w / 8))
    const lh = Math.max(2, Math.floor(h / 8))
    canvas.width = lw
    canvas.height = lh
    let raf = 0
    const step = () => {
      // Opacity is driven by the camera intro (shared ref) so the static and the
      // zoom-out are always in lockstep, even on a slow cold load.
      const op = fuzzRef.current?.opacity ?? 0
      if (op > 0.01) {
        const img = ctx.createImageData(lw, lh)
        const d = img.data
        for (let i = 0; i < d.length; i += 4) {
          const v = (Math.random() * 255) | 0
          d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255
        }
        ctx.putImageData(img, 0, 0)
      }
      canvas.style.opacity = String(op)
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [w, h, fuzzRef])
  return <canvas ref={ref} style={{ width: '100%', height: '100%', display: 'block', imageRendering: 'pixelated' }} />
}

// A source image drawn into a small canvas then upscaled with nearest-neighbour,
// so it reads as chunky pixels (same look as the fuzz). Used for the POMME screen
// shown inside one of the nav monitors.
function PixelScreen({ src, cols = 84 }) {
  const ref = useRef(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return undefined
    const img = new Image()
    let live = true
    img.onload = () => {
      if (!live) return
      const rows = Math.max(1, Math.round(cols * (img.naturalHeight / img.naturalWidth)))
      canvas.width = cols
      canvas.height = rows
      const ctx = canvas.getContext('2d')
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(img, 0, 0, cols, rows)
    }
    img.src = src
    return () => { live = false }
  }, [src, cols])
  return (
    <canvas
      ref={ref}
      style={{ width: '100%', height: '100%', display: 'block', imageRendering: 'pixelated', objectFit: 'cover' }}
    />
  )
}

// The POMME screen: a STATIC snapshot of the painterly scene shown as a color
// DOM <img> (so the manga B&W pass leaves it alone), hung as a bare painting.
// The CRT-TV body is removed for now. No live iframe/WebGL scene, so it is light
// and never lags. The fuzz sits on top.
function Splash({ bind, fuzzRef }) {
  const pixelWidth = 1280
  const pixelHeight = Math.round(pixelWidth * (SPLASH.h / SPLASH.w))
  const distanceFactor = (SPLASH.w * 400) / pixelWidth
  return (
    <group name="painting" position={SPLASH.pos} rotation={SPLASH.rot} scale={SPLASH.scale} {...bind}>
      {/* TV body removed for now - the painting hangs on its own. */}
      {/* transparent drag/select target sized to the screen (bubbles to bind) */}
      <mesh position={[0, 0, 0]}>
        <planeGeometry args={[SPLASH.w, SPLASH.h]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {/* static color screen - pinned z-index BELOW the fuzz */}
      <Html
        transform
        distanceFactor={distanceFactor}
        position={[0, 0, 0.01]}
        pointerEvents="none"
        zIndexRange={[100, 100]}
        style={{ width: `${pixelWidth}px`, height: `${pixelHeight}px`, pointerEvents: 'none' }}
      >
        <PixelScreen src="/assets/pomme-screen.jpg" cols={120} />
      </Html>
      {/* screen fuzz - pinned ABOVE the screen so it is actually visible */}
      {fuzzRef && (
        <Html
          transform
          distanceFactor={distanceFactor}
          position={[0, 0, 0.02]}
          pointerEvents="none"
          zIndexRange={[200, 200]}
          style={{ width: `${pixelWidth}px`, height: `${pixelHeight}px`, pointerEvents: 'none' }}
        >
          <FuzzCanvas w={pixelWidth} h={pixelHeight} fuzzRef={fuzzRef} />
        </Html>
      )}
    </group>
  )
}

// Single Meshy-generated, rigged full-body character using the Suzanne face.
function Monkey({ bind, poseRef, mimic, mirror }) {
  const { scene, animations } = useGLTF(SUZANNE_FULLBODY_URL)
  const fit = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene)
    const size = new THREE.Vector3()
    box.getSize(size)
    const s = 2.4 / (size.y || 1)
    return {
      s,
      pos: [
        -((box.min.x + box.max.x) / 2) * s,
        -box.min.y * s,
        -((box.min.z + box.max.z) / 2) * s,
      ],
    }
  }, [scene])

  // Play the GLB's OWN authored clip on loop - it was made for this exact mesh,
  // so it can't break the skinning the way a hand-synthesized retarget did
  // (hands snapping to the knees). Mimic mode stops it and drives bones instead.
  const rig = useMemo(() => buildRig(scene), [scene])
  const clipRoot = useRef(null)
  const { actions, names } = useAnimations(animations, clipRoot)
  // Forcing a full T-pose stretches this rig's mesh (its skin weights can't take
  // that much arm rotation). So leave the monkey in its clean authored pose and
  // play its own idle clip; mimic mode still drives the bones live.
  useEffect(() => {
    const action = names.length ? actions[names[0]] : null
    if (!action) return undefined
    if (mimic) {
      action.stop()
    } else {
      action.reset().setLoop(THREE.LoopRepeat, Infinity).play()
      action.timeScale = 0.85
    }
    return () => action?.stop()
  }, [actions, names, mimic])

  // Idle-animation wrapper: separate from the draggable outer group so the bob
  // rides ON TOP of wherever the operator places the monkey.
  const idleRef = useRef(null)
  useFrame((state) => {
    if (mimic && rig.ok) {
      const world = poseRef.current
      if (world) applyPose(rig, world, { mirror })
    }
    // gentle breathing bob + weight-shift sway
    const g = idleRef.current
    if (g && !mimic) {
      const t = state.clock.elapsedTime
      g.position.y = Math.sin(t * 1.6) * 0.045
      g.rotation.z = Math.sin(t * 0.9) * 0.02
    } else if (g) {
      g.position.y = 0
      g.rotation.z = 0
    }
  })

  return (
    <group name="monkey" position={MONKEY_POS} {...bind}>
      <group ref={idleRef}>
        <group ref={clipRoot} scale={fit.s} position={fit.pos}>
          <primitive object={scene} />
        </group>
      </group>
    </group>
  )
}

// Arrival zoom-out. On the handoff (playIntro) the camera starts framing the
// painting near-fullscreen - the scramble overlay clears to this first orchard
// frame - then eases back to CAM_HOME, zooming out to reveal the monkey.
// Direct /stage visits pass playIntro=false and open in the settled pose.
const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3)

function CameraIntro({ active, fuzzRef }) {
  const { camera, size } = useThree()
  const started = useRef(false)
  const done = useRef(false)
  const t = useRef(0)
  const pose = useRef(null)
  // Hold on the full painting while the scramble clears, THEN zoom out.
  const DELAY = 0.7
  const DURATION = 1.6

  // Start pose: the camera position that frames the (scaled) painting so it
  // COVERS the whole viewport - the fuzzed screen reads as a full-screen fuzz.
  const startPos = useMemo(() => {
    const center = new THREE.Vector3(...SPLASH.pos)
    const normal = new THREE.Vector3(0, 0, 1)
      .applyEuler(new THREE.Euler(...SPLASH.rot))
      .normalize()
    const fovY = THREE.MathUtils.degToRad(32)
    const aspect = (size.width || 1) / (size.height || 1)
    const sx = SPLASH.scale?.[0] ?? 1
    const sy = SPLASH.scale?.[1] ?? 1
    const fitH = (SPLASH.h * sy / 2) / Math.tan(fovY / 2)
    const fitW = (SPLASH.w * sx / 2) / (Math.tan(fovY / 2) * aspect)
    const dist = Math.min(fitH, fitW) * 0.72
    return { center, pos: center.clone().add(normal.multiplyScalar(dist)) }
  }, [size.width, size.height])

  useFrame((_, delta) => {
    if (!active || done.current) return
    if (!started.current) {
      started.current = true
      t.current = 0
      // Capture the SETTLED pose straight off the camera (its current, untouched
      // position/orientation) so the pull-back lands exactly on the normal
      // stage framing - no guessing where the default camera looks.
      const homePos = camera.position.clone()
      const homeQuat = camera.quaternion.clone()
      const m = new THREE.Matrix4().lookAt(startPos.pos, startPos.center, camera.up)
      const startQuat = new THREE.Quaternion().setFromRotationMatrix(m)
      pose.current = { homePos, homeQuat, startQuat }
    }
    // Clamp: the first frame after the heavy scene load can carry a multi-second
    // delta, which would jump straight to the end (the "teleport"). Cap it so the
    // pull-back always plays out smoothly.
    t.current += Math.min(delta, 0.05)
    const p = Math.min(Math.max(t.current - DELAY, 0) / DURATION, 1)
    const e = easeOutCubic(p)
    const s = pose.current
    camera.position.lerpVectors(startPos.pos, s.homePos, e)
    camera.quaternion.slerpQuaternions(s.startQuat, s.homeQuat, e)
    // Drive the on-screen fuzz: full while the painting fills the viewport (the
    // hold), then fade out over the first second of the pull-back.
    if (fuzzRef) {
      const fop = t.current < DELAY ? 1 : Math.max(0, 1 - (t.current - DELAY) / 1.0)
      fuzzRef.current.opacity = fop
    }
    if (p >= 1) { done.current = true; if (fuzzRef) fuzzRef.current.opacity = 0 }
  })

  return null
}

// Live transform sliders for the selected object (painting or monkey). Values
// are written straight onto the THREE object and read back each frame via refs
// (no React re-render), so it stays cheap and mirrors dragging in real time.
const SLIDER_ROWS = [
  ['pos x', 'position', 'x', -8, 8, 0.01],
  ['pos y', 'position', 'y', -6, 8, 0.01],
  ['pos z', 'position', 'z', -8, 8, 0.01],
  ['rot x', 'rotation', 'x', -Math.PI, Math.PI, 0.005],
  ['rot y', 'rotation', 'y', -Math.PI, Math.PI, 0.005],
  ['rot z', 'rotation', 'z', -Math.PI, Math.PI, 0.005],
  ['scale', 'scale', 'uniform', 0.05, 5, 0.01],
]

function TransformSliders({ selected, getAll }) {
  const inputs = useRef([])
  const outs = useRef([])
  const editing = useRef(false)

  useEffect(() => {
    let raf
    const tick = () => {
      if (selected && !editing.current) {
        for (let i = 0; i < SLIDER_ROWS.length; i++) {
          const [, prop, axis] = SLIDER_ROWS[i]
          const v = axis === 'uniform' ? selected[prop].x : selected[prop][axis]
          const inp = inputs.current[i]
          const out = outs.current[i]
          if (inp && document.activeElement !== inp) inp.value = String(v)
          if (out) out.textContent = v.toFixed(2)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [selected])

  if (!selected) return null

  const onInput = (i) => (e) => {
    const [, prop, axis] = SLIDER_ROWS[i]
    const v = parseFloat(e.target.value)
    if (prop === 'scale' && axis === 'uniform') selected.scale.set(v, v, v)
    else selected[prop][axis] = v
    if (outs.current[i]) outs.current[i].textContent = v.toFixed(2)
  }

  const writeClip = (e, text, done, revert) => {
    navigator.clipboard?.writeText(text).then(
      () => { e.target.textContent = done },
      () => { e.target.textContent = 'copy failed' },
    )
    setTimeout(() => { if (e.target) e.target.textContent = revert }, 1200)
  }

  const copyAll = (e) => {
    const text = getAll?.()
    if (!text) return
    writeClip(e, text, 'copied all', 'copy all')
  }

  const copyValues = (e) => {
    const r = (n) => Number(n.toFixed(3))
    const p = selected.position, rot = selected.rotation, s = selected.scale
    const text =
      `pos: [${r(p.x)}, ${r(p.y)}, ${r(p.z)}], ` +
      `rot: [${r(rot.x)}, ${r(rot.y)}, ${r(rot.z)}], ` +
      `scale: [${r(s.x)}, ${r(s.y)}, ${r(s.z)}]`
    writeClip(e, text, 'copied', 'copy this')
  }

  return (
    <div className="stage-sliders">
      <div className="stage-sliders-head">{selected.name || 'selected'} transform</div>
      {SLIDER_ROWS.map(([label, , , min, max, step], i) => (
        <label className="slider-row" key={label}>
          <span className="slider-label">{label}</span>
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            ref={(el) => { inputs.current[i] = el }}
            onPointerDown={() => { editing.current = true }}
            onPointerUp={() => { editing.current = false }}
            onPointerCancel={() => { editing.current = false }}
            onInput={onInput(i)}
          />
          <output ref={(el) => { outs.current[i] = el }} className="slider-out" />
        </label>
      ))}
      <div className="stage-sliders-copyrow">
        <button className="stage-sliders-copy" onClick={copyAll}>copy all</button>
        <button className="stage-sliders-copy stage-sliders-copy-alt" onClick={copyValues}>copy this</button>
      </div>
    </div>
  )
}

// Backdrop spotlights aimed at the lab equipment behind the monkey. The back of
// the room is otherwise unlit (ambient is deliberately low for the foreground),
// so these carry the backdrop. They "power on": intensity ramps from black once
// the stage is active (synced to the camera pull-back), then holds with a gentle
// out-of-phase shimmer so the equipment reads as live/humming.
//
// Config arrays are MODULE-STABLE references so r3f never re-applies the
// position/target props on re-render - that is what lets a dragged/slider-moved
// light KEEP its new spot (same trick the placed props use). Turn on the
// "lights" toolbar toggle to reveal draggable handles and edit them like any
// other stage object; the intensity is scaled live by the "bg light" slider.
const BACKDROP_LIGHTS = [
  { key: 'bl-L', name: 'back light L', pos: [-2.8, 3.8, 2.6], target: [-0.5, 0.1, -1.9], color: '#e7edff', max: 42, angle: 0.6, distance: 20, phase: 1 },
  { key: 'bl-R', name: 'back light R', pos: [2.8, 3.8, 2.6], target: [0.5, 0.1, -1.9], color: '#fff0d6', max: 38, angle: 0.6, distance: 20, phase: -1 },
]

// Build the live, mutable light params from the static config. The lighting
// panel writes into this each frame BackdropLights reads it, so every knob
// (intensity / angle / penumbra / distance / aim) updates in real time with no
// React re-render. Position is edited separately by dragging the handle.
function makeLightState() {
  return BACKDROP_LIGHTS.map((l) => ({
    intensity: l.max,
    angle: l.angle ?? 1.1,
    penumbra: l.penumbra ?? 0.9,
    distance: l.distance ?? 32,
    target: [...l.target],
  }))
}

function BackLight({ cfg, edit, bind, lightRef, target }) {
  return (
    <>
      <primitive object={target} />
      <group name={cfg.name} position={cfg.pos} {...(edit ? bind : {})}>
        <spotLight ref={lightRef} target={target} intensity={0} decay={2} color={cfg.color} />
        {/* Draggable handle - only shown/clickable while editing lights. */}
        {edit && (
          <mesh>
            <sphereGeometry args={[0.17, 16, 16]} />
            <meshBasicMaterial color={cfg.color} toneMapped={false} />
          </mesh>
        )}
      </group>
    </>
  )
}

function BackdropLights({ active, gainRef, edit, bind, stateRef }) {
  const lightRefs = useRef([])
  const targets = useMemo(() => BACKDROP_LIGHTS.map(() => new THREE.Object3D()), [])
  const t = useRef(0)
  const DELAY = 0.5
  const DURATION = 1.8
  useFrame((state, delta) => {
    if (active) t.current = Math.min(t.current + delta, DELAY + DURATION + 1)
    const ramp = easeOutCubic(Math.min(Math.max(t.current - DELAY, 0) / DURATION, 1))
    const gain = gainRef?.current ?? 1
    const s = Math.sin(state.clock.elapsedTime * 4.5)
    const params = stateRef.current
    for (let i = 0; i < BACKDROP_LIGHTS.length; i++) {
      const l = lightRefs.current[i]
      const p = params[i]
      if (l && p) {
        l.intensity = p.intensity * ramp * gain * (0.93 + 0.07 * s * BACKDROP_LIGHTS[i].phase)
        l.angle = p.angle
        l.penumbra = p.penumbra
        l.distance = p.distance
      }
      targets[i].position.set(p.target[0], p.target[1], p.target[2])
    }
  })
  return BACKDROP_LIGHTS.map((cfg, i) => (
    <BackLight
      key={cfg.key}
      cfg={cfg}
      edit={edit}
      bind={bind}
      target={targets[i]}
      lightRef={(el) => { lightRefs.current[i] = el }}
    />
  ))
}

// Full manual control of the backdrop lights: per-light sliders for intensity,
// cone angle, penumbra, distance, and aim (target x/y/z). Writes straight into
// the shared params ref (no re-render). Position is set by dragging the handle.
const LIGHT_ROWS = [
  ['intensity', 'intensity', 0, 400, 1],
  ['angle', 'angle', 0.1, 1.4, 0.01],
  ['penumbra', 'penumbra', 0, 1, 0.01],
  ['distance', 'distance', 4, 60, 0.5],
]
function LightPanel({ stateRef }) {
  const setVal = (i, key, v) => { stateRef.current[i][key] = v }
  const setAim = (i, axis, v) => { stateRef.current[i].target[axis] = v }
  const copy = (e) => {
    const r = (n) => Number(n.toFixed(3))
    const text = stateRef.current
      .map((p, i) => `${BACKDROP_LIGHTS[i].name}: intensity ${r(p.intensity)}, angle ${r(p.angle)}, penumbra ${r(p.penumbra)}, distance ${r(p.distance)}, aim [${p.target.map(r).join(', ')}]`)
      .join('\n')
    navigator.clipboard?.writeText(text).then(
      () => { e.target.textContent = 'copied' },
      () => { e.target.textContent = 'copy failed' },
    )
    setTimeout(() => { if (e.target) e.target.textContent = 'copy values' }, 1200)
  }
  return (
    <div className="stage-lights">
      <div className="stage-lights-title">Backdrop lights</div>
      {BACKDROP_LIGHTS.map((cfg, i) => (
        <div className="stage-lights-group" key={cfg.key}>
          <div className="stage-lights-head">{cfg.name}</div>
          {LIGHT_ROWS.map(([label, key, min, max, step]) => (
            <label className="slider-row" key={label}>
              <span className="slider-label">{label}</span>
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                defaultValue={stateRef.current[i][key]}
                onInput={(e) => setVal(i, key, parseFloat(e.target.value))}
              />
            </label>
          ))}
          {['x', 'y', 'z'].map((axis, ai) => (
            <label className="slider-row" key={`aim-${axis}`}>
              <span className="slider-label">aim {axis}</span>
              <input
                type="range"
                min={-6}
                max={6}
                step={0.05}
                defaultValue={stateRef.current[i].target[ai]}
                onInput={(e) => setAim(i, ai, parseFloat(e.target.value))}
              />
            </label>
          ))}
        </div>
      ))}
      <button className="stage-sliders-copy" onClick={copy}>copy values</button>
    </div>
  )
}

function MangaRender() {
  const { gl, scene, camera, size } = useThree()
  const pass = useMemo(() => new MangaPass(gl, { grit: 0.75, ink: 0.04 }), [gl])
  const sized = useRef('')
  const key = `${size.width}x${size.height}`
  if (sized.current !== key) {
    sized.current = key
    const dpr = gl.getPixelRatio()
    pass.setSize(size.width * dpr, size.height * dpr)
  }
  useFrame(() => pass.render(scene, camera), 1)
  return null
}

// ------- 3D TV nav -------
// The page nav lives IN the scene as tv.glb monitors so the MangaPass ink shader
// styles them like everything else. They fan on an arc above the monkey; the
// colour-coded page label is a DOM billboard (drei Html) so it stays legible and
// coloured on top of the B&W manga TV body. All placement is tunable here.
const TV_URL = '/assets/tv-monitor.glb' // tv.glb with the stand geometry removed
const NAV_TVS = [
  { to: '/stage', label: 'Stage', color: '#ffcf3f', screen: '/assets/pomme-screen.jpg' },
  { to: '/pov', label: 'Robot POV', color: '#7cd4ff' },
  { to: '/teleop', label: 'Teleop', color: '#ff8fbf' },
  { to: '/lidar', label: 'Lidar', color: '#86e6a0' },
  { to: '/analytics', label: 'Analytics', color: '#c3a2ff' },
]
// The whole stage sits around y = -1.7 (see DEFAULT_PLACEMENT), so the arc lives
// just above the monkey's head, not up near y = 2.
const TV_ARC = {
  center: [0, 0.95, 0.4], // dome centre above the monkey (world units)
  radius: 3.6,
  spreadDeg: 74, // total fan angle across all TVs
  dome: 0.4, // how far the side TVs drop below the centre one
  yaw: 0.3, // how much each TV turns to follow the arc (0 = all face camera)
  size: 0.9, // target TV height in world units (auto-fit)
  faceY: 0, // base yaw; flip by Math.PI if the TVs show their backs
  labelZ: 0.28, // label offset out from the TV centre toward the screen
  labelScale: 5, // drei Html distanceFactor (smaller = smaller label)
  screenZ: 0.11, // POMME screen offset onto the monitor face (local units)
  screenScale: 3.4, // drei Html distanceFactor for the on-monitor screen
  screenPx: [200, 128], // screen DOM size (px) - aspect roughly matches the panel
}

function StageTV({ label, color, to, screen, position, rotation, scale, labelZ, bind, navigate, edit }) {
  const { scene } = useGLTF(TV_URL)
  const model = useMemo(() => {
    const clone = scene.clone(true)
    // tv-monitor.glb is already stand-free; just brighten it so the monitor reads
    // white through the manga pass (its own texture is dark = pitch black otherwise).
    clone.traverse((o) => {
      if (!o.isMesh || !o.material) return
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      mats.forEach((m) => {
        m.emissive = new THREE.Color(0xcfcfcf)
        m.emissiveMap = null
        m.emissiveIntensity = 1
        m.color = new THREE.Color(0xffffff)
        m.needsUpdate = true
      })
    })
    // Recentre the monitor on the group origin.
    const box = new THREE.Box3().setFromObject(clone)
    const centre = new THREE.Vector3()
    box.getCenter(centre)
    clone.position.sub(centre)
    return clone
  }, [scene])
  const groupRef = useRef(null)
  const [hover, setHover] = useState(false)
  // Set the starting transform imperatively ONCE. After this the group is driven
  // by the drag handlers (bind) so hand-placing a TV sticks - a controlled
  // position prop would snap it back to the arc on every re-render.
  useEffect(() => {
    const g = groupRef.current
    if (!g) return
    g.position.set(position[0], position[1], position[2])
    g.rotation.set(rotation[0], rotation[1], rotation[2])
    g.scale.setScalar(scale)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // In edit mode the TV is a draggable/selectable object (bind, no navigation) so
  // you can position it; otherwise it is a nav button (click = go to the page).
  const handlers = edit
    ? { ...bind }
    : { onClick: (event) => { event.stopPropagation(); navigate(to) } }
  return (
    <group
      ref={groupRef}
      {...handlers}
      onPointerOver={(event) => { event.stopPropagation(); setHover(true) }}
      onPointerOut={() => setHover(false)}
    >
      <primitive object={model} scale={hover ? 1.06 : 1} />
      {screen ? (
        // Pixelated POMME on this monitor's screen face (DOM so it keeps colour).
        <Html
          center
          transform
          position={[0, 0, TV_ARC.screenZ]}
          distanceFactor={TV_ARC.screenScale}
          pointerEvents="none"
          style={{ width: `${TV_ARC.screenPx[0]}px`, height: `${TV_ARC.screenPx[1]}px`, pointerEvents: 'none' }}
        >
          <PixelScreen src={screen} />
        </Html>
      ) : (
        <Html center position={[0, 0, labelZ]} distanceFactor={TV_ARC.labelScale} pointerEvents="none">
          <span
            className="tv3d-label"
            style={{ color, textShadow: `0 0 12px ${color}, 0 0 4px ${color}` }}
          >
            {label}
          </span>
        </Html>
      )}
    </group>
  )
}

function StageTVNav({ bind, navigate, edit }) {
  const { scene } = useGLTF(TV_URL)
  const fit = useMemo(() => {
    const box = new THREE.Box3().setFromObject(scene)
    const size = new THREE.Vector3()
    box.getSize(size)
    return TV_ARC.size / (size.y || 1)
  }, [scene])
  const items = useMemo(() => {
    const n = NAV_TVS.length
    const spread = THREE.MathUtils.degToRad(TV_ARC.spreadDeg)
    return NAV_TVS.map((tv, i) => {
      const a = -spread / 2 + (n === 1 ? 0 : (i * spread) / (n - 1))
      const x = TV_ARC.center[0] + Math.sin(a) * TV_ARC.radius
      const y = TV_ARC.center[1] - (1 - Math.cos(a)) * TV_ARC.radius * TV_ARC.dome
      return {
        ...tv,
        position: [x, y, TV_ARC.center[2]],
        rotation: [0, TV_ARC.faceY - a * TV_ARC.yaw, 0],
      }
    })
  }, [])
  return (
    <group>
      {/* The nav sits above the stage spotlight, so give the TV arc its own light
          or the manga pass renders them near-black on the black ceiling. */}
      <pointLight position={[0, TV_ARC.center[1] + 0.6, TV_ARC.center[2] + 2.4]} intensity={38} distance={9} decay={2} />
      {items.map((it) => (
        <StageTV key={it.to} {...it} scale={fit} labelZ={TV_ARC.labelZ} bind={bind} navigate={navigate} edit={edit} />
      ))}
    </group>
  )
}

// edit: false = clean stage (TVs are nav buttons, no editor UI). 'tv' = position
// the nav TVs (they become draggable/selectable, props stay locked).
export default function MonkeyStage({ showNav = true, playIntro = false, liveScene = true, edit = false }) {
  const editTV = edit === 'tv'
  // Router context does not cross into the r3f Canvas, so resolve navigate here
  // (outside the Canvas) and hand it to the in-scene TV nav.
  const navigate = useNavigate()
  const spotTarget = useMemo(() => new THREE.Object3D(), [])
  // Shared handle so the camera intro drives the on-screen fuzz opacity.
  const fuzzRef = useRef({ opacity: 0 })
  // Live multiplier on the backdrop-spot intensity (the toolbar slider writes
  // here; BackdropLights reads it each frame, so no re-render while dragging).
  const bgGain = useRef(1)
  // When on, the backdrop lights show draggable handles + the lighting panel.
  const [lightsEdit, setLightsEdit] = useState(false)
  // Live, mutable per-light params (intensity/angle/penumbra/distance/aim) the
  // panel writes and BackdropLights reads each frame.
  const lightState = useRef(makeLightState())
  const splash = useSplash()
  const [sceneAvailable, setSceneAvailable] = useState(false)
  const [selected, setSelected] = useState(null)
  const [transformMode, setTransformMode] = useState('translate')
  // Mimic mode: the monkey copies the operator's body via the webcam pose.
  const [mimic, setMimic] = useState(false)
  const [mirror, setMirror] = useState(true)
  const poseRef = useRef(null)

  // Placeable lab props. `placed` only tracks WHICH props exist (add / place /
  // delete); their live transform is mutated straight on the THREE object by
  // the same drag / slider / keyboard rig the monkey uses, so no re-render
  // happens while arranging. groups maps id -> live group for delete/duplicate.
  const [placed, setPlaced] = useState(DEFAULT_PLACEMENT)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const propCounter = useRef(0)
  const pendingSelect = useRef(null)
  const groups = useRef(new Map())

  const onPropReady = useCallback((id, group) => {
    groups.current.set(id, group)
    if (pendingSelect.current === id) {
      pendingSelect.current = null
      setSelected(group)
    }
  }, [])

  const addProp = useCallback((catalogId) => {
    const id = `u-${catalogId}-${(propCounter.current += 1)}`
    setPlaced((prev) => {
      // Spawn in front of the monkey, fanned out so repeats do not stack.
      const x = ((prev.length % 5) - 2) * 0.7
      return [...prev, { id, catalogId, position: [x, FLOOR, 1.55], rotation: [0, 0, 0] }]
    })
    pendingSelect.current = id
  }, [])

  const duplicateSelected = useCallback(() => {
    const src = selected
    const catalogId = src?.userData?.catalogId
    if (!catalogId) return
    const id = `u-${catalogId}-${(propCounter.current += 1)}`
    const p = src.position, r = src.rotation, s = src.scale
    setPlaced((prev) => [...prev, {
      id,
      catalogId,
      position: [p.x + 0.5, p.y, p.z],
      rotation: [r.x, r.y, r.z],
      scale: [s.x, s.y, s.z],
    }])
    pendingSelect.current = id
  }, [selected])

  const deleteSelected = useCallback(() => {
    const id = selected?.userData?.instanceId
    if (!id) return
    groups.current.delete(id)
    setPlaced((prev) => prev.filter((inst) => inst.id !== id))
    setSelected(null)
  }, [selected])

  const isProp = Boolean(selected?.userData?.instanceId)

  // Serialize EVERY placed prop's live transform into a paste-ready
  // DEFAULT_PLACEMENT (read straight off each group so it reflects what you
  // dragged, not the seed). This is what the sliders panel's "copy all" emits;
  // paste it back into src/lib/stageProps.js to make the arrangement the default.
  const serializeAll = useCallback(() => {
    const r = (n) => Number(n.toFixed(3))
    const rows = placed.map((inst) => {
      const g = groups.current.get(inst.id)
      const p = g ? g.position : { x: inst.position[0], y: inst.position[1], z: inst.position[2] }
      const rot = g ? g.rotation : { x: inst.rotation?.[0] ?? 0, y: inst.rotation?.[1] ?? 0, z: inst.rotation?.[2] ?? 0 }
      const s = g ? g.scale : { x: 1, y: 1, z: 1 }
      const uniform1 = r(s.x) === 1 && r(s.y) === 1 && r(s.z) === 1
      const scalePart = uniform1 ? '' : `, scale: [${r(s.x)}, ${r(s.y)}, ${r(s.z)}]`
      return `  { id: '${inst.id}', catalogId: '${inst.catalogId}', position: [${r(p.x)}, ${r(p.y)}, ${r(p.z)}], rotation: [${r(rot.x)}, ${r(rot.y)}, ${r(rot.z)}]${scalePart} },`
    })
    return `export const DEFAULT_PLACEMENT = [\n${rows.join('\n')}\n]`
  }, [placed])

  // Direct pointer dragging. The manga post-process renders any TransformControls
  // gizmo as unusable ink, so instead each draggable object is grabbed and slid
  // along a plane that faces the fixed camera at the object's depth. r3f
  // object-level pointer capture keeps move/up flowing even off the object.
  const dragRef = useRef(null)
  const bind = useMemo(() => ({
    onPointerDown(event) {
      event.stopPropagation()
      const obj = event.eventObject
      setSelected(obj)
      event.target.setPointerCapture(event.pointerId)
      const worldPos = obj.getWorldPosition(new THREE.Vector3())
      const normal = event.camera.getWorldDirection(new THREE.Vector3())
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, worldPos)
      const grab = new THREE.Vector3()
      event.ray.intersectPlane(plane, grab)
      dragRef.current = { obj, plane, offset: worldPos.sub(grab) }
    },
    onPointerMove(event) {
      const drag = dragRef.current
      if (!drag) return
      event.stopPropagation()
      const hit = new THREE.Vector3()
      if (!event.ray.intersectPlane(drag.plane, hit)) return
      hit.add(drag.offset)
      if (drag.obj.parent) drag.obj.parent.worldToLocal(hit)
      drag.obj.position.copy(hit)
    },
    onPointerUp(event) {
      if (!dragRef.current) return
      event.stopPropagation()
      dragRef.current = null
      event.target.releasePointerCapture(event.pointerId)
    },
  }), [])

  useEffect(() => {
    let live = true
    fetch('/scene/index.html', { cache: 'no-store' })
      .then((r) => (r.ok ? r.text() : ''))
      .then((html) => {
        if (live) setSceneAvailable(html.includes('id="gl"') && !html.includes('id="root"'))
      })
      .catch(() => {})
    return () => { live = false }
  }, [])

  useEffect(() => {
    const onKey = (event) => {
      const tag = event.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      const key = event.key.toLowerCase()
      if (key === 'w' || key === 'e' || key === 'r') {
        setTransformMode(key === 'w' ? 'translate' : key === 'e' ? 'rotate' : 'scale')
        return
      }
      if ((key === 'delete' || key === 'backspace') && selected?.userData?.instanceId) {
        deleteSelected()
        event.preventDefault()
        return
      }
      if (!selected) return
      const step = event.shiftKey ? 0.25 : 0.06
      const turn = event.shiftKey ? 0.18 : 0.045
      const scale = event.shiftKey ? 0.12 : 0.035
      let changed = true
      if (transformMode === 'translate') {
        if (key === 'arrowleft') selected.position.x -= step
        else if (key === 'arrowright') selected.position.x += step
        else if (key === 'arrowup') selected.position.y += step
        else if (key === 'arrowdown') selected.position.y -= step
        else if (key === '[') selected.position.z -= step
        else if (key === ']') selected.position.z += step
        else changed = false
      } else if (transformMode === 'rotate') {
        if (key === 'arrowleft') selected.rotation.y += turn
        else if (key === 'arrowright') selected.rotation.y -= turn
        else if (key === 'arrowup') selected.rotation.x += turn
        else if (key === 'arrowdown') selected.rotation.x -= turn
        else if (key === '[') selected.rotation.z -= turn
        else if (key === ']') selected.rotation.z += turn
        else changed = false
      } else if (transformMode === 'scale') {
        if (key === 'arrowup' || key === 'arrowright' || key === ']') selected.scale.multiplyScalar(1 + scale)
        else if (key === 'arrowdown' || key === 'arrowleft' || key === '[') selected.scale.multiplyScalar(1 - scale)
        else changed = false
      }
      if (changed) event.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, transformMode, deleteSelected])

  return (
    <div className="stage">
      <Canvas
        onPointerMissed={() => setSelected(null)}
        flat
        dpr={SAFE_DPR}
        camera={{ position: CAM_HOME, fov: 32, near: 0.1, far: 100 }}
        gl={{ antialias: true }}
      >
        <CanvasGuard />
        <color attach="background" args={['#0d0e12']} />
        <CameraIntro active={playIntro} fuzzRef={fuzzRef} />
        <ambientLight intensity={0.13} />
        <primitive object={spotTarget} position={[0, 1.1, 0.3]} />
        <group position={[2.4, 5.4, 3.6]}>
          <spotLight target={spotTarget} angle={0.6} penumbra={0.75} intensity={160} distance={24} decay={2} />
          <mesh>
            <sphereGeometry args={[0.1, 16, 16]} />
            <meshBasicMaterial color="#f4d7a1" />
          </mesh>
        </group>
        <group position={[0, 2.6, 2.4]}>
          <pointLight intensity={26} distance={10} decay={2} />
          <mesh>
            <sphereGeometry args={[0.08, 16, 16]} />
            <meshBasicMaterial color="#cddcff" />
          </mesh>
        </group>
        <BackdropLights active={playIntro} gainRef={bgGain} edit={editTV && lightsEdit} bind={bind} stateRef={lightState} />
        {/* Room backdrop: a wall behind everything so the void is a lit surface,
            not a flat black clear. A light matte material catches the ambient +
            backdrop spots; the manga pass then shades it into paper / tone bands
            (with the spot pools whitening it) instead of pure ink. A small
            emissive lift keeps it off pure black even where unlit. */}
        <mesh position={[0, 1.4, -4.3]}>
          <planeGeometry args={[30, 18]} />
          <meshStandardMaterial color="#c8c8c2" roughness={1} emissive="#343432" emissiveIntensity={1} />
        </mesh>
        <Suspense fallback={null}>
          <Splash bind={bind} fuzzRef={fuzzRef} />
          <Monkey bind={bind} poseRef={poseRef} mimic={mimic} mirror={mirror} />
          {showNav && <StageTVNav bind={bind} navigate={navigate} edit={editTV} />}
        </Suspense>
        {placed.map((inst) => {
          const catalog = CATALOG_BY_ID[inst.catalogId]
          if (!catalog) return null
          return (
            <PropBoundary key={inst.id}>
              <Suspense fallback={null}>
                {/* Props are locked scenery here - only the TVs are positionable. */}
                <StageProp inst={inst} catalog={catalog} bind={undefined} onReady={onPropReady} />
              </Suspense>
            </PropBoundary>
          )
        })}
        <MangaRender />
      </Canvas>
      {/* Editor UI only in the TV-positioning route; the plain /stage is clean. */}
      {editTV && (
        <div className="stage-editor" role="toolbar" aria-label="Position the TVs">
          <span>Drag a TV to move · W/E/R + arrows to fine-tune · COPY THIS for its coords</span>
          {['translate', 'rotate', 'scale'].map((m) => (
            <button key={m} className={transformMode === m ? 'is-active' : ''} onClick={() => setTransformMode(m)}>
              {m}
            </button>
          ))}
          <label className="stage-editor-slider" title="Backdrop light intensity (global)">
            bg light
            <input
              type="range"
              min="0"
              max="3"
              step="0.05"
              defaultValue="1"
              onInput={(e) => { bgGain.current = parseFloat(e.target.value) }}
            />
          </label>
          <button className={lightsEdit ? 'is-active' : ''} onClick={() => setLightsEdit((v) => !v)}>
            lights
          </button>
        </div>
      )}
      {editTV && lightsEdit && <LightPanel stateRef={lightState} />}
      {/* Mimic control stays on the clean stage - it is a feature, not editing. */}
      <div className="stage-editor stage-editor--mimic">
        <button className={mimic ? 'is-active' : ''} onClick={() => setMimic((v) => !v)}>
          {mimic ? 'stop mimic' : 'mimic me'}
        </button>
        {mimic && (
          <button className={mirror ? 'is-active' : ''} onClick={() => setMirror((v) => !v)}>
            mirror
          </button>
        )}
      </div>
      {mimic && (
        <Suspense fallback={null}>
          <MimicCam poseRef={poseRef} mirror={mirror} />
        </Suspense>
      )}
      {editTV && <TransformSliders selected={selected} />}
    </div>
  )
}

useGLTF.preload(SUZANNE_FULLBODY_URL)
useGLTF.preload(TV_URL)
