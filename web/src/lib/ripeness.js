// ripeness.js - in-browser fruit ripeness detector. Runs the SAME YOLOv8n ONNX
// model the robot uses (ml/ripeness/export -> public/models/ripeness) via
// onnxruntime-web (WASM, self-hosted from /ort). Returns the top detection with
// its bounding box so photos can be ANNOTATED. onnxruntime is dynamic-imported
// so it stays out of the initial bundle and only loads on first detect.
//
// Photos come from the hub /media or Vercel Blob (public, CORS-readable) - we
// fetch them to a blob so the canvas is not tainted, then detect + cache.
// classes: apple_ripe | apple_unripe | banana_ripe | banana_unripe (imgsz 320).

const MODEL_URL = '/models/ripeness/model.int8.onnx'
const CLASSES_URL = '/models/ripeness/classes.json'
const IMG = 320
const CONF_MIN = 0.15

let ortP, sessionP, classesP

async function getOrt() {
  if (!ortP) {
    ortP = import('onnxruntime-web').then((ort) => {
      ort.env.wasm.wasmPaths = import.meta.env.DEV
        ? 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/'
        : '/ort/'
      ort.env.wasm.numThreads = 1
      return ort
    })
  }
  return ortP
}

async function getSession() {
  if (!sessionP) {
    sessionP = (async () => {
      const ort = await getOrt()
      return ort.InferenceSession.create(MODEL_URL, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      })
    })()
  }
  return sessionP
}

async function getClasses() {
  if (!classesP) classesP = fetch(CLASSES_URL).then((r) => r.json())
  return classesP
}

export function preloadRipeness() {
  getClasses().catch(() => {})
  getSession().catch(() => {})
}

// letterbox into a [1,3,320,320] tensor; return the scale/pad so boxes can be
// mapped back to the original image's normalized coordinates.
function toTensor(ort, img) {
  const w = img.naturalWidth || img.width
  const h = img.naturalHeight || img.height
  const scale = Math.min(IMG / w, IMG / h)
  const nw = Math.round(w * scale)
  const nh = Math.round(h * scale)
  const padX = Math.floor((IMG - nw) / 2)
  const padY = Math.floor((IMG - nh) / 2)
  const canvas = document.createElement('canvas')
  canvas.width = IMG
  canvas.height = IMG
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.fillStyle = 'rgb(114,114,114)'
  ctx.fillRect(0, 0, IMG, IMG)
  ctx.drawImage(img, padX, padY, nw, nh)
  const { data } = ctx.getImageData(0, 0, IMG, IMG)
  const plane = IMG * IMG
  const arr = new Float32Array(3 * plane)
  for (let i = 0; i < plane; i++) {
    arr[i] = data[i * 4] / 255
    arr[i + plane] = data[i * 4 + 1] / 255
    arr[i + 2 * plane] = data[i * 4 + 2] / 255
  }
  const tensor = new ort.Tensor('float32', arr, [1, 3, IMG, IMG])
  return { tensor, meta: { scale, padX, padY, w, h } }
}

const sigmoid = (x) => 1 / (1 + Math.exp(-x))

// decode YOLOv8 output -> best { cls, conf, box:[cx,cy,w,h] in 320px space }
function decode(dims, data, nc) {
  const attr = 4 + nc
  let nAnchor
  let layout
  if (dims.length === 3 && dims[1] === attr) {
    layout = 'CN'
    nAnchor = dims[2]
  } else if (dims.length === 3 && dims[2] === attr) {
    layout = 'NC'
    nAnchor = dims[1]
  } else {
    return null
  }
  const at = (a, k) => data[layout === 'CN' ? k * nAnchor + a : a * attr + k]
  let bestScore = -1
  let bestClass = -1
  let bestA = -1
  for (let a = 0; a < nAnchor; a++) {
    for (let c = 0; c < nc; c++) {
      let v = at(a, 4 + c)
      if (v < 0 || v > 1) v = sigmoid(v)
      if (v > bestScore) {
        bestScore = v
        bestClass = c
        bestA = a
      }
    }
  }
  if (bestClass < 0) return null
  return {
    cls: bestClass,
    conf: bestScore,
    box: [at(bestA, 0), at(bestA, 1), at(bestA, 2), at(bestA, 3)],
  }
}

// detect on a loaded <img>; returns
//   { label, fruit, ripeness, conf, box:[x,y,w,h] normalized 0..1 } | null
export async function detectImage(img) {
  const [ort, session, classes] = await Promise.all([
    getOrt(),
    getSession(),
    getClasses(),
  ])
  const classList = classes.classes
  const { tensor, meta } = toTensor(ort, img)
  const out = await session.run({ [session.inputNames[0]]: tensor })
  const o = out[session.outputNames[0]]
  const best = decode(o.dims, o.data, classList.length)
  if (!best || best.conf < CONF_MIN) return null

  // map [cx,cy,w,h] (320 letterbox px) -> original-image normalized [x,y,w,h]
  const [cx, cy, bw, bh] = best.box
  const x1 = (cx - bw / 2 - meta.padX) / meta.scale / meta.w
  const y1 = (cy - bh / 2 - meta.padY) / meta.scale / meta.h
  const nw = bw / meta.scale / meta.w
  const nh = bh / meta.scale / meta.h
  const clamp = (v) => Math.max(0, Math.min(1, v))
  const label = classList[best.cls]
  const map = classes.class_map?.[label] ?? {}
  return {
    label,
    fruit: map.fruit ?? null,
    ripeness: map.ripeness ?? null,
    conf: best.conf,
    box: [clamp(x1), clamp(y1), Math.min(nw, 1 - clamp(x1)), Math.min(nh, 1 - clamp(y1))],
  }
}

function loadImg(src, cross) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    if (cross) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image failed to load'))
    img.src = src
  })
}

export async function detectFile(file) {
  const url = URL.createObjectURL(file)
  try {
    return await detectImage(await loadImg(url))
  } finally {
    URL.revokeObjectURL(url)
  }
}

// ---- cached, concurrency-limited detection for remote (blob/media) photos ----
const cache = new Map() // url -> result | null
const inflight = new Map() // url -> Promise
let active = 0
const queue = []
function pump() {
  while (active < 2 && queue.length) {
    active++
    queue.shift()().finally(() => {
      active--
      pump()
    })
  }
}

export function cachedDetection(url) {
  return cache.has(url) ? cache.get(url) : undefined
}

// fetch the photo as a blob (avoids canvas taint for CORS-enabled blob storage),
// detect, cache. Returns the same promise for concurrent callers of a url.
export function detectUrl(url) {
  if (cache.has(url)) return Promise.resolve(cache.get(url))
  if (inflight.has(url)) return inflight.get(url)
  const p = new Promise((resolve) => {
    queue.push(async () => {
      try {
        const blob = await fetch(url).then((r) => r.blob())
        const obj = URL.createObjectURL(blob)
        try {
          const res = await detectImage(await loadImg(obj))
          cache.set(url, res)
          resolve(res)
        } finally {
          URL.revokeObjectURL(obj)
        }
      } catch {
        cache.set(url, null)
        resolve(null)
      } finally {
        inflight.delete(url)
      }
    })
    pump()
  })
  inflight.set(url, p)
  return p
}
