// TV-static page transition. Clicking a stage monitor "changes the channel":
// the screen fills with chunky TV static (same grayscale fuzz as the landing),
// the route swaps behind it, then the static clears over the new page. Arriving
// back at the stage by any means (back button, links, landing) plays the same
// tune-in. The rAF loop only runs while a transition is in flight.

import { createContext, useCallback, useContext, useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

const TvCtx = createContext(null)

// Safe to call outside the provider (falls back to a plain no-op wrapper).
export function useTvTransition() {
  return useContext(TvCtx) || { tvNavigate: () => {} }
}

// The clicked monitor's in-scene fuzz (TvStaticMesh) already fills the screen by
// the time the camera zoom finishes, so the overlay does NOT ramp in - it snaps
// straight to full static (static -> static is a seamless handoff, no visible
// blend seam). COVER_MS is just long enough to paint one opaque frame before we
// swap the route behind it.
const COVER_MS = 60
const HOLD_MS = 400 // stays fully covered while the new page mounts/paints
const REVEAL_MS = 640 // then clears (fades) over the destination

// Camera zoom-in / zoom-out duration (MonkeyStage TvZoom / TvZoomOut). Shared so
// the exit static holds for exactly the pull-back, mirroring how the entry static
// covers the whole push-in.
export const ZOOM_MS = 850

// Set by MonkeyStage when it dives INTO a monitor: the next /stage arrival is a
// TV exit (a camera pull-out plays), so the overlay must stay fully covered for
// the whole pull-back and only THEN clear - the same shape as the entry.
export const tvExitState = { pending: false }

export default function TvTransitionProvider({ children }) {
  const navigate = useNavigate()
  const location = useLocation()
  const canvasRef = useRef(null)
  const state = useRef({ phase: 'idle', t0: 0, op: 0, to: null, guard: false })
  const startRef = useRef(() => {})

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    const ctx = canvas.getContext('2d')
    let w = 2
    let h = 2
    const resize = () => {
      // low-res canvas stretched to fill => chunky pixelated static
      w = canvas.width = Math.max(2, Math.ceil(window.innerWidth / 16))
      h = canvas.height = Math.max(2, Math.ceil(window.innerHeight / 16))
    }
    resize()
    window.addEventListener('resize', resize)

    let raf = 0
    const loop = () => {
      const s = state.current
      const now = performance.now()
      if (s.phase === 'cover') {
        // Snap to full static (no ramp) so the overlay continues the in-scene TV
        // fuzz seamlessly instead of blending in over it.
        s.op = 1
        if (now - s.t0 >= COVER_MS) {
          // fully covered: swap the route behind the static, then hold + reveal
          // guard the arrival-reveal only when this navigate targets the stage
          if (s.to != null) { s.guard = s.to === '/stage'; navigate(s.to); s.to = null }
          s.phase = 'hold'
          s.t0 = now
        }
      } else if (s.phase === 'exitHold') {
        // Returning to the stage: hold full static for the whole camera pull-back
        // (ZOOM_MS), then reveal - mirrors the entry, where the static covers the
        // whole push-in before it clears.
        s.op = 1
        if (now - s.t0 >= ZOOM_MS) { s.phase = 'reveal'; s.t0 = now }
      } else if (s.phase === 'hold') {
        // Keep the screen fully covered while the destination mounts/paints, so
        // the reveal FADES over the real new page rather than a blank loading
        // gap (which read as an instant cut).
        s.op = 1
        if (now - s.t0 >= HOLD_MS) { s.phase = 'reveal'; s.t0 = now }
      } else if (s.phase === 'reveal') {
        s.op = Math.max(0, 1 - (now - s.t0) / REVEAL_MS)
        if (s.op <= 0) { s.phase = 'idle'; s.op = 0 }
      }
      if (s.op > 0.001) {
        const img = ctx.createImageData(w, h)
        const d = img.data
        for (let i = 0; i < d.length; i += 4) {
          const v = (55 + Math.random() * 150) | 0
          d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255
        }
        ctx.putImageData(img, 0, 0)
      }
      canvas.style.opacity = String(s.op)
      if (s.phase === 'idle') { raf = 0; return } // stop the loop when settled
      raf = requestAnimationFrame(loop)
    }
    startRef.current = () => { if (!raf) raf = requestAnimationFrame(loop) }

    return () => {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [navigate])

  // Tune-in whenever we ARRIVE at the stage by any route change that is not a
  // tvNavigate (which already runs its own cover + reveal).
  useEffect(() => {
    const s = state.current
    if (location.pathname !== '/stage') return
    if (s.guard) { s.guard = false; return }
    // A TV exit (dived into a monitor, now pulling back out) holds full static for
    // the pull-back before revealing; a plain visit just tunes in immediately.
    if (tvExitState.pending) {
      tvExitState.pending = false
      s.phase = 'exitHold'
    } else {
      s.phase = 'reveal'
    }
    s.t0 = performance.now()
    s.op = 1
    startRef.current()
  }, [location.pathname])

  const tvNavigate = useCallback((to) => {
    const s = state.current
    if (s.phase === 'cover') return // already changing channel
    s.to = to
    s.phase = 'cover'
    s.t0 = performance.now()
    startRef.current()
  }, [])

  return (
    <TvCtx.Provider value={{ tvNavigate }}>
      {children}
      <canvas ref={canvasRef} className="tv-static-overlay" aria-hidden="true" />
    </TvCtx.Provider>
  )
}
