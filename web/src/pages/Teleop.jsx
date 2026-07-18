import { Component, Suspense, lazy, useEffect, useRef, useState } from 'react'
import { useRobot, useRobotEvent } from '../lib/robot.jsx'
import './teleop.css'

const SpeechRecognitionCtor =
  typeof window !== 'undefined'
    ? window.SpeechRecognition || window.webkitSpeechRecognition
    : null

// Turn a parsed nl_action into a short human-readable confirmation string.
function describeAction(a) {
  if (!a) return null
  if (!a.ok) return a.clarification || a.error || 'not understood'
  if (a.clarification) return a.clarification
  const { task, filter, fruit } = a.action || {}
  const words = [task, filter, fruit].filter(Boolean)
  return words.length ? words.join(' ') : 'ok'
}

// 3D bits are lazy so three.js stays out of the main bundle.
const ControllerModel = lazy(() => import('../components/ControllerModel.jsx'))

const AUTH0_CONFIGURED = Boolean(
  import.meta.env.VITE_AUTH0_DOMAIN
    && import.meta.env.VITE_AUTH0_CLIENT_ID
    && import.meta.env.VITE_AUTH0_AUDIENCE,
)

const DEADZONE = 0.12
// PS controller (standard mapping): 0=cross 1=circle 2=square 3=triangle,
// 4/5=L1/R1, 6/7=L2/R2, 12-15 = dpad up/down/left/right
const BTN = { CROSS: 0, CIRCLE: 1, SQUARE: 2, TRIANGLE: 3 }

const isPlayStationPad = (pad) => /playstation|dualsense|dualshock|wireless controller/i.test(pad?.id ?? '')
const gamepads = () => Array.from(navigator.getGamepads?.() ?? []).filter(Boolean)
const findPad = (index) => {
  const pads = gamepads()
  return pads.find((pad) => pad.index === index)
    ?? pads.find(isPlayStationPad)
    ?? pads[0]
}

// keyboard -> robot bindings (both WASD and arrows drive; J/K/L pick; Space estop)
const DRIVE_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
])
const has = (set, ...codes) => codes.some((c) => set.has(c))

function dz(v) {
  return Math.abs(v) < DEADZONE ? 0 : v
}
const clamp1 = (v) => Math.max(-1, Math.min(1, v))

// If the 3D controller ever fails to render (e.g. no WebGL), keep the page
// fully usable by showing a plain note in its place.
class ModelBoundary extends Component {
  state = { dead: false }
  static getDerivedStateFromError() {
    return { dead: true }
  }
  render() {
    if (this.state.dead) {
      return (
        <div className={`ctrl-canvas ctrl-canvas-hero ctrl-loading${this.props.stage ? ' ctrl-canvas-stage' : ''}`}>
          3D controller unavailable. Keyboard, gamepad and on-screen controls
          still work.
        </div>
      )
    }
    return this.props.children
  }
}

// A simple key diagram for keyboard mode: highlights each key as it is pressed
// (display only; TeleopInner's loop still does the actual emitting).
function KeyboardDiagram() {
  const [down, setDown] = useState(() => new Set())
  useEffect(() => {
    const on = (e) => setDown((p) => new Set(p).add(e.code))
    const off = (e) =>
      setDown((p) => {
        const n = new Set(p)
        n.delete(e.code)
        return n
      })
    const blur = () => setDown(new Set())
    window.addEventListener('keydown', on)
    window.addEventListener('keyup', off)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', on)
      window.removeEventListener('keyup', off)
      window.removeEventListener('blur', blur)
    }
  }, [])
  const Key = ({ code, label, wide }) => (
    <span className={`kb-key${wide ? ' wide' : ''}${down.has(code) ? ' on' : ''}`}>
      {label}
    </span>
  )
  return (
    <div className="kb-diagram">
      <div className="kb-cluster">
        <div className="kb-row"><Key code="KeyW" label="W" /></div>
        <div className="kb-row">
          <Key code="KeyA" label="A" /><Key code="KeyS" label="S" /><Key code="KeyD" label="D" />
        </div>
        <div className="kb-caption">drive (tank)</div>
      </div>
      <div className="kb-cluster">
        <div className="kb-row"><Key code="ArrowUp" label="↑" /></div>
        <div className="kb-row">
          <Key code="ArrowLeft" label="←" /><Key code="ArrowDown" label="↓" /><Key code="ArrowRight" label="→" />
        </div>
        <div className="kb-caption">drive (arrows)</div>
      </div>
      <div className="kb-cluster">
        <div className="kb-row">
          <Key code="KeyJ" label="J" /><Key code="KeyK" label="K" /><Key code="KeyL" label="L" />
        </div>
        <div className="kb-caption">pick nearest / apple / banana</div>
      </div>
      <div className="kb-cluster">
        <div className="kb-row"><Key code="Space" label="Space" wide /></div>
        <div className="kb-caption">emergency stop (C clears)</div>
      </div>
    </div>
  )
}

function _ControllerCallouts({ buttons, sticks }) {
  const callouts = [
    { key: 'up', label: 'D-PAD', x: 30, y: 41, tx: 42, ty: 48 },
    { key: 'triangle', label: '△ TRIANGLE', x: 70, y: 38, tx: 58, ty: 44 },
    { key: 'circle', label: '○ CIRCLE', x: 74, y: 47, tx: 60, ty: 49 },
    { key: 'cross', label: '✕ CROSS', x: 72, y: 56, tx: 58, ty: 54 },
    { key: 'square', label: '□ SQUARE', x: 68, y: 63, tx: 56, ty: 50 },
    { key: 'l1', label: 'L1 / L2', x: 30, y: 27, tx: 40, ty: 36 },
    { key: 'r1', label: 'R1 / R2', x: 70, y: 27, tx: 60, ty: 36 },
  ]
  return (
    <svg className="controller-callouts" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {callouts.map((callout) => {
        const pressed = callout.key === 'l1'
          ? (buttons.l1 || buttons.l2)
          : callout.key === 'r1'
            ? (buttons.r1 || buttons.r2)
            : buttons[callout.key]
        return (
          <g key={callout.key} className={pressed ? 'pressed' : ''}>
            <path d={`M ${callout.x} ${callout.y} L ${callout.tx} ${callout.ty}`} />
            <circle cx={callout.tx} cy={callout.ty} r="0.9" />
            <rect x={callout.x - 4.5} y={callout.y - 3.05} width="9" height="4.45" rx=".45" />
            <text x={callout.x} y={callout.y - 1.3} textAnchor="middle">{callout.label}</text>
            <text className="callout-state" x={callout.x} y={callout.y + .15} textAnchor="middle">
              {pressed ? 'PRESSED' : 'IDLE'}
            </text>
          </g>
        )
      })}
      {[
        { label: 'L STICK', x: 37, y: 67, sx: sticks.lx, sy: sticks.ly },
        { label: 'R STICK', x: 63, y: 67, sx: sticks.rx, sy: sticks.ry },
      ].map((stick) => (
        <g key={stick.label} className="stick-callout">
          <text x={stick.x} y={stick.y - 6} textAnchor="middle">{stick.label}</text>
          <circle cx={stick.x} cy={stick.y} r="4.7" />
          <path d={`M ${stick.x - 3.7} ${stick.y} H ${stick.x + 3.7} M ${stick.x} ${stick.y - 3.7} V ${stick.y + 3.7}`} />
          <circle className="stick-dot" cx={stick.x + stick.sx * 3.6} cy={stick.y - stick.sy * 3.6} r=".85" />
          <text className="callout-state" x={stick.x} y={stick.y + 7.4} textAnchor="middle">
            X {stick.sx.toFixed(2)}  Y {stick.sy.toFixed(2)}
          </text>
        </g>
      ))}
    </svg>
  )
}

function TeleopInner() {
  const { emit, connected, sim } = useRobot()
  const [padName, setPadName] = useState(null)
  const [pairStatus, setPairStatus] = useState('idle')
  const [sticks, setSticks] = useState({ l: 0, r: 0 })
  const [driveSrc, setDriveSrc] = useState('idle')
  const [estopped, setEstopped] = useState(false)
  const [lastAction, setLastAction] = useState(null)
  const [inputMode, setInputMode] = useState('controller') // 'controller' | 'keyboard'
  const [dockOpen, setDockOpen] = useState(false)
  const [listening, setListening] = useState(false)
  const [voiceText, setVoiceText] = useState(null)
  const [voiceAction, setVoiceAction] = useState(null)
  const recognitionRef = useRef(null)

  const heldRef = useRef({ l: 0, r: 0 }) // on-screen button drive
  const keysRef = useRef(new Set()) // currently-held keyboard codes
  const prevButtonsRef = useRef([]) // gamepad edge detection
  const padPrimedRef = useRef(false) // has a valid prev snapshot for the active pad?
  const padIndexRef = useRef(null)
  const estoppedRef = useRef(false)
  estoppedRef.current = estopped
  // live input state consumed by the rigged 3D controller (written every tick)
  const inputRef = useRef({ lx: 0, ly: 0, rx: 0, ry: 0, btn: {} })
  // latest action handlers, so the keydown listener never goes stale
  const actionsRef = useRef({})

  const doPick = (target) => {
    emit('pick', { target })
    setLastAction(`pick -> ${target}`)
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
  actionsRef.current = { doPick, doEstop, clearEstop }

  // Voice commands via the browser Web Speech API (no external service). The
  // transcript is sent to the hub as nl_command; FarmHand's parsed reply comes
  // back as nl_action and is shown as confirmation.
  useEffect(() => {
    if (!SpeechRecognitionCtor) return undefined
    const rec = new SpeechRecognitionCtor()
    rec.lang = 'en-US'
    rec.interimResults = false
    rec.maxAlternatives = 1
    rec.onresult = (event) => {
      const text = event.results[0]?.[0]?.transcript?.trim()
      if (!text) return
      setVoiceText(text)
      setLastAction(`voice: ${text}`)
      emit('nl_command', { text })
    }
    rec.onend = () => setListening(false)
    rec.onerror = () => setListening(false)
    recognitionRef.current = rec
    return () => {
      try { rec.abort() } catch { /* ignore */ }
      recognitionRef.current = null
    }
  }, [emit])

  useRobotEvent('nl_action', (action) => setVoiceAction(action))

  const toggleVoice = () => {
    const rec = recognitionRef.current
    if (!rec) return
    if (listening) {
      rec.stop()
      setListening(false)
      return
    }
    setVoiceAction(null)
    try {
      rec.start()
      setListening(true)
    } catch { /* start() throws if already running; ignore */ }
  }

  const pairController = () => {
    // Bluetooth/USB pairing happens in the operating system. This user gesture
    // tells the browser which already-connected Gamepad API device to use.
    const pad = findPad(padIndexRef.current)
    if (pad) {
      padIndexRef.current = pad.index
      setPadName(pad.id)
      setPairStatus('paired')
    } else {
      setPairStatus('searching')
    }
  }

  // gamepad hotplug
  useEffect(() => {
    const onConnect = (e) => {
      // Prefer a DualSense when more than one device is present. Otherwise use
      // the device the operator explicitly selected with Pair controller.
      if (padIndexRef.current === null || isPlayStationPad(e.gamepad)) {
        padIndexRef.current = e.gamepad.index
        setPadName(e.gamepad.id)
        setPairStatus('paired')
      }
    }
    const onDisconnect = (e) => {
      if (e.gamepad.index === padIndexRef.current) {
        padIndexRef.current = null
        padPrimedRef.current = false
        setPadName(null)
        setPairStatus('idle')
      }
    }
    window.addEventListener('gamepadconnected', onConnect)
    window.addEventListener('gamepaddisconnected', onDisconnect)
    const pad = findPad(null)
    if (pad) {
      padIndexRef.current = pad.index
      setPadName(pad.id)
      setPairStatus('paired')
    }
    return () => {
      window.removeEventListener('gamepadconnected', onConnect)
      window.removeEventListener('gamepaddisconnected', onDisconnect)
    }
  }, [])

  // Browsers often expose a Bluetooth DualSense only after its first button
  // press. Keep looking briefly after the explicit pairing request.
  useEffect(() => {
    if (pairStatus !== 'searching') return undefined
    const timeout = window.setTimeout(() => setPairStatus('idle'), 10_000)
    const id = window.setInterval(() => {
      const pad = findPad(null)
      if (!pad) return
      padIndexRef.current = pad.index
      setPadName(pad.id)
      setPairStatus('paired')
    }, 150)
    return () => {
      window.clearTimeout(timeout)
      window.clearInterval(id)
    }
  }, [pairStatus])

  // keyboard bindings: held keys drive; edge presses fire pick/estop
  useEffect(() => {
    const onDown = (e) => {
      const a = actionsRef.current
      if (DRIVE_KEYS.has(e.code) || e.code === 'Space') e.preventDefault()
      keysRef.current.add(e.code)
      if (e.repeat) return
      if (e.code === 'KeyJ') a.doPick('nearest')
      else if (e.code === 'KeyK') a.doPick('apple')
      else if (e.code === 'KeyL') a.doPick('banana')
      else if (e.code === 'Space') a.doEstop()
      else if (e.code === 'KeyC' && estoppedRef.current) a.clearEstop()
    }
    const onUp = (e) => keysRef.current.delete(e.code)
    const onBlur = () => keysRef.current.clear()
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  // 10 Hz control loop: merge gamepad + keyboard + on-screen -> drive + rig state
  useEffect(() => {
    const id = setInterval(() => {
      const keys = keysRef.current
      const pad = findPad(padIndexRef.current)
      if (pad && pad.index !== padIndexRef.current) {
        padIndexRef.current = pad.index
        padPrimedRef.current = false // re-seed edge detection for the new pad
        setPadName(pad.id)
      }

      // --- keyboard-derived tank drive ---
      const kFwd = (has(keys, 'KeyW', 'ArrowUp') ? 1 : 0) - (has(keys, 'KeyS', 'ArrowDown') ? 1 : 0)
      const kTurn = (has(keys, 'KeyD', 'ArrowRight') ? 1 : 0) - (has(keys, 'KeyA', 'ArrowLeft') ? 1 : 0)
      const kl = clamp1(kFwd + kTurn) * 0.85
      const kr = clamp1(kFwd - kTurn) * 0.85
      const keyDriving = kFwd !== 0 || kTurn !== 0

      // --- gamepad state ---
      let gl = 0
      let gr = 0
      let gpDriving = false
      const gbtn = {}
      let lx = 0
      let ly = 0
      let rx = 0
      let ry = 0
      if (pad) {
        lx = dz(pad.axes[0] ?? 0)
        ly = -dz(pad.axes[1] ?? 0)
        rx = dz(pad.axes[2] ?? 0)
        ry = -dz(pad.axes[3] ?? 0)
        gl = ly
        gr = ry
        gpDriving = gl !== 0 || gr !== 0
        const val = (i) => pad.buttons[i]?.value ?? (pad.buttons[i]?.pressed ? 1 : 0)
        gbtn.cross = val(0); gbtn.circle = val(1); gbtn.square = val(2); gbtn.triangle = val(3)
        gbtn.l1 = val(4); gbtn.r1 = val(5); gbtn.l2 = val(6); gbtn.r2 = val(7)
        gbtn.create = val(8); gbtn.options = val(9); gbtn.l3 = val(10); gbtn.r3 = val(11)
        gbtn.up = val(12); gbtn.down = val(13); gbtn.left = val(14); gbtn.right = val(15)
        gbtn.ps = val(16); gbtn.touchpad = val(17)
        // edge-triggered actions. Skip firing on the priming frame so a button
        // already held when the loop starts (e.g. right after a login redirect
        // remounts the page) is not misread as a fresh press.
        const prev = prevButtonsRef.current
        const primed = padPrimedRef.current
        const pressed = (i) => primed && pad.buttons[i]?.pressed && !prev[i]
        if (pressed(BTN.CROSS)) doPick('nearest')
        if (pressed(BTN.SQUARE)) doPick('apple')
        if (pressed(BTN.TRIANGLE)) doPick('banana')
        if (pressed(BTN.CIRCLE)) doEstop()
        prevButtonsRef.current = pad.buttons.map((b) => b.pressed)
        padPrimedRef.current = true
      }

      // --- pick the active drive source (gamepad > keyboard > on-screen) ---
      let l = heldRef.current.l
      let r = heldRef.current.r
      let src = (l || r) ? 'on-screen' : 'idle'
      if (keyDriving) { l = kl; r = kr; src = 'keyboard' }
      if (gpDriving) { l = gl; r = gr; src = 'gamepad' }

      // --- build the rig's live input (buttons merge across gamepad+keyboard) ---
      const btn = {
        cross: Math.max(gbtn.cross || 0, keys.has('KeyJ') ? 1 : 0),
        square: Math.max(gbtn.square || 0, keys.has('KeyK') ? 1 : 0),
        triangle: Math.max(gbtn.triangle || 0, keys.has('KeyL') ? 1 : 0),
        circle: Math.max(gbtn.circle || 0, keys.has('Space') ? 1 : 0),
        l1: gbtn.l1 || 0, r1: gbtn.r1 || 0, l2: gbtn.l2 || 0, r2: gbtn.r2 || 0,
        create: gbtn.create || 0, options: gbtn.options || 0, l3: gbtn.l3 || 0, r3: gbtn.r3 || 0,
        ps: gbtn.ps || 0, touchpad: gbtn.touchpad || 0,
        up: Math.max(gbtn.up || 0, has(keys, 'KeyW', 'ArrowUp') ? 1 : 0),
        down: Math.max(gbtn.down || 0, has(keys, 'KeyS', 'ArrowDown') ? 1 : 0),
        left: Math.max(gbtn.left || 0, has(keys, 'KeyA', 'ArrowLeft') ? 1 : 0),
        right: Math.max(gbtn.right || 0, has(keys, 'KeyD', 'ArrowRight') ? 1 : 0),
      }
      if (pad) {
        inputRef.current = { lx, ly, rx, ry, btn }
      } else {
        // no gamepad -> show tank speed on the sticks
        inputRef.current = { lx: 0, ly: l, rx: 0, ry: r, btn }
      }


      if (estoppedRef.current) { l = 0; r = 0; if (src !== 'idle') src = 'estop' }
      setSticks({ l, r })
      setDriveSrc(estoppedRef.current ? 'estop' : src)
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
    <main className="teleop-stage">
      <div className="teleop-paper" />
      <div className="teleop-speedlines" />
      <header className="teleop-stage-head">
        <span className="teleop-kicker">FARMLAND // REMOTE PILOT</span>
        <h1>DUALSENSE TELEOP</h1>
      </header>
      {!connected && !sim && (
        <p className="teleop-offline">Server offline. Commands will not reach the robot.</p>
      )}
      <section className="teleop-scene" aria-label="Live controller scene">
        <ModelBoundary stage>
          <Suspense fallback={<div className="ctrl-canvas ctrl-canvas-stage ctrl-loading">loading controller scene...</div>}>
            <ControllerModel stateRef={inputRef} stage annotate={false} />
          </Suspense>
        </ModelBoundary>
        {inputMode === 'keyboard' && <div className="teleop-key-overlay"><KeyboardDiagram /></div>}
      </section>
      <aside className={`teleop-dock${dockOpen ? '' : ' collapsed'}`}>
        <button
          className="dock-toggle"
          onClick={() => setDockOpen((open) => !open)}
          aria-expanded={dockOpen}
        >
          <span className="dock-toggle-label">{dockOpen ? 'HIDE CONTROLS' : 'SHOW CONTROLS'}</span>
          <span className="dock-toggle-status">
            <span className={`drivesrc src-${driveSrc}`}>{driveSrc}</span>
            L {sticks.l.toFixed(2)} · R {sticks.r.toFixed(2)}
          </span>
          <span className="dock-chevron" aria-hidden="true">{dockOpen ? '▾' : '▴'}</span>
        </button>
        <div className="dock-body">
        <div className="dock-body-inner">
        <div className="teleop-dock-top">
          <div className="dock-top-left">
            <div className="mode-toggle" role="tablist">
                <button
                  className={inputMode === 'controller' ? 'active' : ''}
                  onClick={() => setInputMode('controller')}
                >
                  Controller
                </button>
                <button
                  className={inputMode === 'keyboard' ? 'active' : ''}
                  onClick={() => setInputMode('keyboard')}
                >
                  Keyboard
                </button>
            </div>
            {SpeechRecognitionCtor && (
              <button
                className={`voice-btn${listening ? ' rec' : ''}`}
                onClick={toggleVoice}
                title="Speak a command like: pick the ripe apples"
              >
                <span className="voice-dot" aria-hidden="true" />
                {listening ? 'Listening, tap to stop' : 'Voice command'}
              </button>
            )}
          </div>
          <div className="ctrl-readout">
            <span className={padName ? 'on' : 'off'}>
              {padName ? `● ${padName}` : '○ No controller paired · keyboard / on-screen active'}
            </span>
            <button className="pair-controller" onClick={pairController}>
              {pairStatus === 'searching' ? 'Press a PS5 button...' : padName ? 'Controller paired' : 'Pair PS5 controller'}
            </button>
            <span>
              L {sticks.l.toFixed(2)} · R {sticks.r.toFixed(2)} · drive @ 10 Hz
            </span>
            <span>last: {lastAction ?? '-'}</span>
            {voiceText && (
              <span className="voice-readout">
                FarmHand: "{voiceText}"
                {voiceAction && <b> -&gt; {describeAction(voiceAction)}</b>}
              </span>
            )}
          </div>
        </div>
        <div className="teleop-actions">
          <div className="estop-panel">
            <button className="estop-btn" onClick={estopped ? clearEstop : doEstop}>
              {estopped ? 'ESTOPPED, CLICK TO CLEAR' : 'EMERGENCY STOP'}
            </button>
          </div>
          <div className="teleop-drive">
            <span>DRIVE // HOLD</span>
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
          <div className="teleop-pick">
            <span>PICK TARGET</span>
            <div className="actionrow">
              <button className="actionbtn" onClick={() => doPick('nearest')}>
                Nearest
              </button>
              <button className="actionbtn" onClick={() => doPick('apple')}>
                Apple
              </button>
              <button className="actionbtn" onClick={() => doPick('banana')}>
                Banana
              </button>
            </div>
          </div>
        </div>
        </div>
        </div>
      </aside>
    </main>
  )
}

export default function Teleop() {
  return (
    <>
      <p className="simnote" style={{ marginBottom: '1rem' }}>
        {AUTH0_CONFIGURED
          ? 'Guest mode is enabled. Login is optional; signed-in actions are attributed to the operator.'
          : 'Guest mode is enabled.'}
      </p>
      <TeleopInner />
    </>
  )
}
