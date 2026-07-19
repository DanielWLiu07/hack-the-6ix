// Transition cover: the original TV static, dialed down. The first version hurt
// the eyes because it stacked three things - a per-frame flicker, fine pixels,
// and full 0-255 contrast. This keeps the static LOOK but calms all three:
//   - slow flicker: the noise only regenerates every NOISE_MS (not every frame)
//   - few, big pixels: callers draw into a low-res, pixelated canvas
//   - low contrast: values sit in a dim mid band, not blinding black-to-white
// Callers fade it in and out via canvas opacity (the same envelope as before).

const NOISE_MS = 130 // regenerate the static ~7-8x/sec (slow flicker, not a buzz)
const BASE = 24 // darkest grey
const SPAN = 96 // brightest = BASE + SPAN (~120) -> dim static, never full white

export function drawStatic(ctx, w, h) {
  const c = ctx.canvas
  const now = performance.now()
  // Throttle the flicker: keep the previous frame between regenerations.
  if (c._lastNoise && now - c._lastNoise < NOISE_MS) return
  c._lastNoise = now
  const img = ctx.createImageData(w, h)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const v = BASE + ((Math.random() * SPAN) | 0)
    d[i] = v; d[i + 1] = v; d[i + 2] = v; d[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
}
