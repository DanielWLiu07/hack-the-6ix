import { useEffect, useRef } from 'react'
import { useTvTransition } from '../lib/tvTransition.jsx'
import { drawStatic } from '../lib/crtTuneIn.js'
import './ArrivalFuzz.css'

// Full-screen TV static that covers a page the instant it MOUNTS, then fades:
// the "tune-in" when arriving at a page from a stage monitor. Because it plays
// on mount (not on a shared timer racing the route change), the page always
// enters covered even though it is lazy-loaded and mounts fresh - no hard cut.
// Wall-clock timed and a plain 2D canvas, so it is independent of any 3D or
// asset load happening underneath it.
export default function ArrivalFuzz({ hold = 480, fade = 820 }) {
  const ref = useRef(null)
  // This mounts once the (lazy) page has mounted, so tell the TV transition it
  // can clear its static now - the page-side fuzz below takes over seamlessly,
  // with no clean/black gap between them.
  const { arrived } = useTvTransition()
  // Signal AFTER two frames, not on mount: the page shell mounts before its
  // heavy 3D/images paint, and clearing the static on mount can expose an
  // unpainted (black) element. Two rAFs let the first real frame land first.
  useEffect(() => {
    let raf = requestAnimationFrame(() => { raf = requestAnimationFrame(() => arrived()) })
    return () => cancelAnimationFrame(raf)
  }, [arrived])
  useEffect(() => {
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
    drawStatic(ctx, w, h) // cover from the very first frame
    canvas.style.opacity = '1'
    const t0 = performance.now()
    let raf = 0
    const loop = () => {
      const el = performance.now() - t0
      const op = el < hold ? 1 : Math.max(0, 1 - (el - hold) / fade)
      if (op <= 0.001) { canvas.style.opacity = '0'; return }
      drawStatic(ctx, w, h)
      canvas.style.opacity = String(op)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [hold, fade])
  return <canvas ref={ref} className="arrival-fuzz" aria-hidden="true" />
}
