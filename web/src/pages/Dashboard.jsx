import { Suspense, lazy } from 'react'
import { Link } from 'react-router-dom'
import { useRobot, SERVER_URL } from '../lib/robot.jsx'

const LidarViewport = lazy(() => import('../components/LidarViewport.jsx'))

const JOINT_NAMES = ['BASE', 'SHLD', 'ELBW', 'WRST', 'GRIP']

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function DriveBar({ value, label }) {
  const v = Math.max(-1, Math.min(1, value ?? 0))
  const style =
    v >= 0
      ? { bottom: '50%', height: `${v * 50}%` }
      : { top: '50%', height: `${-v * 50}%` }
  return (
    <div>
      <div className="dtrack">
        <div className="zero" />
        <div className={`fill ${v < 0 ? 'rev' : ''}`} style={style} />
      </div>
      <div className="dlabel">
        {label} {v.toFixed(2)}
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { connected, telemetry, detections, picks } = useRobot()
  const state = connected ? (telemetry?.state ?? 'IDLE') : 'OFFLINE'
  const batt = telemetry?.battery_v
  // 3S LiPo: 9.9 V empty, 12.6 V full
  const battPct = batt ? Math.max(0, Math.min(1, (batt - 9.9) / 2.7)) : 0
  const battClass = battPct < 0.2 ? 'crit' : battPct < 0.4 ? 'warn' : ''
  const successCount = picks.filter((p) => p.success).length

  return (
    <>
      <h2>Live Dashboard</h2>
      <div className="grid cards" style={{ marginBottom: '1rem' }}>
        <div className="panel">
          <h3>Robot State</h3>
          <span className={`badge ${state}`}>{state}</span>
          <div className="subval">
            {telemetry ? `last packet ${fmtTime(telemetry.ts)}` : 'no telemetry yet'}
          </div>
        </div>
        <div className="panel">
          <h3>Battery</h3>
          <div className="bigval">
            {batt != null ? batt.toFixed(1) : '--'}
            <span className="unit"> V</span>
          </div>
          <div className={`bar ${battClass}`}>
            <div style={{ width: `${battPct * 100}%` }} />
          </div>
        </div>
        <div className="panel">
          <h3>Picks (session)</h3>
          <div className="bigval">
            {successCount}
            <span className="unit"> / {picks.length}</span>
          </div>
          <div className="subval">successful / attempted</div>
        </div>
        <div className="panel">
          <h3>Drive</h3>
          <div className="drivebars">
            <DriveBar value={telemetry?.drive?.l} label="L" />
            <DriveBar value={telemetry?.drive?.r} label="R" />
          </div>
        </div>
      </div>

      <div className="grid main">
        <div className="grid" style={{ gap: '1rem' }}>
          <div className="panel">
            <h3>Camera (arm-mounted)</h3>
            <div className="camwrap">
              <img
                src={`${SERVER_URL}/stream`}
                alt=""
                onError={(e) => {
                  e.currentTarget.style.display = 'none'
                  e.currentTarget.nextSibling.style.display = 'block'
                }}
              />
              <span className="nocam" style={{ display: 'none', position: 'absolute' }}>
                NO STREAM - waiting for {SERVER_URL}/stream
              </span>
            </div>
            <div className="subval" style={{ marginTop: '0.75rem' }}>
              <Link to="/pov?tab=cam">Open full robot POV</Link>
            </div>
          </div>
          <div className="panel">
            <h3>LiDAR World</h3>
            <div
              className="lidar-canvas"
              style={{ minHeight: '18rem', borderRadius: '0.9rem', overflow: 'hidden' }}
            >
              <Suspense fallback={<p className="empty">Loading 3D view…</p>}>
                <LidarViewport
                  showWorld
                  camera={{ position: [0, 4.3, 4.3], fov: 55 }}
                  pointSize={0.045}
                  controls
                />
              </Suspense>
            </div>
            <div className="subval" style={{ marginTop: '0.75rem' }}>
              Your phone scan writes <code>/world.glb</code> and appears here live.
              <span> </span>
              <Link to="/pov?tab=iphone">Open full LiDAR POV</Link>
            </div>
          </div>
          <div className="panel">
            <h3>Arm Joints</h3>
            <div className="joints">
              {JOINT_NAMES.map((name, i) => {
                const deg = telemetry?.arm?.[i] ?? 0
                return (
                  <div className="joint" key={name}>
                    <span>{name}</span>
                    <div className="track">
                      <div style={{ left: `${(deg / 180) * 100}%` }} />
                    </div>
                    <span className="deg">{Math.round(deg)}°</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="grid" style={{ gap: '1rem' }}>
          <div className="panel">
            <h3>Detections</h3>
            {detections.length === 0 ? (
              <p className="empty">Nothing detected yet</p>
            ) : (
              <ul className="loglist">
                {detections.map((d, i) => (
                  <li key={`${d.ts}-${i}`}>
                    <span className="time">{fmtTime(d.ts)}</span>
                    <span className="fruit">{d.fruit}</span>
                    <span className={`tag ${d.ripeness}`}>{d.ripeness}</span>
                    <span className="right">
                      <span className="conf">{(d.conf * 100).toFixed(0)}%</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="panel">
            <h3>Pick Log</h3>
            {picks.length === 0 ? (
              <p className="empty">No picks yet</p>
            ) : (
              <ul className="loglist">
                {picks.map((p, i) => (
                  <li key={`${p.ts}-${i}`}>
                    <span className="time">{fmtTime(p.ts)}</span>
                    <span className="fruit">{p.fruit}</span>
                    <span className={`tag ${p.ripeness}`}>{p.ripeness}</span>
                    <span className="conf">→ {p.bin}</span>
                    <span className="right">
                      <span className={`tag ${p.success ? 'ok' : 'fail'}`}>
                        {p.success ? 'OK' : 'MISS'}
                      </span>
                      <span className="conf">{(p.duration_ms / 1000).toFixed(1)}s</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
