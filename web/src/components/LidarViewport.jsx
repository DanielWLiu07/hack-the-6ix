import { Component, Suspense, useEffect, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Grid, Html, OrbitControls } from '@react-three/drei'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as THREE from 'three'
import { useRobotEvent } from '../lib/robot.jsx'
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
function PoseMarker({ poseRef, color }) {
  const grp = useRef()
  const target = useRef(new THREE.Vector3()).current
  const targetQ = useRef(new THREE.Quaternion()).current
  const fwd = useRef(new THREE.Vector3()).current
  useFrame(() => {
    const p = poseRef.current
    if (!p || !grp.current) return
    worldToThree(p.x, p.y, target)
    grp.current.position.lerp(target, 0.25)
    fwd.set(-Math.sin(p.theta), 0, -Math.cos(p.theta))
    targetQ.setFromUnitVectors(CONE_UP, fwd)
    grp.current.quaternion.slerp(targetQ, 0.25)
  })
  return (
    <group ref={grp}>
      <mesh>
        <coneGeometry args={[0.12, 0.36, 4]} />
        <meshBasicMaterial color={color} />
      </mesh>
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
}) {
  const [scans, setScans] = useState([])
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
      {showSlam && hasPose && <PoseMarker poseRef={poseRef} color={slamMarkerColor} />}
      {/* Static origin cone only when SLAM isn't driving a live robot marker. */}
      {showOriginMarker && !(showSlam && hasPose) && (
        <mesh position={[0, SENSOR_H, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.09, 0.26, 4]} />
          <meshBasicMaterial color="#e5484d" />
        </mesh>
      )}
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
}) {
  const [worldFailed, setWorldFailed] = useState(false)
  const handleWorldFail = () => {
    setWorldFailed(true)
    onWorldFail?.()
  }
  return (
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
      />
    </Canvas>
  )
}

export { DECAY_MS as LIDAR_DECAY_MS }
