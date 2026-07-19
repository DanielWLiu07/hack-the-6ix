import LidarViewport from '../components/LidarViewport.jsx'

// Bare, full-viewport live SLAM map (C1 occupancy grid + scan + pose), meant to
// be embedded in an <iframe> inside the POV page. Isolating it in its own
// document gives it its own WebGL context, so the POV machine-fringe (a second
// WebGL layer) can overlay the SLAM tab without the two contexts fighting and
// dropping the map - the same trick the iPhone-lidar tab uses (phone.html).
// Config mirrors the POV page's inline SLAM layer exactly.
export default function SlamEmbed() {
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#fffdf8' }}>
      <LidarViewport
        showWorld={false}
        camera={{ position: [0, 4.2, 4.6], fov: 55 }}
        controls
        pointColor="#111111"
        gridCellColor="#d8d2c6"
        gridSectionColor="#b9b2a6"
        controlTarget={[0, 0.35, 0]}
        backgroundColor="#fffdf8"
        showGrid
        scanDecayMs={12000}
        showOriginMarker
        maxScans={48}
        showScans
        showSlam
        navigable
      />
    </div>
  )
}
