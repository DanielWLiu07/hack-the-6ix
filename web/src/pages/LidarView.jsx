import { Component, Suspense, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Grid, useGLTF } from '@react-three/drei'
import { useRobot, useRobotEvent } from '../lib/robot.jsx'

const DECAY_MS = 4000 // scans fade out over this window
const MAX_SCANS = 16
const SENSOR_H = 0.15 // C1 mount height (m) — the scan is one horizontal slice

// iPhone-lidar reconstruction of the demo scene (robot/lidar/phone → world.glb).
// Frame per its conventions doc: glTF/three.js, +Y up, −Z forward, floor y=0.
function WorldModel() {
  const { scene } = useGLTF('/world.glb')
  return <primitive object={scene} />
}
useGLTF.preload('/world.glb')

// If world.glb is missing (e.g. not yet deployed), keep the scan view alive.
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

// One lidar sweep as a fading point cloud, in world.glb's frame:
// robot (x_fwd, y_left) → three (X,Y,Z) = (−y, SENSOR_H, −x).
function ScanPoints({ positions, receivedAt }) {
  const matRef = useRef()
  useFrame(() => {
    if (!matRef.current) return
    const age = performance.now() - receivedAt
    matRef.current.opacity = Math.max(0, 1 - age / DECAY_MS)
  })
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        ref={matRef}
        color="#46e068"
        size={0.05}
        transparent
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  )
}

function Scene({ showWorld, onWorldFail }) {
  const [scans, setScans] = useState([])
  useRobotEvent('lidar_scan', (scan) => {
    if (!Array.isArray(scan?.points)) return
    const positions = new Float32Array(scan.points.length * 3)
    scan.points.forEach(([x, y], i) => {
      positions[i * 3] = -y // three X (robot left +y → three −X)
      positions[i * 3 + 1] = SENSOR_H // three Y (mount height)
      positions[i * 3 + 2] = -x // three Z (robot forward +x → into scene −Z)
    })
    const now = performance.now()
    setScans((prev) =>
      [...prev, { id: now + Math.random(), positions, receivedAt: now }]
        .filter((s) => now - s.receivedAt < DECAY_MS)
        .slice(-MAX_SCANS),
    )
  })

  return (
    <>
      <color attach="background" args={['#050806']} />
      <ambientLight intensity={0.8} />
      <directionalLight position={[3, 6, 2]} intensity={1.1} />
      {showWorld && (
        <Suspense fallback={null}>
          <ModelBoundary onFail={onWorldFail}>
            <WorldModel />
          </ModelBoundary>
        </Suspense>
      )}
      <Grid
        args={[20, 20]}
        cellSize={0.5}
        cellColor="#16221b"
        sectionSize={2}
        sectionColor="#1f3a29"
        fadeDistance={18}
        position={[0, -0.005, 0]}
      />
      {/* robot marker at origin, nose → −Z (world forward) */}
      <mesh position={[0, SENSOR_H, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.09, 0.26, 4]} />
        <meshBasicMaterial color="#e5484d" />
      </mesh>
      {scans.map((s) => (
        <ScanPoints key={s.id} positions={s.positions} receivedAt={s.receivedAt} />
      ))}
      <OrbitControls makeDefault maxPolarAngle={Math.PI / 2.05} target={[0, 0.3, -1]} />
    </>
  )
}

export default function LidarView() {
  const { connected, sim } = useRobot()
  const [showWorld, setShowWorld] = useState(true)
  const [worldFailed, setWorldFailed] = useState(false)

  return (
    <>
      <h2>Lidar Map</h2>
      {!connected && !sim && (
        <p className="simnote" style={{ marginBottom: '1rem' }}>
          Server offline — no scans incoming. Add ?sim=1 to preview.
        </p>
      )}
      <div className="lidar-canvas">
        <Canvas camera={{ position: [0, 4.5, 4.5], fov: 55 }}>
          <Scene
            showWorld={showWorld && !worldFailed}
            onWorldFail={() => setWorldFailed(true)}
          />
        </Canvas>
        <label className="lidar-toggle">
          <input
            type="checkbox"
            checked={showWorld}
            disabled={worldFailed}
            onChange={(e) => setShowWorld(e.target.checked)}
          />
          {worldFailed ? '3D world unavailable' : '3D world (iPhone scan)'}
        </label>
      </div>
      <p className="subval" style={{ marginTop: '0.6rem' }}>
        Live 360° C1 scan (green) overlaid on the iPhone-lidar reconstruction of
        the scene. Robot frame: red marker = rover, nose → forward. Points fade
        over {DECAY_MS / 1000}s. Drag to orbit, scroll to zoom.
      </p>
    </>
  )
}
