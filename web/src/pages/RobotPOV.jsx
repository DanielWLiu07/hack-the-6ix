import { useEffect, useRef, useState } from 'react'
import { useRobot, useRobotEvent, SERVER_URL } from '../lib/robot.jsx'
import RobotFringe from '../components/RobotFringe.jsx'
import LidarViewport from '../components/LidarViewport.jsx'
import BackToStage from '../components/BackToStage.jsx'
import PovFleetPanel from '../components/PovFleetPanel.jsx'
import ArrivalFuzz from '../components/ArrivalFuzz.jsx'
import '../pov.css'

// Robot POV 
// Fullscreen first-person "what the robot sees". Bottom tabs switch the whole
// view between the robot's sensors: the arm camera, the live C1 SLAM scan, and
// the iPhone-lidar 3D reconstruction. A manga machine-fringe frames every view.
// Real robot data only - no fabricated values.

const CAM_W = 640 // nominal frame the detector reports bbox pixels against
const CAM_H = 480
const DET_TTL = 2600 // ms a detection box lingers before fading

const TABS = [
  { id: 'slam', label: 'SLAM MAP' },
  { id: 'iphone', label: '3D LIDAR' },
  { id: 'cam', label: 'ARM CAM' },
]

function LidarLayer({ world }) {
  const [worldStatus, setWorldStatus] = useState('')
  const [allowAutoFit, setAllowAutoFit] = useState(true)

  useEffect(() => {
    if (!world) return undefined
    let alive = true
    const check = async () => {
      try {
        const r = await fetch('/world.glb', { method: 'HEAD', cache: 'no-store' })
        const stamp = r.headers.get('last-modified')
        if (!alive) return
        if (!stamp) {
          setWorldStatus('NO PHONE MESH DATA')
          return
        }
        const ageMs = Date.now() - new Date(stamp).getTime()
        setWorldStatus(ageMs > 45_000 ? 'PHONE MESH STALE - RECONNECT SCAN' : '')
      } catch {
        if (alive) setWorldStatus('WORLD LOAD OFFLINE')
      }
    }
    check()
    const id = setInterval(check, 5000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [world])

  // iPhone-lidar reconstruction: embed the standalone viewer.html. The React
  // viewport shared the GPU with this page's second WebGL context (the manga
  // fringe) and rendered inconsistently; viewer.html is a single-context
  // three.js scene that renders the phone mesh reliably (leak-free, disposes on
  // reload, recovers from GPU context loss). Served same-origin from /public.
  if (world) {
    return (
      <div className="pov-view">
        <iframe
          title="iPhone lidar reconstruction"
          src="/phone.html?world=/world.glb"
          style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
        />
      </div>
    )
  }

  return (
    <div className="pov-view">
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
      />
    </div>
  )
}

// Optical layer (arm camera + detection boxes) 
function CameraLayer({ detections, label }) {
  // connecting | live | off. Show NOT CONNECTED (same placeholder as the other
  // tabs) until a real frame actually loads; a stream that errors or never
  // arrives falls to 'off' - never a blank/broken-image state.
  const [status, setStatus] = useState('connecting')
  useEffect(() => {
    const t = setTimeout(() => setStatus((s) => (s === 'connecting' ? 'off' : s)), 4000)
    return () => clearTimeout(t)
  }, [])
  return (
    <div className="pov-view pov-cam">
      {status !== 'off' && (
        <img
          className="pov-cam-img"
          src={`${SERVER_URL}/stream`}
          alt=""
          style={{ display: status === 'live' ? 'block' : 'none' }}
          onLoad={() => setStatus('live')}
          onError={() => setStatus('off')}
        />
      )}
      {status !== 'live' && <NotConnected sub="arm camera offline" />}
      {status === 'live' && label && <span className="pov-cam-tag">{label} · ARM CAM</span>}
      {/* bbox overlay - viewBox matches the detector's frame; "slice" mirrors
          object-fit: cover on the feed so boxes stay registered. */}
      <svg
        className="pov-boxes"
        viewBox={`0 0 ${CAM_W} ${CAM_H}`}
        preserveAspectRatio="xMidYMid slice"
      >
        {detections.map((d) => {
          const [x, y, w, h] = d.bbox
          const ripe = d.ripeness === 'ripe'
          return (
            <g key={d.id} className="pov-box" style={{ '--ttl': `${DET_TTL}ms` }}>
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                className={ripe ? 'ripe' : 'unripe'}
              />
              <text x={x + 2} y={y - 7}>
                {d.fruit?.toUpperCase()} · {d.ripeness?.toUpperCase()}{' '}
                {Math.round(d.conf * 100)}%
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// small helpers 
function NotConnected({ sub }) {
  return (
    <div className="pov-notconn">
      <span className="nc-title">NOT CONNECTED</span>
      {sub && <span className="nc-sub">{sub}</span>}
    </div>
  )
}

// Page 
export default function RobotPOV() {
  const { connected, telemetry, detections: detLog } = useRobot()
  const rootRef = useRef(null)
  const [tab, setTab] = useState(() => {
    const q = new URLSearchParams(window.location.search).get('tab')
    return TABS.some((t) => t.id === q) ? q : 'iphone'
  })
  // ?edit=1 turns the machine-fringe into a 3D-prop editor on the cam tab (drag
  // props, tweak, add from the palette, copy the layout back to fringeProps.js).
  const editFringe =
    new URLSearchParams(window.location.search).has('edit') && tab === 'cam'
  const [isFs, setIsFs] = useState(false)

  // Live gate. OFF by default so no socket-sourced data (which may be a stand-in
  // robot / camera test pattern, indistinguishable from real hardware here)
  // shows. The operator presses GO LIVE once the real robot is streaming.
  const [live] = useState(true) // always live now (GO LIVE removed)
  const liveRef = useRef(live)
  liveRef.current = live

  // Live, self-expiring detection boxes (overlaid on the camera view).
  const [boxes, setBoxes] = useState([])
  useRobotEvent('detection', (d) => {
    if (!liveRef.current || !Array.isArray(d?.bbox)) return
    const id = performance.now() + Math.random()
    setBoxes((prev) => [...prev, { ...d, id }].slice(-8))
    setTimeout(() => setBoxes((prev) => prev.filter((b) => b.id !== id)), DET_TTL)
  })

  // Swarm-aware POV: this cockpit is "inside" ONE robot. The fleet roster (live
  // `fleet` event) drives a robot picker; the selected rover's state/battery/
  // arm/drive bind to the HUD. Camera + SLAM are the single physical sensors,
  // labeled with the active rover. Deep-linkable via ?robot=rover-NN.
  const [fleet, setFleet] = useState([])
  const [selRobot, setSelRobot] = useState(
    () => new URLSearchParams(window.location.search).get('robot') || null,
  )
  useRobotEvent('fleet', (f) => { if (Array.isArray(f?.robots)) setFleet(f.robots) })
  const [fleetOpen, setFleetOpen] = useState(true) // mission-control sidebar open
  // Resolve the active robot: the picked one if still in the roster, else the
  // first rover. null when no roster yet (fall back to merged telemetry).
  const activeRobot = (selRobot && fleet.find((r) => r.id === selRobot)) || fleet[0] || null
  const pickRobot = (id) => {
    setSelRobot(id)
    const u = new URL(window.location.href)
    u.searchParams.set('robot', id)
    window.history.replaceState(null, '', u) // keep the deep-link in sync
  }

  const feedsOn = connected // live data shows whenever the hub is connected (no GO LIVE gate)
  // Prefer the active rover's live fleet entry; fall back to merged telemetry
  // (single-robot demos, or before the first fleet frame arrives).
  const src = feedsOn ? (activeRobot || telemetry) : null
  const hasTele = Boolean(src)
  const state = feedsOn ? (src?.state ?? 'IDLE') : 'OFFLINE'
  const batt = hasTele && typeof src.battery_v === 'number' ? src.battery_v : null
  const battPct = batt != null ? Math.max(0, Math.min(1, (batt - 9.9) / 2.7)) : 0
  const arm = hasTele && Array.isArray(src.arm) ? src.arm : null
  const drive = hasTele ? src.drive : null
  const locked = tab === 'cam' && feedsOn && boxes.length > 0
  const last = feedsOn ? detLog[0] : null
  const activeTab = Math.max(0, TABS.findIndex((t) => t.id === tab))

  const toggleFs = () => {
    const el = rootRef.current
    if (!document.fullscreenElement) {
      el?.requestFullscreen?.().then(() => setIsFs(true)).catch(() => {})
    } else {
      document.exitFullscreen?.().then(() => setIsFs(false)).catch(() => {})
    }
  }

  // full-screen view for the active tab
  let view
  if (tab === 'cam') {
    view = feedsOn ? (
      <CameraLayer detections={boxes} label={activeRobot?.id} />
    ) : (
      <NotConnected sub={`no robot on ${SERVER_URL}`} />
    )
  } else if (tab === 'slam') {
    // C1 live SLAM map. Isolated in an iframe (its own document = its own WebGL
    // context) so the machine-fringe can overlay this tab too without two heavy
    // contexts in one document dropping the map. Same trick as the iPhone tab.
    view = feedsOn ? (
      <div className="pov-view">
        <iframe
          title="Live SLAM map"
          src="/pov-slam"
          style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
        />
      </div>
    ) : (
      <NotConnected sub="no live scan" />
    )
  } else {
    // iPhone-lidar reconstruction (static scan; renders even offline)
    view = <LidarLayer world />
  }

  return (
    <div className="pov-root" ref={rootRef}>
      <ArrivalFuzz />
      <BackToStage />
   {/* active sensor view */}
      <div className="pov-main">{view}</div>
      <div className="pov-vignette" />

      {/* Machine fringe (manga cutout overlay) - eyeball/gear/prop models hang
          into the top of EVERY tab. It runs its own transparent WebGL canvas.
          This is safe on all three tabs because none of them keeps a second
          WebGL context in THIS document: the camera tab has no 3D canvas, and
          both the SLAM and iPhone tabs render their 3D inside isolated iframes
          (/pov-slam and phone.html), each with its own context. */}
      <RobotFringe edit={editFringe} />

   {/* HUD */}
      <div className="pov-hud">
        <span className="pov-tick tl" />
        <span className="pov-tick tr" />
        <span className="pov-tick bl" />
        <span className="pov-tick br" />
        <div className="pov-scanline" />

        {/* Mission-control sidebar: live fleet roster (click a rover to enter it)
            + FarmHand NL command console. Collapsible so the cockpit stays clean.
            Commands broadcast to the fleet; the real robot executes for real. */}
        {feedsOn && (
          <aside className={`pov-fleetbar ${fleetOpen ? 'open' : ''}`}>
            <button
              className="pov-fleetbar-tab"
              onClick={() => setFleetOpen((v) => !v)}
              title={fleetOpen ? 'Hide fleet + command' : 'Fleet + command'}
            >
              <span className="chev">{fleetOpen ? '‹' : '›'}</span>
              <span className="lab">FLEET</span>
            </button>
            {fleetOpen && (
              <div className="pov-fleetbar-body">
                <PovFleetPanel fleet={fleet} activeId={activeRobot?.id} onPick={pickRobot} />
              </div>
            )}
          </aside>
        )}

        {/* center reticle (camera view only) */}
        {tab === 'cam' && feedsOn && (
          <div className={`pov-reticle ${locked ? 'lock' : ''}`}>
            <span className="ret-h" />
            <span className="ret-v" />
            <span className="ret-ring" />
            {locked && <span className="ret-tag">TARGET&nbsp;LOCK</span>}
          </div>
        )}

        {/* bottom: status + controls, telemetry chips, segmented view tabs */}
        <div className="pov-bottom">
          <div className="pov-tele">
            <div className="chip">
              <span className="k">ARM</span>
              <span className="val">
                {arm
                  ? arm.map((a) => `${Math.round(a ?? 0)}`).join('  ')
                  : '- - - - -'}
              </span>
            </div>
            <div className="chip">
              <span className="k">DRIVE</span>
              <span className="val">
                {drive ? `L ${drive.l.toFixed(2)}  R ${drive.r.toFixed(2)}` : '-'}
              </span>
            </div>
            <div className="chip">
              <span className="k">DETECTION</span>
              <span className="val">
                {last ? (
                  <>
                    <i className={`swatch ${last.ripeness}`} />
                    {last.fruit?.toUpperCase()} · {last.ripeness?.toUpperCase()}{' '}
                    {Math.round(last.conf * 100)}%
                  </>
                ) : (
                  '-'
                )}
              </span>
            </div>
          </div>

          <div className="pov-barrow">
            <div className="pov-top-l">
              <span className={`pov-state ${state}`}>{state}</span>
              <span className="pov-batt">
                <span className="lab">PWR</span>
                <span className="track">
                  <span
                    className={battPct < 0.2 ? 'crit' : battPct < 0.4 ? 'warn' : ''}
                    style={{ width: `${battPct * 100}%` }}
                  />
                </span>
                <span className="v">{batt != null ? `${batt.toFixed(1)}V` : '-'}</span>
              </span>
            </div>

            <div className="pov-seg" style={{ '--n': TABS.length, '--i': activeTab }}>
              <span className="pov-seg-thumb" aria-hidden="true" />
              {TABS.map((t) => (
                <button
                  key={t.id}
                  className={`pov-seg-btn ${tab === t.id ? 'on' : ''}`}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="pov-top-r">
              <button className="pov-fs" onClick={toggleFs} title="Fullscreen">
                {isFs ? 'EXIT FS' : 'FULL'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
