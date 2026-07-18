import { useEffect, useRef, useState } from 'react'
import { useAuth0 } from '@auth0/auth0-react'
import { useRobot } from '../lib/robot.jsx'

const AUTH0_CONFIGURED = Boolean(
  import.meta.env.VITE_AUTH0_DOMAIN && import.meta.env.VITE_AUTH0_CLIENT_ID,
)

const DEADZONE = 0.12
// PS controller (standard mapping): 0=cross 1=circle 2=square 3=triangle
const BTN = { CROSS: 0, CIRCLE: 1, SQUARE: 2, TRIANGLE: 3 }

function applyDeadzone(v) {
  return Math.abs(v) < DEADZONE ? 0 : v
}

function TeleopInner() {
  const { emit, connected, sim } = useRobot()
  const [padName, setPadName] = useState(null)
  const [sticks, setSticks] = useState({ l: 0, r: 0 })
  const [estopped, setEstopped] = useState(false)
  const [lastAction, setLastAction] = useState(null)
  const heldRef = useRef({ l: 0, r: 0 }) // on-screen button drive
  const prevButtonsRef = useRef([])
  const estoppedRef = useRef(false)
  estoppedRef.current = estopped

  const doPick = (target) => {
    emit('pick', { target })
    setLastAction(`pick → ${target}`)
  }
  const doEstop = () => {
    setEstopped(true)
    emit('estop', {})
    emit('drive', { l: 0, r: 0 })
    setLastAction('ESTOP')
  }
  const clearEstop = () => {
    setEstopped(false)
    setLastAction('estop cleared (drive re-enabled)')
  }

  // gamepad hotplug
  useEffect(() => {
    const onConnect = (e) => setPadName(e.gamepad.id)
    const onDisconnect = () => setPadName(null)
    window.addEventListener('gamepadconnected', onConnect)
    window.addEventListener('gamepaddisconnected', onDisconnect)
    const pads = navigator.getGamepads?.() ?? []
    for (const p of pads) if (p) setPadName(p.id)
    return () => {
      window.removeEventListener('gamepadconnected', onConnect)
      window.removeEventListener('gamepaddisconnected', onDisconnect)
    }
  }, [])

  // 10 Hz control loop: read gamepad, merge with on-screen buttons, emit drive
  useEffect(() => {
    const id = setInterval(() => {
      let l = heldRef.current.l
      let r = heldRef.current.r
      const pad = (navigator.getGamepads?.() ?? []).find((p) => p)
      if (pad) {
        // tank drive: left stick Y → left track, right stick Y → right track
        const gl = -applyDeadzone(pad.axes[1] ?? 0)
        const gr = -applyDeadzone(pad.axes[3] ?? 0)
        if (gl !== 0 || gr !== 0) {
          l = gl
          r = gr
        }
        // edge-triggered buttons
        const prev = prevButtonsRef.current
        const pressed = (i) => pad.buttons[i]?.pressed && !prev[i]
        if (pressed(BTN.CROSS)) doPick('nearest')
        if (pressed(BTN.SQUARE)) doPick('apple')
        if (pressed(BTN.TRIANGLE)) doPick('banana')
        if (pressed(BTN.CIRCLE)) doEstop()
        prevButtonsRef.current = pad.buttons.map((b) => b.pressed)
      }
      if (estoppedRef.current) {
        l = 0
        r = 0
      }
      setSticks({ l, r })
      emit('drive', { l: +l.toFixed(2), r: +r.toFixed(2) })
    }, 100)
    return () => {
      clearInterval(id)
      emit('drive', { l: 0, r: 0 })
    }
  }, [emit]) // eslint-disable-line react-hooks/exhaustive-deps

  // on-screen pad helpers: hold to drive
  const hold = (l, r) => () => {
    heldRef.current = { l, r }
  }
  const release = () => {
    heldRef.current = { l: 0, r: 0 }
  }
  const padBtn = (label, l, r) => (
    <button
      className="padbtn"
      onPointerDown={hold(l, r)}
      onPointerUp={release}
      onPointerLeave={release}
      onContextMenu={(e) => e.preventDefault()}
    >
      {label}
    </button>
  )

  return (
    <>
      <h2>Teleop</h2>
      {!connected && !sim && (
        <p className="simnote" style={{ marginBottom: '1rem' }}>
          Server offline — commands will not reach the robot. Add ?sim=1 to test.
        </p>
      )}
      <div className="grid main">
        <div className="grid" style={{ gap: '1rem' }}>
          <div className="panel">
            <button className="estop-btn" onClick={estopped ? clearEstop : doEstop}>
              {estopped ? 'ESTOPPED — CLICK TO CLEAR' : '⛔ EMERGENCY STOP'}
            </button>
          </div>
          <div className="panel">
            <h3>Drive (hold)</h3>
            <div className="padgrid">
              {padBtn('↖', 0.35, 0.8)}
              {padBtn('↑', 0.8, 0.8)}
              {padBtn('↗', 0.8, 0.35)}
              {padBtn('↰', -0.6, 0.6)}
              {padBtn('■', 0, 0)}
              {padBtn('↱', 0.6, -0.6)}
              {padBtn('↙', -0.35, -0.8)}
              {padBtn('↓', -0.8, -0.8)}
              {padBtn('↘', -0.8, -0.35)}
            </div>
          </div>
          <div className="panel">
            <h3>Pick</h3>
            <div className="actionrow">
              <button className="actionbtn" onClick={() => doPick('nearest')}>
                🎯 Nearest
              </button>
              <button className="actionbtn" onClick={() => doPick('apple')}>
                🍎 Apple
              </button>
              <button className="actionbtn" onClick={() => doPick('banana')}>
                🍌 Banana
              </button>
            </div>
          </div>
        </div>

        <div className="grid" style={{ gap: '1rem' }}>
          <div className="panel">
            <h3>Controller</h3>
            <div className="gp-status">
              {padName ? (
                <>
                  <span className="on">● {padName}</span>
                  <br />
                  Sticks: tank drive (L/R) · ✕ pick nearest · □ apple · △ banana
                  · ○ ESTOP
                </>
              ) : (
                <>
                  ○ No gamepad — connect a PlayStation controller and press any
                  button. On-screen controls active meanwhile.
                </>
              )}
            </div>
            <div className="stickviz">
              {[sticks.l, sticks.r].map((v, i) => (
                <div className="stickbox" key={i}>
                  <div
                    className="knob"
                    style={{ left: '50%', top: `${50 - v * 40}%` }}
                  />
                </div>
              ))}
            </div>
            <div className="dlabel">
              L {sticks.l.toFixed(2)} · R {sticks.r.toFixed(2)} · emitting drive
              @ 10 Hz
            </div>
          </div>
          <div className="panel">
            <h3>Last action</h3>
            <div className="gp-status">{lastAction ?? '—'}</div>
          </div>
        </div>
      </div>
    </>
  )
}

function AuthGate() {
  const { isAuthenticated, isLoading, loginWithRedirect, user, logout } =
    useAuth0()
  if (isLoading) return <p className="empty">Checking operator credentials…</p>
  if (!isAuthenticated) {
    return (
      <div className="authgate">
        <h2>Operator login required</h2>
        <p style={{ color: 'var(--ui-dim)' }}>
          Teleop can move a physical robot — sign in to continue.
        </p>
        <button onClick={() => loginWithRedirect()}>Log in with Auth0</button>
      </div>
    )
  }
  return (
    <>
      <p className="simnote" style={{ marginBottom: '1rem' }}>
        Operator: {user?.email ?? user?.name}{' '}
        <a
          style={{ color: 'inherit', cursor: 'pointer', marginLeft: 8 }}
          onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}
        >
          (log out)
        </a>
      </p>
      <TeleopInner />
    </>
  )
}

export default function Teleop() {
  if (!AUTH0_CONFIGURED) {
    return (
      <>
        <p className="simnote" style={{ marginBottom: '1rem' }}>
          Auth0 not configured (set VITE_AUTH0_DOMAIN / VITE_AUTH0_CLIENT_ID) —
          dev bypass active
        </p>
        <TeleopInner />
      </>
    )
  }
  return <AuthGate />
}
