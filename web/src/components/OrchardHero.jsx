// OrchardHero — painterly 3D landing backdrop (the end-goal hero).
// Long-lens painterly framing: a 25° camera, painted sky dome (paper→blue
// wash + hill ridges), meadow ground, and tree.glb + apple.glb, all run
// through the vendored anisotropic-Kuwahara post chain (src/vendor/painterly.js).
// Self-contained r3f — no external assets beyond the two GLBs.
//
// Renders ONLY the background. Hero copy/chip are overlaid by the caller.

import { Suspense, useLayoutEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useGLTF, useProgress } from '@react-three/drei'
import * as THREE from 'three'
import { PainterlyPipeline } from '../vendor/painterly.js'

const TREE_URL = '/assets/tree.glb'
const APPLE_URL = '/assets/apple.glb'

// Scene tuning constants
const PAPER = '#dcd6c4'
const FOG = '#ccd5c8'
const TREE_H = 3.4 // framed for the 25° long lens
const APPLE_D = 0.26
const CAM0 = [5.2, 2.4, 6.9] // exact — the dome horizon is calibrated to it
const LOOK = [0, 1.4, 0]

const APPLES = [
  [0.55, 0.74, 0.35, true],
  [-0.7, 0.68, 0.15, true],
  [0.2, 0.82, -0.55, true],
  [-0.35, 0.78, -0.6, true],
  [0.85, 0.6, -0.2, true],
  [-0.9, 0.58, -0.35, true],
  [0.1, 0.66, 0.7, true],
  [-0.15, 0.86, 0.25, true],
  [1.15, 0.0, 1.2, false],
  [-1.35, 0.0, 0.6, false],
]

// ── Painted sky dome — pinned fully-grown (uGrow=1); uTime keeps the slow
// disc drift. Horizon v=-0.113 is measured for the 25° camera at CAM0, so the
// hill ridges land on the real horizon. ──
const SKY_VERT = /* glsl */ `
  varying vec3 vP;
  void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`
const SKY_FRAG = /* glsl */ `
  varying vec3 vP; uniform float uGrow; uniform float uTime;
  float gh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float gn(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(gh(i), gh(i+vec2(1,0)), f.x), mix(gh(i+vec2(0,1)), gh(i+vec2(1,1)), f.x), f.y);
  }
  void main(){
    float v = vP.y / 30.0;
    float ang = atan(vP.z, vP.x);
    vec3 paper = vec3(0.865, 0.84, 0.77);
    float HOR = -0.113, TOP = 0.167;
    float vn = smoothstep(HOR, TOP, v);
    float sg = smoothstep(0.15, 0.995, uGrow) * 1.25;
    float sfield = (gn(vec2(ang*5.0, v*10.0)+2.2)*0.55 + gn(vec2(ang*11.0, v*22.0)+5.5)*0.30
                  + gn(vec2(ang*24.0, v*48.0)+1.3)*0.15) * 0.72 + (1.0 - vn) * 0.42;
    float m = smoothstep(sg + 0.03, sg - 0.10, sfield);
    float drift = uTime * 0.05;
    float holesE = (gn(vec2(ang*7.0+drift*0.4, v*15.0)+8.1)*0.6 + gn(vec2(ang*15.0+drift*0.4, v*32.0)+3.9)*0.4) * 0.85;
    m *= smoothstep(holesE - 0.20, holesE + 0.20, smoothstep(HOR + 0.02, HOR + 0.17, v));
    float rimS = smoothstep(sg-0.10, sg-0.02, sfield) * (1.0 - smoothstep(sg-0.02, sg+0.03, sfield));
    float band = smoothstep(0.4, 0.75, gn(vec2(ang*1.6+3.3+drift*1.2, v*3.2)));
    vec3 skyCol = mix(vec3(0.62, 0.745, 0.80), vec3(0.71, 0.80, 0.83), band);
    skyCol *= 1.0 - 0.30 * rimS;
    float washU = 0.85 + 0.15 * gn(vec2(ang*9.0+drift*1.6, v*18.0)+3.7);
    float c = gn(vec2(ang*1.1+9.9+drift, v*2.6))*0.55 + gn(vec2(ang*2.7+4.4+drift*1.7, v*5.5))*0.45;
    float cloud = smoothstep(0.56, 0.63, c) * smoothstep(0.25, 0.45, vn);
    vec3 col = mix(paper, skyCol, m * 0.9 * washU);
    col = mix(col, vec3(0.955, 0.945, 0.92), cloud * m);
    float mg = smoothstep(0.22, 0.98, uGrow) * 1.15;
    float ynM = clamp((v - HOR + 0.02) / 0.085, 0.0, 1.0);
    float mfield = ynM*0.62 + (gn(vec2(ang*6.0, v*30.0)+6.6)*0.6 + gn(vec2(ang*13.0, v*60.0)+2.9)*0.4)*0.38;
    float mm = smoothstep(mg + 0.03, mg - 0.10, mfield);
    float mrim = smoothstep(mg-0.10, mg-0.02, mfield) * (1.0 - smoothstep(mg-0.02, mg+0.03, mfield));
    mm *= 1.0 - 0.25 * mrim;
    float ph1 = ang*1.35 + 0.22; float hump1 = 1.0 - abs(2.0*fract(ph1) - 1.0);
    hump1 = hump1*hump1*(3.0 - 2.0*hump1);
    float amp1 = 0.024 + 0.038*gn(vec2(floor(ph1)*3.7, 1.1));
    float r1 = HOR - 0.015 + hump1*amp1;
    float ph2 = ang*2.3 + 0.71; float hump2 = 1.0 - abs(2.0*fract(ph2) - 1.0);
    hump2 = hump2*hump2*(3.0 - 2.0*hump2);
    float amp2 = 0.014 + 0.028*gn(vec2(floor(ph2)*5.1, 2.6));
    float r2 = HOR - 0.02 + hump2*amp2;
    float hor = smoothstep(HOR - 0.09, HOR - 0.075, v);
    float mt1 = smoothstep(r1 + 0.006, r1 - 0.004, v);
    float mt2 = smoothstep(r2 + 0.005, r2 - 0.003, v);
    col = mix(col, vec3(0.63, 0.71, 0.69), mt1 * mm * hor * 0.8);
    col = mix(col, vec3(0.50, 0.60, 0.52), mt2 * mm * hor * 0.88);
    gl_FragColor = vec4(col, 1.0);
  }`

function SkyDome() {
  const matRef = useRef()
  const uniforms = useMemo(
    () => ({ uGrow: { value: 1 }, uTime: { value: 0 } }),
    [],
  )
  useFrame((state) => {
    if (matRef.current) matRef.current.uniforms.uTime.value = state.clock.elapsedTime
  })
  return (
    <mesh>
      <sphereGeometry args={[30, 32, 16]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={SKY_VERT}
        fragmentShader={SKY_FRAG}
        uniforms={uniforms}
        side={THREE.BackSide}
        depthWrite={false}
        fog={false}
      />
    </mesh>
  )
}

// ── Meadow ground — meadow() noise field tinted toward grass green, with the
// scene's paper fog folded in manually (raw ShaderMaterial). ──
const GROUND_VERT = /* glsl */ `
  varying vec3 vWpos; varying float vFogDepth;
  void main(){
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWpos = wp.xyz;
    vec4 mv = viewMatrix * wp;
    vFogDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }`
const GROUND_FRAG = /* glsl */ `
  varying vec3 vWpos; varying float vFogDepth;
  uniform vec3 uFog; uniform float uFogNear; uniform float uFogFar;
  float gh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float gn(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(gh(i), gh(i+vec2(1,0)), f.x), mix(gh(i+vec2(0,1)), gh(i+vec2(1,1)), f.x), f.y);
  }
  vec3 meadow(vec2 p){
    float big = gn(p*0.45 + 3.3), mid = gn(p*1.7 + 7.7), fine = gn(p*5.9 + 1.2);
    vec3 gDeep = vec3(0.16, 0.33, 0.09), gWarm = vec3(0.30, 0.46, 0.13), gSun = vec3(0.46, 0.56, 0.19);
    vec3 col = mix(gWarm, gDeep, big);
    col = mix(col, gSun, smoothstep(0.55, 0.9, mid) * 0.75);
    col *= 0.88 + 0.24 * fine;
    return col;
  }
  void main(){
    vec3 col = meadow(vWpos.xz);
    col = mix(col, vec3(0.27, 0.41, 0.13), 0.55);
    float f = smoothstep(uFogNear, uFogFar, vFogDepth);
    col = mix(col, uFog, f);
    gl_FragColor = vec4(col, 1.0);
  }`

function MeadowGround() {
  const fog = useMemo(() => new THREE.Color(FOG), [])
  const uniforms = useMemo(
    () => ({
      uFog: { value: fog },
      uFogNear: { value: 8 },
      uFogFar: { value: 24 },
    }),
    [fog],
  )
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
      <planeGeometry args={[120, 120]} />
      <shaderMaterial
        vertexShader={GROUND_VERT}
        fragmentShader={GROUND_FRAG}
        uniforms={uniforms}
      />
    </mesh>
  )
}

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

  const base = useMemo(() => {
    const m = scene.clone(true)
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
        amp: 0.015 + (i % 3) * 0.004,
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

function CameraDrift() {
  useFrame((state) => {
    const t = state.clock.elapsedTime
    const cam = state.camera
    cam.position.set(
      CAM0[0] + Math.sin(t * 0.08) * 0.25,
      CAM0[1] + Math.sin(t * 0.06) * 0.08,
      CAM0[2] + Math.cos(t * 0.07) * 0.18,
    )
    cam.lookAt(LOOK[0], LOOK[1], LOOK[2])
  })
  return null
}

function PainterlyPass() {
  const { gl, scene, camera, size } = useThree()
  const pipeline = useMemo(() => {
    const p = new PainterlyPipeline(gl, { renderScale: 0.7 })
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
  return <div className="orchard-load">painting orchard… {Math.round(progress)}%</div>
}

export default function OrchardHero() {
  return (
    <div className="orchard-canvas">
      <Canvas
        flat
        dpr={[1, 1.5]}
        camera={{ position: CAM0, fov: 25, near: 0.1, far: 100 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
      >
        <color attach="background" args={[PAPER]} />
        <fog attach="fog" args={[FOG, 8, 24]} />
        <hemisphereLight args={['#f3f1e3', '#b7a988', 0.95]} />
        <directionalLight position={[4, 8, 5]} intensity={0.7} color="#fff4e2" />
        <ambientLight intensity={0.25} />
        <SkyDome />
        <MeadowGround />
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
