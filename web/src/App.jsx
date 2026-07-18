import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useRobot } from './lib/robot.jsx'
import { passwordLogin } from './lib/ropg.js'
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
      <div className="landing-logout" title={operator.user.name}>
        <span>{operator.user.name}</span>
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
          <p>Signed in as {operator.user.name}. Your commands are attributed to your orchard crew account.</p>
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
  const [operator, setOperator] = useState(null)
  const [boardOpen, setBoardOpen] = useState(false)
  return (
    <main className="hero">
      <LandingAccountControl
        operator={operator}
        onOpenBoard={() => setBoardOpen(true)}
        onLogout={() => setOperator(null)}
      />
      {AUTH0_CONFIGURED && boardOpen && !operator && (
        <div className="scene-auth-overlay is-modal">
          <AuthBoardPanel
            operator={operator}
            onLogin={(result) => { setOperator(result); setBoardOpen(false) }}
            onLogout={() => setOperator(null)}
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
        <Link className="cta" to="/analytics">
          Analytics
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
function Landing() {
  const [mode, setMode] = useState(null) // null | 'scene' | 'orchard'
  const [authBoardOpen, setAuthBoardOpen] = useState(false)
  const [authBoardPinned, setAuthBoardPinned] = useState(false)
  const [stageActive, setStageActive] = useState(false)
  const [loginRevealed, setLoginRevealed] = useState(false)
  const [operator, setOperator] = useState(null)
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
    setOperator(result)
    closeBoard()
  }
  const handleLogout = () => setOperator(null)
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
  // be missed on a slow first paint. Orchard shows the login shortly after load;
  // scene keeps a longer safety net in case the landing beat was dropped.
  useEffect(() => {
    if (mode === null || loginRevealed) return
    const delay = mode === 'orchard' ? 1200 : 3500
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
      {/* The manga stage sits underneath the landing from first paint; the route,
          WebGL canvas, and mascot never remount. The apple ascent cross-fades to
          it (a plain opacity fade, see .landing-stage-layer) at its settled pose. */}
      <div className={`landing-stage-layer ${stageActive ? 'is-active' : ''}`}>
        <Suspense fallback={null}>
          {/* During the landing the stage painting stays a light poster; its live
              scene loads only once the stage takes over, so two heavy scenes
              never run together (that combo crashes Chrome's GPU process). */}
          <MonkeyStage showNav={stageActive} playIntro={stageActive} liveScene={stageActive} />
        </Suspense>
      </div>
      {mode === 'scene' ? (
        <>
          {/* Unmount once the stage takes over so this scene's WebGL context is
              freed - the stage painting's live scene is the only one left. */}
          {!stageActive && (
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
      {!stageActive && (
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
