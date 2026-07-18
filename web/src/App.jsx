import { Suspense, lazy } from 'react'
import { Link } from 'react-router-dom'
import { useRobot } from './lib/robot.jsx'
import './App.css'

// The fresh painterly r3f hero (end-goal). Lazy so three.js stays out of the
// main bundle and only loads when this backdrop is actually shown.
const OrchardHero = lazy(() => import('./components/OrchardHero.jsx'))

// Landing mode:
//  - USE_R3F_HERO true  → promote the painterly r3f orchard for dev AND prod
//    (replaces both interim modes below). Flip on after visual sign-off.
//  - else in DEV        → embed the standalone :8123 painterly scene (interim)
//  - else in PROD       → classic React hero (:8123 doesn't exist on Vercel)
const USE_R3F_HERO = false
const DEV = import.meta.env.DEV
const LEGACY_SCENE_URL = 'http://localhost:8123/'

function useHeroStats() {
  const { connected, telemetry, picks } = useRobot()
  const successCount = picks.filter((p) => p.success).length
  return [
    { label: 'Fruit picked', value: picks.length ? String(picks.length) : '—' },
    {
      label: 'Sort accuracy',
      value: picks.length
        ? `${Math.round((successCount / picks.length) * 100)}%`
        : '—',
    },
    {
      label: 'Est. waste avoided',
      value: picks.length ? `${(successCount * 0.15).toFixed(1)} kg` : '—',
    },
    {
      label: 'Robot status',
      value: connected ? (telemetry?.state ?? 'ONLINE') : 'OFFLINE',
    },
  ]
}

// The only thing overlaid on the pure scene: one tiny, low-opacity corner
// link so the demo can navigate out. Everything else (HUD, keyboard) is the
// scene's own, untouched.
function SceneChip() {
  return (
    <Link className="scene-chip" to="/dashboard">
      Dashboard →
    </Link>
  )
}

// Pure-scene landing: a fullscreen, fully-interactive backdrop with nothing
// over it but the corner chip.
function SceneLanding({ backdrop }) {
  return (
    <main className="hero-stage">
      {backdrop}
      <SceneChip />
    </main>
  )
}

// Interim (dev only): the standalone painterly scene served at :8123,
// fullscreen, behaving exactly as it does on its own.
function LegacyEmbed() {
  return (
    <iframe
      className="hero-embed"
      src={LEGACY_SCENE_URL}
      title="Painterly orchard scene"
    />
  )
}

// Classic React hero — prod interim until the r3f hero is promoted.
function ClassicHero() {
  const stats = useHeroStats()
  return (
    <main className="hero">
      <p className="kicker">HACK THE 6IX 2026</p>
      <h1>
        Battery, <span className="accent">not Blood.</span>
      </h1>
      <p className="sub">
        An autonomous harvest rover that sees fruit with on-arm edge AI, picks
        it, and sorts it into the right bin — apples, bananas, ripe or not.
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
        <Link className="cta primary" to="/dashboard">
          Live Dashboard
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
        30–40% of food never makes it from harvest to shelf. Our rover picks
        and sorts at the point of harvest — 5 W of edge AI, zero stoop labor.
      </p>
    </main>
  )
}

export default function App() {
  if (USE_R3F_HERO) {
    return (
      <SceneLanding
        backdrop={
          <Suspense fallback={<div className="hero-fallback" />}>
            <OrchardHero />
          </Suspense>
        }
      />
    )
  }
  if (DEV) {
    return <SceneLanding backdrop={<LegacyEmbed />} />
  }
  return <ClassicHero />
}
