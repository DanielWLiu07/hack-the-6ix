// Shared helpers for hub tests. Server URL comes from SERVER_URL (default localhost:3001).
import { io } from "socket.io-client";

export const SERVER_URL = process.env.SERVER_URL || "http://localhost:3001";

// role is advisory: sent as both a query param and an auth field so whichever
// convention the hub picks ("role" query / auth) is covered. If the hub
// just broadcasts to everyone, role is ignored and tests still work.
export function connect(role = "browser", opts = {}) {
  return connectTo(SERVER_URL, role, opts);
}

// Same as connect() but to an explicit hub URL (used for private test hubs).
export function connectTo(url, role = "browser", opts = {}) {
  return io(url, {
    transports: ["websocket"],
    reconnection: false,
    timeout: 3000,
    query: { role },
    auth: { role },
    ...opts,
  });
}

export function connected(socket, ms = 3000) {
  return new Promise((resolve, reject) => {
    if (socket.connected) return resolve(socket);
    const t = setTimeout(() => reject(new Error(`connect timeout after ${ms}ms (${SERVER_URL})`)), ms);
    socket.once("connect", () => { clearTimeout(t); resolve(socket); });
    socket.once("connect_error", (e) => { clearTimeout(t); reject(e); });
  });
}

// Resolve true if the hub is reachable, false otherwise. Never throws.
export async function serverUp(ms = 2500) {
  const s = connect("probe");
  try {
    await connected(s, ms);
    return true;
  } catch {
    return false;
  } finally {
    s.close();
  }
}

// Wait for the next `event` on `socket`; resolves with the payload.
export function waitFor(socket, event, ms = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      socket.off(event, on);
      reject(new Error(`timed out after ${ms}ms waiting for "${event}"`));
    }, ms);
    const on = (payload) => { clearTimeout(t); resolve(payload); };
    socket.once(event, on);
  });
}

// Collect up to `n` payloads of `event` within `ms`; resolves with what it got.
export function collect(socket, event, n, ms = 6000) {
  return new Promise((resolve) => {
    const got = [];
    const done = () => { socket.off(event, on); clearTimeout(t); resolve(got); };
    const t = setTimeout(done, ms);
    const on = (payload) => { got.push(payload); if (got.length >= n) done(); };
    socket.on(event, on);
  });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Well-formed example payloads for every schema (used to test relaying).
export const SAMPLES = {
  telemetry: { ts: 1752768000000, battery_v: 11.1, state: "IDLE", arm: [90, 45, 120, 90, 30], drive: { l: 0, r: 0 } },
  detection: { ts: 1752768000000, fruit: "apple", ripeness: "ripe", conf: 0.93, bbox: [10, 20, 50, 60] },
  pick_event: { ts: 1752768000000, fruit: "banana", ripeness: "unripe", bin: "banana_unripe", success: true, duration_ms: 8000 },
  lidar_scan: { ts: 1752768000000, points: [[0.5, 1.2], [-0.3, 2.0]] },
  drive: { l: -0.5, r: 0.5 },
  arm_pose: { joints: [90, 45, 120, 90, 30] },
  pick: { target: "nearest" },
  estop: {},
  nl_command: { text: "pick all ripe apples" },
  nl_action: { ts: 1752768000000, text: "pick all ripe apples", ok: true, action: { task: "pick", fruit: "apple", filter: "ripe", zone: "any" } },
  // 8x8 occupancy grid, all-unknown (255), origin at (-2,-2)m, 5cm cells.
  slam_map: { ts: 1752768000000, resolution: 0.05, width: 8, height: 8, origin: [-2, -2], data: Buffer.alloc(64, 255).toString("base64") },
  slam_pose: { ts: 1752768000000, x: 1.0, y: 0.5, theta: 0.3 },
};

// Spawn a private, isolated hub (the hub's index.js) on `port`, with Base44
// forwarding forced OFF so test pick_events never reach the real Orchard OS
// webhook. Resolves { proc, url, close() } once the hub is accepting sockets.
// Used by integration tests that need determinism + write side effects the
// shared :3001 hub can't safely provide.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

export async function spawnHub(port = 3999, ms = 8000) {
  const proc = spawn("node", ["index.js"], {
    cwd: SERVER_DIR,
    // MONGODB_URI="" forces the in-memory store so integration tests are
    // deterministic and never read/write the SHARED Atlas collection (a full
    // collection would push our fixed-ts test markers out of any limit window).
    // The empty value wins because index.js's loadEnvFile() does not override
    // an already-set env var. Atlas itself is covered by db/selftest.js.
    env: { ...process.env, PORT: String(port), BASE44_WEBHOOK_URL: "", BASE44_SECRET: "", MONGODB_URI: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const url = `http://localhost:${port}`;
  let out = "";
  proc.stdout.on("data", (d) => { out += d.toString(); });
  proc.stderr.on("data", (d) => { out += d.toString(); });

  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) {
        const health = await res.json();
        return { proc, url, health, close: () => new Promise((r) => { proc.once("exit", r); proc.kill("SIGTERM"); }) };
      }
    } catch { /* not up yet */ }
    await sleep(150);
  }
  proc.kill("SIGKILL");
  throw new Error(`private hub on :${port} did not come up in ${ms}ms. Output:\n${out}`);
}
