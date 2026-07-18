// sim.js - fake robot client. Connects to the hub as role=robot and emits
// plausible telemetry (5 Hz), detections, pick_events and lidar_scans per the
// root CLAUDE.md schemas. Responds to drive / pick / estop.
//
//   SERVER_URL=http://localhost:3001 npm run sim
//   SIM_LIDAR=0 to disable lidar frames (e.g. when lidar-sim's is running)

import fs from 'node:fs';
import path from 'node:path';
import { io } from 'socket.io-client';
import { uploadImage } from './blob.js';
import { OccGrid } from './occgrid.js';

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';
const LIDAR_ON = process.env.SIM_LIDAR !== '0';
// When the hub spawns us as its demo panic-switch fallback it sets SIM_TAG=panic.
// We flag the connection so the hub's auto-failover never counts this stand-in
// as "the real robot came back". Harmless (just a marker) when run manually.
const IS_PANIC_SIM = process.env.SIM_TAG === 'panic';

const socket = io(SERVER_URL, { auth: { role: 'robot', sim: IS_PANIC_SIM } });

const FRUITS = ['apple', 'apple', 'banana']; // apples slightly more common
const RIPENESS = ['ripe', 'ripe', 'unripe'];

// state
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

// inbound commands
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

// main loop: telemetry 5 Hz + state machine
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
    if (sim.state === 'SORT') emitPickEvent(now).catch((e) => console.warn('[sim] pick emit failed:', e.message));
    setState(next);
  }
}, 200);

async function emitPickEvent(now) {
  const { fruit, ripeness } = sim.pendingFruit || randomFruit();
  sim.pendingFruit = null;
  const success = Math.random() < 0.9;
  const image_url = await writePickImage(now, { fruit, ripeness, success });
  socket.emit('pick_event', {
    ts: now,
    fruit,
    ripeness,
    bin: `${fruit}_${ripeness}`,
    success,
    duration_ms: STATE_DURATION.PICK + STATE_DURATION.SORT + Math.floor(Math.random() * 800),
    ...(image_url ? { image_url } : {}), // photo-per-pickup (docs/DATA.md "Pick photos")
  });
  console.log(`[sim] pick_event ${fruit}/${ripeness} success=${success} img=${image_url ?? 'none'}`);
}

// The sim has no real camera, so it renders a labelled SVG "snapshot" per pick
// into the SAME media/ dir the hub serves at /media (both live in web/server/).
// A real robot would drop a JPEG here instead; the pick_event just references it.
const MEDIA_DIR = path.join(import.meta.dirname, 'media');
const FRUIT_COLOR = {
  apple_ripe: '#d1381f', apple_unripe: '#4f9e3f',
  banana_ripe: '#f2c018', banana_unripe: '#b7c24a',
};
async function writePickImage(ts, { fruit, ripeness, success }) {
  const file = `pick_${ts}.svg`;
  // Absolute hub URL (not a bare "/media/..") so it also resolves from the
  // Vercel-hosted dashboard / phones, which aren't served by the hub.
  const localUrl = `${SERVER_URL.replace(/\/$/, '')}/media/${file}`;
  try {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    const color = FRUIT_COLOR[`${fruit}_${ripeness}`] ?? '#888';
    const shape = fruit === 'banana'
      ? `<path d="M96 150 Q160 210 224 150 Q170 176 96 150 Z" fill="${color}"/>`
      : `<circle cx="160" cy="130" r="52" fill="${color}"/>`;
    const badge = success ? '#3ddc84' : '#e5484d';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240">
<rect width="320" height="240" fill="#14171c"/>
${shape}
<circle cx="248" cy="48" r="16" fill="${badge}"/>
<text x="248" y="55" font-family="sans-serif" font-size="18" font-weight="bold" fill="#14171c" text-anchor="middle">${success ? 'OK' : 'X'}</text>
<text x="20" y="210" font-family="sans-serif" font-size="20" fill="#e6e6e6">${fruit} / ${ripeness}</text>
<text x="20" y="230" font-family="sans-serif" font-size="12" fill="#8a929c">pick ${ts}</text>
</svg>`;
    fs.writeFileSync(path.join(MEDIA_DIR, file), svg); // local copy = offline fallback
    // Hybrid: upload to Vercel Blob when BLOB_READ_WRITE_TOKEN is set (public URL
    // that works everywhere); otherwise serve the local copy from the hub.
    const blobUrl = await uploadImage(file, Buffer.from(svg), 'image/svg+xml');
    return blobUrl || localUrl;
  } catch (err) {
    console.warn('[sim] pick image write failed:', err.message);
    return null; // image is best-effort; the pick_event still goes out
  }
}

// detections while seeking (~every 1.5 s)
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

// lidar: 6x4 m room walls from current pose, 2 Hz, 180 pts
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

// Persistent SLAM occupancy grid, fed with the ground-truth pose the sim
// already integrates. Centered on the 6x4 room so the rover stays inside it.
// The web lidar view renders this as the accumulating map; slam_pose moves the
// robot marker. slam_map is throttled to 0.5 Hz per the schema.
const occ = new OccGrid({ res: 0.05, size: 128, cx: 3, cy: 2 });
let slamTick = 0;

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
    const ts = Date.now();
    socket.emit('lidar_scan', { ts, points });

    // fuse into the persistent map + publish pose (2 Hz) and map (0.5 Hz)
    occ.integrate(sim.pos.x, sim.pos.y, sim.pos.heading, points);
    socket.emit('slam_pose', {
      ts,
      x: +sim.pos.x.toFixed(3),
      y: +sim.pos.y.toFixed(3),
      theta: +sim.pos.heading.toFixed(4),
    });
    if (slamTick++ % 4 === 0) socket.emit('slam_map', occ.payload(ts));
  }, 500);
}
