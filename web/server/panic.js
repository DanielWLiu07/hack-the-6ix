// panic.js - DEMO PANIC SWITCH (force-sim).
//
// If the real robot dies during judging the dashboard would go stale and the
// demo dies with it. This switch keeps data flowing by spawning `sim.js` as a
// child process that connects back to the hub as a robot and emits plausible
// telemetry/detections/picks/lidar. The panic sim is tagged (auth.sim=true) so
// auto-mode can tell it apart from a real robot.
//
// Modes (runtime-settable via POST /api/force-sim, or boot env FORCE_SIM):
//   off  - no fallback sim; the real robot is the only source. (default)
//   on   - MANUAL PANIC: ensure the fallback sim is running right now.
//   auto - FAILOVER: run the sim iff no real (non-sim) robot has been connected
//          for PANIC_GRACE_MS; kill it automatically when a real robot returns.
//
// The `{on:true|false}` body is accepted as a dead-simple button (-> on/off).

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));

export function createPanicSwitch({ port, getRealRobotCount, graceMs = 4000, log = console }) {
  let mode = 'off'; // off | on | auto
  let proc = null; // the running sim child, or null
  let realZeroSince = null; // ms timestamp when real robots last hit zero (auto mode)

  function simRunning() {
    return proc !== null;
  }

  function startSim(reason) {
    if (proc) return false;
    const child = spawn('node', ['sim.js'], {
      cwd: SERVER_DIR,
      stdio: 'inherit',
      env: { ...process.env, SERVER_URL: `http://localhost:${port}`, SIM_TAG: 'panic' },
    });
    proc = child;
    log.warn(`[panic] force-sim STARTED (${reason}) pid=${child.pid}`);
    child.on('exit', (code) => {
      // Only clear if this is still the tracked child (avoid clobbering a restart).
      if (proc === child) proc = null;
      log.warn(`[panic] sim child exited (code=${code ?? 'signal'})`);
    });
    return true;
  }

  function stopSim(reason) {
    if (!proc) return false;
    const child = proc;
    proc = null; // clear first so the exit handler no-ops
    log.warn(`[panic] force-sim STOPPED (${reason})`);
    child.kill('SIGTERM');
    return true;
  }

  // Reconcile the running sim with the desired state for the current mode.
  function reconcile(reason = 'tick') {
    if (mode === 'on') {
      if (!proc) startSim(`manual panic (${reason})`);
      return;
    }
    if (mode === 'off') {
      if (proc) stopSim(`mode=off (${reason})`);
      return;
    }
    // auto: sim on iff no real robot for the grace window
    const real = getRealRobotCount();
    if (real > 0) {
      realZeroSince = null;
      if (proc) stopSim('auto: real robot present');
      return;
    }
    // real === 0
    if (realZeroSince === null) realZeroSince = Date.now();
    const downFor = Date.now() - realZeroSince;
    if (!proc && downFor >= graceMs) startSim(`auto: no real robot for ${downFor}ms`);
  }

  function setMode(next, reason = 'api') {
    const valid = ['off', 'on', 'auto'];
    if (!valid.includes(next)) throw new Error(`invalid mode "${next}" (want ${valid.join('|')})`);
    mode = next;
    realZeroSince = null; // restart the grace clock on any mode change
    log.warn(`[panic] mode -> ${mode} (${reason})`);
    reconcile('mode-change');
    return status();
  }

  function status() {
    return {
      mode,
      sim_running: simRunning(),
      sim_pid: proc?.pid ?? null,
      real_robots: getRealRobotCount(),
      grace_ms: graceMs,
    };
  }

  // Auto-mode watchdog. Cheap 1 s tick; only acts in auto mode.
  const timer = setInterval(() => {
    if (mode === 'auto') reconcile('watchdog');
  }, 1000);
  timer.unref?.(); // never keep the process alive on our account

  function shutdown() {
    clearInterval(timer);
    stopSim('hub shutdown');
  }

  return { setMode, status, simRunning, reconcile, shutdown, get mode() { return mode; } };
}
