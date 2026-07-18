// AnalyticsHero: a painterly ORCHARD hero band for the top of the Analytics page.
// A small 3D orchard (grass, trees, the Meshy crate, scattered apples) with a
// prominent hero apple front-right, all rendered through the app's anisotropic-
// Kuwahara PainterlyPipeline (the same painterly shader as the landing). The
// "Data Aggregation" title is overlaid by the page on the left. Lazy so
// three/r3f stays out of the analytics data path.

import { Suspense, useLayoutEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { PainterlyPipeline } from '../vendor/painterly.js'

const SKY = '#cdd6c6'
const FOG = '#c8d2c5'
const GRASS = '#728c4d'

function Model({ url, height, pos, rotY = 0 }) {
  const { scene } = useGLTF(url)
  const model = useMemo(() => {
    const m = scene.clone(true)
    const box = new THREE.Box3().setFromObject(m)
    const size = new THREE.Vector3()
    box.getSize(size)
    m.scale.setScalar(height / (size.y || 1))
    const b2 = new THREE.Box3().setFromObject(m)
    const c = new THREE.Vector3()
    b2.getCenter(c)
    m.position.x -= c.x
    m.position.z -= c.z
    m.position.y -= b2.min.y
    return m
  }, [scene, height])
  return (
    <group position={pos} rotation={[0, rotY, 0]}>
      <primitive object={model} />
    </group>
  )
}

function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[120, 120]} />
      <meshStandardMaterial color={GRASS} roughness={1} />
    </mesh>
  )
}

// the hero apple front-right, gently turning
function HeroApple() {
  const { scene } = useGLTF('/assets/apple.glb')
  const model = useMemo(() => {
    const m = scene.clone(true)
    const box = new THREE.Box3().setFromObject(m)
    const size = new THREE.Vector3()
    box.getSize(size)
    m.scale.setScalar(1.7 / (size.y || 1))
    const b2 = new THREE.Box3().setFromObject(m)
    const c = new THREE.Vector3()
    b2.getCenter(c)
    m.position.sub(c)
    return m
  }, [scene])
  const ref = useRef()
  useFrame((st) => {
    if (!ref.current) return
    const t = st.clock.elapsedTime
    ref.current.rotation.y = t * 0.4
    ref.current.position.y = 1.15 + Math.sin(t * 1.1) * 0.06
  })
  return (
    <group ref={ref} position={[3.1, 1.15, 2.4]}>
      <primitive object={model} />
    </group>
  )
}

function PainterlyRender() {
  const { gl, scene, camera, size } = useThree()
  const pass = useMemo(() => {
    const p = new PainterlyPipeline(gl, { renderScale: 0.72 })
    p.rtScene.texture.colorSpace = THREE.SRGBColorSpace
    return p
  }, [gl])
  useLayoutEffect(() => {
    const dpr = gl.getPixelRatio()
    pass.setSize(size.width * dpr, size.height * dpr)
  }, [pass, gl, size])
  useFrame(() => pass.render(scene, camera), 1)
  return null
}

function Rig() {
  const { camera } = useThree()
  useFrame((st) => {
    const t = st.clock.elapsedTime
    camera.position.x = 0.3 + Math.sin(t * 0.1) * 0.4
    camera.position.y = 1.7 + Math.sin(t * 0.13) * 0.08
    camera.lookAt(0.9, 1.05, 0)
  })
  return null
}

const APPLES = [
  { pos: [-1.3, 0, 1.6], h: 0.32 },
  { pos: [0.2, 0, 2.4], h: 0.28 },
  { pos: [-2.6, 2.7, -1.8], h: 0.34 },
  { pos: [1.2, 2.5, -3.4], h: 0.3 },
]

export default function AnalyticsHero() {
  return (
    <div className="az-backdrop" aria-hidden>
      <Canvas
        flat
        dpr={[1, 1.35]}
        camera={{ position: [0.3, 1.7, 7.4], fov: 34 }}
        gl={{ antialias: true }}
      >
        <color attach="background" args={[SKY]} />
        <fog attach="fog" args={[FOG, 9, 26]} />
        <hemisphereLight args={['#fff8e6', '#5f7344', 1.15]} />
        <directionalLight position={[5, 8, 4]} intensity={1.35} />
        <ambientLight intensity={0.5} />
        <Suspense fallback={null}>
          <Ground />
          <Model url="/assets/tree.glb" height={4.8} pos={[-2.8, 0, -2.2]} />
          <Model url="/assets/tree.glb" height={4} pos={[1.6, 0, -4.4]} rotY={1.1} />
          <Model url="/assets/crate.min.glb" height={1.05} pos={[-1.4, 0, 1.4]} rotY={-0.4} />
          {APPLES.map((a, i) => (
            <Model key={i} url="/assets/apple.glb" height={a.h} pos={a.pos} />
          ))}
          <HeroApple />
        </Suspense>
        <Rig />
        <PainterlyRender />
      </Canvas>
    </div>
  )
}

useGLTF.preload('/assets/tree.glb')
useGLTF.preload('/assets/apple.glb')
useGLTF.preload('/assets/crate.min.glb')
