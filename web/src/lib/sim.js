// Browser-side fake robot. Mirrors server/sim.js behavior so the UI is
// testable with zero backend (enable with ?sim=1). Payloads follow the
// shared schemas in root CLAUDE.md exactly.

import { OccGrid } from './occgrid.js'

const STATES = ['IDLE', 'NAV', 'SEEK', 'APPROACH', 'PICK', 'SORT']
const FRUITS = ['apple', 'banana']
const RIPENESS = ['ripe', 'unripe']

// Lightweight FarmHand stand-in: turn a spoken/typed command into the same
// structured action the real LLM agent returns (task + optional fruit/filter).
export function parseNlCommand(text) {
  const t = String(text || '').toLowerCase()
  if (!t.trim()) return { ok: false, clarification: 'Say a command like "pick the ripe apples".' }
  if (/\b(stop|halt|e-?stop|emergency|freeze)\b/.test(t)) return { ok: true, action: { task: 'stop' } }
  const fruit = /\bbanana/.test(t) ? 'banana' : /\bapple/.test(t) ? 'apple' : null
  const filter = /\b(unripe|green)\b/.test(t) ? 'unripe' : /\bripe\b/.test(t) ? 'ripe' : null
  const task = /\bsort\b/.test(t) ? 'sort' : /\b(pick|grab|collect|harvest|get)\b/.test(t) ? 'pick' : null
  if (!task) return { ok: false, clarification: 'Try a command with "pick", "sort", or "stop".' }
  const action = { task }
  if (fruit) action.fruit = fruit
  if (filter) action.filter = filter
  return { ok: true, action }
}

export function startSim(bus) {
  let state = 'SEEK'
  let stateAge = 0
  let battery = 12.3
  let arm = [90, 45, 120, 90, 30]
  let armTarget = [...arm]
  let drive = { l: 0, r: 0 }
  let heading = 0
  let pos = { x: 0, y: 0 }
  let estopped = false
  const timers = []

  bus.onCommand = (event, payload) => {
    if (event === 'estop') {
      estopped = true
      state = 'ESTOP'
      drive = { l: 0, r: 0 }
    } else if (event === 'drive') {
      if (!estopped) drive = { l: payload.l ?? 0, r: payload.r ?? 0 }
    } else if (event === 'arm_pose') {
      if (!estopped && payload.joints) armTarget = payload.joints.slice(0, 5)
    } else if (event === 'pick') {
      if (!estopped) {
        state = 'PICK'
        stateAge = 0
      }
    } else if (event === 'nl_command') {
      // FarmHand stand-in: parse the natural-language text into a structured
      // nl_action and echo it back the way the real agent would, then act on it.
      const action = parseNlCommand(String(payload.text ?? ''))
      const reply = { ts: Date.now(), text: String(payload.text ?? ''), ...action }
      bus.push('nl_action', reply)
      if (reply.ok && reply.action) {
        if (reply.action.task === 'stop') {
          estopped = true
          state = 'ESTOP'
          drive = { l: 0, r: 0 }
        } else if (!estopped) {
          state = 'PICK'
          stateAge = 0
        }
      }
    }
  }

  // telemetry @5 Hz
  timers.push(setInterval(() => {
    battery = Math.max(9.5, battery - 0.0004 + (Math.random() - 0.5) * 0.01)
    stateAge += 0.2
    if (!estopped && stateAge > 4 + Math.random() * 4) {
      state = STATES[(STATES.indexOf(state) + 1) % STATES.length] || 'IDLE'
      stateAge = 0
      if (state === 'PICK' || state === 'SORT') {
        armTarget = arm.map((j) => Math.max(0, Math.min(180, j + (Math.random() - 0.5) * 70)))
      }
    }
    arm = arm.map((j, i) => j + (armTarget[i] - j) * 0.15)
    if (state === 'SEEK' && !estopped && drive.l === 0 && drive.r === 0) {
      drive = { l: 0.4 + Math.random() * 0.2, r: 0.4 + Math.random() * 0.2 }
    } else if (state !== 'SEEK' && state !== 'IDLE') {
      drive = { l: drive.l * 0.7, r: drive.r * 0.7 }
    }
    heading += (drive.r - drive.l) * 0.08
    pos.x += Math.cos(heading) * (drive.l + drive.r) * 0.02
    pos.y += Math.sin(heading) * (drive.l + drive.r) * 0.02
    bus.push('telemetry', {
      ts: Date.now(),
      battery_v: +battery.toFixed(2),
      state,
      arm: arm.map((j) => Math.round(j)),
      drive: { l: +drive.l.toFixed(2), r: +drive.r.toFixed(2) },
    })
  }, 200))

  // detections every ~2 s while SEEK/PICK
  timers.push(setInterval(() => {
    if (estopped || (state !== 'SEEK' && state !== 'PICK')) return
    const fruit = FRUITS[Math.floor(Math.random() * 2)]
    const ripeness = RIPENESS[Math.floor(Math.random() * 2)]
    bus.push('detection', {
      ts: Date.now(),
      fruit,
      ripeness,
      conf: +(0.72 + Math.random() * 0.27).toFixed(2),
      bbox: [
        Math.floor(Math.random() * 400),
        Math.floor(Math.random() * 300),
        60 + Math.floor(Math.random() * 80),
        60 + Math.floor(Math.random() * 80),
      ],
    })
  }, 2000))

  // pick_event every ~9 s
  timers.push(setInterval(() => {
    if (estopped) return
    const fruit = FRUITS[Math.floor(Math.random() * 2)]
    const ripeness = RIPENESS[Math.floor(Math.random() * 2)]
    bus.push('pick_event', {
      ts: Date.now(),
      fruit,
      ripeness,
      bin: `${fruit}_${ripeness}`,
      success: Math.random() > 0.15,
      duration_ms: 6000 + Math.floor(Math.random() * 5000),
    })
  }, 9000))

  // Persistent SLAM map, fed with the sim's ground-truth pose. Room is 4x3 m
  // centered at origin, so center the grid there and it never clips.
  const occ = new OccGrid({ res: 0.05, size: 128, cx: 0, cy: 0 })
  let slamTick = 0

  // lidar @2 Hz - rectangular room + a couple of obstacles, robot frame
  timers.push(setInterval(() => {
    const points = []
    const W = 4, H = 3
    for (let i = 0; i < 360; i += 2) {
      const a = (i * Math.PI) / 180 + heading
      // ray from pos to room walls
      let r = Infinity
      const dx = Math.cos(a), dy = Math.sin(a)
      if (dx > 1e-6) r = Math.min(r, (W / 2 - pos.x) / dx)
      if (dx < -1e-6) r = Math.min(r, (-W / 2 - pos.x) / dx)
      if (dy > 1e-6) r = Math.min(r, (H / 2 - pos.y) / dy)
      if (dy < -1e-6) r = Math.min(r, (-H / 2 - pos.y) / dy)
      // obstacle: circle at (1, 0.5) r=0.25
      const ox = 1 - pos.x, oy = 0.5 - pos.y
      const proj = ox * dx + oy * dy
      if (proj > 0) {
        const d2 = ox * ox + oy * oy - proj * proj
        if (d2 < 0.25 * 0.25) r = Math.min(r, proj - Math.sqrt(0.0625 - d2))
      }
      if (!isFinite(r) || r <= 0) continue
      r += (Math.random() - 0.5) * 0.03
      // robot frame (subtract heading)
      const la = a - heading
      points.push([+(r * Math.cos(la)).toFixed(3), +(r * Math.sin(la)).toFixed(3)])
    }
    const ts = Date.now()
    bus.push('lidar_scan', { ts, points })

    occ.integrate(pos.x, pos.y, heading, points)
    bus.push('slam_pose', {
      ts,
      x: +pos.x.toFixed(3),
      y: +pos.y.toFixed(3),
      theta: +heading.toFixed(4),
    })
    if (slamTick++ % 4 === 0) bus.push('slam_map', occ.payload(ts))
  }, 500))

  // keep pos inside the room
  timers.push(setInterval(() => {
    pos.x = Math.max(-1.8, Math.min(1.8, pos.x))
    pos.y = Math.max(-1.3, Math.min(1.3, pos.y))
  }, 1000))

  return () => timers.forEach(clearInterval)
}
