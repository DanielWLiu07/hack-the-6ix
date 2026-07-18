import { Suspense, lazy } from 'react'
import { Link } from 'react-router-dom'
import { useRobot } from './lib/robot.jsx'
import './App.css'

// Landing = the self-contained r3f painterly OrchardHero. Lazy so three.js
// stays out of the main bundle. It needs WebGL2 (the painterly pass is GLSL3);
// if that's unavailable we fall back to the static ClassicHero.
const OrchardHero = lazy(() => import('./components/OrchardHero.jsx'))

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

// One tiny, low-opacity corner link so the demo can navigate out of the scene.
function SceneChip() {
  return (
    <Link className="scene-chip" to="/dashboard">
      Dashboard →
    </Link>
  )
}

// Static fallback hero for browsers/GPUs without WebGL2.
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
  if (!WEBGL2) return <ClassicHero />
  return (
    <main className="hero-stage">
      <Suspense fallback={<div className="hero-fallback" />}>
        <OrchardHero />
      </Suspense>
      <SceneChip />
    </main>
  )
}
