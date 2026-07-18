// RobotRollIn - the Gaussian-splatted real robot (scanned from video via the
// OpenSplat pipeline) rolling onto the landing from the side, then settling into
// a slow idle turntable spin. Rendered as a transparent overlay Canvas above the
// painterly backdrop but below the landing UI (pointer-events: none).
//
// The splat file is pre-centered + scaled (see robot-splat/*.py), so SPLAT_FIX
// only carries the by-eye ORIENTATION. Add ?tunesplat to the URL for live
// rotate/scale sliders (the roll-in is frozen so you can orient it), then hit
// copy and paste the values back to bake them into SPLAT_FIX.

import { Component, Suspense, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Splat } from '@react-three/drei'

const SPLAT_URL = '/assets/robot.splat'

// By-eye orientation of the (already centered + scaled) splat, tuned in
// ?tunesplat so it drives in upright and facing forward.
const SPLAT_FIX = {
  rotation: [0.158, 2.348, -0.062], // radians, XYZ
  scale: 1.3,
}

// The overlay camera is matched EXACTLY to the orchard scene's rest camera
// (natureScene.js: fov 25, pos (5.2,2.4,6.9), aims (-0.4,1.0,-0.4)), so the cart
// lives in the SAME world coordinates as the painted scene - grounded on the
// real meadow floor (Y=-0.95), not floating in screen space.
const CAM_POS = [5.2, 2.4, 6.9]
const CAM_TGT = [-0.4, 1.0, -0.4]
const RIG_YAW = 0.654 // scene rig yaw: screen-right axis in world XZ

// World drive path along the floor. TARGET is the END spot (tune it in ?tunesplat
// - drag the end sliders, copy, paste to bake). Default sits left of the apple.
const FLOOR_Y = -0.95 // scene ground plane
const CART_LIFT = 0.55 // raise the cart centre so its base sits on the floor (tune)
const WORLD_SCALE = 0.9 // shrink the 2.4u splat to scene scale (tune)
const TARGET = [-3.45, -0.05, 0.28] // end location (lowered a bit)
const DRIVE_DIST = 10 // how far off-screen it starts (longer run = more momentum)
const DRIVE_DUR = 2.8 // seconds to drive in
const DRIVE_DELAY = 0 // drive in right as the apple slams (no wait)
// Side entry: START sits off-screen along the floor (screen-left of TARGET). The
// cart drives STRAIGHT toward TARGET facing its travel direction the whole way,
// then turns to the final (camera-facing) heading at the end.
const RIGHT = [Math.cos(RIG_YAW), 0, -Math.sin(RIG_YAW)] // screen-right axis in world
const START = [TARGET[0] - RIGHT[0] * DRIVE_DIST, TARGET[1], TARGET[2] - RIGHT[2] * DRIVE_DIST]
const TRAVEL_YAW = Math.atan2(RIGHT[0], RIGHT[2]) // heading while driving in (forward = travel dir)

const TUNE = typeof window !== 'undefined' && window.location.search.includes('tunesplat')
const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3)

// Slave the overlay camera to the scene's LIVE camera. split.js posts { type:
// 'ht6-cam', p, q, fov } every frame; we copy that pose so the overlay shares
// the scene's exact view - the rover then stays anchored in the world through
// the impact shake / parallax / ascent instead of sitting screen-fixed. Falls
// back to the static rest pose if no feed (orchard mode / message dropped).
function SyncCamera() {
  const { camera } = useThree()
  const pose = useRef(null)
  useLayoutEffect(() => {
    camera.lookAt(CAM_TGT[0], CAM_TGT[1], CAM_TGT[2])
    camera.updateProjectionMatrix()
  }, [camera])
  useEffect(() => {
    const onMsg = (e) => { if (e.data?.type === 'ht6-cam') pose.current = e.data }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])
  useFrame(() => {
    const d = pose.current
    if (!d) return
    camera.position.set(d.p[0], d.p[1], d.p[2])
    camera.quaternion.set(d.q[0], d.q[1], d.q[2], d.q[3])
    if (d.fov && Math.abs(camera.fov - d.fov) > 0.01) { camera.fov = d.fov; camera.updateProjectionMatrix() }
  })
  return null
}

// Continuous engine idle: high-freq vibration + slow rock, always running so the
// parked cart looks alive. `punch` adds the drive-in suspension bump.
function engineShake(b, now, punch = 0) {
  const vib = Math.sin(now * 43) * 0.006 + Math.sin(now * 27) * 0.004
  const rock = Math.sin(now * 2.4) * 0.02
  b.position.y = rock + vib + punch
  b.rotation.z = Math.sin(now * 39) * 0.012
  b.rotation.x = Math.sin(now * 33) * 0.009
}

// Cart drives along the floor in WORLD space from screen-left to the apple, then
// yaws to face the camera. Triggered by the apple slam (startRef).
function RollingRobot({ fixRef, startRef }) {
  const outer = useRef(null) // world placement (position + yaw + world scale)
  const rig = useRef(null) // engine shake + drive bounce
  const fix = useRef(null) // splat orientation (SPLAT_FIX / tune)
  const t0 = useRef(null)
  const clock = useRef(0) // clamped-delta clock so a backgrounded tab can't jump the drive-in
  // turnP 0 = facing the travel direction (driving away into the scene);
  // turnP 1 = U-turned to point back at the live camera.
  const place = (g, x, y, z, turnP, camPos) => {
    g.position.set(x, y, z)
    const faceYaw = Math.atan2(camPos.x - x, camPos.z - z)
    let delta = faceYaw - TRAVEL_YAW
    delta = Math.atan2(Math.sin(delta), Math.cos(delta)) // shortest arc (~180 = the U-turn)
    g.rotation.set(0, TRAVEL_YAW + delta * turnP, 0)
    g.scale.setScalar(WORLD_SCALE)
  }
  useFrame((state, delta) => {
    const camPos = state.camera.position
    const f = fix.current
    if (f) {
      const r = TUNE ? fixRef.current : SPLAT_FIX
      f.rotation.set(r.rotation[0], r.rotation[1], r.rotation[2])
      f.scale.setScalar(r.scale)
    }
    if (TUNE) {
      // Tune mode: park at the live end location, U-turned to face the camera.
      const tg = fixRef.current.target || TARGET
      if (outer.current) place(outer.current, tg[0], tg[1], tg[2], 1, camPos)
      return
    }
    const g = outer.current
    const b = rig.current
    // Advance a clamped clock, not the raw scene clock: leaving the tab pauses
    // the loop, and the first frame back carries a multi-second delta that would
    // jump the drive-in straight to "arrived" (the robot coming in early). Clamp
    // it so the drive-in pauses with the rest of the scene and resumes in sync.
    clock.current += Math.min(delta, 0.05)
    const now = clock.current
    if (!startRef.current) { // idling in the foreground, waiting for the apple slam
      if (g) place(g, START[0], START[1], START[2], 0, camPos)
      t0.current = null
      if (b) engineShake(b, now)
      return
    }
    if (t0.current == null) t0.current = now
    // Hold off-screen for DRIVE_DELAY after the slam, THEN drive in.
    const t = now - t0.current - DRIVE_DELAY
    const pRaw = Math.min(Math.max(t, 0) / DRIVE_DUR, 1)
    const e = easeOutCubic(pRaw)
    const arriving = 1 - e
    // Drive straight forward with power for the first ~35%, THEN ease the turn
    // in gradually over the rest (smooth, not a snap) so it arrives facing final.
    const tp = Math.min(Math.max((pRaw - 0.35) / 0.65, 0), 1)
    const turnP = tp * tp * (3 - 2 * tp) // smoothstep after the forward lead-in
    if (g) {
      place(
        g,
        START[0] + (TARGET[0] - START[0]) * e,
        START[1] + (TARGET[1] - START[1]) * e,
        START[2] + (TARGET[2] - START[2]) * e,
        turnP,
        camPos,
      )
    }
    if (b) engineShake(b, now, Math.sin(t * 19) * 0.05 * arriving)
  })
  return (
    <group ref={outer}>
      <group ref={rig}>
        <group ref={fix}>
          <Splat src={SPLAT_URL} />
        </group>
      </group>
    </group>
  )
}

// A missing/failed splat file must never take the landing down.
class SplatBoundary extends Component {
  state = { dead: false }
  static getDerivedStateFromError() {
    return { dead: true }
  }
  render() {
    return this.state.dead ? null : this.props.children
  }
}

// Live orientation sliders (only with ?tunesplat). Writes to a ref the splat
// group reads each frame - no re-render - then copy the values to bake them.
const ROWS = [
  ['rot x', 'rx', -Math.PI, Math.PI, 0.01],
  ['rot y', 'ry', -Math.PI, Math.PI, 0.01],
  ['rot z', 'rz', -Math.PI, Math.PI, 0.01],
  ['scale', 'sc', 0.2, 3, 0.01],
  ['end x', 'ex', -5, 5, 0.05],
  ['end y', 'ey', -3, 3, 0.05],
  ['end z', 'ez', -5, 5, 0.05],
]
function TunePanel({ fixRef }) {
  const set = (key, v) => {
    const f = fixRef.current
    if (key === 'sc') f.scale = v
    else if (key[0] === 'r') f.rotation['xyz'.indexOf(key[1])] = v
    else f.target['xyz'.indexOf(key[1])] = v // end x/y/z
  }
  const dv = (key) => {
    const f = fixRef.current
    if (key === 'sc') return f.scale
    if (key[0] === 'r') return 0
    return f.target['xyz'.indexOf(key[1])]
  }
  const copy = (e) => {
    const r = (n) => Number(n.toFixed(3))
    const f = fixRef.current
    const text = `rotation: [${r(f.rotation[0])}, ${r(f.rotation[1])}, ${r(f.rotation[2])}], scale: ${r(f.scale)}, target(end): [${r(f.target[0])}, ${r(f.target[1])}, ${r(f.target[2])}]`
    navigator.clipboard?.writeText(text).then(
      () => { e.target.textContent = 'copied' },
      () => { e.target.textContent = 'copy failed' },
    )
    setTimeout(() => { if (e.target) e.target.textContent = 'copy values' }, 1200)
  }
  return (
    <div className="splat-tune">
      <div className="splat-tune-head">robot: orient + end spot</div>
      {ROWS.map(([label, key, min, max, step]) => (
        <label className="slider-row" key={key}>
          <span className="slider-label">{label}</span>
          <input type="range" min={min} max={max} step={step}
            defaultValue={dv(key)}
            onInput={(e) => set(key, parseFloat(e.target.value))} />
        </label>
      ))}
      <button className="stage-sliders-copy" onClick={copy}>copy values</button>
    </div>
  )
}

export default function RobotRollIn() {
  const fixRef = useRef({ rotation: [0, 0, 0], scale: 1, target: [...TARGET] })
  useMemo(() => { fixRef.current = { rotation: [...SPLAT_FIX.rotation], scale: SPLAT_FIX.scale, target: [...TARGET] } }, [])
  // The cart waits off-screen until the EXACT apple-impact frame. The scene posts
  // { phase: 'slam' } only on real impact (not the early grow path), so the cart
  // drives in right as the apple hits - not before. Fallback covers orchard mode
  // (no scene) or a dropped message. In tune mode it drives in immediately.
  const started = useRef(TUNE)
  useEffect(() => {
    if (TUNE) return undefined
    const onMsg = (e) => { if (e.data?.phase === 'slam') started.current = true }
    window.addEventListener('message', onMsg)
    // Long safety net ONLY for orchard mode (no scene) or a dropped message -
    // well past any real apple slam, so a slow scene load never preempts it.
    const fallback = window.setTimeout(() => { started.current = true }, 14000)
    return () => { window.removeEventListener('message', onMsg); window.clearTimeout(fallback) }
  }, [])
  return (
    <div className="robot-rollin" aria-hidden="true">
      <Canvas
        // r3f writes inline pointer-events:auto on its container, overriding the
        // layer's none; force none so the splat never swallows landing clicks.
        style={{ pointerEvents: 'none' }}
        dpr={[1, 1.5]}
        gl={{ alpha: true, antialias: true }}
        camera={{ position: CAM_POS, fov: 25, near: 0.1, far: 100 }}
      >
        <SyncCamera />
        <SplatBoundary>
          <Suspense fallback={null}>
            <RollingRobot fixRef={fixRef} startRef={started} />
          </Suspense>
        </SplatBoundary>
      </Canvas>
      {TUNE && <TunePanel fixRef={fixRef} />}
    </div>
  )
}
