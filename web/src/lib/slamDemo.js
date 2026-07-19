// Self-contained SLAM demo feed for the deployed dashboard when there is NO live
// hub (Vercel can't reach the laptop). Pushes the SAME slam_map / slam_pose /
// lidar_scan / nav_path events the real pipeline emits, so the SLAM view renders
// a complete, static, navigable map instead of a blank screen. This is the same
// class of approved stand-in as the server sim - a simulator feeding the bus,
// not hardcoded UI data. Off by default; the operator toggles it (DEMO button).
import { OccGrid } from './occgrid.js'
import { parseNlCommand } from './sim.js'

// A small room (4 x 3 m) with a few round objects, matching the server sim's feel.
const W = 4
const H = 3
const OBJECTS = [
  { x: 1.0, y: 0.5, r: 0.22 },
  { x: -1.1, y: -0.6, r: 0.2 },
  { x: 0.2, y: 0.95, r: 0.16 },
]
const ROOM = { xmin: -1.8, xmax: 1.8, ymin: -1.3, ymax: 1.3 }

function raycast(px, py, heading) {
  const points = []
  for (let i = 0; i < 360; i += 1) {
    const a = (i * Math.PI) / 180 + heading
    const dx = Math.cos(a)
    const dy = Math.sin(a)
    let r = Infinity
    if (dx > 1e-6) r = Math.min(r, (W / 2 - px) / dx)
    if (dx < -1e-6) r = Math.min(r, (-W / 2 - px) / dx)
    if (dy > 1e-6) r = Math.min(r, (H / 2 - py) / dy)
    if (dy < -1e-6) r = Math.min(r, (-H / 2 - py) / dy)
    for (const o of OBJECTS) {
      const ox = o.x - px
      const oy = o.y - py
      const proj = ox * dx + oy * dy
      if (proj <= 0) continue
      const d2 = ox * ox + oy * oy - proj * proj
      if (d2 < o.r * o.r) r = Math.min(r, proj - Math.sqrt(o.r * o.r - d2))
    }
    if (!isFinite(r) || r <= 0) continue
    r += (Math.random() - 0.5) * 0.02
    const la = a - heading
    points.push([+(r * Math.cos(la)).toFixed(3), +(r * Math.sin(la)).toFixed(3)])
  }
  return points
}

const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a))
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))

export function startSlamDemo(bus) {
  const timers = []
  const occ = new OccGrid({ res: 0.05, size: 128, cx: 0, cy: 0 })

  // Pre-build the whole map from a loop of viewpoints so it is complete from the
  // first frame (no visible "building" sweep).
  const tour = [
    [-1.4, -1.0], [-1.4, 1.0], [0, 1.1], [1.4, 1.0], [1.4, -1.0], [0, -1.1],
  ]
  let hd = 0
  for (const [vx, vy] of tour) {
    for (let k = 0; k < 4; k++) {
      occ.integrate(vx, vy, hd, raycast(vx, vy, hd))
      hd += 0.7
    }
  }

  // Frozen resting pose - the rover just sits in the mapped room until a click.
  const pose = { x: -0.9, y: 0.7, theta: 0.2 }
  let nav = null // { goal: [x, y] }
  let mapTick = 0

  const push = () => {
    const ts = Date.now()
    if (nav) {
      const [gx, gy] = nav.goal
      const dx = gx - pose.x
      const dy = gy - pose.y
      const dist = Math.hypot(dx, dy)
      if (dist < 0.05) {
        nav = null
        bus.push('nav_path', { ts, goal: [gx, gy], points: [], active: false, reached: true })
      } else {
        const err = norm(Math.atan2(dy, dx) - pose.theta)
        pose.theta = norm(pose.theta + clamp(err, -0.35, 0.35))
        const step = Math.min(0.07, dist)
        pose.x += Math.cos(pose.theta) * step
        pose.y += Math.sin(pose.theta) * step
      }
    }
    const pts = raycast(pose.x, pose.y, pose.theta)
    occ.integrate(pose.x, pose.y, pose.theta, pts)
    bus.push('lidar_scan', { ts, points: pts })
    bus.push('slam_pose', {
      ts, x: +pose.x.toFixed(3), y: +pose.y.toFixed(3), theta: +pose.theta.toFixed(4),
    })
    if (mapTick++ % 8 === 0) bus.push('slam_map', occ.payload(ts))
  }

  // Commands come through emit() -> bus.onCommand while the demo is active.
  bus.onCommand = (event, payload = {}) => {
    if (event === 'nl_command') {
      // FarmHand stand-in (same parser the ?sim robot uses) so the command
      // console converses even with no hub; a goal command drives the demo rover.
      const action = parseNlCommand(String(payload.text ?? ''))
      bus.push('nl_action', { ts: Date.now(), text: String(payload.text ?? ''), ...action })
      return
    }
    if (event !== 'nav_goal') return
    if (payload.cancel) {
      nav = null
      bus.push('nav_path', { ts: Date.now(), goal: null, points: [], active: false, reached: false })
      return
    }
    const gx = clamp(Number(payload.x), ROOM.xmin, ROOM.xmax)
    const gy = clamp(Number(payload.y), ROOM.ymin, ROOM.ymax)
    if (!isFinite(gx) || !isFinite(gy)) return
    nav = { goal: [gx, gy] }
    bus.push('nav_path', {
      ts: Date.now(), goal: [gx, gy],
      points: [[+pose.x.toFixed(3), +pose.y.toFixed(3)], [gx, gy]],
      active: true, reached: false,
    })
  }

  // paint the complete map + parked pose immediately, then keep it alive at 5 Hz
  bus.push('slam_map', occ.payload(Date.now()))
  bus.push('slam_pose', { ts: Date.now(), x: pose.x, y: pose.y, theta: pose.theta })
  timers.push(setInterval(push, 200))

  return () => {
    timers.forEach(clearInterval)
    if (bus.onCommand) bus.onCommand = null
  }
}
