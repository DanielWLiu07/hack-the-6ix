// MonkeyStage - the "monkey page". The landing scene lives here NOT as a TV
// rectangle but as an amorphous painted SPLASH (a watercolor-masked iframe)
// floating in a dark manga room, a smooth full-body Suzanne character lit beside it.
// Arriving from the landing, the splash fills the viewport (mirroring the scene
// the user just left) then the camera eases back and it settles as a hanging
// painting. Direct visits skip to the settled state. Fully orbit-controllable.

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { MangaPass } from '../lib/mangaPass.js'
import SiteNav from '../components/SiteNav.jsx'
import '../App.css'

const SUZANNE_FULLBODY_URL = '/assets/suzanne-fullbody-rigged.glb'
// the painted splash: a wide floating plane, hung upper-left like a canvas
const SPLASH = { w: 2.95, h: 1.85, pos: [-1.35, 1.62, -0.4], rot: [0, 0.4, 0] }
const MONKEY_POS = [0, 0, 0.3]
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

// The painted splash: crisp scene iframe clipped to the blob, with a paper
// bleed halo (manga-shaded mesh) peeking around its torn edges.
function Splash({ splash, sceneAvailable, bind }) {
  const pixelWidth = 1280
  const pixelHeight = Math.round(pixelWidth * (SPLASH.h / SPLASH.w))
  const maskCss = {
    maskImage: `url(${splash.url})`,
    WebkitMaskImage: `url(${splash.url})`,
    maskSize: '100% 100%',
    WebkitMaskSize: '100% 100%',
    maskRepeat: 'no-repeat',
    WebkitMaskRepeat: 'no-repeat',
  }
  return (
    <group position={SPLASH.pos} rotation={SPLASH.rot} {...bind}>
      {/* paper bleed halo, slightly larger, behind the iframe */}
      <mesh position={[0, 0, -0.03]} scale={[1.13, 1.16, 1]}>
        <planeGeometry args={[SPLASH.w, SPLASH.h]} />
        <meshBasicMaterial
          color="#e8e3d3"
          map={splash.maskTexture}
          transparent
          depthWrite={false}
        />
      </mesh>
      {sceneAvailable ? (
        <Html
          transform
          distanceFactor={SPLASH.w / (1280 / 100)}
          position={[0, 0, 0.01]}
          style={{ width: `${pixelWidth}px`, height: `${pixelHeight}px`, pointerEvents: 'none', ...maskCss }}
        >
          <iframe
            src="/scene/index.html"
            title="Painterly landing scene"
            allow="autoplay; fullscreen; gamepad"
            style={{ width: '100%', height: '100%', border: 0, display: 'block', pointerEvents: 'none', ...maskCss }}
          />
        </Html>
      ) : (
        <mesh position={[0, 0, 0.01]}>
          <planeGeometry args={[SPLASH.w, SPLASH.h]} />
          <meshBasicMaterial map={splash.posterTexture} alphaMap={splash.maskTexture} transparent />
        </mesh>
      )}
    </group>
  )
}

// Single Meshy-generated, rigged full-body character using the Suzanne face.
function Monkey({ bind }) {
  const { scene } = useGLTF(SUZANNE_FULLBODY_URL)
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

  return (
    <group position={MONKEY_POS} {...bind}>
      <group scale={fit.s} position={fit.pos}>
        <primitive object={scene} />
      </group>
    </group>
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

export default function MonkeyStage({ showNav = true }) {
  const spotTarget = useMemo(() => new THREE.Object3D(), [])
  const splash = useSplash()
  const [sceneAvailable, setSceneAvailable] = useState(false)
  const [selected, setSelected] = useState(null)
  const [transformMode, setTransformMode] = useState('translate')

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
  }, [selected, transformMode])

  return (
    <div className="stage">
      <Canvas
        onPointerMissed={() => setSelected(null)}
        flat
        dpr={[1, 1.5]}
        camera={{ position: CAM_HOME, fov: 32, near: 0.1, far: 100 }}
        gl={{ antialias: true }}
      >
        <color attach="background" args={['#0d0e12']} />
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
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.35, 0]}>
          <planeGeometry args={[60, 60]} />
          <meshStandardMaterial color="#191a1f" roughness={1} />
        </mesh>
        <Suspense fallback={null}>
          <Splash splash={splash} sceneAvailable={sceneAvailable} bind={bind} />
          <Monkey bind={bind} />
        </Suspense>
        <MangaRender />
      </Canvas>
      <div className="stage-editor" role="toolbar" aria-label="Stage transforms">
        <span>Drag the monkey or painting to move · W/E/R + arrows to fine-tune</span>
        {['translate', 'rotate', 'scale'].map((mode) => (
          <button key={mode} className={transformMode === mode ? 'is-active' : ''} onClick={() => setTransformMode(mode)}>
            {mode}
          </button>
        ))}
      </div>
      {/* Painted after the Canvas so it is never hidden by the WebGL layer. */}
      {showNav && <SiteNav variant="stage" />}
    </div>
  )
}

useGLTF.preload(SUZANNE_FULLBODY_URL)
