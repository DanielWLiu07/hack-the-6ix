// MonkeyStage - the "monkey page". The landing scene lives here NOT as a TV
// rectangle but as an amorphous painted SPLASH (a watercolor-masked iframe)
// floating in a dark manga room, a smooth full-body Suzanne character lit beside it.
// Arriving from the landing, the splash fills the viewport (mirroring the scene
// the user just left) then the camera eases back and it settles as a hanging
// painting. Direct visits skip to the settled state. Fully orbit-controllable.

import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Html, useAnimations, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { MangaPass } from '../lib/mangaPass.js'
import { CanvasGuard, SAFE_DPR } from '../lib/canvasGuard.jsx'
import { buildRig, applyPose } from '../lib/poseRig.js'
import { useTvTransition } from '../lib/tvTransition.jsx'
import { preloadRoute } from '../lib/routePreload.js'
import { StageProp, PropBoundary } from '../components/StageProp.jsx'
import { PROP_CATALOG, CATALOG_BY_ID, DEFAULT_PLACEMENT, FLOOR } from '../lib/stageProps.js'

// Webcam pose capture is heavy (MediaPipe wasm), so it only loads when the
// operator turns on mimic mode.
const MimicCam = lazy(() => import('../components/MimicCam.jsx'))
import '../App.css'

// Fresh Meshy-generated cartoon monkey, arms out in a T-pose (a clean static
// mesh - no skinning weights to break). The rig/mimic code below no-ops when
// there are no bones, so it just renders in this cheerful arms-up pose.
// The mascot is now a Mixamo-rigged body (clean weights + baked Idle/Walk/Run,
// and a real humanoid skeleton for webcam mimic) with the Suzanne monkey head
// grafted on. The head is extracted from the old monkey mesh and rides on the
// body's head bone (heads do not deform, so a rigid attach is all it needs).
const BODY_URL = '/assets/suit.glb'
const HEAD_SRC_URL = '/assets/suzanne-tpose.glb'
// head extraction: keep triangles above this height fraction (the head, not the
// T-pose arms). head sized to this fraction of body height, lifted by UP_FRAC.
const HEAD_THR = 0.83
const HEAD_SIZE_FRAC = 0.17
const HEAD_UP_FRAC = 0.35
// the painted splash: a wide floating plane, hung upper-left, facing the camera
const SPLASH = { w: 2.95, h: 1.85, pos: [0.034, -1.037, 0.312], rot: [0, 0, 0], scale: [0.59, 0.58, 0.59] }
const MONKEY_POS = [0, -1.731, 0.764]
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

// Fullscreen TV-static overlay for the landing->stage arrival. CameraIntro
// drives fuzzRef.current.opacity (full during the hold, then fading as the
// camera pulls back); this fixed DOM canvas reads it each frame and scrambles
// while visible. Standalone (not tied to the removed painting), so the tune-in
// transition survives even though the Splash/TV is gone.
function StageFuzz({ fuzzRef }) {
  const ref = useRef(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return undefined
    const ctx = canvas.getContext('2d')
    let w = 2
    let h = 2
    const resize = () => {
      // low-res canvas stretched to fill => chunky pixelated static
      w = canvas.width = Math.max(2, Math.ceil(window.innerWidth / 7))
      h = canvas.height = Math.max(2, Math.ceil(window.innerHeight / 7))
    }
    resize()
    window.addEventListener('resize', resize)
    let raf = 0
    const step = () => {
      const op = fuzzRef.current?.opacity ?? 0
      if (op > 0.01) {
        const img = ctx.createImageData(w, h)
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
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [fuzzRef])
  return <canvas ref={ref} className="stage-fuzz" aria-hidden="true" />
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

// Build a static head mesh from the monkey's skinned mesh, keeping only the
// triangles above HEAD_THR of height (the head, not the T-pose arms which sit at
// shoulder height). The geometry is recentred at its own origin so it can be hung
// on any bone. Material keeps the face texture but is whitened for the manga pass.
function extractMonkeyHead(monkeyScene) {
  let src = null
  monkeyScene.traverse((o) => { if ((o.isSkinnedMesh || o.isMesh) && o.geometry) src = o })
  const geo = src.geometry
  const pos = geo.attributes.position
  let minY = Infinity, maxY = -Infinity
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); if (y<minY)minY=y; if (y>maxY)maxY=y }
  const thr = minY + (maxY - minY) * HEAD_THR
  const idx = geo.index ? geo.index.array : null
  const triCount = idx ? idx.length/3 : pos.count/3
  const nrm = geo.attributes.normal, uv = geo.attributes.uv
  const used = new Map(), P = [], N = [], U = [], I = []
  const push = (vi) => {
    let n = used.get(vi)
    if (n === undefined) {
      n = P.length/3; used.set(vi, n)
      P.push(pos.getX(vi), pos.getY(vi), pos.getZ(vi))
      if (nrm) N.push(nrm.getX(vi), nrm.getY(vi), nrm.getZ(vi))
      if (uv) U.push(uv.getX(vi), uv.getY(vi))
    }
    I.push(n)
  }
  for (let t = 0; t < triCount; t++) {
    const a = idx ? idx[t*3] : t*3, b = idx ? idx[t*3+1] : t*3+1, c = idx ? idx[t*3+2] : t*3+2
    if (pos.getY(a) > thr && pos.getY(b) > thr && pos.getY(c) > thr) { push(a); push(b); push(c) }
  }
  const hg = new THREE.BufferGeometry()
  hg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3))
  if (nrm) hg.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3))
  if (uv) hg.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2))
  hg.setIndex(I); hg.computeBoundingBox()
  const size = hg.boundingBox.getSize(new THREE.Vector3())
  const ctr = hg.boundingBox.getCenter(new THREE.Vector3())
  hg.translate(-ctr.x, -ctr.y, -ctr.z)
  hg.computeVertexNormals()
  // Plain light material - NOT the monkey's textured material. The manga pass is
  // B&W so the face texture is discarded anyway, and its baked map fed NaNs into
  // the half-float manga target (blanking the whole frame). Suzanne's features
  // are geometric, so the ink shading defines the face cleanly on a flat surface.
  // Flat emissive lift so the manga pass reads the face as paper + ink outlines
  // rather than a dark blob (deep-set eyes / downward faces get little light).
  const mat = new THREE.MeshStandardMaterial({
    color: '#ffffff', roughness: 1, metalness: 0,
    emissive: new THREE.Color('#ffffff'), emissiveIntensity: 1.0,
  })
  return { mesh: new THREE.Mesh(hg, mat), height: size.y }
}

// Delete the soldier's own head: hide the visor and drop the vanguard triangles
// whose vertices are weighted to the head/neck bones (so nothing stretches when
// the monkey head sits on top - the verts are gone, not collapsed).
function stripSoldierHead(body) {
  const comp = ['getX', 'getY', 'getZ', 'getW']
  body.traverse((o) => {
    if (/visor/i.test(o.name)) o.visible = false
    if (!o.isSkinnedMesh || !o.skeleton) return
    const headIdx = new Set()
    o.skeleton.bones.forEach((b, i) => { if (/head|neck/i.test(b.name)) headIdx.add(i) })
    const g = o.geometry, sk = g.attributes.skinIndex, sw = g.attributes.skinWeight
    if (!sk) return
    const isHead = (v) => { let w = 0; for (let k = 0; k < 4; k++) if (headIdx.has(sk[comp[k]](v))) w += sw[comp[k]](v); return w > 0.5 }
    const src = g.index ? Array.from(g.index.array) : Array.from({ length: g.attributes.position.count }, (_, i) => i)
    const kept = []
    for (let t = 0; t < src.length; t += 3) {
      const a = src[t], b = src[t+1], c = src[t+2]
      if (isHead(a) && isHead(b) && isHead(c)) continue
      kept.push(a, b, c)
    }
    g.setIndex(kept)
  })
}

// The mascot: a Mixamo-rigged body (its own Idle plays by default; mimic drives
// its arms/legs from your webcam via the shared poseRig) with the Suzanne head
// grafted onto the head bone. The head follows the head bone each frame but stays
// upright, so the clean face never distorts no matter what the body does.
const _hm = new THREE.Matrix4()
const _hp = new THREE.Vector3()
// Rotate `bone` so its rest world direction points at `targetDir` (world). Used
// to drop the arms into a natural rest when the body ships only a T-pose.
const _adq = new THREE.Quaternion()
const _awq = new THREE.Quaternion()
const _apq = new THREE.Quaternion()
function aimBone(bone, bindDir, bindWQ, targetDir) {
  _adq.setFromUnitVectors(bindDir, targetDir)
  _awq.copy(_adq).multiply(bindWQ)
  bone.parent.getWorldQuaternion(_apq)
  bone.quaternion.copy(_apq.invert().multiply(_awq))
}
// mouse-follow scratch: cursor ray -> a world target at the monkey's depth that
// the arms point at (upper body only, no torso lean).
const _mv = new THREE.Vector3()
const _mtarget = new THREE.Vector3()
const _sh = new THREE.Vector3()
const _n = new THREE.Vector3()
// Cursor-point pose: the FOREARM aims exactly at the cursor target, while the
// upper arm just loosely follows (elbow stays relaxed at the side). This reads as
// a natural pointing gesture and can never fold behind the body the way a strict
// reach IK could.
const _aim = new THREE.Vector3()
const _udir = new THREE.Vector3()
const _elb = new THREE.Vector3()
const _fdir = new THREE.Vector3()
function pointArm(a, S, target) {
  _aim.copy(target).sub(S).normalize()
  _udir.copy(a.restDir).lerp(_aim, 0.45).normalize()   // loose upper arm (half toward cursor)
  aimBone(a.bone, a.bindDir, a.bindWQ, _udir)
  a.bone.updateWorldMatrix(true, true)
  a.fore.getWorldPosition(_elb)                         // elbow = forearm bone origin
  _fdir.copy(target).sub(_elb).normalize()             // forearm points EXACTLY at cursor
  aimBone(a.fore, a.foreBindDir, a.foreBindWQ, _fdir)
}
function Monkey({ bind, poseRef, mimic, mirror }) {
  const soldier = useGLTF(BODY_URL)
  const headSrc = useGLTF(HEAD_SRC_URL)

  const built = useMemo(() => {
    // clone so our mutations (head-strip, added head) never touch the GLTF cache
    const body = skeletonClone(soldier.scene)
    stripSoldierHead(body)
    body.updateWorldMatrix(true, true)
    let headBone = null
    body.traverse((o) => { if (o.isBone && /^head$/i.test(o.name.replace(/[^a-z]/gi, '').replace(/^mixamorig/i, ''))) headBone = o })
    // body extent from the skeleton (setFromObject is unreliable on skinned meshes)
    let mnx=Infinity,mxx=-Infinity,mny=Infinity,mxy=-Infinity,mnz=Infinity,mxz=-Infinity
    body.traverse((o) => { if (o.isBone) { const p = new THREE.Vector3(); o.getWorldPosition(p)
      if(p.x<mnx)mnx=p.x; if(p.x>mxx)mxx=p.x; if(p.y<mny)mny=p.y; if(p.y>mxy)mxy=p.y; if(p.z<mnz)mnz=p.z; if(p.z>mxz)mxz=p.z } })
    const bodyH = (mxy - mny) || 1
    const { mesh: head, height: hh } = extractMonkeyHead(headSrc.scene)
    const headWorldH = bodyH * HEAD_SIZE_FRAC
    head.scale.setScalar(headWorldH / (hh || 1))
    body.add(head)
    const s = 2.4 / bodyH
    // Capture an arm-rest for bodies that ship only a T-pose: aim each upper arm
    // DOWN and slightly out to its own side (sign from its bind direction, so it
    // works whichever way the rig is handed).
    const wp = (o) => o.getWorldPosition(new THREE.Vector3())
    const armRest = []
    ;[['LeftArm', 'LeftForeArm', 'LeftHand'], ['RightArm', 'RightForeArm', 'RightHand']].forEach(([an, cn, hn]) => {
      let a = null, c = null, h = null
      body.traverse((o) => {
        const nm = o.name.replace(/[^a-z]/gi, '').replace(/^mixamorig/i, '').toLowerCase()
        if (nm === an.toLowerCase()) a = o
        if (nm === cn.toLowerCase()) c = o
        if (nm === hn.toLowerCase()) h = o
      })
      if (!a || !c || !h) return
      const bindDir = wp(c).sub(wp(a)).normalize()
      const outSign = Math.sign(bindDir.x) || 1
      armRest.push({
        bone: a,
        fore: c,
        bindDir,
        bindWQ: a.getWorldQuaternion(new THREE.Quaternion()),
        foreBindDir: wp(h).sub(wp(c)).normalize(),
        foreBindWQ: c.getWorldQuaternion(new THREE.Quaternion()),
        // relaxed upper-arm direction: down + a touch out and forward
        restDir: new THREE.Vector3(outSign * 0.25, -1, 0.35).normalize(),
      })
    })
    return {
      body, head, headBone, headUp: headWorldH * HEAD_UP_FRAC, armRest,
      animated: (soldier.animations?.[0]?.duration ?? 0) > 0.5,
      fit: { s, pos: [-((mnx+mxx)/2)*s, -mny*s, -((mnz+mxz)/2)*s] },
    }
  }, [soldier.scene, headSrc.scene])

  const { body, head, headBone, headUp, armRest, animated, fit } = built
  // Mixamo-skeleton retarget rig for webcam mimic (arms + legs look-at).
  const rig = useMemo(() => buildRig(body), [body])
  // Only auto-play a REAL clip (>0.5s). A T-pose-only download has a 2-frame clip
  // we skip, posing the arms into a rest instead. Mimic always stops it.
  const { actions, names } = useAnimations(soldier.animations, body)
  useEffect(() => {
    if (!animated) return undefined
    const idleName = names.find((n) => /idle/i.test(n)) || names[0]
    const idle = idleName ? actions[idleName] : null
    if (!idle) return undefined
    if (mimic) idle.stop()
    else idle.reset().setLoop(THREE.LoopRepeat, Infinity).play()
    return () => idle?.stop()
  }, [actions, names, mimic, animated])

  const mouseSmooth = useRef(new THREE.Vector3())
  useFrame((state) => {
    if (mimic && rig.ok && poseRef.current) {
      applyPose(rig, poseRef.current, { mirror })
    } else if (!mimic && !animated) {
      // Arms point at the cursor (upper body only - torso/legs never move). The
      // target is the cursor cast onto a plane IN FRONT of the chest (toward the
      // camera), so the forearms reach forward at the screen, never behind the body.
      const cam = state.camera
      _mv.set(state.pointer.x, state.pointer.y, 0.5).unproject(cam).sub(cam.position).normalize()
      if (armRest[0]) {
        armRest[0].bone.getWorldPosition(_sh)
        _n.copy(cam.position).sub(_sh).normalize()          // chest -> camera
        const denom = _mv.dot(_n) || 1
        _mtarget.copy(_sh).addScaledVector(_n, 1.1).sub(cam.position)
        const t = _mtarget.dot(_n) / denom                  // ray hits the front plane
        _mtarget.copy(cam.position).addScaledVector(_mv, t)
        if (mouseSmooth.current.lengthSq() === 0) mouseSmooth.current.copy(_mtarget)
        mouseSmooth.current.lerp(_mtarget, 0.2)
        for (const a of armRest) {
          a.bone.getWorldPosition(_sh)
          pointArm(a, _sh, mouseSmooth.current)
        }
      }
    }
    // hang the head on the head bone (position only, kept upright + forward)
    if (headBone && head) {
      body.updateWorldMatrix(true, true)
      _hm.copy(body.matrixWorld).invert().multiply(headBone.matrixWorld)
      _hp.setFromMatrixPosition(_hm)
      head.position.set(_hp.x, _hp.y + headUp, _hp.z)
      head.quaternion.identity()
    }
  })

  return (
    <group name="monkey" position={MONKEY_POS} {...bind}>
      <group scale={fit.s} position={fit.pos}>
        <primitive object={body} />
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
  const clock = useRef(0)
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

  useFrame(() => {
    if (!active || done.current) return
    if (!started.current) {
      started.current = true
      t.current = 0
      clock.current = performance.now()
      // Capture the SETTLED pose straight off the camera (its current, untouched
      // position/orientation) so the pull-back lands exactly on the normal
      // stage framing - no guessing where the default camera looks.
      const homePos = camera.position.clone()
      const homeQuat = camera.quaternion.clone()
      const m = new THREE.Matrix4().lookAt(startPos.pos, startPos.center, camera.up)
      const startQuat = new THREE.Quaternion().setFromRotationMatrix(m)
      pose.current = { homePos, homeQuat, startQuat }
    }
    // Wall-clock timeline, measured from the first rendered frame (so a slow
    // first frame after the heavy scene load cannot teleport to the end). Real
    // elapsed time, not accumulated frame deltas: the landing->stage handoff is
    // the heaviest moment (GLBs decoding, WebGL contexts collapsing 3->1) and
    // tying the timeline to frame rate stretched the full-screen black fuzz into
    // a multi-second freeze. Wall-clock keeps the hold + zoom-out at ~2s always.
    t.current = (performance.now() - clock.current) / 1000
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

// Default transform of the radial light. Drag/slider it, hit "copy this", and
// paste the pos/rot/scale here to make the new spot the default.
const RADIAL_LIGHT = { position: [0.004, -2.349, -2.576], rotation: [0, 0, 0], scale: [1, 1, 1] }

// A big camera-facing plane textured with a white->black radial gradient: a
// manga "spotlight / moon" that splits the frame into a white disc and black
// void. Unlit (meshBasicMaterial) so it is exactly the gradient regardless of
// scene lights; the manga pass screentones it. Draggable via the shared bind so
// the operator can slide the division around; slider-editable when selected.
function RadialLight({ bind, groupRef }) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 512
    c.height = 512
    const ctx = c.getContext('2d')
    const g = ctx.createRadialGradient(256, 256, 8, 256, 256, 256)
    g.addColorStop(0, '#ffffff')
    g.addColorStop(0.5, '#ffffff')
    g.addColorStop(0.72, '#000000')
    g.addColorStop(1, '#000000')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 512, 512)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [])
  // Idle "breathing" pulse - the disc slowly swells/shrinks and throbs in
  // brightness so the light reads as alive. Applied on an INNER group/material
  // so it rides ON TOP of wherever the operator drags the outer group.
  const pulse = useRef(null)
  const matRef = useRef(null)
  useFrame((state) => {
    const t = state.clock.elapsedTime
    if (pulse.current) pulse.current.scale.setScalar(1 + 0.08 * Math.sin(t * 0.7))
    if (matRef.current) matRef.current.color.setScalar(0.9 + 0.1 * Math.sin(t * 0.9 + 1))
  })
  return (
    <group ref={groupRef} name="radial light" position={RADIAL_LIGHT.position} rotation={RADIAL_LIGHT.rotation} scale={RADIAL_LIGHT.scale} {...bind}>
      <group ref={pulse}>
        <mesh>
          <planeGeometry args={[10, 10]} />
          <meshBasicMaterial ref={matRef} map={tex} toneMapped={false} depthWrite={false} />
        </mesh>
      </group>
    </group>
  )
}

// Page load-in: the whole stage (floor, props, monkey, TVs, radial light) grows
// up + rises into place with an ease-out when the scene first mounts, so the set
// "assembles" on load. Time-based from mount; settles to identity so dragging /
// framing math is unaffected afterwards.
function IntroGroup({ children }) {
  const ref = useRef(null)
  const t = useRef(0)
  const DUR = 1.1
  // Set the entrance pose ONCE, imperatively - passing scale/position as JSX
  // props would let r3f re-apply (reset) them on any re-render mid-animation.
  useLayoutEffect(() => {
    const g = ref.current
    if (g) { g.scale.setScalar(0.7); g.position.y = -0.7 }
  }, [])
  useFrame((_, delta) => {
    const g = ref.current
    if (!g || t.current >= DUR) return
    t.current = Math.min(t.current + delta, DUR)
    const e = 1 - Math.pow(1 - t.current / DUR, 3)
    g.scale.setScalar(0.7 + 0.3 * e)
    g.position.y = (1 - e) * -0.7
  })
  return <group ref={ref}>{children}</group>
}

function MangaRender() {
  const { gl, scene, camera, size } = useThree()
  // `gen` bumps on GPU context restore so the pass (and its render target, which
  // is lost with the context) is rebuilt - otherwise the scene stays pure black
  // after a GPU reset while the DOM labels keep showing.
  const [gen, setGen] = useState(0)
  const pass = useMemo(() => new MangaPass(gl, { grit: 0.75, ink: 0.04 }), [gl, gen])
  useEffect(() => {
    const dpr = gl.getPixelRatio()
    pass.setSize(size.width * dpr, size.height * dpr)
  }, [pass, gl, size.width, size.height])
  useEffect(() => {
    const canvas = gl.domElement
    const onRestored = () => setGen((g) => g + 1)
    canvas.addEventListener('webglcontextrestored', onRestored, false)
    return () => canvas.removeEventListener('webglcontextrestored', onRestored)
  }, [gl])
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
  // Four text monitors, left to right, each placed independently.
  { to: '/pov', label: 'Robot', color: '#7cd4ff', pos: [-1.908, 0.953, 0.322], rot: [0, 0.688, 0.068], scale: 0.67 },
  { to: '/analytics', label: 'Data', color: '#c3a2ff', pos: [-0.616, 1.046, 0.365], rot: [0, 0.065, 0], scale: 0.6 },
  { to: '/teleop', label: 'TeleOp', color: '#ff8fbf', pos: [0.604, 1.045, 0.365], rot: [0, -0.065, 0], scale: 0.6 },
  { to: '/lidar', label: 'Extra', color: '#86e6a0', pos: [1.891, 0.948, 0.323], rot: [0, -0.688, -0.068], scale: 0.66 },
  {
    // POMME monitor - a text TV like the others, hand-placed.
    to: '/', label: 'Pomme', color: '#ffcf3f',
    pos: [0.011, -0.49, 1.11], rot: [-0.547, 0, 0], scale: 0.68,
  },
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
  textScale: 0.49, // group scale for the text (non-POMME) TVs
  faceY: 0, // base yaw; flip by Math.PI if the TVs show their backs
  labelZ: 0.28, // label offset out from the TV centre toward the screen
  labelScale: 5, // drei Html distanceFactor (smaller = smaller label)
  screenY: 0, // vertical offset of the POMME screen (0 = centred on the monitor)
  screenZ: 0.11, // POMME screen offset onto the monitor face (local units)
  screenScale: 3.4, // drei Html distanceFactor for the label frame (text TVs)
  pommeScale: 4.3, // drei Html distanceFactor for the POMME image (bigger monitor)
  screenPx: [200, 128], // screen DOM size (px) - aspect roughly matches the panel
}

// Live TV static drawn onto the monitor face (a plane with a per-frame canvas
// texture). Rendered as a child of the clicked TV so it scales/zooms WITH the
// monitor - the fuzz is on the screen, not the whole viewport.
function TvStaticMesh() {
  const tex = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 40
    const t = new THREE.CanvasTexture(c)
    t.magFilter = THREE.NearestFilter
    t.minFilter = THREE.NearestFilter
    return { c, t }
  }, [])
  useFrame(() => {
    const ctx = tex.c.getContext('2d')
    const img = ctx.createImageData(tex.c.width, tex.c.height)
    const d = img.data
    for (let i = 0; i < d.length; i += 4) {
      const v = (Math.random() * 255) | 0
      d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
    tex.t.needsUpdate = true
  })
  return (
    <mesh position={[0, 0, 0.135]}>
      <planeGeometry args={[1.95, 1.25]} />
      <meshBasicMaterial map={tex.t} toneMapped={false} />
    </mesh>
  )
}

// Camera push-in to a clicked monitor: eases the camera to the pose that frames
// that monitor's face so it fills the viewport (the static screen "encompasses
// the screen"), then fires onDone (the real route change).
function TvZoom({ groupRef, onDone }) {
  const { camera, size } = useThree()
  const started = useRef(false)
  const done = useRef(false)
  const t = useRef(0)
  const clock = useRef(0)
  const from = useRef(null)
  const to = useRef(null)
  const DURATION = 0.85
  useFrame(() => {
    const g = groupRef.current
    if (!g || done.current) return
    if (!started.current) {
      started.current = true
      t.current = 0
      clock.current = performance.now()
      const worldPos = g.getWorldPosition(new THREE.Vector3())
      const worldQuat = g.getWorldQuaternion(new THREE.Quaternion())
      const s = g.scale.x || 1
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(worldQuat).normalize()
      const center = worldPos.clone().add(normal.clone().multiplyScalar(0.14 * s))
      const faceW = 1.95 * s
      const faceH = 1.25 * s
      const fovY = THREE.MathUtils.degToRad(camera.fov)
      const aspect = (size.width || 1) / (size.height || 1)
      const fitH = (faceH / 2) / Math.tan(fovY / 2)
      const fitW = (faceW / 2) / (Math.tan(fovY / 2) * aspect)
      const dist = Math.min(fitH, fitW) * 0.9 // <1 = slight overfill so it fully covers
      const toPos = center.clone().add(normal.clone().multiplyScalar(dist))
      const m = new THREE.Matrix4().lookAt(toPos, center, new THREE.Vector3(0, 1, 0))
      from.current = { pos: camera.position.clone(), quat: camera.quaternion.clone() }
      to.current = { pos: toPos, quat: new THREE.Quaternion().setFromRotationMatrix(m) }
    }
    t.current = (performance.now() - clock.current) / 1000
    const p = Math.min(t.current / DURATION, 1)
    const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2 // easeInOutQuad
    camera.position.lerpVectors(from.current.pos, to.current.pos, e)
    camera.quaternion.slerpQuaternions(from.current.quat, to.current.quat, e)
    if (p >= 1) { done.current = true; onDone() }
  })
  return null
}

function StageTV({ label, color, to, screen, mirrorOf, position, rotation, scale, labelZ, bind, onNav, edit, zoomActive, onReady, registry }) {
  const { scene } = useGLTF(TV_URL)
  const { object, materials } = useMemo(() => {
    const clone = scene.clone(true)
    const mats = []
    // tv-monitor.glb is already stand-free; just brighten it so the monitor reads
    // white through the manga pass (its own texture is dark = pitch black otherwise).
    clone.traverse((o) => {
      if (!o.isMesh || !o.material) return
      const list = Array.isArray(o.material) ? o.material : [o.material]
      // CLONE each material so every TV owns its own - scene.clone(true) shares
      // materials, so without this the per-frame emissive writes fight across all
      // five monitors and they flicker/darken.
      const cloned = list.map((m) => {
        const c = m.clone()
        c.emissive = new THREE.Color(0xffffff)
        c.emissiveMap = null
        c.emissiveIntensity = 1.7 // stay bright (paper-white) at rest, no darkening
        c.color = new THREE.Color(0xffffff)
        c.needsUpdate = true
        mats.push(c)
        return c
      })
      o.material = Array.isArray(o.material) ? cloned : cloned[0]
    })
    const box = new THREE.Box3().setFromObject(clone)
    const centre = new THREE.Vector3()
    box.getCenter(centre)
    clone.position.sub(centre) // recentre on the group origin
    return { object: clone, materials: mats }
  }, [scene])
  const groupRef = useRef(null)
  const [hover, setHover] = useState(false)
  // Set the starting transform imperatively ONCE. After this the group is driven
  // by the drag handlers (bind) so hand-placing a TV sticks - a controlled
  // position prop would snap it back to the arc on every re-render.
  useEffect(() => {
    const g = groupRef.current
    if (!g) return undefined
    g.position.set(position[0], position[1], position[2])
    g.rotation.set(rotation[0], rotation[1], rotation[2])
    g.scale.setScalar(scale)
    onReady?.(to, g) // register for COPY ALL serialization
    return () => onReady?.(to, null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Hover: brighten the monitor (highlight) AND grow it very slightly. Eased so
  // it ramps smoothly. The label grows a touch too (CSS). No grow while editing.
  useFrame((_, delta) => {
    const k = 1 - Math.pow(0.002, delta)
    // Emissive stays constant (set once) so the monitor never darkens on leave;
    // the hover highlight is the radial glow + the slight scale below.
    const g = groupRef.current
    if (!g) return
    // Live mirror: this TV tracks another one across centre (flip X, negate the
    // Y-rotation), so dragging the source moves this one too.
    if (mirrorOf) {
      const src = registry?.current?.get(mirrorOf)
      if (src) {
        // true reflection across x=0: flip X, negate the Y and Z rotations, and
        // copy the source's scale so the pair matches exactly.
        g.position.set(-src.position.x, src.position.y, src.position.z)
        g.rotation.set(src.rotation.x, -src.rotation.y, -src.rotation.z)
        const sTarget = src.scale.x * (!edit && hover ? 1.03 : 1)
        const s = g.scale.x + (sTarget - g.scale.x) * k
        g.scale.setScalar(s)
      }
    } else if (!edit) {
      // On hover: grow a touch (the label, a child, grows too) and lift up a bit.
      const sTarget = scale * (hover ? 1.05 : 1)
      const s = g.scale.x + (sTarget - g.scale.x) * k
      g.scale.setScalar(s)
      const yTarget = position[1] + (hover ? 0.06 : 0)
      g.position.y += (yTarget - g.position.y) * k
    }
  })
  // In edit mode the TV is a draggable/selectable object (bind, no navigation) so
  // you can position it; otherwise it is a nav button (click = go to the page).
  const handlers = edit
    ? { ...bind }
    : { onClick: (event) => { event.stopPropagation(); onNav(to, groupRef.current) } }
  return (
    <group
      ref={groupRef}
      {...handlers}
      onPointerOver={(event) => { event.stopPropagation(); setHover(true) }}
      onPointerOut={() => setHover(false)}
    >
      <primitive object={object} />
      {/* Whole-TV click target so the entire monitor is the button (bubbles to
          the group handlers). Rotates/scales with the TV. */}
      <mesh position={[0, 0, 0.13]}>
        <planeGeometry args={[1.95, 1.25]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {/* Channel-change static on THIS screen while zooming into it. */}
      {zoomActive && <TvStaticMesh />}
      {screen ? (
        // POMME on this monitor's screen face: black-and-white, not pixelated.
        <Html
          center
          transform
          position={[0, TV_ARC.screenY, TV_ARC.screenZ]}
          distanceFactor={TV_ARC.pommeScale}
          pointerEvents="none"
          style={{ width: `${TV_ARC.screenPx[0]}px`, height: `${TV_ARC.screenPx[1]}px`, pointerEvents: 'none' }}
        >
          <img
            src={screen}
            alt=""
            draggable={false}
            style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover', filter: 'grayscale(1) contrast(1.05)' }}
          />
        </Html>
      ) : (
        // Label lives ON the screen (transform): centred, and it rotates/scales
        // together with the TV instead of always facing the camera.
        <Html
          center
          transform
          position={[0, 0, TV_ARC.screenZ]}
          distanceFactor={TV_ARC.screenScale}
          pointerEvents="none"
          style={{
            width: `${TV_ARC.screenPx[0]}px`,
            height: `${TV_ARC.screenPx[1]}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <span
            className={`tv3d-label${hover ? ' is-hover' : ''}`}
            style={hover
              ? { color, textShadow: `0 0 16px ${color}, 0 0 6px ${color}` }
              : { color: '#9aa0a6', textShadow: '0 1px 2px rgba(0, 0, 0, .65)' }}
          >
            {label}
          </span>
        </Html>
      )}
    </group>
  )
}

// Deterministic monitor layout (position / rotation / scale per TV). Shared by
// the nav renderer and the exit zoom-out so the framing matches exactly without
// needing a live group ref.
function layoutTvs() {
  // Only the text TVs (no explicit pos) fan on the arc; index them among
  // themselves so a hand-placed monitor does not leave a gap in the fan.
  const textTVs = NAV_TVS.filter((tv) => !tv.pos)
  const n = textTVs.length
  const spread = THREE.MathUtils.degToRad(TV_ARC.spreadDeg)
  return NAV_TVS.map((tv) => {
    if (tv.pos) {
      return { ...tv, position: tv.pos, rotation: tv.rot || [0, 0, 0], scaleVal: tv.scale ?? 1 }
    }
    const i = textTVs.indexOf(tv)
    const a = -spread / 2 + (n === 1 ? 0 : (i * spread) / (n - 1))
    const x = TV_ARC.center[0] + Math.sin(a) * TV_ARC.radius
    const y = TV_ARC.center[1] - (1 - Math.cos(a)) * TV_ARC.radius * TV_ARC.dome
    return {
      ...tv,
      position: [x, y, TV_ARC.center[2]],
      rotation: [0, TV_ARC.faceY - a * TV_ARC.yaw, 0],
      scaleVal: TV_ARC.textScale,
    }
  })
}

// The camera pose that frames a monitor's face so it fills the viewport (min-fit
// = cover, slight overfill). Used by both the click push-in and the exit
// zoom-out; kept as one helper so enter/exit are exact mirrors.
function tvFramingPose(item, fovDeg, width, height) {
  const pos = new THREE.Vector3(...item.position)
  const quat = new THREE.Quaternion().setFromEuler(new THREE.Euler(...item.rotation))
  const s = item.scaleVal || 1
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(quat).normalize()
  const center = pos.clone().add(normal.clone().multiplyScalar(0.14 * s))
  const faceW = 1.95 * s
  const faceH = 1.25 * s
  const fovY = THREE.MathUtils.degToRad(fovDeg)
  const aspect = (width || 1) / (height || 1)
  const fitH = (faceH / 2) / Math.tan(fovY / 2)
  const fitW = (faceW / 2) / (Math.tan(fovY / 2) * aspect)
  const dist = Math.min(fitH, fitW) * 0.9
  const camPos = center.clone().add(normal.clone().multiplyScalar(dist))
  const m = new THREE.Matrix4().lookAt(camPos, center, new THREE.Vector3(0, 1, 0))
  return { pos: camPos, quat: new THREE.Quaternion().setFromRotationMatrix(m) }
}

// Exit arrival: when we return to the stage after clicking INTO a monitor, start
// the camera framed inside that monitor and ease out to the settled stage view,
// mirroring the push-in. The static reveal (tvTransition) clears over it.
function TvZoomOut({ to }) {
  const { camera, size } = useThree()
  const started = useRef(false)
  const done = useRef(false)
  const t = useRef(0)
  const home = useRef(null)
  const DURATION = 1.0
  const framing = useMemo(() => {
    const item = layoutTvs().find((it) => it.to === to)
    return item ? tvFramingPose(item, camera.fov, size.width, size.height) : null
  }, [to, camera.fov, size.width, size.height])

  useFrame((_, delta) => {
    if (!framing || done.current) return
    if (!started.current) {
      started.current = true
      t.current = 0
      // Capture the settled home pose (as configured on the Canvas), then jump
      // the camera into the monitor so the pull-back starts fully zoomed in.
      home.current = { pos: camera.position.clone(), quat: camera.quaternion.clone() }
      camera.position.copy(framing.pos)
      camera.quaternion.copy(framing.quat)
    }
    t.current += Math.min(delta, 0.05)
    const p = Math.min(t.current / DURATION, 1)
    const e = 1 - Math.pow(1 - p, 3) // easeOutCubic
    camera.position.lerpVectors(framing.pos, home.current.pos, e)
    camera.quaternion.slerpQuaternions(framing.quat, home.current.quat, e)
    if (p >= 1) done.current = true
  })
  return null
}

function StageTVNav({ bind, onNav, edit, zoomTo, onReady, registry }) {
  const items = useMemo(layoutTvs, [])
  return (
    <group>
      {/* The nav sits above the stage spotlight, so give the TV arc its own light
          or the manga pass renders them near-black on the black ceiling. */}
      <pointLight position={[0, TV_ARC.center[1] + 0.6, TV_ARC.center[2] + 2.4]} intensity={38} distance={9} decay={2} />
      {items.map((it) => (
        <StageTV key={it.to} {...it} scale={it.scaleVal} labelZ={TV_ARC.labelZ} bind={bind} onNav={onNav} edit={edit} zoomActive={zoomTo === it.to} onReady={onReady} registry={registry} />
      ))}
    </group>
  )
}

// Which monitor we last dived INTO. Module-scope so it survives the unmount when
// the route changes; on returning to the stage we zoom back OUT of it. Consumed
// (cleared) once, so a later plain visit to /stage does not replay the pull-out.
let pendingTvOut = null

// edit: false = clean stage (TVs are nav buttons, no editor UI). 'tv' = position
// the nav TVs (they become draggable/selectable, props stay locked).
export default function MonkeyStage({ showNav = true, playIntro = false, liveScene = true, edit = false }) {
  const editTV = edit === 'tv'
  // Clicking a monitor "changes the channel": the clicked monitor's screen fills
  // with static, the camera pushes IN until that screen fills the viewport, then
  // tvNavigate swaps the route and clears the static over the new page (reveal).
  const { tvNavigate } = useTvTransition()
  const [zoomTo, setZoomTo] = useState(null) // the `to` of the monitor being entered
  const zoomGroupRef = useRef(null) // live THREE group of that monitor (for framing)
  const startZoom = useCallback((to, group) => {
    if (zoomTo || !group) return // ignore repeat clicks mid-transition
    // Warm the destination chunk now (during the ~0.85s zoom + static cover), so
    // the tune-in reveal fades over the real page instead of a blank loader.
    preloadRoute(to)
    zoomGroupRef.current = group
    pendingTvOut = to // remember it so the return pulls back out of this monitor
    setZoomTo(to)
  }, [zoomTo])
  // On mount, consume any pending "exit" monitor: if we arrived by clicking into
  // a TV, play the reverse pull-out. Never on the tv-positioning editor route.
  const [tvOut] = useState(() => {
    if (editTV) return null
    const v = pendingTvOut
    pendingTvOut = null
    return v
  })
  const spotTarget = useMemo(() => new THREE.Object3D(), [])
  // Shared handle so the camera intro drives the on-screen fuzz opacity.
  const fuzzRef = useRef({ opacity: 0 })
  const splash = useSplash()
  const [sceneAvailable, setSceneAvailable] = useState(false)
  const [selected, setSelected] = useState(null)
  const [transformMode, setTransformMode] = useState('translate')
  // Mimic mode: the monkey copies the operator's body via the webcam pose.
  const [mimic, setMimic] = useState(false)
  const [mirror, setMirror] = useState(false)
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
  // Live TV monitor groups, keyed by route, so COPY ALL can serialize the TVs too.
  const tvGroups = useRef(new Map())
  // Live radial-light group so COPY ALL can serialize it (into RADIAL_LIGHT).
  const radialRef = useRef(null)
  const onTvReady = useCallback((to, group) => {
    if (group) tvGroups.current.set(to, group)
    else tvGroups.current.delete(to)
  }, [])

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
    // TV monitors, keyed by route - paste these pos/rot/scale into NAV_TVS.
    const tvRows = []
    tvGroups.current.forEach((g, to) => {
      if (!g) return
      const p = g.position
      const rot = g.rotation
      const s = g.scale
      tvRows.push(`  { to: '${to}', pos: [${r(p.x)}, ${r(p.y)}, ${r(p.z)}], rot: [${r(rot.x)}, ${r(rot.y)}, ${r(rot.z)}], scale: ${r(s.x)} },`)
    })
    const tvBlock = tvRows.length ? `\n\n// TV MONITORS (into NAV_TVS):\n${tvRows.join('\n')}` : ''
    // Radial light (into RADIAL_LIGHT) - read live off its group.
    const rl = radialRef.current
    const rlBlock = rl
      ? `\n\n// RADIAL LIGHT (into RADIAL_LIGHT):\nconst RADIAL_LIGHT = { position: [${r(rl.position.x)}, ${r(rl.position.y)}, ${r(rl.position.z)}], rotation: [${r(rl.rotation.x)}, ${r(rl.rotation.y)}, ${r(rl.rotation.z)}], scale: [${r(rl.scale.x)}, ${r(rl.scale.y)}, ${r(rl.scale.z)}] }`
      : ''
    return `export const DEFAULT_PLACEMENT = [\n${rows.join('\n')}\n]${tvBlock}${rlBlock}`
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
        dpr={[1, 1.25]}
        camera={{ position: CAM_HOME, fov: 32, near: 0.1, far: 100 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
      >
        <CanvasGuard />
        <color attach="background" args={['#000000']} />
        <CameraIntro active={playIntro && !tvOut} fuzzRef={fuzzRef} />
        {tvOut && <TvZoomOut to={tvOut} />}
        {/* The heavy scene (lights, backdrop, monkey, TV nav, props, manga
            post-process) renders only once the stage takes over (liveScene).
            On the landing it stays empty, so the stage does not add a third
            heavy WebGL scene next to the painterly iframe and the robot splat -
            that combo was losing the GPU context and blacking out the stage
            after the handoff. Direct /stage visits default liveScene=true. */}
        {liveScene && (
        <>
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
        {/* Backdrop wall removed - pure black void. Everything below grows in on
            load via IntroGroup. */}
        <IntroGroup>
          {/* Black floor - grounds the scene; catches the spotlights as a manga
              tone pool, and the radial disc reads like a moon behind its edge. */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, FLOOR, 0]}>
            <planeGeometry args={[60, 60]} />
            <meshStandardMaterial color="#050505" roughness={1} />
          </mesh>
          <RadialLight bind={bind} groupRef={radialRef} />
          <Suspense fallback={null}>
            <Monkey bind={bind} poseRef={poseRef} mimic={mimic} mirror={mirror} />
            {showNav && <StageTVNav bind={bind} onNav={editTV ? () => {} : startZoom} edit={editTV} zoomTo={zoomTo} onReady={onTvReady} registry={tvGroups} />}
          </Suspense>
          {placed.map((inst) => {
            const catalog = CATALOG_BY_ID[inst.catalogId]
            if (!catalog) return null
            return (
              <PropBoundary key={inst.id}>
                <Suspense fallback={null}>
                  {/* Props are locked on the clean stage, draggable in the editor. */}
                  <StageProp inst={inst} catalog={catalog} bind={editTV ? bind : undefined} onReady={onPropReady} />
                </Suspense>
              </PropBoundary>
            )
          })}
        </IntroGroup>
        {zoomTo && <TvZoom groupRef={zoomGroupRef} onDone={() => tvNavigate(zoomTo)} />}
        <MangaRender />
        </>
        )}
      </Canvas>
      {/* Fullscreen tune-in static for the landing->stage arrival. */}
      <StageFuzz fuzzRef={fuzzRef} />
      {/* Editor UI only in the TV-positioning route; the plain /stage is clean. */}
      {editTV && (
        <div className="stage-editor" role="toolbar" aria-label="Edit the stage">
          <span>Drag a TV or prop · W/E/R + arrows · COPY THIS for coords</span>
          {['translate', 'rotate', 'scale'].map((m) => (
            <button key={m} className={transformMode === m ? 'is-active' : ''} onClick={() => setTransformMode(m)}>
              {m}
            </button>
          ))}
          <button className={paletteOpen ? 'is-active' : ''} onClick={() => setPaletteOpen((v) => !v)}>add prop</button>
          <button onClick={duplicateSelected}>duplicate</button>
          <button onClick={deleteSelected}>delete</button>
        </div>
      )}
      {editTV && paletteOpen && (
        <div className="stage-palette" role="menu" aria-label="Place a prop">
          <div className="stage-palette-head">Place a prop</div>
          <div className="stage-palette-grid">
            {PROP_CATALOG.map((p) => (
              <button key={p.id} onClick={() => addProp(p.id)} title={`Add ${p.label}`}>{p.label}</button>
            ))}
          </div>
          <div className="stage-palette-note">Drops in front of the monkey - drag it into place.</div>
        </div>
      )}
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
      {/* The transform panel (with copy) shows in the editor, and also on the
          clean stage when the radial light is picked - so it can be copied. */}
      {(editTV || selected?.name === 'radial light') && (
        <TransformSliders selected={selected} getAll={serializeAll} />
      )}
    </div>
  )
}

useGLTF.preload(BODY_URL)
useGLTF.preload(HEAD_SRC_URL)
useGLTF.preload(TV_URL)
