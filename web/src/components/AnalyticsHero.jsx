// AnalyticsHero: the landing's painted SKY + GRASS as a light backdrop for the
// Analytics page (no fruit/trees - the human adds those later). The sky dome and
// meadow shaders are the SAME as the landing (OrchardHero), replicated verbatim
// and pinned to the landing's calibrated camera (CAM0, 25 deg) so the horizon
// lines up, then run through the shared PainterlyPipeline. One canvas, fixed
// behind the UI, pointer-events none, so it never blocks the data.
//
// NOTE: these shaders are copied from OrchardHero.jsx (web-frontend). They should
// really live in a shared module both import - flagged to web-frontend/master.

import { useLayoutEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { PainterlyPipeline } from '../vendor/painterly.js'
import { CanvasGuard, SAFE_DPR } from '../lib/canvasGuard.jsx'

const FOG = '#ccd5c8'
const CAM0 = [5.2, 2.4, 6.9] // exact - the dome horizon is calibrated to it
const LOOK = [0, 1.4, 0]

// -- Painted sky dome (verbatim from the landing) --
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
  const uniforms = useMemo(() => ({ uGrow: { value: 1 }, uTime: { value: 0 } }), [])
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

// -- Meadow ground (verbatim from the landing) --
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
    () => ({ uFog: { value: fog }, uFogNear: { value: 8 }, uFogFar: { value: 24 } }),
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

// gentle drift around the calibrated camera (matches the landing feel)
function Rig() {
  const { camera } = useThree()
  useFrame((st) => {
    const t = st.clock.elapsedTime
    camera.position.set(
      CAM0[0] + Math.sin(t * 0.08) * 0.25,
      CAM0[1] + Math.sin(t * 0.06) * 0.08,
      CAM0[2],
    )
    camera.lookAt(LOOK[0], LOOK[1], LOOK[2])
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
        dpr={SAFE_DPR}
        camera={{ position: CAM0, fov: 25, near: 0.1, far: 100 }}
        gl={{ antialias: true }}
      >
        <CanvasGuard />
        <color attach="background" args={['#dcd6c4']} />
        <fog attach="fog" args={[FOG, 8, 24]} />
        <SkyDome />
        <MeadowGround />
        <Rig />
        <PainterlyRender />
      </Canvas>
    </div>
  )
}
