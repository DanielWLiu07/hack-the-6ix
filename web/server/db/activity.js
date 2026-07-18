// Robot-activity summary derived from a time-ordered telemetry slice. Shared by
// both backends so memory and Mongo report identical shapes. Telemetry is a
// bounded/capped buffer (~last 80 min at 1 Hz), so this is a rolling window.

import { round2 } from './impact.js';

const STATES = ['IDLE', 'SEEK', 'PICK', 'SORT', 'ESTOP'];
// Gaps larger than this between consecutive samples mean the robot was
// disconnected/off - don't attribute that time to the earlier state.
const MAX_GAP_MS = 5000;
const BATTERY_SERIES_MAX = 120;

// `rows`: telemetry docs sorted ascending by ts.
export function computeActivity(rows) {
  const stateDurations = Object.fromEntries(STATES.map((s) => [s, 0]));
  let estopCount = 0;
  let batteryMin = null;
  let batteryMax = null;

  for (let i = 0; i < rows.length; i++) {
    const cur = rows[i];
    if (typeof cur.battery_v === 'number') {
      batteryMin = batteryMin == null ? cur.battery_v : Math.min(batteryMin, cur.battery_v);
      batteryMax = batteryMax == null ? cur.battery_v : Math.max(batteryMax, cur.battery_v);
    }
    // A transition INTO ESTOP counts as one e-stop event.
    if (cur.state === 'ESTOP' && (i === 0 || rows[i - 1].state !== 'ESTOP')) {
      estopCount += 1;
    }
    // Attribute the interval to the state held at its start.
    if (i < rows.length - 1 && cur.state in stateDurations) {
      const dt = rows[i + 1].ts - cur.ts;
      if (dt > 0 && dt <= MAX_GAP_MS) stateDurations[cur.state] += dt;
    }
  }

  const totalMs = Object.values(stateDurations).reduce((a, b) => a + b, 0);
  const activeMs = stateDurations.SEEK + stateDurations.PICK + stateDurations.SORT;

  // Downsample the battery curve to a bounded number of points for the chart.
  const withBattery = rows.filter((r) => typeof r.battery_v === 'number');
  const step = Math.max(1, Math.ceil(withBattery.length / BATTERY_SERIES_MAX));
  const series = withBattery
    .filter((_, i) => i % step === 0)
    .map((r) => ({ t: r.ts, v: r.battery_v }));

  return {
    total_ms: totalMs,
    state_durations: stateDurations,
    active_pct: totalMs ? round2(activeMs / totalMs) : 0,
    estop_count: estopCount,
    battery: {
      now: withBattery.length ? withBattery[withBattery.length - 1].battery_v : null,
      min: batteryMin,
      max: batteryMax,
      series,
    },
  };
}
