import { Component, Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { useRobot, SERVER_URL } from '../lib/robot.jsx'
import BackToStage from '../components/BackToStage.jsx'
import '../analytics.css'

// Manga-shaded decoration scene + editor (background). Lazy so three/r3f stays
// out of the analytics data path.
const Deco = lazy(() => import('../components/Deco.jsx'))

// Ink for the data marks.
const C_INK = '#171914'
const C_GREY = '#6f6a61'

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

// Count-up number: animates from its previous value toward the new one.
function Num({ value, digits = 0 }) {
  const [disp, setDisp] = useState(typeof value === 'number' ? value : 0)
  const ref = useRef(disp)
  ref.current = disp
  useEffect(() => {
    if (typeof value !== 'number' || Number.isNaN(value)) return undefined
    const from = ref.current
    const start = performance.now()
    let raf
    const tick = (t) => {
      const k = Math.min(1, Math.max(0, (t - start) / 500))
      const e = 1 - Math.pow(1 - k, 3)
      setDisp(from + (value - from) * e)
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value])
  if (typeof value !== 'number' || Number.isNaN(value)) return value
  return disp.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

function Metric({ label, value, unit, sub, series, color, area = true, flash = false }) {
  return (
    <div className={`az-panel az-metric${flash ? ' flash' : ''}`}>
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

// Throughput bars + sort-success line over the window.
function TrendChart({ bars, line }) {
  const maxB = Math.max(1, ...bars)
  const n = bars.length || 1
  const bw = 100 / n
  return (
    <svg className="az-chart" viewBox="0 0 100 42" preserveAspectRatio="none" aria-hidden>
      <line className="axis" x1="0" y1="38" x2="100" y2="38" />
      {bars.map((b, i) => {
        const hh = (b / maxB) * 34
        return (
          <rect key={i} className="bar" x={i * bw + bw * 0.16} y={38 - hh} width={bw * 0.68} height={Math.max(0, hh)} />
        )
      })}
      {line && line.length > 1 && (
        <path
          className="succ"
          d={line
            .map((v, i) => `${i ? 'L' : 'M'}${((i / (line.length - 1)) * 100).toFixed(2)} ${(37 - (v / 100) * 33).toFixed(2)}`)
            .join(' ')}
        />
      )}
    </svg>
  )
}

export default function Analytics() {
  const { picks, sim, connected, detections } = useRobot()
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
  const streaming = sim || live

  // flash the pick counter whenever a new pick arrives
  const [flash, setFlash] = useState(false)
  const prevPicks = useRef(picks.length)
  useEffect(() => {
    if (picks.length > prevPicks.current) {
      setFlash(true)
      const t = setTimeout(() => setFlash(false), 700)
      prevPicks.current = picks.length
      return () => clearTimeout(t)
    }
    prevPicks.current = picks.length
    return undefined
  }, [picks.length])
  // ---- impact model. picks + waste stay live-derived; these are documented
  // conversion factors (see docs/IMPACT.md), not mock data. ----
  const CO2E_PER_KG = 2.5 // kg CO2e per kg food waste avoided
  const USD_PER_KG = 2.2 // wholesale produce value, $/kg
  const MANUAL_SEC = 18 // manual-picker cycle-time baseline
  const wasteKg = waste ?? 0
  const co2eKg = co2e != null ? co2e : +(wasteKg * CO2E_PER_KG).toFixed(2)
  const usd = Math.round(wasteKg * USD_PER_KG)
  const laborHrs = +(((total || 0) * MANUAL_SEC) / 3600).toFixed(1)
  const spanH =
    winPicks.length > 1
      ? Math.max(1 / 60, (winPicks[winPicks.length - 1].ts - winPicks[0].ts) / 3600000)
      : null
  const kgPerHr = spanH ? +((okCount * KG_PER_PICK) / spanH).toFixed(1) : null
  const vsManual = avgMs ? +(MANUAL_SEC / (avgMs / 1000)).toFixed(1) : null
  const peakThroughput = Math.max(0, ...series.buckets)

  // detection stats (from the live detection stream)
  const detCount = detections.length
  const detConf = detCount
    ? detections.reduce((s, d) => s + (d.conf ?? 0), 0) / detCount
    : null
  const lastDet = detections[0] ?? null

  // all-time aggregate from the server (live only)
  const allTime =
    serverStats && !sim
      ? {
          total: serverStats.total,
          rate: serverStats.success_rate,
          waste: serverStats.waste_avoided_kg,
        }
      : null

  return (
    <div className="az">
      <BackToStage />
      {/* manga-shaded deco scene + editor (background) */}
      <HeroBoundary>
        <Suspense fallback={null}>
          <Deco />
        </Suspense>
      </HeroBoundary>

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
        <span className={`az-live${streaming ? '' : ' stale'}`}>
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

      {/* impact / ROI strip */}
      <div className="az-panel az-impact">
        <h3>Impact // waste kept off the ground this {winLabel === 'ALL' ? 'session' : winLabel.toLowerCase()}</h3>
        <div className="az-impact-grid">
          <div className="az-imp"><b><Num value={wasteKg} digits={1} /><i>kg</i></b><span>waste avoided</span></div>
          <div className="az-imp"><b><Num value={co2eKg} digits={1} /><i>kg</i></b><span>CO2e avoided</span></div>
          <div className="az-imp"><b><i>$</i><Num value={usd} /></b><span>value recovered</span></div>
          <div className="az-imp"><b><Num value={laborHrs} digits={1} /><i>h</i></b><span>labor saved</span></div>
          <div className="az-imp"><b><Num value={kgPerHr ?? 0} digits={1} /><i>kg/h</i></b><span>{vsManual ? `${vsManual}x manual` : 'throughput'}</span></div>
        </div>
      </div>

      {/* metric tiles */}
      <div className="az-grid az-metrics">
        <Metric
          label="Total picks"
          value={<Num value={total} />}
          flash={flash}
          sub={`${okCount} ok / ${winPicks.length - okCount} fail (${winLabel})`}
          series={series.picksCum}
          color={C_INK}
        />
        <Metric
          label="Sort success"
          value={<Num value={rate != null ? Math.round(rate * 100) : '--'} />}
          unit="%"
          sub={
            rate != null
              ? `${okCount} of ${winPicks.length || total} clean sorts`
              : 'no picks yet'
          }
          series={series.successRoll}
          color={C_INK}
          area={false}
        />
        <Metric
          label="Avg pick time"
          value={<Num value={avgMs != null ? avgMs / 1000 : '--'} digits={1} />}
          unit="s"
          sub={vsManual ? `${vsManual}x a manual picker` : 'cycle time'}
          series={series.wasteCum}
          color={C_GREY}
          area={false}
        />
        <Metric
          label="Vision confidence"
          value={<Num value={detConf != null ? Math.round(detConf * 100) : '--'} />}
          unit="%"
          sub={detCount ? `${detCount} detections` : 'no detections yet'}
          series={series.successRoll}
          color={C_INK}
          area={false}
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

      {/* trends */}
      <div className="az-panel az-trends">
        <h3>Trends // throughput bars + sort-success line over {winLabel === 'ALL' ? 'session' : winLabel}</h3>
        <TrendChart bars={series.buckets} line={series.successRoll} />
        <div className="az-trend-legend">
          <span><i className="k-bar" /> throughput (peak {peakThroughput}/bucket)</span>
          <span><i className="k-line" /> sort success</span>
          {allTime && <span className="k-all">all-time {allTime.total} picks</span>}
        </div>
      </div>

      {/* live feed + all-time / vision */}
      <div className="az-grid az-two">
        <div className="az-panel">
          <h3>Last picks</h3>
          <ul className="az-feed">
            {picks.length === 0 && <li className="empty">waiting for picks...</li>}
            {picks.slice(0, 8).map((p, i) => (
              <li key={`${p.ts}-${i}`}>
                <span className="t">{new Date(p.ts).toLocaleTimeString([], { hour12: false })}</span>
                <span className="f">{p.fruit} {p.ripeness}</span>
                <span className="ar">{'->'}</span>
                <span className="bn">{p.bin}</span>
                <span className={`st ${p.success ? 'y' : 'n'}`}>{p.success ? 'OK' : 'FAIL'}</span>
                <span className="dd">{p.duration_ms ? `${(p.duration_ms / 1000).toFixed(1)}s` : ''}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="az-panel">
          <h3>{allTime ? 'All-time (server)' : 'Vision'}</h3>
          <div className="az-kv">
            {allTime ? (
              <>
                <div><span>picks</span><b>{allTime.total}</b></div>
                <div><span>success</span><b>{allTime.rate != null ? `${Math.round(allTime.rate * 100)}%` : '--'}</b></div>
                <div><span>waste</span><b>{allTime.waste != null ? `${allTime.waste} kg` : '--'}</b></div>
                <div><span>CO2e</span><b>{co2eKg} kg</b></div>
              </>
            ) : (
              <>
                <div><span>avg confidence</span><b>{detConf != null ? `${Math.round(detConf * 100)}%` : '--'}</b></div>
                <div><span>detections</span><b>{detCount}</b></div>
                <div><span>last seen</span><b>{lastDet ? `${lastDet.fruit} ${lastDet.ripeness}` : '--'}</b></div>
                <div><span>last conf</span><b>{lastDet ? `${Math.round((lastDet.conf ?? 0) * 100)}%` : '--'}</b></div>
              </>
            )}
          </div>
        </div>
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
