// HT6 telemetry hub — Express + Socket.IO on :3001.
// Relays events between robot clients and browser clients per root CLAUDE.md schemas.
//
// Client roles (handshake `auth: { role }` or `?role=`):
//   robot — the rover / sim.js / lidar pi   (emits telemetry, detection, pick_event, lidar_scan)
//   ui    — browser dashboard (default)     (emits drive, arm_pose, pick, estop, nl_command)
//   agent — FarmHand LLM client             (receives nl_command, emits robot control events)

import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { createStore } from './store.js';
import { streamHandler } from './stream.js';
import { validators } from './schemas.js';

try { process.loadEnvFile(new URL('./.env', import.meta.url).pathname); } catch { /* no .env */ }

const PORT = Number(process.env.PORT || 3001);

const store = await createStore();

const app = express();
app.use(cors({ origin: true })); // 5173 + Vercel mirror + judges' phones
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, methods: ['GET', 'POST'] },
});

// events flowing robot -> ui
const ROBOT_EVENTS = ['telemetry', 'detection', 'pick_event', 'lidar_scan'];
// events flowing ui/agent -> robot
const CONTROL_EVENTS = ['drive', 'arm_pose', 'pick', 'estop', 'nl_command'];

const counts = { robot: 0, ui: 0, agent: 0 };
let lastTelemetry = null;
let lastTelemetryStoredAt = 0;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

io.on('connection', (socket) => {
  const rawRole = socket.handshake.auth?.role || socket.handshake.query?.role;
  const role = ['robot', 'agent'].includes(rawRole) ? rawRole : 'ui';
  socket.join(role + 's');
  counts[role]++;
  console.log(`[hub] ${role} connected (${socket.id}) — robots:${counts.robot} uis:${counts.ui} agents:${counts.agent}`);

  // late-joining dashboards get the last known robot state immediately
  if (role === 'ui' && lastTelemetry) socket.emit('telemetry', lastTelemetry);

  for (const event of ROBOT_EVENTS) {
    socket.on(event, (payload) => {
      if (role !== 'robot' || !isObj(payload)) return;
      if (!validators[event](payload)) return dropInvalid(event, payload);
      io.to('uis').emit(event, payload);
      if (event === 'telemetry') {
        lastTelemetry = payload;
        const now = Date.now();
        if (now - lastTelemetryStoredAt >= 1000) { // downsample to <=1 Hz
          lastTelemetryStoredAt = now;
          store.insertTelemetry(payload).catch(logStoreErr);
        }
      } else if (event === 'detection') {
        store.insertDetection(payload).catch(logStoreErr);
      } else if (event === 'pick_event') {
        store.insertPickEvent(payload).catch(logStoreErr);
      }
    });
  }

  for (const event of CONTROL_EVENTS) {
    socket.on(event, (payload = {}) => {
      if (role === 'robot' || !isObj(payload)) return;
      if (event === 'drive') {
        const l = Number(payload.l);
        const r = Number(payload.r);
        if (!Number.isFinite(l) || !Number.isFinite(r)) return;
        payload = { l: Math.max(-1, Math.min(1, l)), r: Math.max(-1, Math.min(1, r)) };
      }
      io.to('robots').emit(event, payload);
      // FarmHand agent parses NL commands into structured control events
      if (event === 'nl_command' && role === 'ui') io.to('agents').emit('nl_command', payload);
      if (event === 'estop') console.log('[hub] ESTOP relayed');
    });
  }

  socket.on('disconnect', () => {
    counts[role]--;
    console.log(`[hub] ${role} disconnected (${socket.id})`);
  });
});

function logStoreErr(err) {
  console.warn('[store] write failed:', err.message);
}

// --- REST -------------------------------------------------------------------

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    uptime_s: Math.round(process.uptime()),
    clients: { ...counts },
    robot_connected: counts.robot > 0,
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
    const limit = Math.min(Number(req.query.limit) || 100, 1000);
    res.json(await store.getPicks({ limit }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/stream', streamHandler);

// --- lifecycle --------------------------------------------------------------

server.listen(PORT, () => {
  console.log(`[hub] listening on http://localhost:${PORT}  (stream: /stream, stats: /api/stats)`);
});

async function shutdown() {
  console.log('[hub] shutting down');
  io.close();
  server.close();
  await store.close().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
