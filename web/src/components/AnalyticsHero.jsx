// AnalyticsHero: full-page painterly ORCHARD backdrop for the Analytics page.
// A 3D orchard (grass, trees, the Meshy crate, and apples scattered all around,
// on the ground and in the canopies) rendered through the app's anisotropic-
// Kuwahara PainterlyPipeline (src/vendor/painterly.js) with the same paper/fog
// palette as the landing, so it reads as the same painted world. Lazy so
// three/r3f stays out of the analytics data path.

import { Suspense, useLayoutEffect, useMemo } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { PainterlyPipeline } from '../vendor/painterly.js'

const PAPER = '#dcd6c4' // matches the landing
const FOG = '#ccd5c8'
const GRASS = '#728c4d'

// a normalized GLB instance (shares geometry across clones)
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
      <planeGeometry args={[160, 160]} />
      <meshStandardMaterial color={GRASS} roughness={1} />
    </mesh>
  )
}

// apples scattered across the whole orchard: [x, y, z, height]
const APPLES = [
  [-6.5, 0, 2, 0.4], [-4.2, 0, 3.4, 0.36], [-2.1, 0, 4.6, 0.42],
  [0.4, 0, 5.2, 0.38], [2.8, 0, 4, 0.44], [5.1, 0, 2.6, 0.4],
  [6.8, 0, 0.6, 0.36], [-5.6, 0, -1.4, 0.34], [3.9, 0, -1.8, 0.38],
  [-1.2, 0, 1.6, 0.3], [1.6, 0, 2.4, 0.32],
  // canopy apples (up in the trees)
  [-4.4, 4.3, -4.2, 0.4], [-3.2, 3.6, -3.4, 0.36], [4.6, 3.9, -6, 0.4],
  [5.6, 3.2, -5.2, 0.34], [0.2, 4.4, -8.6, 0.38],
]

// bananas scattered on the ground: [x, y, z, height, rotY]
const BANANAS = [
  [-3, 0, 3.8, 0.32, 0.6], [1.9, 0, 3.2, 0.3, -1.2], [4.3, 0, 1.6, 0.34, 2.1],
  [-5.4, 0, 0.8, 0.3, -0.4], [0.9, 0, 4.6, 0.28, 1.4],
]

function Rig() {
  const { camera } = useThree()
  useFrame((st) => {
    const t = st.clock.elapsedTime
    camera.position.x = Math.sin(t * 0.07) * 0.7
    camera.position.y = 3 + Math.sin(t * 0.1) * 0.14
    camera.lookAt(0, 1.1, -1.5)
  })
  return null
}

function PainterlyRender() {
  const { gl, scene, camera, size } = useThree()
  const pass = useMemo(() => {
    const p = new PainterlyPipeline(gl, { renderScale: 0.7 })
    p.rtScene.texture.colorSpace = THREE.SRGBColorSpace
    return p
  }, [gl])
  useLayoutEffect(() => {
    const dpr = gl.getPixelRatio()
    pass.setSize(Math.max(2, size.width * dpr), Math.max(2, size.height * dpr))
  }, [pass, gl, size])
  useFrame(() => pass.render(scene, camera), 1)
  return null
}

export default function AnalyticsHero() {
  return (
    <div className="orchard-canvas" aria-hidden>
      <Canvas
        flat
        dpr={[1, 1.4]}
        camera={{ position: [0, 3, 11], fov: 33, near: 0.1, far: 120 }}
        gl={{ antialias: true }}
      >
        <color attach="background" args={[PAPER]} />
        <fog attach="fog" args={[FOG, 12, 40]} />
        <hemisphereLight args={['#fff7e4', '#5f7344', 1.15]} />
        <directionalLight position={[6, 10, 5]} intensity={1.3} color="#fff4e2" />
        <ambientLight intensity={0.45} />
        <Suspense fallback={null}>
          <Ground />
          <Model url="/assets/tree.glb" height={6} pos={[-4.2, 0, -4]} />
          <Model url="/assets/tree.glb" height={5.2} pos={[4.6, 0, -6]} rotY={1.1} />
          <Model url="/assets/tree.glb" height={5.6} pos={[0.2, 0, -8.6]} rotY={-0.6} />
          <Model url="/assets/crate.min.glb" height={1.15} pos={[2.6, 0, 2.4]} rotY={-0.5} />
          <Model url="/assets/crate.min.glb" height={1} pos={[-3.6, 0, 1.2]} rotY={0.7} />
          {APPLES.map((a, i) => (
            <Model key={`a${i}`} url="/assets/apple.glb" height={a[3]} pos={[a[0], a[1], a[2]]} />
          ))}
          {BANANAS.map((b, i) => (
            <Model key={`b${i}`} url="/assets/banana.min.glb" height={b[3]} pos={[b[0], b[1], b[2]]} rotY={b[4]} />
          ))}
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
useGLTF.preload('/assets/banana.min.glb')
