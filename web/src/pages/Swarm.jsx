import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useRobot, useRobotEvent, SERVER_URL } from '../lib/robot.jsx'
import '../swarm.css'

// Swarm - fleet command center. Renders every robot the hub currently sees on a
// shared top-down map (live dots + heading + fading trail) beside a status
// roster. Source is the server-aggregated `fleet` event ONLY (schema addendum
// in root CLAUDE.md); no fabricated robots. Empty until robots connect.

const VB_W = 1000
const VB_H = 700
const PAD = 60 // viewBox px kept clear around the mapped world
const TRAIL = 36 // positions retained per robot for the path
const STALE_MS = 6000 // no update in this long -> dim + mark STALE

// State -> ink color, shared with the POV/analytics palette.
const STATE_COLOR = {
  IDLE: '#8a857b',
  NAV: '#9b8cff',
  SEEK: '#7cd4ff',
  APPROACH: '#5ad1c4',
  PICK: '#f2a03c',
  SORT: '#86e6a0',
  ESTOP: '#ff5b5b',
}
const stateColor = (s) => STATE_COLOR[s] || '#8a857b'

// Battery 9.9-12.6V -> 0..1 (same mapping as the POV power gauge).
const battPct = (v) => (v == null ? 0 : Math.max(0, Math.min(1, (v - 9.9) / 2.7)))

function ageLabel(ms) {
  if (ms == null) return '-'
  if (ms < 1500) return 'now'
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`
  return `${Math.round(ms / 60_000)}m ago`
}

export default function Swarm() {
  const { connected } = useRobot()
  const [snapshot, setSnapshot] = useState({ ts: 0, robots: [] })
  // now ticks once a second so "last seen" ages and stale dimming stay live
  // even when no fleet frame arrives.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  // Position trails per robot id, and a world bounding box that only grows so
  // the map does not jitter as robots roam. Both live in refs; a render bump
  // (the snapshot state) redraws from them.
  const trails = useRef(new Map())
  const boundsRef = useRef(null)

  useRobotEvent('fleet', (f) => {
    if (!f || !Array.isArray(f.robots)) return
    const ids = new Set()
    for (const r of f.robots) {
      ids.add(r.id)
      if (Array.isArray(r.pos)) {
        const arr = trails.current.get(r.id) || []
        const last = arr[arr.length - 1]
        if (!last || last[0] !== r.pos[0] || last[1] !== r.pos[1]) {
          arr.push(r.pos)
          if (arr.length > TRAIL) arr.shift()
          trails.current.set(r.id, arr)
        }
        // grow the world box to include this point
        const b = boundsRef.current
        const [x, y] = r.pos
        boundsRef.current = b
          ? [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)]
          : [x, y, x, y]
      }
    }
    // forget robots that left the roster
    for (const id of [...trails.current.keys()]) if (!ids.has(id)) trails.current.delete(id)
    setSnapshot(f)
  })

  const robots = snapshot.robots
  const positioned = robots.filter((r) => Array.isArray(r.pos))

  // World -> viewBox projection. Enforce a minimum 3 m span and keep the world
  // aspect (letterbox inside the padded viewBox), Y inverted for screen space.
  const project = useMemo(() => {
    let b = boundsRef.current
    if (!b) b = [-1.5, -1.5, 1.5, 1.5]
    let [minX, minY, maxX, maxY] = b
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    const span = Math.max(3, maxX - minX, maxY - minY) / 2 + 0.6
    minX = cx - span; maxX = cx + span; minY = cy - span; maxY = cy + span
    const w = VB_W - PAD * 2
    const h = VB_H - PAD * 2
    const s = Math.min(w / (maxX - minX), h / (maxY - minY))
    const ox = PAD + (w - s * (maxX - minX)) / 2
    const oy = PAD + (h - s * (maxY - minY)) / 2
    return (x, y) => ({
      x: ox + (x - minX) * s,
      y: oy + (maxY - y) * s, // invert Y: world up -> screen up
    })
    // Reproject whenever a new snapshot lands (bounds may have grown).
  }, [snapshot])

  const online = robots.length
  const withFix = positioned.length
  const avgBatt = robots.length
    ? robots.reduce((a, r) => a + (r.battery_v || 0), 0) / robots.filter((r) => r.battery_v != null).length || 0
    : 0
  const activeCount = robots.filter((r) => r.state && r.state !== 'IDLE' && r.state !== 'ESTOP').length

  return (
    <div className="swarm">
      <div className="swarm-head">
        <div className="swarm-title">
          <Link to="/stage" className="swarm-back">&lt; hub</Link>
          <h1>FLEET SWARM</h1>
          <span className={`swarm-conn ${connected ? 'on' : ''}`}>
            {connected ? 'HUB LINK' : 'NO HUB'}
          </span>
        </div>
        <div className="swarm-kpis">
          <div className="swarm-kpi"><span className="k">ONLINE</span><span className="v">{online}</span></div>
          <div className="swarm-kpi"><span className="k">ACTIVE</span><span className="v">{activeCount}</span></div>
          <div className="swarm-kpi"><span className="k">MAP FIX</span><span className="v">{withFix}/{online}</span></div>
          <div className="swarm-kpi"><span className="k">AVG PWR</span><span className="v">{avgBatt ? `${avgBatt.toFixed(1)}V` : '-'}</span></div>
        </div>
      </div>

      <div className="swarm-body">
        <div className="swarm-map-wrap">
          <svg className="swarm-map" viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMid meet">
            <defs>
              <pattern id="swarm-grid" width="50" height="50" patternUnits="userSpaceOnUse">
                <path d="M50 0H0V50" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
              </pattern>
            </defs>
            <rect x="0" y="0" width={VB_W} height={VB_H} fill="url(#swarm-grid)" />

            {/* trails */}
            {positioned.map((r) => {
              const arr = trails.current.get(r.id)
              if (!arr || arr.length < 2) return null
              const pts = arr.map((p) => { const s = project(p[0], p[1]); return `${s.x.toFixed(1)},${s.y.toFixed(1)}` }).join(' ')
              return (
                <polyline
                  key={`t-${r.id}`}
                  points={pts}
                  fill="none"
                  stroke={stateColor(r.state)}
                  strokeWidth="2"
                  strokeOpacity="0.35"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )
            })}

            {/* robots */}
            {positioned.map((r) => {
              const s = project(r.pos[0], r.pos[1])
              const col = stateColor(r.state)
              const stale = now - r.last_ts > STALE_MS
              const hx = Math.cos(r.theta || 0) * 22
              const hy = -Math.sin(r.theta || 0) * 22 // screen Y inverted
              return (
                <g
                  key={`r-${r.id}`}
                  className="swarm-dot"
                  style={{ transform: `translate(${s.x}px, ${s.y}px)`, opacity: stale ? 0.4 : 1 }}
                >
                  <circle r="16" fill={col} fillOpacity="0.15" />
                  <line x1="0" y1="0" x2={hx} y2={hy} stroke={col} strokeWidth="3" strokeLinecap="round" />
                  <circle r="7" fill={col} stroke="#12130f" strokeWidth="2" />
                  <text x="0" y="-22" textAnchor="middle" className="swarm-dot-label" fill={col}>
                    {r.id}{r.sim ? ' · sim' : ''}
                  </text>
                </g>
              )
            })}
          </svg>
          {online === 0 && (
            <div className="swarm-empty">
              <span className="swarm-empty-title">NO ROBOTS CONNECTED</span>
              <span className="swarm-empty-sub">waiting on the hub at {SERVER_URL}</span>
            </div>
          )}
          {online > 0 && withFix === 0 && (
            <div className="swarm-empty">
              <span className="swarm-empty-sub">{online} online, none reporting a map pose yet</span>
            </div>
          )}
        </div>

        <div className="swarm-roster">
          {robots.length === 0 && <div className="swarm-roster-empty">roster empty</div>}
          {robots.map((r) => {
            const col = stateColor(r.state)
            const pct = battPct(r.battery_v)
            const stale = now - r.last_ts > STALE_MS
            return (
              <div key={r.id} className={`swarm-card ${stale ? 'stale' : ''}`}>
                <div className="swarm-card-top">
                  <span className="swarm-card-id">
                    <i className="swarm-led" style={{ background: col }} />
                    {r.id}
                    {r.sim && <span className="swarm-sim">SIM</span>}
                  </span>
                  <span className="swarm-state" style={{ color: col, borderColor: col }}>
                    {stale ? 'STALE' : r.state}
                  </span>
                </div>
                <div className="swarm-batt">
                  <span className="track">
                    <span
                      className={pct < 0.2 ? 'crit' : pct < 0.4 ? 'warn' : ''}
                      style={{ width: `${pct * 100}%` }}
                    />
                  </span>
                  <span className="swarm-batt-v">{r.battery_v != null ? `${r.battery_v.toFixed(1)}V` : '-'}</span>
                </div>
                <div className="swarm-card-meta">
                  <span>DRIVE L {(r.drive?.l ?? 0).toFixed(2)} · R {(r.drive?.r ?? 0).toFixed(2)}</span>
                  <span>{r.pos ? `x ${r.pos[0].toFixed(1)} y ${r.pos[1].toFixed(1)}` : 'no fix'} · {ageLabel(now - r.last_ts)}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
