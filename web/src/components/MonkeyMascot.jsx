// MonkeyMascot - the humanoid cartoon monkey, rendered in FULLY black-and-white
// manga (ink outlines + halftone/hatch tone bands via src/lib/mangaPass.js) on a
// transparent canvas. Plays its rig animation and rises up from the bottom on
// mount. Standalone renderer - the monkey-page scene positions/uses it.

import { Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGLTF, useAnimations } from '@react-three/drei'
import * as THREE from 'three'
import { MangaPass } from '../lib/mangaPass.js'
import { CanvasGuard, SAFE_DPR } from '../lib/canvasGuard.jsx'

const MONKEY_URL = '/assets/monkey.glb'
const RISE_FROM = -2.2 // world units below final pose
const RISE_MS = 1400

function Monkey() {
  const { scene, animations } = useGLTF(MONKEY_URL)
  const model = useMemo(() => scene.clone(true), [scene])
  const riseRef = useRef()
  const { actions, names } = useAnimations(animations, riseRef)
  const t0 = useRef(null)

  useLayoutEffect(() => {
    const box = new THREE.Box3().setFromObject(model)
    const size = new THREE.Vector3()
    box.getSize(size)
    model.scale.setScalar(1.9 / (size.y || 1))
    const b2 = new THREE.Box3().setFromObject(model)
    const c = new THREE.Vector3()
    b2.getCenter(c)
    model.position.x -= c.x
    model.position.z -= c.z
    model.position.y -= b2.min.y // feet at y=0
  }, [model])

  // play the rig's idle/first clip on loop
  useEffect(() => {
    if (!names.length) return
    const act = actions[names[0]]
    act?.reset().fadeIn(0.3).play()
    return () => act?.fadeOut(0.2)
  }, [actions, names])

  // rise from below on mount (ease-out)
  useFrame((st) => {
    if (!riseRef.current) return
    if (t0.current === null) t0.current = st.clock.elapsedTime
    const p = Math.min(1, (st.clock.elapsedTime - t0.current) / (RISE_MS / 1000))
    const e = 1 - Math.pow(1 - p, 3)
    riseRef.current.position.y = RISE_FROM * (1 - e)
  })

  return (
    <group ref={riseRef}>
      <primitive object={model} />
    </group>
  )
}

// Takes over the render loop to run the manga pass to the transparent canvas.
function MangaRender() {
  const { gl, scene, camera, size } = useThree()
  const pass = useMemo(() => new MangaPass(gl, { grit: 0.45, ink: 0.05 }), [gl])
  useLayoutEffect(() => {
    const dpr = gl.getPixelRatio()
    pass.setSize(size.width * dpr, size.height * dpr)
  }, [pass, gl, size])
  useFrame(() => pass.render(scene, camera), 1)
  return null
}

export default function MonkeyMascot() {
  return (
    <div className="monkey-mascot" aria-hidden>
      <Canvas
        flat
        dpr={SAFE_DPR}
        gl={{ alpha: true, antialias: true, premultipliedAlpha: false }}
        camera={{ position: [0, 0.9, 3.4], fov: 32 }}
      >
        <CanvasGuard />
        <ambientLight intensity={0.55} />
        <directionalLight position={[2, 3, 4]} intensity={1.15} />
        <directionalLight position={[-3, 1, -2]} intensity={0.4} />
        <Suspense fallback={null}>
          <Monkey />
        </Suspense>
        <MangaRender />
      </Canvas>
    </div>
  )
}

useGLTF.preload(MONKEY_URL)
