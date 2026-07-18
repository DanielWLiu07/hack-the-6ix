// soak.js - extended soak / leak hunt for the telemetry hub (owner: server-test).
//
// Night-shift demo-hardening: run the full stack (hub + sim) for 30+ minutes
// under continuous client churn + periodic connect/disconnect storms + malformed
// payload barrages, sampling the HUB PROCESS RSS the whole time. Answers the one
// question that matters for judging: "would this hub die (or bloat, or choke)
// during a 3-hour judging window?"
//
// Runs against a PRIVATE hub instance we spawn (same index.js, Base44 OFF) so it
// never disrupts the shared :3001 hub the fleet uses overnight, and so RSS is
// cleanly attributable to one PID.
//
//   node soak.js                 # default ~32 min
//   SOAK_MIN=45 node soak.js     # longer
//   SOAK_MIN=3  node soak.js     # smoke the harness itself
//
// Emits a machine-readable final line: "SOAK_VERDICT: PASS|CONCERN - <detail>".
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { io } from "socket.io-client";

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.SOAK_PORT || 3997);
const URL = `http://127.0.0.1:${PORT}`;
const SOAK_MIN = Number(process.env.SOAK_MIN || 32);
const SAMPLE_MS = Number(process.env.SOAK_SAMPLE_MS || 30000);
// churn tuning knobs (defaults model a heavy-but-plausible reconnect load)
const CHURN_MS = Number(process.env.SOAK_CHURN_MS || 400);
const CHURN_SIZE = Number(process.env.SOAK_CHURN_SIZE || 12);
const STORM_MS = Number(process.env.SOAK_STORM_MS || 60000);
// optional extra `node` args for the spawned hub (e.g. "-r /path/diag-hook.cjs")
const HUB_NODE_ARGS = process.env.SOAK_HUB_NODE_ARGS ? process.env.SOAK_HUB_NODE_ARGS.split(" ").filter(Boolean) : [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const stats = {
  opened: 0, closed: 0, connectErrors: 0, storms: 0, malformedBursts: 0,
  telemetrySeen: 0, samples: [],
};

function rssKB(pid) {
  try {
    return Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)]).toString().trim()) || 0;
  } catch { return -1; }
}

// Open file descriptors held by the hub process - the number to watch for a
// socket/handle leak under connection churn. macOS: count lsof lines for the pid.
function fdCount(pid) {
  try {
    return execFileSync("lsof", ["-p", String(pid)], { stdio: ["ignore", "pipe", "ignore"] })
      .toString().trim().split("\n").length - 1;
  } catch { return -1; }
}

const HUB_LOG = join(dirname(fileURLToPath(import.meta.url)), `hub-${PORT}.log`);

async function health() {
  try {
    const res = await fetch(`${URL}/api/health`);
    return res.ok ? await res.json() : null;
  } catch { return null; }
}

// A short-lived client: connect as a random role, emit a small burst, then leave
// (via a mix of graceful close and abrupt engine destroy to exercise both paths).
function churnClient() {
  const roles = ["ui", "ui", "ui", "robot", "agent"]; // ui-heavy, like the real dashboard
  const role = roles[stats.opened % roles.length];
  const s = io(URL, { transports: ["websocket"], reconnection: false, timeout: 4000, auth: { role } });
  stats.opened++;
  let closed = false;
  const finish = () => { if (closed) return; closed = true; stats.closed++; };

  s.on("connect_error", () => { stats.connectErrors++; finish(); });
  s.on("connect", () => {
    // emit a plausible burst for the role
    try {
      if (role === "ui") {
        s.emit("drive", { l: Math.random() * 2 - 1, r: Math.random() * 2 - 1 });
        if (Math.random() < 0.3) s.emit("nl_command", { text: "pick all ripe apples" });
        if (Math.random() < 0.1) s.emit("estop", {});
      } else if (role === "agent") {
        s.emit("nl_action", { ts: Date.now(), text: "x", ok: true, action: { task: "pick", fruit: "apple", filter: "ripe", zone: "any" } });
      } else if (role === "robot") {
        // control-plane robot: emit telemetry only (no pick_event - keep the
        // unbounded pickEvents growth out of this connection-leak measurement)
        s.emit("telemetry", { ts: Date.now(), battery_v: 11.1, state: "SEEK", arm: [90, 45, 120, 90, 30], drive: { l: 0, r: 0 } });
      }
    } catch { /* socket may already be tearing down */ }

    const lifeMs = 150 + Math.floor(Math.random() * 1800);
    setTimeout(() => {
      // ~30% abrupt (destroy the underlying engine), rest graceful
      if (Math.random() < 0.3 && s.io?.engine) s.io.engine.close();
      else s.close();
      finish();
    }, lifeMs);
  });
  // safety net: guarantee cleanup even if connect never fires
  setTimeout(() => { try { s.close(); } catch {} finish(); }, 7000);
}

// A burst of simultaneous connects, half aborted before the handshake settles -
// the nastiest case for per-connection cleanup.
function storm(n = 60) {
  stats.storms++;
  for (let i = 0; i < n; i++) {
    const s = io(URL, { transports: ["websocket"], reconnection: false, timeout: 3000, auth: { role: "ui" } });
    stats.opened++;
    const kill = () => { try { (s.io?.engine && Math.random() < 0.5) ? s.io.engine.close() : s.close(); } catch {} stats.closed++; };
    if (i % 2 === 0) setTimeout(kill, Math.floor(Math.random() * 40)); // abort mid-handshake
    else s.on("connect", () => setTimeout(kill, 200 + Math.random() * 400));
    s.on("connect_error", () => { stats.connectErrors++; stats.closed++; });
  }
}

// Garbage the validator/relay path must survive without leaking.
function malformedBurst() {
  stats.malformedBursts++;
  const s = io(URL, { transports: ["websocket"], reconnection: false, auth: { role: "robot" } });
  stats.opened++;
  s.on("connect", () => {
    const junk = [
      ["telemetry", { ts: "nope", state: "BOGUS", arm: [1, 2] }],
      ["telemetry", null], ["detection", { conf: NaN }], ["pick_event", { bin: 42 }],
      ["lidar_scan", { points: Array(9000).fill([Infinity, -Infinity]) }],
      ["not_a_real_event", { x: 1 }], ["telemetry", Object.create(null)],
      ["telemetry", { ts: Date.now(), battery_v: 11, state: "IDLE", arm: [1,2,3,4,5], drive: {l:0,r:0}, EXTRA: "x" }],
    ];
    for (const [ev, p] of junk) { try { s.emit(ev, p); } catch {} }
    setTimeout(() => { s.close(); stats.closed++; }, 300);
  });
  s.on("connect_error", () => { stats.connectErrors++; stats.closed++; });
}

async function main() {
  console.log(`[soak] booting private hub on :${PORT} (Base44 OFF) + sim, target ${SOAK_MIN} min`);
  // 1. hub
  const hubLog = createWriteStream(HUB_LOG);
  const hub = spawn("node", [...HUB_NODE_ARGS, "index.js"], {
    cwd: SERVER_DIR,
    // Force the in-memory backend: (1) it reproduces the venue-resilience path
    // that must survive if Atlas is unreachable, and (2) it stops this load test
    // from writing tens of thousands of junk churn events into the SHARED Atlas
    // cluster (web/server/.env now points at it). MONGODB_URI="" wins because
    // index.js's loadEnvFile() does not override an already-set env var.
    env: { ...process.env, PORT: String(PORT), BASE44_WEBHOOK_URL: "", BASE44_SECRET: "", MONGODB_URI: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  hub.stdout.pipe(hubLog);
  hub.stderr.pipe(hubLog);
  hub.on("exit", (code, sig) => {
    let tail = "";
    try { tail = readFileSync(HUB_LOG, "utf8").split("\n").slice(-25).join("\n"); } catch {}
    console.log(`\n--- hub stdout/stderr tail (${HUB_LOG}) ---\n${tail}\n--- end hub tail ---`);
    console.log(`SOAK_VERDICT: CONCERN - HUB PROCESS EXITED mid-soak (code=${code} sig=${sig}). This WOULD kill the demo.`);
    process.exit(1);
  });
  // wait for it to listen
  for (let i = 0; i < 60; i++) { if (await health()) break; await sleep(200); }
  const h0 = await health();
  if (!h0) { console.log("SOAK_VERDICT: CONCERN - hub never became reachable"); hub.kill("SIGKILL"); process.exit(1); }

  // 2. sim (faithful full-stack robot) pointed at our private hub
  const sim = spawn("node", ["sim.js"], {
    cwd: SERVER_DIR, env: { ...process.env, SERVER_URL: URL }, stdio: ["ignore", "ignore", "ignore"],
  });
  await sleep(500);

  // 3. long-lived observer: proves the hub keeps delivering robot traffic
  const observer = io(URL, { transports: ["websocket"], reconnection: true, auth: { role: "ui" } });
  observer.on("telemetry", () => { stats.telemetrySeen++; });

  // 4. drivers
  const t0 = Date.now();
  const endAt = t0 + SOAK_MIN * 60_000;
  const churnTimer = setInterval(() => { for (let i = 0; i < CHURN_SIZE; i++) churnClient(); }, CHURN_MS);
  const stormTimer = setInterval(() => storm(60), STORM_MS);
  const malformedTimer = setInterval(() => malformedBurst(), 45_000);

  const rss0 = rssKB(hub.pid);
  let telAtLastSample = 0;
  console.log(`[soak] fd-limit(soft)=${(() => { try { return execFileSync("bash", ["-c", "ulimit -Sn"]).toString().trim(); } catch { return "?"; } })()} hub.pid=${hub.pid}`);
  console.log(`[soak] t=0m rss=${rss0}KB fds=${fdCount(hub.pid)} clients=${JSON.stringify(h0.clients)}`);

  // 5. sampler loop
  while (Date.now() < endAt) {
    await sleep(SAMPLE_MS);
    const mins = ((Date.now() - t0) / 60000).toFixed(1);
    const rss = rssKB(hub.pid);
    const fds = fdCount(hub.pid);
    const hh = await health();
    const telDelta = stats.telemetrySeen - telAtLastSample;
    telAtLastSample = stats.telemetrySeen;
    stats.samples.push({ mins: Number(mins), rss, fds, clients: hh?.clients, telDelta });
    console.log(`[soak] t=${mins}m rss=${rss}KB fds=${fds} Δtel=${telDelta} clients=${JSON.stringify(hh?.clients)} opened=${stats.opened} closed=${stats.closed} cerr=${stats.connectErrors} storms=${stats.storms}`);
    if (!hh) console.log(`[soak] WARN: /api/health did not answer at t=${mins}m`);
  }

  // 6. stop churn, let cleanup settle, then read the FINAL settled state
  clearInterval(churnTimer); clearInterval(stormTimer); clearInterval(malformedTimer);
  console.log("[soak] churn stopped; waiting 8s for connection cleanup to settle...");
  await sleep(8000);
  const settled = await health();
  const rssEnd = rssKB(hub.pid);
  observer.close();
  sim.kill("SIGTERM");
  hub.removeAllListeners("exit");
  hub.kill("SIGTERM");

  // 7. verdict
  report(rss0, rssEnd, settled);
}

function report(rss0, rssEnd, settled) {
  const warm = stats.samples.filter((s) => s.mins >= 2); // ignore JIT warmup
  const base = warm.length ? warm[0].rss : rss0;
  const peak = Math.max(rss0, ...stats.samples.map((s) => s.rss));
  const fdPeak = Math.max(0, ...stats.samples.map((s) => s.fds || 0));
  const fdEnd = stats.samples.length ? stats.samples[stats.samples.length - 1].fds : -1;
  const durMin = stats.samples.length ? stats.samples[stats.samples.length - 1].mins : 0;
  // growth rate from first warm sample to end
  const growthKB = rssEnd - base;
  const perMin = durMin > 2 ? growthKB / (durMin - 2) : 0;
  const proj3h = Math.round(rssEnd + perMin * (180 - durMin)); // extrapolate to 3h
  const telTotal = stats.telemetrySeen;
  const telStalls = stats.samples.filter((s) => s.mins > 1 && s.telDelta === 0).length;

  console.log("\n========== SOAK REPORT ==========");
  console.log(`duration:        ${durMin} min`);
  console.log(`clients churned: opened=${stats.opened} closed=${stats.closed} connectErrors=${stats.connectErrors}`);
  console.log(`storms:          ${stats.storms} (60 conns each, half aborted mid-handshake)`);
  console.log(`malformedBursts: ${stats.malformedBursts}`);
  console.log(`telemetry seen:  ${telTotal} (stall samples: ${telStalls})`);
  console.log(`RSS base(@2m):   ${base}KB`);
  console.log(`RSS peak:        ${peak}KB`);
  console.log(`RSS end:         ${rssEnd}KB  (growth ${growthKB >= 0 ? "+" : ""}${growthKB}KB, ${perMin.toFixed(1)}KB/min)`);
  console.log(`RSS proj @3h:    ~${proj3h}KB (${(proj3h / 1024).toFixed(0)}MB) if linear growth held`);
  console.log(`hub fds:         peak=${fdPeak} end=${fdEnd} (open file descriptors on the hub process)`);
  console.log(`settled health:  ${JSON.stringify(settled)}`);
  console.log("=================================");

  const concerns = [];
  // Leak thresholds: >8 MB/hr sustained, or projected 3h RSS over ~600 MB, is a flag.
  if (perMin > 8192 / 60) concerns.push(`RSS growth ${(perMin * 60 / 1024).toFixed(1)}MB/hr sustained`);
  if (proj3h > 600 * 1024) concerns.push(`projected 3h RSS ~${(proj3h / 1024).toFixed(0)}MB`);
  // Connection cleanup: after churn stops, ui count should fall back to ~1
  // (our observer). Anything large means disconnects didn't release state.
  if (settled?.clients && settled.clients.ui > 5) concerns.push(`ui count did not settle: ${settled.clients.ui} (disconnect cleanup leak?)`);
  if (settled?.clients && (settled.clients.robot < 0 || settled.clients.ui < 0 || settled.clients.agent < 0)) concerns.push(`negative client count = counter drift: ${JSON.stringify(settled.clients)}`);
  if (!settled) concerns.push("hub not answering /api/health at end");
  if (!settled?.robot_connected) concerns.push("sim/robot not connected at end (delivery may have stalled)");
  if (telStalls > Math.max(2, stats.samples.length * 0.15)) concerns.push(`${telStalls} telemetry-stall samples (hub choked on robot delivery)`);

  if (concerns.length) console.log(`SOAK_VERDICT: CONCERN - ${concerns.join("; ")}`);
  else console.log(`SOAK_VERDICT: PASS - hub stable over ${durMin}m of churn; RSS ~flat (${perMin.toFixed(1)}KB/min), counts settled, delivery healthy. No 3-hour-window risk observed.`);
  process.exit(0);
}

main().catch((e) => { console.log(`SOAK_VERDICT: CONCERN - harness error: ${e.message}`); process.exit(1); });
