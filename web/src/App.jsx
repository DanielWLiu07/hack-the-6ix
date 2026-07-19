import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useRobot } from './lib/robot.jsx'
import { drawStatic } from './lib/crtTuneIn.js'
import { passwordLogin, signupRedirect } from './lib/ropg.js'
import { useOperator, operatorLabel } from './lib/auth.jsx'
import './App.css'

// Landing ladder:
//   no WebGL2                     -> static ClassicHero
//   /scene/ present (real scene)  -> fullscreen self-hosted 1:1 painterly scene
//   /scene/ absent (fresh clones) -> self-contained r3f OrchardHero
// public/scene/ is gitignored, so fresh clones / Vercel may lack it. We must
// also guard against the SPA fallback: a missing /scene/index.html can still
// return the app shell (200), so we verify the body is the real scene (its
// <canvas id="gl">) and not the SPA (<div id="root">).
const OrchardHero = lazy(() => import('./components/OrchardHero.jsx'))
// The scanned rover (Gaussian splat) - a separate WebGL canvas whose camera is
// slaved to the scene's live camera (ht6-cam feed) so it stays anchored in world.
const RobotRollIn = lazy(() => import('./components/RobotRollIn.jsx'))
const MonkeyStage = lazy(() => import('./pages/MonkeyStage.jsx'))
const AUTH0_CONFIGURED = Boolean(
  import.meta.env.VITE_AUTH0_DOMAIN && import.meta.env.VITE_AUTH0_CLIENT_ID,
)

const WEBGL2 = (() => {
  try {
    return !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
})()

function useHeroStats() {
  const { connected, telemetry, picks } = useRobot()
  const successCount = picks.filter((p) => p.success).length
  return [
    { label: 'Fruit picked', value: picks.length ? String(picks.length) : '-' },
    {
      label: 'Sort accuracy',
      value: picks.length
        ? `${Math.round((successCount / picks.length) * 100)}%`
        : '-',
    },
    {
      label: 'Est. waste avoided',
      value: picks.length ? `${(successCount * 0.15).toFixed(1)} kg` : '-',
    },
    {
      label: 'Robot status',
      value: connected ? (telemetry?.state ?? 'ONLINE') : 'OFFLINE',
    },
  ]
}

function OrchardAccountControl({ operator, onFocusBoard, onMoveBoard, onLeaveBoard, onOpenBoard, onLogout }) {
  if (operator) {
    return (
      <div className="landing-logout" title={operatorLabel(operator)}>
        <span>{operatorLabel(operator)}</span>
        <button onClick={onLogout}>Sign out</button>
      </div>
    )
  }
  return (
    <div className="landing-login-wrap">
      <button
        className="landing-login"
        aria-label="Login"
        onPointerEnter={onFocusBoard}
        onPointerMove={onMoveBoard}
        onPointerLeave={onLeaveBoard}
        onFocus={onFocusBoard}
        onBlur={onLeaveBoard}
        onClick={onOpenBoard}
      />
      <span aria-hidden="true">LOGIN</span>
    </div>
  )
}

// The sign-in form that rides on the orchard board. It authenticates via Auth0
// Resource Owner Password Grant (no hosted-page redirect): see lib/ropg.js.
function AuthBoardPanel({ operator, onLogin, onLogout, onClose, onDemo }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  const onSubmit = async (event) => {
    event.preventDefault()
    if (pending) return
    setPending(true)
    setError('')
    const result = await passwordLogin(username.trim(), password)
    setPending(false)
    if (result.ok) {
      setPassword('')
      onLogin(result)
    } else {
      setError(result.error)
    }
  }

  return (
    <section className="auth-signboard-panel">
      <button className="signboard-close" onClick={onClose} aria-label="Return to orchard">×</button>
      <span className="signboard-kicker">FARMHAND ORCHARD PASS</span>
      <h2>{operator ? 'Welcome back.' : 'Operator sign in'}</h2>
      {operator ? (
        <>
          <p>Signed in as {operatorLabel(operator)}. Your commands are attributed to your orchard crew account.</p>
          <button className="signboard-action" onClick={onLogout}>Sign out</button>
        </>
      ) : (
        <form className="signboard-form" onSubmit={onSubmit}>
          <label className="signboard-field">
            <span>Username</span>
            <input
              type="text"
              name="username"
              autoComplete="username"
              placeholder="orchard.hand"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={pending}
            />
          </label>
          <label className="signboard-field">
            <span>Password</span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              placeholder="********"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={pending}
            />
          </label>
          {error ? <p className="signboard-error" role="alert">{error}</p> : null}
          <button type="submit" className="signboard-action" disabled={pending}>
            {pending ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      )}
      {onDemo ? (
        <button type="button" className="signboard-demo signboard-demo-btn" onClick={onDemo}>
          Or continue in demo mode -&gt;
        </button>
      ) : (
        <Link className="signboard-demo" to="/teleop">Or continue in demo mode -&gt;</Link>
      )}
    </section>
  )
}

function LandingAccountControl(props) {
  // Hidden when Auth is intentionally unconfigured (keeps local visual work usable).
  return AUTH0_CONFIGURED ? <OrchardAccountControl {...props} /> : null
}

// Static fallback hero for browsers/GPUs without WebGL2.
function ClassicHero() {
  const stats = useHeroStats()
  const { operator, login, logout } = useOperator()
  const [boardOpen, setBoardOpen] = useState(false)
  return (
    <main className="hero">
      <LandingAccountControl
        operator={operator}
        onOpenBoard={() => setBoardOpen(true)}
        onLogout={logout}
      />
      {AUTH0_CONFIGURED && boardOpen && !operator && (
        <div className="scene-auth-overlay is-modal">
          <AuthBoardPanel
            operator={operator}
            onLogin={(result) => { login(result); setBoardOpen(false) }}
            onLogout={logout}
            onClose={() => setBoardOpen(false)}
          />
        </div>
      )}
      <p className="kicker">HACK THE 6IX 2026</p>
      <h1>
        Battery, <span className="accent">not Blood.</span>
      </h1>
      <p className="sub">
        An autonomous harvest rover that sees fruit with on-arm edge AI, picks
        it, and sorts it into the right bin - apples, bananas, ripe or not.
        Lower food costs. Less waste. No back-breaking labor.
      </p>
      <div className="stats">
        {stats.map((s) => (
          <div className="stat" key={s.label}>
            <span className="value">{s.value}</span>
            <span className="label">{s.label}</span>
          </div>
        ))}
      </div>
      <nav className="cta-row">
        <Link className="cta primary" to="/stage">
          Enter Stage
        </Link>
        <Link className="cta" to="/teleop">
          Teleop
        </Link>
        <Link className="cta" to="/lidar">
          Lidar Map
        </Link>
        <Link className="cta" to="/swarm">
          Swarm
        </Link>
        <Link className="cta" to="/analytics">
          Analytics
        </Link>
        <Link className="cta" to="/info">
          How it works
        </Link>
      </nav>
      <p className="note">
        30-40% of food never makes it from harvest to shelf. Our rover picks
        and sorts at the point of harvest - 5 W of edge AI, zero stoop labor.
      </p>
    </main>
  )
}

// Probe the self-hosted scene, verifying it's the real scene and not the SPA
// shell fallback. While probing, show paper (no dead-iframe flash).
// Full-screen tune-in static for the landing-to-stage handoff. The stage's own
// fuzz cannot cover the cut, because the stage WebGL canvas mounts fresh on the
// handoff (to avoid three live GL contexts) and needs a beat to init - so the
// landing would visibly cut to the mounting stage before that fuzz appears. This
// 2D-canvas overlay lives at the App level and starts covering IMMEDIATELY when
// the handoff begins, on a wall clock, then fades as the stage settles under it.
function StageArrivalFuzz({ active }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!active) return undefined
    const canvas = ref.current
    if (!canvas) return undefined
    const ctx = canvas.getContext('2d')
    let w = 2
    let h = 2
    const resize = () => {
      w = canvas.width = Math.max(2, Math.ceil(window.innerWidth / 16))
      h = canvas.height = Math.max(2, Math.ceil(window.innerHeight / 16))
    }
    resize()
    window.addEventListener('resize', resize)
    // Ramp IN over the still-visible landing (soft CRT tune-in), hold fully
    // covered while the stage swaps in behind it, then fade OUT to the stage.
    // COVER must match stageCovered's delay so the landing unmounts and the stage
    // mounts exactly when the cover is fully opaque.
    const COVER = 340 // ms fade-in 0 -> 1 over the landing
    const HOLD = 420 // ms fully covered while the stage mounts
    const FADE = 950 // ms fade-out over the settled stage
    const t0 = performance.now()
    let raf = 0
    drawStatic(ctx, w, h)
    canvas.style.opacity = '0'
    const loop = () => {
      const el = performance.now() - t0
      const op = el < COVER
        ? el / COVER
        : el < COVER + HOLD
          ? 1
          : Math.max(0, 1 - (el - COVER - HOLD) / FADE)
      if (op <= 0.001 && el > COVER + HOLD) { canvas.style.opacity = '0'; return }
      drawStatic(ctx, w, h)
      canvas.style.opacity = String(op)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [active])
  if (!active) return null
  return <canvas ref={ref} className="stage-arrival-fuzz" aria-hidden="true" />
}

function GithubIcon() {
  return (
    <svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

function DevpostIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M8 2.5h8L21.5 8v8L16 21.5H8L2.5 16V8z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <text x="12" y="16" textAnchor="middle" fontSize="11" fontWeight="700" fontFamily="system-ui, sans-serif" fill="currentColor">D</text>
    </svg>
  )
}

// Project links, bottom-left of the landing. TODO: replace the Devpost href with
// the real submission URL once it exists.
const LANDING_LINKS = [
  { label: 'GitHub', href: 'https://github.com/DanielWLiu07/hack-the-6ix', Icon: GithubIcon },
  { label: 'Devpost', href: 'https://devpost.com/', Icon: DevpostIcon },
]

function LandingLinks() {
  return (
    <nav className="landing-links" aria-label="Project links">
      {LANDING_LINKS.map(({ label, href, Icon }) => (
        <a
          key={label}
          className="landing-link"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          title={label}
          aria-label={label}
        >
          <Icon />
        </a>
      ))}
    </nav>
  )
}

function Landing() {
  const [mode, setMode] = useState(null) // null | 'scene' | 'orchard'
  const [authBoardOpen, setAuthBoardOpen] = useState(false)
  const [authBoardPinned, setAuthBoardPinned] = useState(false)
  const [stageActive, setStageActive] = useState(false)
  // Flips true once the arrival fuzz has ramped over the landing. The landing
  // visuals stay until then and the stage mounts only then, so the WebGL context
  // swap is hidden behind the fuzz and the fuzz fades IN over the real landing
  // scene rather than snapping on. Delay matches COVER in StageArrivalFuzz.
  const [stageCovered, setStageCovered] = useState(false)
  useEffect(() => {
    if (!stageActive) return undefined
    const id = setTimeout(() => setStageCovered(true), 340)
    return () => clearTimeout(id)
  }, [stageActive])
  const [loginRevealed, setLoginRevealed] = useState(false)
  // Global, persistent session (survives navigation + refresh): see lib/auth.jsx.
  const { operator, login, logout: handleLogout } = useOperator()
  // Keep the board in the DOM through its exit animation instead of yanking it
  // the instant it closes: boardShown = mounted, boardClosing = playing exit.
  const [boardShown, setBoardShown] = useState(false)
  const [boardClosing, setBoardClosing] = useState(false)
  const sceneRef = useRef(null)
  const authOverlayRef = useRef(null)

  const closeBoard = () => {
    setAuthBoardPinned(false)
    setAuthBoardOpen(false)
    relaySceneFocus(null, false, false)
  }
  const handleLogin = (result) => {
    login(result)
    closeBoard()
  }
  // Demo mode: drop the login, return to the orchard, and kick off the apple
  // grab (which plays through to the stage handoff).
  const handleDemo = () => {
    closeBoard()
    sceneRef.current?.contentWindow?.postMessage(
      { type: 'ht6-demo-start' },
      window.location.origin,
    )
  }

  const relaySceneFocus = (event, active, open = undefined) => {
    const x = event?.clientX == null ? 0 : (event.clientX / window.innerWidth) * 2 - 1
    const y = event?.clientY == null ? 0 : -((event.clientY / window.innerHeight) * 2 - 1)
    sceneRef.current?.contentWindow?.postMessage(
      { type: 'ht6-auth-focus', active, x, y, open },
      window.location.origin,
    )
  }

  const wireSceneStart = () => {
    const frame = sceneRef.current
    const doc = frame?.contentDocument
    const win = frame?.contentWindow
    if (!doc || !win || doc.__ht6StartWired) return
    doc.__ht6StartWired = true
    // Send an explicit start command from the visible landing document. This
    // avoids a missed claw click when the painterly hover ray is one frame late.
    doc.addEventListener(
      'pointerdown',
      () => win.postMessage({ type: 'ht6-start-claw' }, window.location.origin),
      { capture: true },
    )
  }

  // Parent overlays (including Login) sit above the iframe. Relay their cursor
  // motion too, so the painting retains the same camera-follow everywhere.
  useEffect(() => {
    const relayPointer = (event) => {
      sceneRef.current?.contentWindow?.postMessage(
        {
          type: 'ht6-scene-pointer',
          x: (event.clientX / window.innerWidth) * 2 - 1,
          y: -((event.clientY / window.innerHeight) * 2 - 1),
        },
        window.location.origin,
      )
    }
    window.addEventListener('pointermove', relayPointer, { passive: true })
    return () => window.removeEventListener('pointermove', relayPointer)
  }, [])

  useEffect(() => {
    let alive = true
    fetch('/scene/index.html', { cache: 'no-store' })
      .then((r) => (r.ok ? r.text() : ''))
      .then((html) => {
        if (!alive) return
        const isScene = html.includes('id="gl"') && !html.includes('id="root"')
        setMode(isScene ? 'scene' : 'orchard')
      })
      .catch(() => {
        if (alive) setMode('orchard')
      })
    return () => {
      alive = false
    }
  }, [])

  // The embedded scene postMessages its heist phases. Warm the stage assets
  // The stage is rendered underneath the landing from first paint. On ascent
  // we reveal it in-place rather than unmounting into a different route.
  useEffect(() => {
    let warmed = false
    const onMsg = (e) => {
      const d = e.data
      if (!d || d.type !== 'ht6-scene') return
      if (d.phase === 'grabbed' && !warmed) {
        warmed = true
        // Redundant cache warm-up for a cold browser cache.
        fetch('/assets/tv.glb').catch(() => {})
        fetch('/assets/suzanne-fullbody-rigged.glb').catch(() => {})
      } else if (d.phase === 'landed') {
        // The hero apple just hit the floor: bring the login sign in on that beat.
        setLoginRevealed(true)
      } else if (d.phase === 'ascent') {
        // Claw carries the apple up: hand off to /stage. The fuzz lives only on
        // the POMME screen there (see FuzzCanvas), driven by the camera intro -
        // nothing full-screen on the landing.
        setStageActive(true)
        window.history.replaceState(window.history.state, '', '/stage')
      }
    }
    window.addEventListener('message', onMsg)
    return () => {
      window.removeEventListener('message', onMsg)
    }
  }, [])

  // Reveal fallback: orchard mode never sends 'landed', and a scene message can
  // be missed on a slow first paint. Orchard shows the login shortly after load.
  // In scene mode the login is meant to drop in exactly when the apple slams the
  // ground (the 'landed' message), so the fallback sits well AFTER the expected
  // slam (~3-4s in) and only fires if that beat was somehow dropped.
  useEffect(() => {
    if (mode === null || loginRevealed) return
    const delay = mode === 'orchard' ? 1200 : 7000
    const id = setTimeout(() => setLoginRevealed(true), delay)
    return () => clearTimeout(id)
  }, [mode, loginRevealed])

  // Lock the sign-in card onto the board: the scene posts the board face's
  // projected screen position every frame, and we move the overlay to match it
  // via direct DOM writes (no React state, so a frame-rate feed is cheap). This
  // is what makes the form read as part of the scene, riding the sign as the
  // camera sways, instead of a card pinned to screen space.
  useEffect(() => {
    const onAnchor = (e) => {
      if (e.data?.type !== 'ht6-auth-anchor') return
      const el = authOverlayRef.current
      if (!el) return
      el.style.left = `${(e.data.x * 100).toFixed(2)}%`
      el.style.top = `${(e.data.y * 100).toFixed(2)}%`
    }
    window.addEventListener('message', onAnchor)
    return () => window.removeEventListener('message', onAnchor)
  }, [])

  // Drive the board mount/exit: open mounts it, closing plays the exit animation
  // for its duration, then it unmounts. (matches scene-auth-out timing in CSS.)
  useEffect(() => {
    if (authBoardPinned) {
      setBoardShown(true)
      setBoardClosing(false)
      return undefined
    }
    if (!boardShown) return undefined
    setBoardClosing(true)
    const id = setTimeout(() => {
      setBoardShown(false)
      setBoardClosing(false)
    }, 340)
    return () => clearTimeout(id)
  }, [authBoardPinned, boardShown])

  if (mode === null) return <main className="hero-stage" />
  return (
    <main className={`hero-stage ${loginRevealed ? 'login-in' : ''}`}>
      <StageArrivalFuzz active={stageActive} />
      {!stageCovered && <LandingLinks />}
      {/* The manga stage sits underneath the landing from first paint; the route,
          WebGL canvas, and mascot never remount. The apple ascent cross-fades to
          it (a plain opacity fade, see .landing-stage-layer) at its settled pose. */}
      <div className={`landing-stage-layer ${stageCovered ? 'is-active' : ''}`}>
        {/* The stage's WebGL canvas is NOT mounted during the landing. Keeping it
            alive next to the painterly scene iframe and the robot splat meant
            three heavy WebGL contexts at once, which crashed the GPU and left the
            stage black after the handoff. Mount it only when the stage takes over
            (the same fresh-mount path as a direct /stage visit, which is stable);
            the fuzz intro covers the brief load. */}
        {stageCovered && (
          <Suspense fallback={null}>
            <MonkeyStage showNav playIntro liveScene />
          </Suspense>
        )}
      </div>
      {mode === 'scene' ? (
        <>
          {/* Unmount once the stage takes over so this scene's WebGL context is
              freed - the stage painting's live scene is the only one left. */}
          {!stageCovered && (
            <iframe
              ref={sceneRef}
              className="hero-embed"
              src="/scene/index.html"
              title="Painterly orchard scene"
              onLoad={wireSceneStart}
            />
          )}
          {AUTH0_CONFIGURED && boardShown && (
            <div
              className={`scene-auth-overlay ${boardClosing ? 'is-closing' : ''}`}
              ref={authOverlayRef}
            >
              <AuthBoardPanel
                operator={operator}
                onLogin={handleLogin}
                onLogout={handleLogout}
                onClose={closeBoard}
                onDemo={handleDemo}
              />
            </div>
          )}
        </>
      ) : (
        <Suspense fallback={<div className="hero-fallback" />}>
          <OrchardHero
            authBoardOpen={authBoardOpen}
            authPanel={AUTH0_CONFIGURED && authBoardPinned ? (
              <AuthBoardPanel
                operator={operator}
                onLogin={handleLogin}
                onLogout={handleLogout}
                onClose={() => {
                  setAuthBoardPinned(false)
                  setAuthBoardOpen(false)
                }}
              />
            ) : null}
          />
        </Suspense>
      )}
      {!stageCovered && (
        <Suspense fallback={null}>
          <RobotRollIn />
        </Suspense>
      )}
      {!stageCovered && (
        <LandingAccountControl
          operator={operator}
          onLogout={handleLogout}
          onFocusBoard={() => {
            setAuthBoardOpen(true)
          }}
          onMoveBoard={() => {}}
          onLeaveBoard={() => {
            if (!authBoardPinned) setAuthBoardOpen(false)
          }}
          onOpenBoard={() => {
            // Toggle: pressing LOGIN again while the board is up backs out of it.
            if (authBoardPinned) {
              closeBoard()
              return
            }
            setAuthBoardPinned(true)
            setAuthBoardOpen(true)
            relaySceneFocus(null, true, true)
          }}
        />
      )}
    </main>
  )
}

export default function App() {
  if (!WEBGL2) return <ClassicHero />
  return <Landing />
}
