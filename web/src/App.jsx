import { Suspense, lazy, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth0 } from '@auth0/auth0-react'
import { useRobot } from './lib/robot.jsx'
import './App.css'

// Landing ladder:
//   no WebGL2                     → static ClassicHero
//   /scene/ present (real scene)  → fullscreen self-hosted 1:1 painterly scene
//   /scene/ absent (fresh clones) → self-contained r3f OrchardHero
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

function OrchardAccountControl({ onFocusBoard, onMoveBoard, onLeaveBoard, onOpenBoard }) {
  const { isLoading, isAuthenticated, loginWithRedirect, logout, user } = useAuth0()
  const name = user?.name || user?.email || 'Orchard operator'

  if (isLoading) {
    return (
      <div className="landing-login-wrap">
        <button className="landing-login" disabled aria-label="Login" />
        <span aria-hidden="true">LOGIN</span>
      </div>
    )
  }

  if (!isAuthenticated) {
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
          onClick={onOpenBoard || (() => loginWithRedirect())}
        />
        <span aria-hidden="true">LOGIN</span>
      </div>
    )
  }

  return (
    <div className="landing-logout" title={name}>
      <span>{name}</span>
      <button onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}>
        Sign out
      </button>
    </div>
  )
}

function AuthBoardPanel({ onClose }) {
  const { isAuthenticated, loginWithRedirect, logout, user } = useAuth0()
  const name = user?.name || user?.email || 'Orchard operator'
  return (
    <section className="auth-signboard-panel">
      <button className="signboard-close" onClick={onClose} aria-label="Return to orchard">×</button>
      <span className="signboard-kicker">FARMHAND ORCHARD PASS</span>
      <h2>{isAuthenticated ? 'Welcome back.' : 'Ready to pick?'}</h2>
      <p>
        {isAuthenticated
          ? `Signed in as ${name}. Your commands can be attributed to your orchard crew account.`
          : 'Sign in to attribute robot commands and harvest picks to your operator profile.'}
      </p>
      {isAuthenticated ? (
        <button className="signboard-action" onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}>
          Sign out
        </button>
      ) : (
        <button className="signboard-action" onClick={() => loginWithRedirect()}>
          Sign in with Auth0
        </button>
      )}
      <Link className="signboard-demo" to="/teleop">Or continue in demo mode →</Link>
    </section>
  )
}

function SceneAuthBridge({ onClose }) {
  const { loginWithRedirect } = useAuth0()
  useEffect(() => {
    const onMessage = (event) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type === 'ht6-auth-login') loginWithRedirect()
      if (event.data?.type === 'ht6-auth-close') onClose()
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [loginWithRedirect, onClose])
  return null
}

function LandingAccountControl({ onFocusBoard, onMoveBoard, onLeaveBoard, onOpenBoard }) {
  // Keep local visual work usable when Auth0 is intentionally unconfigured.
  return AUTH0_CONFIGURED
    ? <OrchardAccountControl
        onFocusBoard={onFocusBoard}
        onMoveBoard={onMoveBoard}
        onLeaveBoard={onLeaveBoard}
        onOpenBoard={onOpenBoard}
      />
    : null
}

// Static fallback hero for browsers/GPUs without WebGL2.
function ClassicHero() {
  const stats = useHeroStats()
  return (
    <main className="hero">
      <LandingAccountControl />
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
  const sceneRef = useRef(null)

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
      } else if (d.phase === 'ascent') {
        setStageActive(true)
        window.history.replaceState(window.history.state, '', '/stage')
      }
    }
    window.addEventListener('message', onMsg)
    return () => {
      window.removeEventListener('message', onMsg)
    }
  }, [])

  if (mode === null) return <main className="hero-stage" />
  return (
    <main className="hero-stage">
      {AUTH0_CONFIGURED && <SceneAuthBridge onClose={() => {
        setAuthBoardPinned(false)
        setAuthBoardOpen(false)
        relaySceneFocus(null, false, false)
      }} />}
      <div className={`landing-stage-layer ${stageActive ? 'is-active' : ''}`}>
        <Suspense fallback={null}>
          <MonkeyStage showNav={stageActive} />
        </Suspense>
      </div>
      {mode === 'scene' ? (
        <>
          <iframe
            ref={sceneRef}
            className="hero-embed"
            src="/scene/index.html"
            title="Painterly orchard scene"
            onLoad={wireSceneStart}
          />
          {AUTH0_CONFIGURED && authBoardPinned && (
            <div className="scene-auth-overlay">
              <AuthBoardPanel onClose={() => {
                setAuthBoardPinned(false)
                setAuthBoardOpen(false)
                relaySceneFocus(null, false, false)
              }} />
            </div>
          )}
        </>
      ) : (
        <Suspense fallback={<div className="hero-fallback" />}>
          <OrchardHero
            authBoardOpen={authBoardOpen}
            authPanel={AUTH0_CONFIGURED && authBoardPinned ? <AuthBoardPanel onClose={() => {
              setAuthBoardPinned(false)
              setAuthBoardOpen(false)
            }} /> : null}
          />
        </Suspense>
      )}
      {!stageActive && (
        <LandingAccountControl
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
