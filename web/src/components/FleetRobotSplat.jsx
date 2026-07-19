// FleetRobotSplat - the scanned rover shown as its Gaussian splat capture inside
// the fleet tab. Small self-contained R3F canvas: the same /assets/robot.splat
// used by the SLAM pose marker and the landing roll-in, gently auto-rotating so
// the fleet header reads as "this is the real machine". No mock data - it is the
// actual OpenSplat reconstruction of the rover.
import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { Splat, OrbitControls } from '@react-three/drei'

const SPLAT_URL = '/assets/robot.splat'

// Same by-eye orientation the roll-in uses so the rover stands upright + facing.
const SPLAT_FIX = { rotation: [0.158, 2.348, -0.062], scale: 1.35 }

export default function FleetRobotSplat() {
  return (
    <div className="povf-splat">
      <Canvas
        dpr={[1, 1.6]}
        camera={{ fov: 30, position: [0, 0.15, 3.1] }}
        gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
      >
        <ambientLight intensity={0.9} />
        <Suspense fallback={null}>
          <group rotation={SPLAT_FIX.rotation} scale={SPLAT_FIX.scale}>
            <Splat src={SPLAT_URL} />
          </group>
        </Suspense>
        <OrbitControls
          enablePan={false}
          enableZoom={false}
          autoRotate
          autoRotateSpeed={0.9}
          minPolarAngle={Math.PI * 0.32}
          maxPolarAngle={Math.PI * 0.62}
        />
      </Canvas>
      <span className="povf-splat-tag">SCANNED ROVER · GAUSSIAN SPLAT</span>
    </div>
  )
}
