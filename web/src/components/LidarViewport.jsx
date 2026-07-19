import { Component, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Grid, Html, Line, OrbitControls, Splat } from '@react-three/drei'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as THREE from 'three'
import { useRobot, useRobotEvent } from '../lib/robot.jsx'
import { CanvasGuard, SAFE_DPR } from '../lib/canvasGuard.jsx'

const DECAY_MS = 4000
const MAX_SCANS = 16
const SENSOR_H = 0.15
const WORLD_RELOAD_MS = 3000
const DEFAULT_WORLD_URL = '/world.glb'

// SLAM occupancy map: base64 uint8 grid, 0=free 100=occupied 255=unknown,
// capped at 128x128 cells per the schema.
const MAX_CELLS = 128 * 128
// planeGeometry lies in XY; this tips every instance flat onto the ground plane.
const FLAT_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))
const CONE_UP = new THREE.Vector3(0, 1, 0)

// --- Robot representation: the Gaussian splat capture of the actual rover ---
// The splat sits at the live slam_pose and turns with the heading. A capture's
// native scale/orientation is arbitrary, so these are the alignment knobs -
// tweak them until the rover sits upright, on the ground, facing its travel
// direction. (Rotations in radians.)
const ROBOT_SPLAT_URL = '/assets/robot.splat'
const ROBOT_SPLAT_SCALE = 0.6 // overall size on the map (raise/lower to match ~0.4 m rover)
const ROBOT_SPLAT_ROT = [0, 0, 0] // [rx,ry,rz] correction for the capture's native axes
const ROBOT_SPLAT_Y = 0.0 // vertical offset so the rover's base rests on the floor plane

function b64ToBytes(b64) {
  try {
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

// World meters (SLAM frame) -> three.js coords. Matches the live-scan mapping so
// the accumulated map, the scan sweep and the robot marker all share one frame.
function worldToThree(wx, wy, out) {
  return out.set(-wy, SENSOR_H, -wx)
}

// Persistent occupancy grid. Each slam_map event repaints two InstancedMeshes
// (occupied cells solid, free cells faint) so the map accumulates and stays put
// while the robot drives - the "it's building a map" view, not a fading radar.
function SlamMap({ showFreeSpace, occupiedColor, freeColor }) {
  const occRef = useRef()
  const freeRef = useRef()
  const dummy = useRef(new THREE.Object3D()).current
  const pos = useRef(new THREE.Vector3()).current

  useEffect(() => {
    if (occRef.current) occRef.current.count = 0
    if (freeRef.current) freeRef.current.count = 0
  }, [])

  useRobotEvent('slam_map', (msg) => {
    if (!msg || typeof msg.data !== 'string') return
    const bytes = b64ToBytes(msg.data)
    if (!bytes) return
    const { width, height, resolution: res } = msg
    if (!Array.isArray(msg.origin) || bytes.length !== width * height) return
    const [ox, oy] = msg.origin
    const occM = occRef.current
    const freeM = freeRef.current
    const cell = res * 0.98 // small gap so tiles read as a grid
    let no = 0
    let nf = 0
    for (let iy = 0; iy < height; iy++) {
      const wy = oy + (iy + 0.5) * res
      for (let ix = 0; ix < width; ix++) {
        const v = bytes[iy * width + ix]
        if (v === 255) continue // unknown: leave empty
        const occupied = v >= 100
        if (!occupied && !showFreeSpace) continue
        worldToThree(ox + (ix + 0.5) * res, wy, pos)
        pos.y = occupied ? 0.03 : 0.02
        dummy.position.copy(pos)
        dummy.quaternion.copy(FLAT_Q)
        dummy.scale.set(cell, cell, 1)
        dummy.updateMatrix()
        if (occupied) {
          if (occM && no < MAX_CELLS) occM.setMatrixAt(no++, dummy.matrix)
        } else if (freeM && nf < MAX_CELLS) {
          freeM.setMatrixAt(nf++, dummy.matrix)
        }
      }
    }
    if (occM) {
      occM.count = no
      occM.instanceMatrix.needsUpdate = true
    }
    if (freeM) {
      freeM.count = nf
      freeM.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <>
      <instancedMesh
        ref={freeRef}
        args={[undefined, undefined, MAX_CELLS]}
        frustumCulled={false}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          color={freeColor}
          transparent
          opacity={0.16}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
      <instancedMesh
        ref={occRef}
        args={[undefined, undefined, MAX_CELLS]}
        frustumCulled={false}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          color={occupiedColor}
          transparent
          opacity={0.9}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
    </>
  )
}

// Robot marker driven by slam_pose. Eases toward the latest pose so the cone
// glides across the map and its nose points along robot-forward.
// Robot marker: the actual rover, rendered as its Gaussian splat capture. It
// glides to the live slam_pose and yaws to the heading. A small ground dot marks
// the exact pose so position stays readable even if the splat is subtle/offset;
// a cone stands in while the splat streams in.
function PoseMarker({ poseRef, color, splatRot, splatScale }) {
  const grp = useRef()
  const spin = useRef()
  const target = useRef(new THREE.Vector3()).current
  useFrame(() => {
    if (!grp.current) return
    // Default to the origin so the rover ALWAYS shows - even before any pose or
    // with no connection. When a slam_pose arrives it glides there and turns.
    const p = poseRef.current
    const px = p ? p.x : 0
    const py = p ? p.y : 0
    const th = p ? p.theta : 0
    worldToThree(px, py, target)
    target.y = ROBOT_SPLAT_Y
    grp.current.position.lerp(target, 0.25)
    if (spin.current) {
      // robot heading -> yaw about the vertical (three) axis; wrap the delta so
      // it never spins the long way round the +/-pi seam.
      const yaw = Math.atan2(-Math.sin(th), -Math.cos(th))
      let d = yaw - spin.current.rotation.y
      d = Math.atan2(Math.sin(d), Math.cos(d))
      spin.current.rotation.y += d * 0.25
    }
  })
  return (
    <group ref={grp}>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.06, 20]} />
        <meshBasicMaterial color={color} />
      </mesh>
      <group ref={spin}>
        <Suspense
          fallback={
            <mesh>
              <coneGeometry args={[0.12, 0.36, 4]} />
              <meshBasicMaterial color={color} />
            </mesh>
          }
        >
          <group rotation={splatRot ?? ROBOT_SPLAT_ROT} scale={splatScale ?? ROBOT_SPLAT_SCALE}>
            <Splat src={ROBOT_SPLAT_URL} />
          </group>
        </Suspense>
      </group>
    </group>
  )
}

class ModelBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    this.props.onFail?.()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

function disposeObject(obj) {
  obj.traverse((child) => {
    child.geometry?.dispose?.()
    if (Array.isArray(child.material)) child.material.forEach((m) => m?.dispose?.())
    else child.material?.dispose?.()
  })
}

function tintWorldMaterials(root) {
  root.traverse((child) => {
    if (!child.isMesh || !child.material) return
    const mats = Array.isArray(child.material) ? child.material : [child.material]
    mats.forEach((mat) => {
      if ('color' in mat && mat.color) mat.color.multiplyScalar(0.72)
      if ('roughness' in mat) mat.roughness = Math.min(1, (mat.roughness ?? 0.8) + 0.12)
      if ('metalness' in mat) mat.metalness = 0
      if ('transparent' in mat) mat.transparent = false
      mat.needsUpdate = true
    })
  })
}

function WorldModel({
  onFail,
  reloadMs = WORLD_RELOAD_MS,
  fitView = false,
  autoFitEnabled = true,
}) {
  const { scene, camera, invalidate } = useThree()
  const worldRef = useRef(null)
  const okRef = useRef(false)
  const worldSigRef = useRef(null)
  const acceptedRef = useRef({ maxDim: 0, faceCount: 0 })
  // Auto-fit the camera ONCE. A live scan rewrites world.glb every ~2s; re-fitting
  // on every reload yanks the camera around (and a stray far voxel blows up the
  // bounds so the model shrinks to nothing, then snaps back = the flashing).
  const fittedRef = useRef(false)

  useEffect(() => {
    const loader = new GLTFLoader()
    let cancelled = false

    const loadWorld = (sig) => {
      const url = `${DEFAULT_WORLD_URL}?t=${Date.now()}`
      loader.load(
        url,
        (gltf) => {
          if (cancelled) return
          const box = new THREE.Box3().setFromObject(gltf.scene)
          if (box.isEmpty()) {
            if (!okRef.current) onFail?.(new Error('world.glb loaded with no geometry'))
            return
          }
          let faceCount = 0
          gltf.scene.traverse((obj) => {
            if (!obj.isMesh || !obj.geometry) return
            // A live scan mesh grows every 2s; never let a transient bad bounding
            // sphere frustum-cull the whole world (loads-then-vanishes bug).
            obj.frustumCulled = false
            const pos = obj.geometry.attributes?.position
            if (obj.geometry.index) faceCount += Math.floor(obj.geometry.index.count / 3)
            else if (pos) faceCount += Math.floor(pos.count / 3)
          })
          const size = box.getSize(new THREE.Vector3())
          const maxDim = Math.max(size.x, size.y, size.z, 0)
          const last = acceptedRef.current
          const suspiciousShrink =
            last.maxDim > 0.75 &&
            maxDim < last.maxDim * 0.18 &&
            faceCount < Math.max(250, Math.floor(last.faceCount * 0.2))
          if (suspiciousShrink) return

          worldSigRef.current = sig ?? worldSigRef.current
          if (worldRef.current) {
            scene.remove(worldRef.current)
            disposeObject(worldRef.current)
          }
          const root = new THREE.Group()
          const center = box.getCenter(new THREE.Vector3())
          gltf.scene.position.x -= center.x
          gltf.scene.position.y -= box.min.y
          gltf.scene.position.z -= center.z
          tintWorldMaterials(gltf.scene)

          if (fitView && autoFitEnabled && !fittedRef.current) {
            // Frame the room from ~1 diagonal away (matches the known-good
            // viewer.html). The old maxDim*2.4 sat ~14 m back, shrinking the
            // model to an invisible speck.
            const d = Math.max(size.x, size.y, size.z, 0.6)
            camera.position.set(d * 0.62, Math.max(1.1, size.y * 0.7 + d * 0.35), d * 0.62)
            camera.lookAt(0, Math.max(0.2, size.y * 0.4), 0)
            camera.updateProjectionMatrix()
            fittedRef.current = true // fit once, then let the live mesh grow in place
          }
          root.add(gltf.scene)
          worldRef.current = root
          scene.add(root)
          okRef.current = true
          acceptedRef.current = { maxDim, faceCount }
          // The scene was mutated imperatively (outside R3F's reconciler). Under a
          // non-continuous frameloop that change isn't drawn until something asks
          // for a frame, so the freshly added world can sit invisible. Request one.
          invalidate()
        },
        undefined,
        (err) => {
          if (!okRef.current) onFail?.(err)
        },
      )
    }

    const pollWorld = async () => {
      try {
        const res = await fetch(DEFAULT_WORLD_URL, {
          method: 'HEAD',
          cache: 'no-store',
        })
        if (!res.ok) return
        const sig = [
          res.headers.get('etag') ?? '',
          res.headers.get('last-modified') ?? '',
          res.headers.get('content-length') ?? '',
        ].join('|')
        if (!worldSigRef.current || sig !== worldSigRef.current) loadWorld(sig)
      } catch (err) {
        if (!okRef.current) onFail?.(err)
      }
    }

    pollWorld()
    const timer = setInterval(pollWorld, reloadMs)
    return () => {
      cancelled = true
      clearInterval(timer)
      if (worldRef.current) {
        scene.remove(worldRef.current)
        disposeObject(worldRef.current)
        worldRef.current = null
        invalidate()
      }
    }
  }, [autoFitEnabled, camera, fitView, onFail, reloadMs, scene, invalidate])

  return null
}

function CameraTarget({ target, onInteract }) {
  const { camera } = useThree()
  const controlsRef = useRef()

  useEffect(() => {
    if (!target) return
    const [x, y, z] = target
    controlsRef.current?.target.set(x, y, z)
    controlsRef.current?.update()
    camera.lookAt(x, y, z)
  }, [camera, target?.[0], target?.[1], target?.[2]])

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      dampingFactor={0.08}
      screenSpacePanning
      minDistance={0.25}
      maxDistance={30}
      zoomSpeed={0.85}
      panSpeed={0.9}
      rotateSpeed={0.75}
      maxPolarAngle={Math.PI / 1.9}
      touches={{
        ONE: THREE.TOUCH.ROTATE,
        TWO: THREE.TOUCH.DOLLY_PAN,
      }}
      onStart={() => onInteract?.()}
    />
  )
}

function ScanPoints({ positions, receivedAt, color, size, decayMs }) {
  const matRef = useRef()
  useFrame(() => {
    if (!matRef.current) return
    if (!Number.isFinite(decayMs) || decayMs <= 0) {
      matRef.current.opacity = 0.96
      return
    }
    const age = performance.now() - receivedAt
    matRef.current.opacity = Math.max(0, 1 - age / decayMs)
  })
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        ref={matRef}
        color={color}
        size={size}
        transparent
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  )
}

function AutoOrbit() {
  useFrame((s) => {
    const t = s.clock.elapsedTime * 0.22
    s.camera.position.set(Math.sin(t) * 4.6, 4.2, Math.cos(t) * 4.6)
    s.camera.lookAt(0, 0.3, -1)
  })
  return null
}

// Inverse of worldToThree: a three-space ground point -> SLAM world meters.
function threeToWorld(pt) {
  return [-pt.z, -pt.x] // wx = -z, wy = -x
}

// The planned route to the goal, drawn as a bright polyline hovering just over
// the map. Recomputed only when the path points change.
function NavPath({ points, color }) {
  const pts = useMemo(() => {
    if (!Array.isArray(points) || points.length < 2) return null
    return points.map(([wx, wy]) => [-wy, SENSOR_H + 0.05, -wx])
  }, [points])
  if (!pts) return null
  return <Line points={pts} color={color} lineWidth={3} dashed dashScale={8} transparent opacity={0.95} />
}

// Destination pin at the declared goal: a pulsing ground ring plus a small
// standing marker so it reads from the map's default oblique angle.
function GoalMarker({ goal, color, reached }) {
  const ring = useRef()
  useFrame((s) => {
    if (!ring.current) return
    const k = reached ? 1.15 : 1 + 0.35 * (0.5 + 0.5 * Math.sin(s.clock.elapsedTime * 4))
    ring.current.scale.set(k, k, k)
  })
  if (!Array.isArray(goal)) return null
  const [x, , z] = [-goal[1], 0, -goal[0]]
  return (
    <group position={[x, 0, z]}>
      <mesh ref={ring} position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.14, 0.2, 28]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.18, 0]}>
        <coneGeometry args={[0.07, 0.22, 4]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  )
}

// Invisible ground catcher: a click sets a navigation goal (SLAM world meters).
// OrbitControls owns drags; a genuine click still fires onClick on this plane.
function NavClickPlane({ onPick }) {
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, 0.01, 0]}
      onClick={(e) => {
        e.stopPropagation()
        onPick(threeToWorld(e.point))
      }}
    >
      {/* sized to the room (+margin) so a click on empty ground past the map
          doesn't project to a far-away goal that flings the rover out */}
      <planeGeometry args={[14, 14]} />
      <meshBasicMaterial visible={false} />
    </mesh>
  )
}

function Scene({
  showWorld,
  onWorldFail,
  orbit,
  controls,
  pointColor,
  pointSize,
  gridCellColor,
  gridSectionColor,
  fitView,
  controlTarget,
  backgroundColor,
  showGrid,
  scanDecayMs,
  showOriginMarker,
  maxScans,
  showScans,
  worldStatus,
  autoFitEnabled,
  onInteract,
  showSlam,
  showFreeSpace,
  slamOccupiedColor,
  slamFreeColor,
  slamMarkerColor,
  navigable,
  emitNav,
  onNavState,
  navColor,
}) {
  const [scans, setScans] = useState([])
  // Live navigation route (nav_path event): goal + planned polyline + status.
  const [nav, setNav] = useState(null)
  useRobotEvent('nav_path', (msg) => {
    if (!msg) return
    const next = {
      goal: Array.isArray(msg.goal) ? msg.goal : null,
      points: Array.isArray(msg.points) ? msg.points : [],
      active: !!msg.active,
      reached: !!msg.reached,
    }
    setNav(next)
    onNavState?.(next)
  })
  // Latest SLAM pose. When present, live scans are lifted into the world frame
  // so they land on the accumulated map; without it we fall back to the classic
  // robot-centered radar (pose stays at the origin).
  const poseRef = useRef(null)
  const [hasPose, setHasPose] = useState(false)

  useRobotEvent('slam_pose', (p) => {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.theta)) return
    poseRef.current = { x: p.x, y: p.y, theta: p.theta }
    if (!hasPose) setHasPose(true)
  })

  useRobotEvent('lidar_scan', (scan) => {
    if (!Array.isArray(scan?.points)) return
    const p = showSlam ? poseRef.current : null
    const c = p ? Math.cos(p.theta) : 1
    const s = p ? Math.sin(p.theta) : 0
    const positions = new Float32Array(scan.points.length * 3)
    scan.points.forEach(([x, y], i) => {
      // robot frame -> world frame (identity when no pose), then world -> three
      const wx = p ? p.x + c * x - s * y : x
      const wy = p ? p.y + s * x + c * y : y
      positions[i * 3] = -wy
      positions[i * 3 + 1] = SENSOR_H
      positions[i * 3 + 2] = -wx
    })
    const now = performance.now()
    setScans((prev) => {
      let next = [...prev, { id: now + Math.random(), positions, receivedAt: now }]
      if (Number.isFinite(scanDecayMs) && scanDecayMs > 0) {
        next = next.filter((s) => now - s.receivedAt < scanDecayMs)
      }
      if (Number.isFinite(maxScans) && maxScans > 0) {
        next = next.slice(-maxScans)
      }
      return next
    })
  })

  return (
    <>
      <color attach="background" args={[backgroundColor]} />
      <hemisphereLight args={['#ffffff', '#d9d3c7', 1.25]} />
      <ambientLight intensity={1.05} />
      <directionalLight position={[3, 6, 2]} intensity={1.45} />
      {orbit && <AutoOrbit />}
      {showWorld && (
        <Suspense fallback={null}>
          <ModelBoundary onFail={onWorldFail}>
            <WorldModel
              onFail={onWorldFail}
              fitView={fitView}
              autoFitEnabled={autoFitEnabled}
            />
          </ModelBoundary>
        </Suspense>
      )}
      {showGrid && (
        <Grid
          args={[20, 20]}
          cellSize={0.5}
          cellColor={gridCellColor}
          sectionSize={2}
          sectionColor={gridSectionColor}
          fadeDistance={18}
          position={[0, -0.005, 0]}
        />
      )}
      {showSlam && <SlamMap showFreeSpace={showFreeSpace} occupiedColor={slamOccupiedColor} freeColor={slamFreeColor} />}
      {navigable && <NavClickPlane onPick={(xy) => emitNav?.(xy)} />}
      {navigable && nav?.active && <NavPath points={nav.points} color={navColor} />}
      {navigable && nav?.goal && (
        <GoalMarker goal={nav.goal} color={navColor} reached={nav.reached} />
      )}
      {/* The rover (Gaussian splat) is ALWAYS present - it holds the origin until
          a slam_pose arrives (even with no connection), then glides to the pose. */}
      <PoseMarker poseRef={poseRef} color={slamMarkerColor} />
      {showScans && scans.map((s) => (
        <ScanPoints
          key={s.id}
          positions={s.positions}
          receivedAt={s.receivedAt}
          color={pointColor}
          size={pointSize}
          decayMs={scanDecayMs}
        />
      ))}
      {worldStatus && (
        <Html position={[0, 1.3, 0]} center>
          <div
            style={{
              padding: '8px 12px',
              border: '1px solid rgba(17,16,13,0.18)',
              borderRadius: '999px',
              background: 'rgba(255,253,250,0.92)',
              color: '#11100d',
              font: '600 12px ui-monospace, Menlo, monospace',
              letterSpacing: '0.08em',
              whiteSpace: 'nowrap',
            }}
          >
            {worldStatus}
          </div>
        </Html>
      )}
      {controls && <CameraTarget target={controlTarget} onInteract={onInteract} />}
    </>
  )
}

export default function LidarViewport({
  showWorld = true,
  camera = { position: [0, 4.5, 4.5], fov: 55 },
  orbit = false,
  controls = false,
  pointColor = '#46e068',
  pointSize = 0.05,
  gridCellColor = '#16221b',
  gridSectionColor = '#1f3a29',
  dpr = [1, 1.5],
  onWorldFail,
  fitView = false,
  controlTarget = [0, 0.3, -1],
  backgroundColor = '#f4f0e6',
  showGrid = true,
  scanDecayMs = DECAY_MS,
  showOriginMarker = true,
  maxScans = MAX_SCANS,
  showScans = true,
  worldStatus = '',
  autoFitEnabled = false,
  onInteract,
  showSlam = true,
  showFreeSpace = true,
  slamOccupiedColor = '#2bb673',
  slamFreeColor = '#8aa79b',
  slamMarkerColor = '#f5a524',
  navigable = false,
  navColor = '#2f7db0',
  demoToggle = false,
}) {
  const [worldFailed, setWorldFailed] = useState(false)
  const [navState, setNavState] = useState(null)
  const { emit, demo, toggleDemo } = useRobot()
  const handleWorldFail = () => {
    setWorldFailed(true)
    onWorldFail?.()
  }
  const emitNav = (xy) =>
    emit('nav_goal', { ts: Date.now(), x: Math.round(xy[0] * 1000) / 1000, y: Math.round(xy[1] * 1000) / 1000 })
  const cancelNav = () => emit('nav_goal', { ts: Date.now(), cancel: true })

  const navHint = navState?.reached
    ? 'ARRIVED · click to set a new destination'
    : navState?.active
      ? 'NAVIGATING to destination...'
      : 'click the map to declare a destination'

  return (
    <>
      <Canvas camera={camera} dpr={SAFE_DPR}>
        <CanvasGuard />
        <Scene
          showWorld={showWorld && !worldFailed}
          onWorldFail={handleWorldFail}
          orbit={orbit}
          controls={controls}
          pointColor={pointColor}
          pointSize={pointSize}
          gridCellColor={gridCellColor}
          gridSectionColor={gridSectionColor}
          fitView={fitView}
          controlTarget={controlTarget}
          backgroundColor={backgroundColor}
          showGrid={showGrid}
          scanDecayMs={scanDecayMs}
          showOriginMarker={showOriginMarker}
          maxScans={maxScans}
          showScans={showScans}
          worldStatus={worldStatus}
          autoFitEnabled={autoFitEnabled}
          onInteract={onInteract}
          showSlam={showSlam}
          showFreeSpace={showFreeSpace}
          slamOccupiedColor={slamOccupiedColor}
          slamFreeColor={slamFreeColor}
          slamMarkerColor={slamMarkerColor}
          navigable={navigable}
          emitNav={emitNav}
          onNavState={setNavState}
          navColor={navColor}
        />
      </Canvas>
      {demoToggle && (
        <button
          className={`lv-demo ${demo ? 'on' : ''}`}
          onClick={toggleDemo}
          title="Play a self-contained SLAM demo when there is no live robot connection"
        >
          <i className="lv-demo-dot" />
          {demo ? 'DEMO ON' : 'DEMO'}
        </button>
      )}
      {navigable && (
        <div className="lv-nav">
          <span className={`lv-nav-hint ${navState?.active ? 'go' : ''} ${navState?.reached ? 'done' : ''}`}>
            <i className="lv-nav-dot" />
            {navHint}
          </span>
          {navState?.active && (
            <button className="lv-nav-stop" onClick={cancelNav}>STOP</button>
          )}
        </div>
      )}
    </>
  )
}

export { DECAY_MS as LIDAR_DECAY_MS }
