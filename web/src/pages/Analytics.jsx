import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { useRobot, SERVER_URL } from '../lib/robot.jsx'
import '../analytics.css'

// Reuse the landing's painterly orchard scene as the full-page backdrop (do not
// reinvent it). Lazy so three/r3f stays out of the analytics data path.
const OrchardHero = lazy(() => import('../components/OrchardHero.jsx'))

// Green painterly orchard palette.
const C_LEAF = '#52803a'
const C_GOLD = '#b57e28'
const C_INK = '#33452b'

const BINS = ['apple_ripe', 'apple_unripe', 'banana_ripe', 'banana_unripe']
const KG_PER_PICK = 0.15 // avg fruit mass, waste-avoided estimate

const WINDOWS = [
  { key: 'all', label: 'ALL', ms: 0 },
  { key: '5m', label: '5M', ms: 5 * 60_000 },
  { key: '1m', label: '1M', ms: 60_000 },
]

// Server /api/stats shape (server-core): { totals:{picks,successes,failures,
// success_rate}, by_bin, avg_pick_duration_ms, waste_avoided_kg, co2e_avoided_kg }
function normalizeStats(s) {
  if (!s) return null
  return {
    total: s.totals?.picks ?? s.total ?? 0,
    success_rate: s.totals?.success_rate ?? s.success_rate ?? null,
    waste_avoided_kg: s.waste_avoided_kg ?? null,
    co2e_avoided_kg: s.co2e_avoided_kg ?? null,
    avg_duration_ms: s.avg_pick_duration_ms ?? s.avg_duration_ms ?? null,
    by_bin: s.by_bin ?? null,
  }
}

function binCounts(picks) {
  const b = Object.fromEntries(BINS.map((k) => [k, 0]))
  for (const p of picks) if (p.bin in b) b[p.bin]++
  return b
}

function fmt(n, d = 0) {
  if (n == null || Number.isNaN(n)) return '--'
  return Number(n).toLocaleString(undefined, {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  })
}

// Inline SVG sparkline, no chart library.
function Sparkline({ data, color, area, height = 34 }) {
  const path = useMemo(() => {
    if (!data || data.length < 2) return null
    const min = Math.min(...data)
    const max = Math.max(...data)
    const span = max - min || 1
    const stepX = 100 / (data.length - 1)
    const pts = data.map((v, i) => {
      const x = i * stepX
      const y = 36 - ((v - min) / span) * 32 - 2 // 2px padding, inverted
      return [x, y]
    })
    const line = pts
      .map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(2)} ${p[1].toFixed(2)}`)
      .join(' ')
    const fill = `${line} L100 38 L0 38 Z`
    return { line, fill }
  }, [data])

  return (
    <svg
      className="az-spark"
      style={{ height }}
      viewBox="0 0 100 38"
      preserveAspectRatio="none"
      aria-hidden
    >
      {path ? (
        <>
          {area && <path d={path.fill} fill={color} opacity="0.16" />}
          <path className="line" d={path.line} stroke={color} />
        </>
      ) : (
        <line
          x1="0"
          y1="34"
          x2="100"
          y2="34"
          stroke={color}
          strokeOpacity="0.35"
          strokeWidth="1.5"
        />
      )}
    </svg>
  )
}

class HeroBoundary extends Component {
  state = { dead: false }
  static getDerivedStateFromError() {
    return { dead: true }
  }
  render() {
    return this.state.dead ? null : this.props.children
  }
}

function Metric({ label, value, unit, sub, series, color, area = true }) {
  return (
    <div className="az-panel az-metric">
      <h3>{label}</h3>
      <div className="az-num">
        {value}
        {unit && <span className="u">{unit}</span>}
      </div>
      {sub && <div className="az-delta">{sub}</div>}
      <Sparkline data={series} color={color} area={area} />
    </div>
  )
}

export default function Analytics() {
  const { picks, sim, connected } = useRobot()
  const [serverStats, setServerStats] = useState(null)
  const [fetchError, setFetchError] = useState(false)
  const [win, setWin] = useState('all')
  const [now, setNow] = useState(() => Date.now())

  // poll the server aggregate (live mode only)
  useEffect(() => {
    if (sim) return
    let alive = true
    const load = async () => {
      try {
        const res = await fetch(`${SERVER_URL}/api/stats`)
        if (!res.ok) throw new Error(res.status)
        const data = await res.json()
        if (alive) {
          setServerStats(normalizeStats(data))
          setFetchError(false)
        }
      } catch {
        if (alive) setFetchError(true)
      }
    }
    load()
    const id = setInterval(load, 5000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [sim])

  // gentle clock so the time windows stay accurate between pick events
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 3000)
    return () => clearInterval(id)
  }, [])

  const winMs = WINDOWS.find((w) => w.key === win)?.ms ?? 0
  const winLabel = WINDOWS.find((w) => w.key === win)?.label ?? 'ALL'

  const bufAsc = useMemo(() => [...picks].sort((a, b) => a.ts - b.ts), [picks])
  const winPicks = useMemo(
    () => (winMs > 0 ? bufAsc.filter((p) => now - p.ts <= winMs) : bufAsc),
    [bufAsc, winMs, now],
  )

  const useServer = win === 'all' && !!serverStats && !sim
  const byBin =
    useServer && serverStats.by_bin ? serverStats.by_bin : binCounts(winPicks)

  const okCount = winPicks.filter((p) => p.success).length
  const total = useServer ? serverStats.total : winPicks.length
  const rate = useServer
    ? serverStats.success_rate
    : winPicks.length
      ? okCount / winPicks.length
      : null
  const waste = useServer
    ? serverStats.waste_avoided_kg
    : +(okCount * KG_PER_PICK).toFixed(2)
  const co2e = useServer ? serverStats.co2e_avoided_kg : null
  const avgMs = useServer
    ? serverStats.avg_duration_ms
    : winPicks.length
      ? winPicks.reduce((s, p) => s + (p.duration_ms ?? 0), 0) / winPicks.length
      : null

  // session series, always from the live buffer window
  const series = useMemo(() => {
    const P = winPicks
    let c = 0
    let w = 0
    let ok = 0
    const picksCum = []
    const wasteCum = []
    const successRoll = []
    P.forEach((p, i) => {
      c += 1
      if (p.success) {
        ok += 1
        w += KG_PER_PICK
      }
      picksCum.push(c)
      wasteCum.push(+w.toFixed(3))
      successRoll.push((ok / (i + 1)) * 100)
    })
    const n = 28
    const buckets = new Array(n).fill(0)
    if (P.length) {
      const t0 = P[0].ts
      const t1 = P[P.length - 1].ts
      const span = Math.max(1, t1 - t0)
      for (const p of P) {
        const idx = Math.min(n - 1, Math.floor(((p.ts - t0) / span) * n))
        buckets[idx]++
      }
    }
    return { picksCum, wasteCum, successRoll, buckets }
  }, [winPicks])

  const binMax = Math.max(1, ...BINS.map((b) => byBin[b] ?? 0))
  const binTotal = BINS.reduce((s, b) => s + (byBin[b] ?? 0), 0)

  const matrix = ['apple', 'banana'].map((f) => ({
    fruit: f,
    ripe: byBin[`${f}_ripe`] ?? 0,
    unripe: byBin[`${f}_unripe`] ?? 0,
  }))
  const colTot = {
    ripe: (byBin.apple_ripe ?? 0) + (byBin.banana_ripe ?? 0),
    unripe: (byBin.apple_unripe ?? 0) + (byBin.banana_unripe ?? 0),
  }

  const live = !sim && connected && !fetchError
  const co2eShown = co2e != null

  return (
    <div className="az">
      {/* entire page = the landing's painterly orchard scene */}
      <div className="az-scene" aria-hidden>
        <HeroBoundary>
          <Suspense fallback={null}>
            <OrchardHero />
          </Suspense>
        </HeroBoundary>
      </div>

      <div className="az-overlay">
        <div className="az-head">
          <h1 className="az-title">Data Aggregation</h1>
        </div>

        <div className="az-main">
          {/* controls */}
      <div className="az-controls">
        <div className="az-seg" role="group" aria-label="time window">
          {WINDOWS.map((w) => (
            <button
              key={w.key}
              className={win === w.key ? 'on' : ''}
              onClick={() => setWin(w.key)}
            >
              {w.label}
            </button>
          ))}
        </div>
        <span className={`az-live${live ? '' : ' stale'}`}>
          <span className="sq" />
          {sim
            ? 'SIM STREAM'
            : live
              ? 'LIVE'
              : fetchError
                ? 'BUFFER ONLY'
                : 'CONNECTING'}
        </span>
      </div>

      {(sim || fetchError) && (
        <p className="az-note">
          {sim
            ? 'Sim mode. Figures derived from simulated pick events this session.'
            : `Aggregate endpoint unreachable at ${SERVER_URL}. Showing session-buffered pick events (last 50).`}
        </p>
      )}

      {/* metric tiles */}
      <div className="az-grid az-metrics">
        <Metric
          label="Total picks"
          value={fmt(total)}
          sub={`${okCount} ok / ${winPicks.length - okCount} fail (${winLabel})`}
          series={series.picksCum}
          color={C_LEAF}
        />
        <Metric
          label="Sort success"
          value={rate != null ? Math.round(rate * 100) : '--'}
          unit="%"
          sub={
            rate != null
              ? `${okCount} of ${winPicks.length || total} clean sorts`
              : 'no picks yet'
          }
          series={series.successRoll}
          color={C_LEAF}
          area={false}
        />
        <Metric
          label="Waste avoided"
          value={fmt(waste, 2)}
          unit="kg"
          sub={`at ${KG_PER_PICK} kg per fruit saved`}
          series={series.wasteCum}
          color={C_GOLD}
        />
        <Metric
          label={co2eShown ? 'CO2e avoided' : 'Avg pick time'}
          value={
            co2eShown
              ? fmt(co2e, 2)
              : avgMs != null
                ? (avgMs / 1000).toFixed(1)
                : '--'
          }
          unit={co2eShown ? 'kg' : 's'}
          sub={
            avgMs != null ? `avg cycle ${(avgMs / 1000).toFixed(1)}s` : undefined
          }
          series={series.wasteCum}
          color={C_INK}
          area={co2eShown}
        />
      </div>

      {/* bins + matrix */}
      <div className="az-grid az-two">
        <div className="az-panel">
          <h3>Sorted by bin</h3>
          <div className="az-tbl">
            {BINS.map((b) => {
              const v = byBin[b] ?? 0
              const isRipe = b.endsWith('_ripe')
              const cls = isRipe ? 'ripe' : 'unripe'
              const share = binTotal ? Math.round((v / binTotal) * 100) : 0
              return (
                <div className="az-tbl-row" key={b}>
                  <span className="az-tbl-name">
                    <i className={cls} />
                    {b.replace('_', ' / ')}
                  </span>
                  <span className="az-tbl-bar">
                    <span
                      className={cls}
                      style={{ width: `${(v / binMax) * 100}%` }}
                    />
                  </span>
                  <span className="az-tbl-count">
                    {v} <span className="az-tbl-pct">{share}%</span>
                  </span>
                </div>
              )
            })}
          </div>
          <div className="az-legend">
            <span>
              <i className="ripe" /> ripe (solid)
            </span>
            <span>
              <i className="unripe" /> unripe (tone)
            </span>
          </div>
        </div>

        <div className="az-panel">
          <h3>Fruit x ripeness</h3>
          <div className="az-matrix">
            <div className="h" />
            <div className="h">Ripe</div>
            <div className="h">Unripe</div>
            <div className="h tot">Total</div>
            {matrix.map((r) => (
              <MatrixRow key={r.fruit} row={r} />
            ))}
            <div className="rh">Total</div>
            <div className="cell tot">{colTot.ripe}</div>
            <div className="cell tot">{colTot.unripe}</div>
            <div className="cell tot">{binTotal}</div>
          </div>
        </div>
      </div>

      {/* throughput strip */}
      <div className="az-panel az-strip">
        <h3>Throughput / picks over {winLabel === 'ALL' ? 'session' : winLabel}</h3>
        <Sparkline data={series.buckets} color={C_LEAF} area height={58} />
      </div>
        </div>
      </div>
    </div>
  )
}

function MatrixRow({ row }) {
  const tot = row.ripe + row.unripe
  return (
    <>
      <div className="rh">{row.fruit === 'apple' ? 'Apple' : 'Banana'}</div>
      <div className="cell">
        <b>{row.ripe}</b>
      </div>
      <div className="cell">
        <b>{row.unripe}</b>
      </div>
      <div className="cell tot">{tot}</div>
    </>
  )
}
