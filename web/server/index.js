// HT6 telemetry hub - Express + Socket.IO on :3001.
// Relays events between robot clients and browser clients per root CLAUDE.md schemas.
//
// Client roles (handshake `auth: { role }` or `?role=`):
//   robot - the rover / sim.js / lidar pi   (emits telemetry, detection, pick_event, lidar_scan)
//   ui    - browser dashboard (default)     (emits drive, arm_pose, pick, estop, nl_command)
//   agent - FarmHand LLM client             (receives nl_command, emits robot control events)

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { createStore } from './store.js';
import { streamHandler } from './stream.js';
import { validators } from './schemas.js';
import { forwardPickEvent, base44Enabled } from './base44.js';
import { createPanicSwitch } from './panic.js';
import { verifyToken, authEnabled, operatorLabel } from './auth.js';

try { process.loadEnvFile(new URL('./.env', import.meta.url).pathname); } catch { /* no .env */ }

const PORT = Number(process.env.PORT || 3001);

const store = await createStore();

const app = express();
app.use(cors({ origin: true })); // 5173 + Vercel mirror + judges' phones
app.use(express.json());

// Pick photos: robot/sim writes a per-pick image to web/server/media/ and puts
// only a `/media/...` reference on the pick_event (never image bytes in Atlas -
// M0 is 512 MB). Serve that dir statically so the dashboard can load thumbnails.
const MEDIA_DIR = path.join(import.meta.dirname, 'media');
fs.mkdirSync(MEDIA_DIR, { recursive: true });
app.use('/media', express.static(MEDIA_DIR, { maxAge: '1h', fallthrough: true }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, methods: ['GET', 'POST'] },
});

// Auth0 identity on the socket handshake. HACKATHON POSTURE: we attribute, we
// don't restrict - everyone still sees the same shared dashboard. When Auth0 is
// unconfigured this attaches null (dev bypass). The identity is used only to
// stamp `operator` on commands/picks for the Atlas audit trail (Mongo↔Auth0).
io.use(async (socket, next) => {
  try {
    socket.data.operator = operatorLabel(await verifyToken(socket.handshake.auth?.token));
  } catch {
    socket.data.operator = null;
  }
  next();
});

// events flowing robot -> ui
const ROBOT_EVENTS = ['telemetry', 'detection', 'pick_event', 'lidar_scan', 'slam_map', 'slam_pose'];
// events flowing ui/agent -> robot
const CONTROL_EVENTS = ['drive', 'arm_pose', 'pick', 'estop', 'nl_command'];

const counts = { robot: 0, ui: 0, agent: 0 };
let lastTelemetry = null;
// Last SLAM map + pose, replayed to a dashboard that joins mid-demo so the
// persistent map appears immediately instead of staying blank until the next
// 0.5 Hz map tick (the map is a slow event; a fresh UI must not wait for it).
let lastSlamMap = null;
let lastSlamPose = null;
// Last authenticated operator to issue a control command - the robot's
// pick_events (emitted later, by the robot) are attributed to them for the
// audit trail. null in autonomous/dev-bypass mode (pick stays unattributed).
let lastOperator = null;

// Set of socket ids that are REAL robots (role=robot without the panic-sim tag).
// The demo panic switch uses this to know if the real robot has died.
const realRobots = new Set();

// Demo panic switch: spawns/kills sim.js as a fallback data source if the real
// robot dies mid-judging. Boot mode from FORCE_SIM env (off|on|auto|1|0).
const panic = createPanicSwitch({
  port: PORT,
  getRealRobotCount: () => realRobots.size,
  graceMs: Number(process.env.PANIC_GRACE_MS) || 4000,
});
const bootMode = ({ '1': 'on', on: 'on', auto: 'auto', '0': 'off', off: 'off', '': 'off' })[
  (process.env.FORCE_SIM ?? '').toLowerCase()
];
if (bootMode && bootMode !== 'off') panic.setMode(bootMode, 'boot env FORCE_SIM');

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const normalizeRole = (r) => (r === 'farmhand' ? 'agent' : r);

io.on('connection', (socket) => {
  const rawRole = normalizeRole(socket.handshake.auth?.role || socket.handshake.query?.role);
  let role = ['robot', 'agent'].includes(rawRole) ? rawRole : 'ui';
  const isSim = socket.handshake.auth?.sim === true; // panic-switch fallback sim
  socket.join(role + 's');
  counts[role]++;
  updateRealRobot(socket.id, role, isSim);
  console.log(`[hub] ${role}${isSim ? ' (sim)' : ''} connected (${socket.id}) - robots:${counts.robot} uis:${counts.ui} agents:${counts.agent}`);

  // llm-client's service registers post-connect: register {"role":"farmhand"}
  socket.on('register', (payload = {}) => {
    const next = ['robot', 'agent'].includes(normalizeRole(payload?.role)) ? normalizeRole(payload.role) : 'ui';
    if (next === role) return;
    socket.leave(role + 's');
    counts[role]--;
    role = next;
    socket.join(role + 's');
    counts[role]++;
    updateRealRobot(socket.id, role, isSim);
    console.log(`[hub] ${socket.id} re-registered as ${role}`);
  });

  // late-joining dashboards get the last known robot state immediately
  if (role === 'ui') {
    if (lastTelemetry) socket.emit('telemetry', lastTelemetry);
    if (lastSlamMap) socket.emit('slam_map', lastSlamMap);
    if (lastSlamPose) socket.emit('slam_pose', lastSlamPose);
  }

  for (const event of ROBOT_EVENTS) {
    socket.on(event, (payload) => {
      if (role !== 'robot' || !isObj(payload)) return;
      if (!validators[event](payload)) return dropInvalid(event, payload);
      // Attribute the pick to whoever is currently in control (Atlas audit trail).
      if (event === 'pick_event' && lastOperator) payload = { ...payload, operator: lastOperator };
      io.to('uis').emit(event, payload);
      if (event === 'telemetry') {
        lastTelemetry = payload;
        store.recordTelemetry(payload).catch(logStoreErr); // store self-downsamples to <=1 Hz
      } else if (event === 'slam_map') {
        lastSlamMap = payload;
      } else if (event === 'slam_pose') {
        lastSlamPose = payload;
      } else if (event === 'detection') {
        store.recordDetection(payload).catch(logStoreErr);
      } else if (event === 'pick_event') {
        store.recordPickEvent(payload).catch(logStoreErr);
        forwardPickEvent(payload); // → Base44 Orchard OS (no-op unless env-gated on)
      }
    });
  }

  for (const event of CONTROL_EVENTS) {
    socket.on(event, (payload = {}) => {
      if (role === 'robot' || !isObj(payload)) return;
      // this operator is now "in control" → attribute subsequent picks to them
      if (socket.data.operator) lastOperator = socket.data.operator;
      if (event === 'drive') {
        const l = Number(payload.l);
        const r = Number(payload.r);
        if (!Number.isFinite(l) || !Number.isFinite(r)) return;
        payload = { l: Math.max(-1, Math.min(1, l)), r: Math.max(-1, Math.min(1, r)) };
      }
      io.to('robots').emit(event, payload);
      // FarmHand agent parses NL commands into structured control events
      if (event === 'nl_command' && role === 'ui') {
        io.to('agents').emit('nl_command', payload);
        // audit trail: who asked what (Atlas `commands`, Auth0-attributed)
        Promise.resolve(
          store.recordCommand?.({
            ts: Date.now(),
            text: String(payload.text ?? ''),
            source: 'web',
            operator: socket.data.operator,
          })
        ).catch(logStoreErr);
      }
      if (event === 'estop') console.log('[hub] ESTOP relayed');
    });
  }

  // FarmHand agent replies: nl_action {ts, text, ok, action|clarification|error}
  // (contract proposed by llm-client). Echo to uis for display; forward the full
  // nl_action to robots plus a mapped basic control event for fw-linux.
  socket.on('nl_action', (payload) => {
    if (role !== 'agent' || !isObj(payload) || typeof payload.ok !== 'boolean') return;
    io.to('uis').emit('nl_action', payload);
    if (!payload.ok || !isObj(payload.action)) return;
    io.to('robots').emit('nl_action', payload);
    const { task, fruit } = payload.action;
    if (task === 'stop') io.to('robots').emit('estop', {});
    else if (task === 'pick' || task === 'sort') {
      io.to('robots').emit('pick', { target: fruit === 'apple' || fruit === 'banana' ? fruit : 'nearest' });
    }
  });

  socket.on('disconnect', () => {
    counts[role]--;
    realRobots.delete(socket.id);
    if (panic.mode === 'auto') panic.reconcile('robot disconnect');
    console.log(`[hub] ${role} disconnected (${socket.id})`);
  });
});

// Keep the realRobots set in sync with a socket's current role. A robot without
// the panic-sim tag counts as "the real robot" for auto-failover.
function updateRealRobot(id, role, isSim) {
  if (role === 'robot' && !isSim) realRobots.add(id);
  else realRobots.delete(id);
  if (panic.mode === 'auto') panic.reconcile('robot membership change');
}

function logStoreErr(err) {
  console.warn('[store] write failed:', err.message);
}

let lastDropLog = 0;
function dropInvalid(event, payload) {
  const now = Date.now();
  if (now - lastDropLog > 5000) { // rate-limited so a bad emitter can't spam the log
    lastDropLog = now;
    console.warn(`[hub] dropped invalid ${event}:`, JSON.stringify(payload)?.slice(0, 200));
  }
}

// --- REST -------------------------------------------------------------------

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    uptime_s: Math.round(process.uptime()),
    clients: { ...counts },
    robot_connected: counts.robot > 0,
    real_robot_connected: realRobots.size > 0,
    base44_forwarding: base44Enabled(),
    force_sim: panic.status(),
  });
});

app.get('/api/stats', async (_req, res) => {
  try {
    res.json(await store.getStats());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/picks', async (req, res) => {
  try {
    const { fruit, ripeness, since } = req.query;
    const limit = Math.min(Number(req.query.limit) || 100, 1000);
    res.json(await store.getPicks({ limit, fruit, ripeness, since: since ? Number(since) : undefined }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/detections', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 1000);
    res.json(await store.getDetections({ limit }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- demo panic switch ------------------------------------------------------
// GET  /api/force-sim            -> current state
// POST /api/force-sim {mode}     -> "off" | "on" | "auto"
// POST /api/force-sim {on:bool}  -> simple button (on->"on", false->"off")
// Guarded by X-Panic-Key header iff PANIC_KEY env is set.
app.get('/api/force-sim', (_req, res) => res.json(panic.status()));

app.post('/api/force-sim', (req, res) => {
  const key = process.env.PANIC_KEY;
  if (key && req.get('x-panic-key') !== key) {
    return res.status(403).json({ error: 'bad or missing X-Panic-Key' });
  }
  const body = isObj(req.body) ? req.body : {};
  let mode = body.mode;
  if (mode === undefined && body.on !== undefined) mode = body.on ? 'on' : 'off';
  if (mode === undefined) {
    return res.status(400).json({ error: 'need {"mode":"off|on|auto"} or {"on":true|false}' });
  }
  try {
    const state = panic.setMode(String(mode).toLowerCase(), 'api');
    console.log('[hub] PANIC force-sim ->', JSON.stringify(state));
    res.json(state);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/stream', streamHandler);

// --- lifecycle --------------------------------------------------------------

server.listen(PORT, () => {
  console.log(`[hub] listening on http://localhost:${PORT}  (stream: /stream, stats: /api/stats)`);
  console.log(`[hub] Base44 pick_event forwarding: ${base44Enabled() ? 'ON' : 'off (set BASE44_WEBHOOK_URL to enable)'}`);
  console.log(`[hub] demo panic switch: mode=${panic.mode}  (POST /api/force-sim {"mode":"off|on|auto"})`);
});

async function shutdown() {
  console.log('[hub] shutting down');
  panic.shutdown();
  io.close();
  server.close();
  await store.close().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
