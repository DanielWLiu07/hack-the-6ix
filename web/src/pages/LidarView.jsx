import { useState } from 'react'
import { useRobot } from '../lib/robot.jsx'
import LidarViewport, { LIDAR_DECAY_MS } from '../components/LidarViewport.jsx'

export default function LidarView() {
  const { connected, sim } = useRobot()
  const [showWorld, setShowWorld] = useState(true)
  const [worldFailed, setWorldFailed] = useState(false)

  return (
    <section className="lidar-page">
      <h2>Lidar Map</h2>
      {!connected && !sim && (
        <p className="simnote" style={{ marginBottom: '1rem' }}>
          Server offline - no scans incoming. Add ?sim=1 to preview.
        </p>
      )}
      <div className="lidar-canvas">
        <LidarViewport
          showWorld={showWorld && !worldFailed}
          controls
          camera={{ position: [0, 4.5, 4.5], fov: 55 }}
          onWorldFail={() => setWorldFailed(true)}
        />
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
        Persistent SLAM map: occupied cells (green) accumulate and stay as the
        rover drives, with the live 360° C1 sweep on top and the amber marker
        tracking the robot pose. The live sweep fades over {LIDAR_DECAY_MS / 1000}s;
        the map does not. Drag to orbit, scroll to zoom.
      </p>
    </section>
  )
}
