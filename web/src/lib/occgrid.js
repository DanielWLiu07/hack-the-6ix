// occgrid.js - compact log-odds occupancy grid for the browser sim's slam_map.
//
// Browser mirror of web/server/occgrid.js (see it for the full rationale). The
// only difference is base64 encoding: btoa here vs Buffer on the Node side.
// Serializes the master-approved `slam_map` payload (base64 uint8, row-major:
// 0=free 100=occupied 255=unknown).

const FREE = 0
const OCC = 100
const UNKNOWN = 255
const L_FREE = -0.4
const L_OCC = 0.85
const L_CLAMP = 6.0
const OCC_T = 0.5
const FREE_T = -0.5

function bytesToBase64(bytes) {
  let bin = ''
  const chunk = 0x8000 // avoid arg-count limits on String.fromCharCode
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

export class OccGrid {
  constructor({ res = 0.05, size = 128, cx = 0, cy = 0 } = {}) {
    this.res = res
    this.w = size
    this.h = size
    this.ox = cx - (size * res) / 2
    this.oy = cy - (size * res) / 2
    this.log = new Float32Array(size * size)
  }

  _cellX(x) { return Math.floor((x - this.ox) / this.res) }
  _cellY(y) { return Math.floor((y - this.oy) / this.res) }

  integrate(px, py, heading, points) {
    const c = Math.cos(heading)
    const s = Math.sin(heading)
    const rx = this._cellX(px)
    const ry = this._cellY(py)
    for (const pt of points) {
      const lx = pt[0]
      const ly = pt[1]
      const wx = px + c * lx - s * ly
      const wy = py + s * lx + c * ly
      const ex = this._cellX(wx)
      const ey = this._cellY(wy)
      const n = Math.max(Math.abs(ex - rx), Math.abs(ey - ry))
      for (let i = 1; i < n; i++) {
        const gx = Math.round(rx + ((ex - rx) * i) / n)
        const gy = Math.round(ry + ((ey - ry) * i) / n)
        if (gx >= 0 && gx < this.w && gy >= 0 && gy < this.h) {
          const k = gy * this.w + gx
          const v = this.log[k] + L_FREE
          this.log[k] = v < -L_CLAMP ? -L_CLAMP : v
        }
      }
      if (ex >= 0 && ex < this.w && ey >= 0 && ey < this.h) {
        const k = ey * this.w + ex
        const v = this.log[k] + L_OCC
        this.log[k] = v > L_CLAMP ? L_CLAMP : v
      }
    }
  }

  toBytes() {
    const g = new Uint8Array(this.w * this.h)
    for (let i = 0; i < g.length; i++) {
      const l = this.log[i]
      g[i] = l >= OCC_T ? OCC : l <= FREE_T ? FREE : UNKNOWN
    }
    return g
  }

  payload(ts) {
    return {
      ts,
      resolution: +this.res.toFixed(4),
      width: this.w,
      height: this.h,
      origin: [+this.ox.toFixed(3), +this.oy.toFixed(3)],
      data: bytesToBase64(this.toBytes()),
    }
  }
}
