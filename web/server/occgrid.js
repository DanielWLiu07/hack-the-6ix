// occgrid.js - compact log-odds occupancy grid for the sim's slam_map output.
//
// The sim knows its own ground-truth pose, so instead of running ICP it fuses
// each emitted scan straight into a persistent grid: cells a beam passes through
// gain free evidence, the endpoint cell gains occupied evidence, accumulated in
// log-odds so noise and dropouts wash out. Serializes the master-approved
// `slam_map` payload (base64 uint8, row-major: 0=free 100=occupied 255=unknown).
//
// Node build (uses Buffer for base64). The browser sim has a mirror in
// web/src/lib/occgrid.js.

const FREE = 0;
const OCC = 100;
const UNKNOWN = 255;
const L_FREE = -0.4; // log-odds delta for a cell a beam passed through
const L_OCC = 0.85; // log-odds delta for a beam endpoint
const L_CLAMP = 6.0; // keep bounded so cells can still change
const OCC_T = 0.5; // log-odds >= this renders occupied
const FREE_T = -0.5; // log-odds <= this renders free

export class OccGrid {
  // Fixed grid centered on world (cx,cy). size cells, res meters/cell.
  constructor({ res = 0.05, size = 128, cx = 0, cy = 0 } = {}) {
    this.res = res;
    this.w = size;
    this.h = size;
    this.ox = cx - (size * res) / 2; // world x of cell (0,0) corner
    this.oy = cy - (size * res) / 2;
    this.log = new Float32Array(size * size);
  }

  _cellX(x) { return Math.floor((x - this.ox) / this.res); }
  _cellY(y) { return Math.floor((y - this.oy) / this.res); }

  // Fuse one scan. Robot world pose (px,py,heading) + robot-frame [x,y] points.
  integrate(px, py, heading, points) {
    const c = Math.cos(heading);
    const s = Math.sin(heading);
    const rx = this._cellX(px);
    const ry = this._cellY(py);
    for (const pt of points) {
      const lx = pt[0];
      const ly = pt[1];
      const wx = px + c * lx - s * ly;
      const wy = py + s * lx + c * ly;
      const ex = this._cellX(wx);
      const ey = this._cellY(wy);
      const n = Math.max(Math.abs(ex - rx), Math.abs(ey - ry));
      for (let i = 1; i < n; i++) { // free cells along the beam, excluding endpoint
        const gx = Math.round(rx + ((ex - rx) * i) / n);
        const gy = Math.round(ry + ((ey - ry) * i) / n);
        if (gx >= 0 && gx < this.w && gy >= 0 && gy < this.h) {
          const k = gy * this.w + gx;
          const v = this.log[k] + L_FREE;
          this.log[k] = v < -L_CLAMP ? -L_CLAMP : v;
        }
      }
      if (ex >= 0 && ex < this.w && ey >= 0 && ey < this.h) {
        const k = ey * this.w + ex;
        const v = this.log[k] + L_OCC;
        this.log[k] = v > L_CLAMP ? L_CLAMP : v;
      }
    }
  }

  toBytes() {
    const g = new Uint8Array(this.w * this.h);
    for (let i = 0; i < g.length; i++) {
      const l = this.log[i];
      g[i] = l >= OCC_T ? OCC : l <= FREE_T ? FREE : UNKNOWN;
    }
    return g;
  }

  // master-approved slam_map payload
  payload(ts) {
    return {
      ts,
      resolution: +this.res.toFixed(4),
      width: this.w,
      height: this.h,
      origin: [+this.ox.toFixed(3), +this.oy.toFixed(3)],
      data: Buffer.from(this.toBytes()).toString('base64'),
    };
  }
}
