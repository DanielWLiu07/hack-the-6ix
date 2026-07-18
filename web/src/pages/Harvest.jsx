import { useEffect, useMemo, useRef, useState } from 'react'
import { useRobot, SERVER_URL } from '../lib/robot.jsx'
import { detectFile, detectUrl, cachedDetection } from '../lib/ripeness.js'
import '../harvest.css'

// Harvest Log - a gallery of the real apple/banana photos captured when the
// robot picks each fruit (stored on Vercel Blob / hub /media). Every photo is
// ANNOTATED in the browser by the same YOLOv8n ripeness model: detected box +
// fruit + ripeness + confidence. History from GET /api/picks; live via pick_event.

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'apple', label: 'Apples' },
  { id: 'banana', label: 'Bananas' },
  { id: 'ripe', label: 'Ripe' },
  { id: 'unripe', label: 'Unripe' },
]

const WASTE_PER_FRUIT_KG = 0.15 // ripe-picked-and-sorted waste avoided factor

// Real sample photos (public/samples, seeded from the ripeness dataset) so the
// gallery + annotations can be tested before the robot streams live JPEGs.
const SAMPLE_DEFS = ['apple_ripe', 'apple_unripe', 'banana_ripe', 'banana_unripe'].flatMap(
  (cls) => {
    const [fruit, ripeness] = cls.split('_')
    return [0, 1, 2, 3].map((n) => ({
      fruit,
      ripeness,
      bin: cls,
      image_url: `/samples/sample_${cls}_${n}.jpg`,
    }))
  },
)

function fmtTime(ts) {
  return new Date(ts).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

const keyOf = (p) => `${p.ts}-${p.fruit}-${p.bin ?? ''}`
const isRaster = (url) => !!url && !url.toLowerCase().endsWith('.svg')

function matches(p, filter) {
  if (filter === 'all') return true
  if (filter === 'ripe' || filter === 'unripe') return p.ripeness === filter
  return p.fruit === filter
}

// Photo with the model's detection drawn over it. Detects lazily (on scroll)
// for remote URLs, eagerly for an uploaded File. Skips SVG placeholders.
function AnnotatedPhoto({ url, file, fit = 'cover', detect = true, onResult }) {
  const src = useMemo(() => (file ? URL.createObjectURL(file) : url), [file, url])
  const [res, setRes] = useState(() => (url ? cachedDetection(url) : undefined))
  const wrapRef = useRef(null)

  useEffect(() => {
    if (file) return () => URL.revokeObjectURL(src)
  }, [file, src])

  useEffect(() => {
    if (file) {
      let alive = true
      detectFile(file).then((r) => alive && setRes(r)).catch(() => alive && setRes(null))
      return () => {
        alive = false
      }
    }
    if (!detect || !isRaster(url) || res !== undefined) return
    const el = wrapRef.current
    if (!el) return
    let done = false
    const io = new IntersectionObserver(
      (ents) => {
        if (ents[0].isIntersecting && !done) {
          done = true
          io.disconnect()
          detectUrl(url).then(setRes)
        }
      },
      { rootMargin: '150px' },
    )
    io.observe(el)
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, file, detect])

  useEffect(() => {
    onResult?.(res)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [res])

  return (
    <div className="ann" ref={wrapRef}>
      {src ? (
        <img className="ann-img" style={{ objectFit: fit }} src={src} alt="" loading="lazy" />
      ) : (
        <div className="hv-nophoto">no photo</div>
      )}
      {res?.box && (
        <svg
          className="ann-svg"
          viewBox="0 0 100 100"
          preserveAspectRatio={fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet'}
        >
          <rect
            className="ann-box"
            x={res.box[0] * 100}
            y={res.box[1] * 100}
            width={res.box[2] * 100}
            height={res.box[3] * 100}
          />
          <text
            className="ann-lab"
            x={res.box[0] * 100 + 0.8}
            y={Math.max(res.box[1] * 100 - 1.4, 4)}
          >
            {res.fruit?.toUpperCase()} {res.ripeness?.toUpperCase()} {Math.round(res.conf * 100)}%
          </text>
        </svg>
      )}
    </div>
  )
}

function RipeTag({ ripeness }) {
  return <span className={`hv-ripe ${ripeness}`}>{ripeness}</span>
}

// Inked manga glyph shown for picks that have no real photo yet (sim writes SVG
// placeholders). Keeps the panel on-theme instead of a dark stand-in image.
function FruitGlyph({ fruit }) {
  return (
    <div className="hv-glyph">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        {fruit === 'banana' ? (
          <path
            className="g-fill"
            d="M26 42 Q36 74 72 68 Q78 66 74 62 Q56 70 42 56 Q32 46 34 40 Q30 38 26 42 Z"
          />
        ) : (
          <>
            <path className="g-fill" d="M56 34 Q78 30 78 54 Q78 78 56 78 Q34 78 34 54 Q34 30 56 34 Z" />
            <rect className="g-ink" x="54" y="20" width="4" height="14" rx="2" />
            <path className="g-fill" d="M58 26 Q72 16 80 24 Q70 34 58 30 Z" />
          </>
        )}
      </svg>
      <span className="hv-glyph-tag">no photo yet</span>
    </div>
  )
}

function HvCard({ pick, onOpen }) {
  const [model, setModel] = useState(null)
  // prefer the live model annotation for the chip; fall back to the logged label
  const fruit = model?.fruit ?? pick.fruit
  const ripeness = model?.ripeness ?? pick.ripeness
  return (
    <button className="hv-card" onClick={() => onOpen(pick)}>
      <div className="hv-photo">
        {isRaster(pick.image_url) ? (
          <AnnotatedPhoto url={pick.image_url} fit="cover" onResult={setModel} />
        ) : (
          <FruitGlyph fruit={pick.fruit} />
        )}
        <span className={`hv-result ${pick.success ? 'ok' : 'miss'}`}>
          {pick.success ? 'SORTED' : 'MISS'}
        </span>
        <div className="hv-overlay">
          <span className="hv-fruit">{fruit}</span>
          <RipeTag ripeness={ripeness} />
        </div>
      </div>
      <div className="hv-meta">
        <span className="hv-bin">{pick.bin ?? '-'}</span>
        <span className="hv-time">{fmtTime(pick.ts)}</span>
      </div>
    </button>
  )
}

function ClassifyPanel() {
  const [file, setFile] = useState(null)
  const [model, setModel] = useState(undefined)

  const pick = (f) => {
    if (!f) return
    setModel(undefined)
    setFile(f)
  }

  return (
    <section
      className="hv-classify"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        pick(e.dataTransfer.files?.[0])
      }}
    >
      <div className="hv-cl-head">
        <label className="hv-cl-btn">
          Upload a photo
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => pick(e.target.files?.[0])}
          />
        </label>
        <span className="hv-cl-hint">
          or drop an apple / banana photo to detect + annotate it with the
          on-device ripeness model (YOLOv8n) right here in your browser
        </span>
      </div>
      {file && (
        <div className="hv-cl-out">
          <div className="hv-cl-prev">
            <AnnotatedPhoto file={file} fit="contain" onResult={setModel} />
          </div>
          <div className="hv-cl-res">
            {model === undefined ? (
              <span className="hv-cl-load">running model...</span>
            ) : model ? (
              <div className="hv-cl-hit">
                <div className="hv-cl-line">
                  <span className="hv-fruit">{model.fruit}</span>
                  <RipeTag ripeness={model.ripeness} />
                </div>
                <div className="hv-cl-conf">{Math.round(model.conf * 100)}% confidence</div>
              </div>
            ) : (
              <span className="hv-cl-err">no fruit detected</span>
            )}
          </div>
        </div>
      )}
    </section>
  )
}

export default function Harvest() {
  const { picks: livePicks } = useRobot()
  const [fetched, setFetched] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [active, setActive] = useState(null)
  const [activeModel, setActiveModel] = useState(undefined)
  const [samplePicks, setSamplePicks] = useState([])

  const toggleSamples = () =>
    setSamplePicks((cur) =>
      cur.length
        ? []
        : SAMPLE_DEFS.map((d, i) => ({
            ...d,
            ts: Date.now() - i * 17000,
            success: i % 6 !== 0,
            duration_ms: 7000 + (i % 5) * 800,
          })),
    )

  useEffect(() => {
    let alive = true
    fetch(`${SERVER_URL}/api/picks?limit=500`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows) => alive && setFetched(Array.isArray(rows) ? rows : []))
      .catch(() => {})
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  const picks = useMemo(() => {
    const map = new Map()
    for (const p of [...samplePicks, ...livePicks, ...fetched]) {
      if (!p || p.ts == null) continue
      const k = keyOf(p)
      if (!map.has(k)) map.set(k, p)
    }
    return [...map.values()].sort((a, b) => b.ts - a.ts)
  }, [samplePicks, livePicks, fetched])

  const shown = picks.filter((p) => matches(p, filter))
  const total = picks.length
  const successCount = picks.filter((p) => p.success).length
  const rate = total ? Math.round((successCount / total) * 100) : 0
  const ripeCount = picks.filter((p) => p.ripeness === 'ripe').length
  const wasteKg = (successCount * WASTE_PER_FRUIT_KG).toFixed(1)

  const openPick = (p) => {
    setActiveModel(undefined)
    setActive(p)
  }

  const activeFruit = activeModel?.fruit ?? active?.fruit
  const activeRipe = activeModel?.ripeness ?? active?.ripeness
  const activeIndex = active ? shown.findIndex((p) => keyOf(p) === keyOf(active)) : -1
  const step = (d) => {
    if (activeIndex < 0) return
    const next = shown[activeIndex + d]
    if (next) openPick(next)
  }

  useEffect(() => {
    if (!active) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') setActive(null)
      else if (e.key === 'ArrowLeft') step(-1)
      else if (e.key === 'ArrowRight') step(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="harvest">
      <div className="hv-head">
        <div>
          <p className="hv-kicker">Pick + sort ledger</p>
          <h2>Harvest Log</h2>
          <p className="hv-sub">
            Real photo captured on the arm camera at every pick, annotated by the
            on-device ripeness model.
          </p>
        </div>
        <div className="hv-stats">
          <div className="hv-stat">
            <span className="n">{total}</span>
            <span className="k">picked</span>
          </div>
          <div className="hv-stat">
            <span className="n">{ripeCount}</span>
            <span className="k">ripe</span>
          </div>
          <div className="hv-stat">
            <span className="n">{rate}%</span>
            <span className="k">sorted ok</span>
          </div>
          <div className="hv-stat">
            <span className="n">{wasteKg}</span>
            <span className="k">kg saved</span>
          </div>
        </div>
      </div>

      <ClassifyPanel />

      <div className="hv-filters">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            className={filter === f.id ? 'on' : ''}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
        <button className="hv-sample-btn" onClick={toggleSamples}>
          {samplePicks.length ? 'Clear samples' : 'Load sample photos'}
        </button>
        <span className="hv-count">{shown.length} shown</span>
      </div>

      {loading && !picks.length ? (
        <p className="empty">Loading harvest...</p>
      ) : !shown.length ? (
        <div className="hv-empty">
          <p className="hv-empty-t">No picks captured yet</p>
          <p className="hv-sub">
            A photo lands here each time the robot picks a fruit. Start the robot
            (or the sim) and they appear live.
          </p>
        </div>
      ) : (
        <div className="hv-grid">
          {shown.map((p) => (
            <HvCard key={keyOf(p)} pick={p} onOpen={openPick} />
          ))}
        </div>
      )}

      {active && (
        <div className="hv-lightbox" onClick={() => setActive(null)}>
          <div className="hv-lb-card" onClick={(e) => e.stopPropagation()}>
            <button className="hv-lb-close" onClick={() => setActive(null)}>
              close
            </button>
            {activeIndex > 0 && (
              <button className="hv-lb-nav prev" onClick={() => step(-1)} aria-label="Previous">
                ‹
              </button>
            )}
            {activeIndex < shown.length - 1 && (
              <button className="hv-lb-nav next" onClick={() => step(1)} aria-label="Next">
                ›
              </button>
            )}
            <div className="hv-lb-photo">
              {isRaster(active.image_url) ? (
                <AnnotatedPhoto url={active.image_url} fit="contain" onResult={setActiveModel} />
              ) : (
                <FruitGlyph fruit={active.fruit} />
              )}
              {activeIndex >= 0 && (
                <span className="hv-lb-count">
                  {activeIndex + 1} / {shown.length}
                </span>
              )}
            </div>
            <div className="hv-lb-info">
              <div className="hv-lb-title">
                <span className="hv-fruit">{activeFruit}</span>
                <RipeTag ripeness={activeRipe} />
              </div>
              <dl className="hv-lb-rows">
                <div>
                  <dt>Model detection</dt>
                  <dd>
                    {!isRaster(active.image_url)
                      ? 'awaiting real photo'
                      : activeModel === undefined
                        ? 'running...'
                        : activeModel
                          ? `${activeModel.label} ${Math.round(activeModel.conf * 100)}%`
                          : 'no detection'}
                  </dd>
                </div>
                <div>
                  <dt>Logged class</dt>
                  <dd>{active.fruit}_{active.ripeness}</dd>
                </div>
                <div>
                  <dt>Sorted to bin</dt>
                  <dd>{active.bin ?? '-'}</dd>
                </div>
                <div>
                  <dt>Result</dt>
                  <dd className={active.success ? 'ok' : 'miss'}>
                    {active.success ? 'sorted ok' : 'missed'}
                  </dd>
                </div>
                <div>
                  <dt>Captured</dt>
                  <dd>{fmtTime(active.ts)}</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
