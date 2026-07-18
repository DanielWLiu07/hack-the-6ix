// MangaBackdrop: a subtle full-viewport MANGA-SHADER crust for the Analytics
// page background (in the spirit of Teleop's three.js ink background). An
// inside-out noise sphere fills the view and is run through the app's real
// mangaPass shader (halftone dots / crosshatch / ink grain), giving a crusty
// black-and-white texture. Fixed behind the UI, pointer-events none, low
// opacity, so it never blocks or competes with the data. Lazy so three/r3f stays
// out of the data path.

import { useLayoutEffect, useMemo } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { MangaPass } from '../lib/mangaPass.js'
import { CanvasGuard, SAFE_DPR } from '../lib/canvasGuard.jsx'

const NOISE_VERT = /* glsl */ `
  varying vec3 vP;
  void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`
const NOISE_FRAG = /* glsl */ `
  precision highp float;
  varying vec3 vP;
  uniform float uTime;
  float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h(i), h(i + vec2(1,0)), f.x), mix(h(i + vec2(0,1)), h(i + vec2(1,1)), f.x), f.y);
  }
  float fbm(vec2 p){
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * n(p); p = p * 2.0 + 1.7; a *= 0.5; }
    return v;
  }
  void main(){
    vec3 d = normalize(vP);
    vec2 uv = vec2(atan(d.z, d.x), d.y) * 2.4;
    float f = fbm(uv * 3.2 + uTime * 0.02);
    // keep it light so the shader yields a sparse halftone crust, not a dark field
    float g = 0.6 + f * 0.4;
    gl_FragColor = vec4(vec3(g), 1.0);
  }`

function CrustField() {
  const matRef = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: NOISE_VERT,
        fragmentShader: NOISE_FRAG,
        uniforms: { uTime: { value: 0 } },
        side: THREE.BackSide,
        depthWrite: false,
      }),
    [],
  )
  useFrame((st) => {
    matRef.uniforms.uTime.value = st.clock.elapsedTime
  })
  return (
    <mesh material={matRef}>
      <sphereGeometry args={[10, 32, 16]} />
    </mesh>
  )
}

function MangaRender() {
  const { gl, scene, camera, size } = useThree()
  const pass = useMemo(() => new MangaPass(gl, { grit: 0.55, ink: 0.08 }), [gl])
  useLayoutEffect(() => {
    const dpr = gl.getPixelRatio()
    pass.setSize(Math.max(2, size.width * dpr), Math.max(2, size.height * dpr))
  }, [pass, gl, size])
  useFrame(() => pass.render(scene, camera), 1)
  return null
}

export default function MangaBackdrop() {
  return (
    <div className="az-crust" aria-hidden>
      <Canvas
        flat
        dpr={SAFE_DPR}
        gl={{ alpha: true, antialias: true, premultipliedAlpha: false }}
        camera={{ position: [0, 0, 0.01], fov: 70 }}
      >
        <CanvasGuard />
        <CrustField />
        <MangaRender />
      </Canvas>
    </div>
  )
}
