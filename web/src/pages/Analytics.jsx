import { useEffect, useMemo, useState } from 'react'
import { useRobot, SERVER_URL } from '../lib/robot.jsx'

// Validated categorical pair on surface #121a15 (dataviz six-checks: all PASS)
const C_RIPE = '#199e70'
const C_UNRIPE = '#c98500'

const BINS = ['apple_ripe', 'apple_unripe', 'banana_ripe', 'banana_unripe']
const KG_PER_PICK = 0.15 // avg fruit mass — waste-avoided estimate

// Server /api/stats shape (server-core, live as of 17 Jul):
// { backend, totals: {picks, successes, failures, success_rate}, by_fruit,
//   by_ripeness, by_bin, avg_pick_duration_ms, detections,
//   waste_avoided_kg, co2e_avoided_kg }
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

// Derive a stats object from locally-buffered pick events (sim / server-less).
function statsFromPicks(picks) {
  const byBin = Object.fromEntries(BINS.map((b) => [b, 0]))
  let ok = 0
  for (const p of picks) {
    if (p.bin in byBin) byBin[p.bin]++
    if (p.success) ok++
  }
  return {
    total: picks.length,
    success_rate: picks.length ? ok / picks.length : null,
    waste_avoided_kg: +(ok * KG_PER_PICK).toFixed(2),
    by_bin: byBin,
    avg_duration_ms: picks.length
      ? picks.reduce((s, p) => s + (p.duration_ms ?? 0), 0) / picks.length
      : null,
  }
}

function StatTile({ label, value, unit, sub }) {
  return (
    <div className="panel">
      <h3>{label}</h3>
      <div className="bigval">
        {value}
        {unit && <span className="unit"> {unit}</span>}
      </div>
      {sub && <div className="subval">{sub}</div>}
    </div>
  )
}

// Horizontal bar row: 16px bar, 4px rounded data-end (square at baseline),
// value label at the tip in text ink.
function BarRow({ label, value, max, color }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  // Near-full bars would push the tip label past the track edge (overflow),
  // so anchor it just inside the bar's right end instead.
  const inside = pct > 80
  return (
    <div className="vz-row" title={`${label}: ${value}`}>
      <span className="vz-label">{label}</span>
      <div className="vz-track">
        <div
          className="vz-bar"
          style={{ width: `${pct}%`, background: color }}
        />
        <span
          className={`vz-val${inside ? ' inside' : ''}`}
          style={
            inside
              ? { left: `calc(${pct}% - 8px)`, transform: 'translate(-100%, -50%)' }
              : { left: `calc(${pct}% + 8px)` }
          }
        >
          {value}
        </span>
      </div>
    </div>
  )
}

export default function Analytics() {
  const { picks, sim } = useRobot()
  const [serverStats, setServerStats] = useState(null)
  const [fetchError, setFetchError] = useState(false)

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

  const local = useMemo(() => statsFromPicks(picks), [picks])
  const stats = serverStats ?? local
  const byBin = stats.by_bin ?? local.by_bin
  const binMax = Math.max(1, ...BINS.map((b) => byBin[b] ?? 0))

  // ripeness split per fruit (2 series: ripe / unripe)
  const fruitRows = ['apple', 'banana'].map((f) => ({
    fruit: f,
    ripe: byBin[`${f}_ripe`] ?? 0,
    unripe: byBin[`${f}_unripe`] ?? 0,
  }))

  const total = stats.total ?? 0
  const rate = stats.success_rate
  const waste = stats.waste_avoided_kg
  const avgMs = stats.avg_duration_ms

  return (
    <>
      <h2>Analytics</h2>
      {fetchError && !sim && (
        <p className="simnote" style={{ marginBottom: '1rem' }}>
          /api/stats unreachable at {SERVER_URL} — showing session-local counts
          from live pick_events instead.
        </p>
      )}
      {sim && (
        <p className="simnote" style={{ marginBottom: '1rem' }}>
          Sim mode — stats derived from simulated pick events this session.
        </p>
      )}

      <div className="grid cards" style={{ marginBottom: '1rem' }}>
        <StatTile label="Total picks" value={total} />
        <StatTile
          label="Success rate"
          value={rate != null ? Math.round(rate * 100) : '--'}
          unit="%"
        />
        <StatTile
          label="Est. waste avoided"
          value={waste != null ? waste : '--'}
          unit="kg"
          sub={`@ ${KG_PER_PICK} kg per fruit saved`}
        />
        <StatTile
          label={stats.co2e_avoided_kg != null ? 'CO₂e avoided' : 'Avg pick time'}
          value={
            stats.co2e_avoided_kg != null
              ? stats.co2e_avoided_kg
              : avgMs != null
                ? (avgMs / 1000).toFixed(1)
                : '--'
          }
          unit={stats.co2e_avoided_kg != null ? 'kg' : 's'}
          sub={avgMs != null ? `avg pick ${(avgMs / 1000).toFixed(1)}s` : undefined}
        />
      </div>

      <div className="grid main">
        <div className="panel">
          <h3>Picks by bin</h3>
          {BINS.map((b) => (
            <BarRow
              key={b}
              label={b.replace('_', ' · ')}
              value={byBin[b] ?? 0}
              max={binMax}
              color={b.endsWith('ripe') && !b.endsWith('unripe') ? C_RIPE : C_UNRIPE}
            />
          ))}
          <div className="vz-legend">
            <span>
              <i style={{ background: C_RIPE }} /> ripe
            </span>
            <span>
              <i style={{ background: C_UNRIPE }} /> unripe
            </span>
          </div>
        </div>

        <div className="panel">
          <h3>Ripeness split by fruit</h3>
          {fruitRows.map((r) => {
            const rowTotal = r.ripe + r.unripe
            return (
              <div key={r.fruit} style={{ marginBottom: '1rem' }}>
                <div className="vz-stack-label">
                  {r.fruit === 'apple' ? '🍎' : '🍌'} {r.fruit}
                  <span className="vz-muted"> · {rowTotal} picked</span>
                </div>
                <div
                  className="vz-stack"
                  title={`${r.fruit}: ${r.ripe} ripe / ${r.unripe} unripe`}
                >
                  {rowTotal === 0 ? (
                    <div className="vz-stack-empty" />
                  ) : (
                    <>
                      <div
                        style={{
                          flex: r.ripe || 0.0001,
                          background: C_RIPE,
                        }}
                      />
                      <div
                        style={{
                          flex: r.unripe || 0.0001,
                          background: C_UNRIPE,
                        }}
                      />
                    </>
                  )}
                </div>
                <div className="vz-stack-nums">
                  <span>{r.ripe} ripe</span>
                  <span>{r.unripe} unripe</span>
                </div>
              </div>
            )
          })}
          <div className="vz-legend">
            <span>
              <i style={{ background: C_RIPE }} /> ripe
            </span>
            <span>
              <i style={{ background: C_UNRIPE }} /> unripe
            </span>
          </div>
        </div>
      </div>
    </>
  )
}
