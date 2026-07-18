// OrchardHero — painterly 3D landing backdrop (the end-goal hero).
// A flat, 2D-illustration orchard: tree.glb with apple.glb instances, lit
// softly, drifting slowly, run through the vendored anisotropic-Kuwahara
// post chain (src/vendor/painterly.js) for a hand-painted look.
//
// This renders ONLY the background. Hero copy/stats/CTA are overlaid by the
// caller (App.jsx) on a translucent panel.

import { Suspense, useLayoutEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGLTF, useProgress } from '@react-three/drei'
import * as THREE from 'three'
import { PainterlyPipeline } from '../vendor/painterly.js'

const TREE_URL = '/assets/tree.glb'
const APPLE_URL = '/assets/apple.glb'

// Scene tuning (spec)
const PAPER = '#dcd6c4'
const FOG = '#ccd5c8'
const TREE_H = 5 // normalized tree height (world units)
const APPLE_D = 0.3 // normalized apple diameter
const CAM0 = [5.2, 2.4, 6.9]
const LOOK = [0, 1.7, 0]

// Apples in the canopy (fractions of tree height) + a couple on the ground.
// [x, yFrac, z, bob] — bob=false for grounded fruit.
const APPLES = [
  [0.55, 0.74, 0.35, true],
  [-0.7, 0.68, 0.15, true],
  [0.2, 0.82, -0.55, true],
  [-0.35, 0.78, -0.6, true],
  [0.85, 0.6, -0.2, true],
  [-0.9, 0.58, -0.35, true],
  [0.1, 0.66, 0.7, true],
  [-0.15, 0.86, 0.25, true],
  [1.15, 0.0, 1.2, false], // ground
  [-1.35, 0.0, 0.6, false], // ground
]

// Flatten a loaded model's materials toward a matte illustration look and
// strip shadow casting (the painterly pass provides the "render", not PBR).
function flatten(obj) {
  obj.traverse((o) => {
    if (!o.isMesh) return
    o.castShadow = false
    o.receiveShadow = false
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    for (const m of mats) {
      if (!m) continue
      if ('metalness' in m) m.metalness = 0
      if ('roughness' in m) m.roughness = 1
      if ('envMapIntensity' in m) m.envMapIntensity = 0
      m.flatShading = false
      m.needsUpdate = true
    }
  })
}

// Scale/recenter a model so it is TREE_H tall (or APPLE_D wide) with its base
// at y=0 and centered on x/z — robust to the asset's authored scale.
function fitToHeight(model, targetH) {
  const box = new THREE.Box3().setFromObject(model)
  const size = new THREE.Vector3()
  box.getSize(size)
  const s = targetH / (size.y || 1)
  model.scale.setScalar(s)
  const box2 = new THREE.Box3().setFromObject(model)
  model.position.x -= (box2.min.x + box2.max.x) / 2
  model.position.z -= (box2.min.z + box2.max.z) / 2
  model.position.y -= box2.min.y
}

function Tree() {
  const { scene } = useGLTF(TREE_URL)
  const model = useMemo(() => scene.clone(true), [scene])
  useLayoutEffect(() => {
    fitToHeight(model, TREE_H)
    flatten(model)
  }, [model])
  return <primitive object={model} />
}

function Apples() {
  const { scene } = useGLTF(APPLE_URL)
  const groups = useRef([])

  // One shared, normalized apple; clone per instance (shares geometry).
  const base = useMemo(() => {
    const m = scene.clone(true)
    // normalize to APPLE_D using the largest horizontal extent
    const box = new THREE.Box3().setFromObject(m)
    const size = new THREE.Vector3()
    box.getSize(size)
    const s = APPLE_D / (Math.max(size.x, size.z) || 1)
    m.scale.setScalar(s)
    const box2 = new THREE.Box3().setFromObject(m)
    m.position.y -= (box2.min.y + box2.max.y) / 2
    m.position.x -= (box2.min.x + box2.max.x) / 2
    m.position.z -= (box2.min.z + box2.max.z) / 2
    flatten(m)
    return m
  }, [scene])

  const instances = useMemo(
    () =>
      APPLES.map(([x, yFrac, z, bob], i) => ({
        key: i,
        pos: [x, yFrac * TREE_H + (bob ? 0 : APPLE_D * 0.5), z],
        bob,
        phase: i * 1.7,
        amp: 0.015 + (i % 3) * 0.004, // ~1.5–2.3cm
        object: base.clone(true),
      })),
    [base],
  )

  useFrame((state) => {
    const t = state.clock.elapsedTime
    for (let i = 0; i < instances.length; i++) {
      const g = groups.current[i]
      const inst = instances[i]
      if (!g || !inst.bob) continue
      g.position.y = inst.pos[1] + Math.sin(t * 0.7 + inst.phase) * inst.amp
      g.rotation.z = Math.sin(t * 0.5 + inst.phase) * 0.04
    }
  })

  return instances.map((inst, i) => (
    <group
      key={inst.key}
      ref={(el) => {
        groups.current[i] = el
      }}
      position={inst.pos}
    >
      <primitive object={inst.object} />
    </group>
  ))
}

function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
      <circleGeometry args={[40, 48]} />
      <meshStandardMaterial color="#cfc9b1" roughness={1} metalness={0} />
    </mesh>
  )
}

// Slow idle camera drift around the spec starting pose.
function CameraDrift() {
  useFrame((state) => {
    const t = state.clock.elapsedTime
    const cam = state.camera
    cam.position.set(
      CAM0[0] + Math.sin(t * 0.08) * 0.35,
      CAM0[1] + Math.sin(t * 0.06) * 0.12,
      CAM0[2] + Math.cos(t * 0.07) * 0.25,
    )
    cam.lookAt(LOOK[0], LOOK[1], LOOK[2])
  })
  return null
}

// Takes over the render loop (priority 1) to run the painterly post chain.
function PainterlyPass() {
  const { gl, scene, camera, size } = useThree()
  const pipeline = useMemo(() => {
    const p = new PainterlyPipeline(gl, { renderScale: 0.7 })
    // Encode the scene render as sRGB into its RT so the passthrough
    // composite reaches the canvas at the right brightness.
    p.rtScene.texture.colorSpace = THREE.SRGBColorSpace
    return p
  }, [gl])

  useLayoutEffect(() => {
    const dpr = gl.getPixelRatio()
    pipeline.setSize(Math.max(2, size.width * dpr), Math.max(2, size.height * dpr))
  }, [pipeline, gl, size])

  useFrame(() => {
    pipeline.render(scene, camera)
  }, 1)

  return null
}

function LoadBadge() {
  const { active, progress } = useProgress()
  if (!active) return null
  return (
    <div className="orchard-load">
      painting orchard… {Math.round(progress)}%
    </div>
  )
}

export default function OrchardHero() {
  return (
    <div className="orchard-canvas">
      <Canvas
        flat
        dpr={[1, 1.5]}
        camera={{ position: CAM0, fov: 42, near: 0.1, far: 60 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
      >
        <color attach="background" args={[PAPER]} />
        <fog attach="fog" args={[FOG, 8, 24]} />
        <hemisphereLight args={['#f3f1e3', '#b7a988', 0.95]} />
        <directionalLight position={[4, 8, 5]} intensity={0.7} color="#fff4e2" />
        <ambientLight intensity={0.25} />
        <Ground />
        <Suspense fallback={null}>
          <Tree />
          <Apples />
        </Suspense>
        <CameraDrift />
        <PainterlyPass />
      </Canvas>
      <LoadBadge />
    </div>
  )
}

useGLTF.preload(TREE_URL)
useGLTF.preload(APPLE_URL)
