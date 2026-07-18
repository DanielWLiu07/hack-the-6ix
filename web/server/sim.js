// sim.js — fake robot client. Connects to the hub as role=robot and emits
// plausible telemetry (5 Hz), detections, pick_events and lidar_scans per the
// root CLAUDE.md schemas. Responds to drive / pick / estop.
//
//   SERVER_URL=http://localhost:3001 npm run sim
//   SIM_LIDAR=0 to disable lidar frames (e.g. when lidar-sim's is running)

import { io } from 'socket.io-client';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';
const LIDAR_ON = process.env.SIM_LIDAR !== '0';
// When the hub spawns us as its demo panic-switch fallback it sets SIM_TAG=panic.
// We flag the connection so the hub's auto-failover never counts this stand-in
// as "the real robot came back". Harmless (just a marker) when run manually.
const IS_PANIC_SIM = process.env.SIM_TAG === 'panic';

const socket = io(SERVER_URL, { auth: { role: 'robot', sim: IS_PANIC_SIM } });

const FRUITS = ['apple', 'apple', 'banana']; // apples slightly more common
const RIPENESS = ['ripe', 'ripe', 'unripe'];

// --- state ------------------------------------------------------------------

const sim = {
  state: 'IDLE',
  stateSince: Date.now(),
  battery: 12.4,
  arm: [90, 45, 120, 90, 30],
  armTarget: [90, 45, 120, 90, 30],
  drive: { l: 0, r: 0 },
  manualDriveUntil: 0,
  pendingFruit: null, // detection carried into the pick cycle
  pos: { x: 1.0, y: 1.0, heading: 0 }, // meters, inside a 6x4 room
};

const STATE_DURATION = { IDLE: 3000, SEEK: 4500, PICK: 5000, SORT: 3000 };
const NEXT_STATE = { IDLE: 'SEEK', SEEK: 'PICK', PICK: 'SORT', SORT: 'IDLE' };

function setState(s) {
  sim.state = s;
  sim.stateSince = Date.now();
  console.log(`[sim] state -> ${s}`);
}

function randomFruit() {
  const fruit = FRUITS[Math.floor(Math.random() * FRUITS.length)];
  const ripeness = RIPENESS[Math.floor(Math.random() * RIPENESS.length)];
  return { fruit, ripeness };
}

// --- inbound commands -------------------------------------------------------

socket.on('connect', () => console.log(`[sim] connected to ${SERVER_URL} as robot`));
socket.on('connect_error', (e) => console.log('[sim] connect error:', e.message));

socket.on('drive', ({ l, r } = {}) => {
  if (sim.state === 'ESTOP') { setState('IDLE'); console.log('[sim] estop cleared by drive'); }
  sim.drive = { l: +l || 0, r: +r || 0 };
  sim.manualDriveUntil = Date.now() + 1500;
});

socket.on('arm_pose', ({ joints } = {}) => {
  if (Array.isArray(joints) && joints.length === 5) sim.armTarget = joints.map(Number);
});

socket.on('pick', ({ target } = {}) => {
  if (sim.state === 'ESTOP') return;
  if (target === 'apple' || target === 'banana') {
    sim.pendingFruit = { fruit: target, ripeness: RIPENESS[Math.floor(Math.random() * RIPENESS.length)] };
  }
  console.log(`[sim] pick command (target=${target || 'nearest'})`);
  setState('PICK');
});

socket.on('estop', () => {
  console.log('[sim] ESTOP');
  setState('ESTOP');
  sim.drive = { l: 0, r: 0 };
  setTimeout(() => {
    if (sim.state === 'ESTOP') { setState('IDLE'); console.log('[sim] estop auto-cleared'); }
  }, 5000);
});

// --- main loop: telemetry 5 Hz + state machine ------------------------------

setInterval(() => {
  const now = Date.now();
  sim.battery = Math.max(9.5, sim.battery - 0.0004);

  // arm eases toward target; PICK wiggles the target to look alive
  if (sim.state === 'PICK' || sim.state === 'SORT') {
    const t = (now - sim.stateSince) / 1000;
    sim.armTarget = [
      90 + Math.sin(t * 1.5) * 40,
      45 + Math.sin(t * 2.1) * 25,
      120 - Math.sin(t * 1.2) * 30,
      90,
      sim.state === 'SORT' ? 80 : 30, // gripper closed while sorting
    ];
  }
  sim.arm = sim.arm.map((a, i) => +(a + (sim.armTarget[i] - a) * 0.15).toFixed(1));

  // drive: manual override wins, else state-driven
  if (now > sim.manualDriveUntil) {
    if (sim.state === 'SEEK') {
      const t = (now - sim.stateSince) / 1000;
      sim.drive = { l: +(0.4 + Math.sin(t) * 0.15).toFixed(2), r: +(0.4 - Math.sin(t) * 0.15).toFixed(2) };
    } else {
      sim.drive = { l: 0, r: 0 };
    }
  }

  // integrate rough pose for the lidar sim
  const v = (sim.drive.l + sim.drive.r) / 2 * 0.3; // m/s
  const w = (sim.drive.r - sim.drive.l) * 1.2; // rad/s
  sim.pos.heading += w * 0.2;
  sim.pos.x = Math.min(5.6, Math.max(0.4, sim.pos.x + Math.cos(sim.pos.heading) * v * 0.2));
  sim.pos.y = Math.min(3.6, Math.max(0.4, sim.pos.y + Math.sin(sim.pos.heading) * v * 0.2));

  socket.emit('telemetry', {
    ts: now,
    battery_v: +sim.battery.toFixed(2),
    state: sim.state,
    arm: sim.arm,
    drive: sim.drive,
  });

  // state machine advance (ESTOP only leaves via command/timeout above)
  if (sim.state !== 'ESTOP' && now - sim.stateSince > STATE_DURATION[sim.state]) {
    const next = NEXT_STATE[sim.state];
    if (next === 'PICK' && !sim.pendingFruit) sim.pendingFruit = randomFruit();
    if (sim.state === 'SORT') emitPickEvent(now);
    setState(next);
  }
}, 200);

function emitPickEvent(now) {
  const { fruit, ripeness } = sim.pendingFruit || randomFruit();
  sim.pendingFruit = null;
  const success = Math.random() < 0.9;
  socket.emit('pick_event', {
    ts: now,
    fruit,
    ripeness,
    bin: `${fruit}_${ripeness}`,
    success,
    duration_ms: STATE_DURATION.PICK + STATE_DURATION.SORT + Math.floor(Math.random() * 800),
  });
  console.log(`[sim] pick_event ${fruit}/${ripeness} success=${success}`);
}

// --- detections while seeking (~every 1.5 s) --------------------------------

setInterval(() => {
  if (sim.state !== 'SEEK') return;
  const { fruit, ripeness } = randomFruit();
  sim.pendingFruit = { fruit, ripeness };
  const w = 60 + Math.floor(Math.random() * 60);
  const h = Math.floor(w * (fruit === 'banana' ? 0.6 : 1.0));
  socket.emit('detection', {
    ts: Date.now(),
    fruit,
    ripeness,
    conf: +(0.75 + Math.random() * 0.24).toFixed(2),
    bbox: [
      Math.floor(Math.random() * (320 - w)),
      Math.floor(Math.random() * (240 - h)),
      w,
      h,
    ],
  });
}, 1500);

// --- lidar: 6x4 m room walls from current pose, 2 Hz, 180 pts ---------------

function wallDistance(px, py, angle) {
  // distance from (px,py) along `angle` to the 6x4 room boundary
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let d = Infinity;
  if (dx > 1e-6) d = Math.min(d, (6 - px) / dx);
  if (dx < -1e-6) d = Math.min(d, (0 - px) / dx);
  if (dy > 1e-6) d = Math.min(d, (4 - py) / dy);
  if (dy < -1e-6) d = Math.min(d, (0 - py) / dy);
  return d;
}

if (LIDAR_ON) {
  setInterval(() => {
    const points = [];
    for (let i = 0; i < 180; i++) {
      const rel = (i / 180) * Math.PI * 2; // angle in robot frame
      const world = rel + sim.pos.heading;
      let d = wallDistance(sim.pos.x, sim.pos.y, world);
      d += (Math.random() - 0.5) * 0.04; // sensor noise
      if (Math.random() < 0.03) continue; // dropouts
      points.push([+(d * Math.cos(rel)).toFixed(3), +(d * Math.sin(rel)).toFixed(3)]);
    }
    socket.emit('lidar_scan', { ts: Date.now(), points });
  }, 500);
}
