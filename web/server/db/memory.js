// In-memory backend: same interface as mongo.js, zero dependencies.
// Used whenever MONGODB_URI is unset (or Mongo is unreachable) so the sim and
// dashboard never block on Atlas.

import { computeImpact, round2, pickKg, throughput, KG_PER_FRUIT } from './impact.js';
import { computeActivity } from './activity.js';

const DETECTION_CAP = 2000;
const COMMAND_CAP = 500;

export function createMemoryBackend({ telemetryCap = 5000 } = {}) {
  const telemetry = []; // ring buffer, newest last
  const detections = [];
  const pickEvents = [];
  const commands = []; // NL command audit log (ring buffer)

  return {
    backend: 'memory',

    async recordTelemetry(doc) {
      telemetry.push(doc);
      if (telemetry.length > telemetryCap) telemetry.shift();
    },

    async recordDetection(doc) {
      detections.push(doc);
      if (detections.length > DETECTION_CAP) detections.shift();
    },

    async recordPickEvent(doc) {
      pickEvents.push(doc);
    },

    async recordCommand(doc) {
      commands.push(doc);
      if (commands.length > COMMAND_CAP) commands.shift();
    },

    async getPicks({ limit = 50, fruit, ripeness, since, operator } = {}) {
      let out = pickEvents;
      if (fruit) out = out.filter((p) => p.fruit === fruit);
      if (ripeness) out = out.filter((p) => p.ripeness === ripeness);
      if (operator) out = out.filter((p) => p.operator === operator);
      if (since != null) out = out.filter((p) => p.ts >= since);
      return out.slice(-limit).reverse(); // newest first
    },

    async getDetections({ limit = 50 } = {}) {
      return detections.slice(-limit).reverse();
    },

    async getCommands({ limit = 50, operator } = {}) {
      const out = operator ? commands.filter((c) => c.operator === operator) : commands;
      return out.slice(-limit).reverse(); // newest first
    },

    // Most recent stored telemetry - a status-header snapshot + late-joiner
    // hydration (the live socket is authoritative; this is the "on load" value).
    async getLatestTelemetry() {
      return telemetry.length ? telemetry[telemetry.length - 1] : null;
    },

    // Robot activity from the (bounded, capped) telemetry buffer: how long the
    // robot spent in each state, e-stop count, and a battery curve. Reliability
    // / hardware-track story ("actively picking N% of the time").
    async getActivity({ since } = {}) {
      const rows = (since != null ? telemetry.filter((t) => t.ts >= since) : telemetry)
        .slice()
        .sort((a, b) => a.ts - b.ts);
      return computeActivity(rows);
    },

    async getStats() {
      const totals = { picks: pickEvents.length, successes: 0, failures: 0, success_rate: 0 };
      const byFruit = {};
      const byRipeness = {};
      const byBin = {};
      const successesByFruit = {};
      let durationSum = 0;
      let durationCount = 0;

      for (const p of pickEvents) {
        const f = (byFruit[p.fruit] ??= { picks: 0, successes: 0 });
        f.picks += 1;
        byRipeness[p.ripeness] = (byRipeness[p.ripeness] ?? 0) + 1;
        if (p.bin) byBin[p.bin] = (byBin[p.bin] ?? 0) + 1;
        if (p.success) {
          totals.successes += 1;
          f.successes += 1;
          successesByFruit[p.fruit] = (successesByFruit[p.fruit] ?? 0) + 1;
        } else {
          totals.failures += 1;
        }
        if (typeof p.duration_ms === 'number') {
          durationSum += p.duration_ms;
          durationCount += 1;
        }
      }
      totals.success_rate = totals.picks ? round2(totals.successes / totals.picks) : 0;

      const byClass = {};
      let confSum = 0;
      let confCount = 0;
      for (const d of detections) {
        const key = `${d.fruit}_${d.ripeness}`;
        byClass[key] = (byClass[key] ?? 0) + 1;
        if (typeof d.conf === 'number') {
          confSum += d.conf;
          confCount += 1;
        }
      }
      const avgConf = confCount ? round2(confSum / confCount) : 0;

      // Elapsed window of recorded picks -> drives the throughput rates the
      // env/Deloitte tracks quote ("sorts N fruit / X kg per hour"). Use true
      // min/max ts, not positional, in case picks arrive slightly out of order.
      let firstTs = null;
      let lastTs = null;
      for (const p of pickEvents) {
        if (firstTs == null || p.ts < firstTs) firstTs = p.ts;
        if (lastTs == null || p.ts > lastTs) lastTs = p.ts;
      }
      const spanMs = firstTs != null ? lastTs - firstTs : 0;
      const impact = computeImpact(successesByFruit);

      return {
        backend: 'memory',
        totals,
        by_fruit: byFruit,
        by_ripeness: byRipeness,
        by_bin: byBin,
        avg_pick_duration_ms: durationCount ? Math.round(durationSum / durationCount) : 0,
        detections: { total: detections.length, by_class: byClass, avg_conf: avgConf },
        ...impact,
        window: { first_ts: firstTs, last_ts: lastTs, span_ms: spanMs },
        throughput: throughput({ picks: totals.picks, kg: impact.waste_avoided_kg, spanMs }),
      };
    },

    // Picks bucketed into fixed time windows for the Analytics charts. Each
    // bucket carries counts + successful-pick mass so the UI can plot volume,
    // success rate, and cumulative yield. `t` is the bucket's start epoch-ms.
    async getTimeSeries({ bucketMs = 60000, since, until } = {}) {
      const buckets = new Map();
      for (const p of pickEvents) {
        if (since != null && p.ts < since) continue;
        if (until != null && p.ts > until) continue;
        const t = p.ts - (p.ts % bucketMs);
        const b =
          buckets.get(t) ??
          buckets.set(t, { t, picks: 0, successes: 0, kg: 0, apple: 0, banana: 0 }).get(t);
        b.picks += 1;
        if (p.success) b.successes += 1;
        b.kg += pickKg(p);
        if (p.fruit === 'apple' || p.fruit === 'banana') b[p.fruit] += 1;
      }
      const series = [...buckets.values()]
        .sort((a, b) => a.t - b.t)
        .map((b) => ({ ...b, kg: round2(b.kg) }));
      return { bucket_ms: bucketMs, series };
    },

    // Harvest runs inferred from gaps between picks: a gap ≥ gapMs starts a new
    // run. Maps to a Base44 HarvestJob and powers the "this run: N picks in M
    // min, K kg" demo card. Newest run first.
    async getSessions({ gapMs = 120000 } = {}) {
      const sessions = [];
      let cur = null;
      for (const p of pickEvents) {
        if (!cur || p.ts - cur._last > gapMs) {
          cur = { start_ts: p.ts, _last: p.ts, picks: 0, successes: 0, _byFruit: {} };
          sessions.push(cur);
        }
        cur._last = p.ts;
        cur.picks += 1;
        if (p.success) {
          cur.successes += 1;
          cur._byFruit[p.fruit] = (cur._byFruit[p.fruit] ?? 0) + 1;
        }
      }
      return sessions
        .map((s) => {
          const impact = computeImpact(s._byFruit);
          return {
            start_ts: s.start_ts,
            end_ts: s._last,
            duration_ms: s._last - s.start_ts,
            picks: s.picks,
            successes: s.successes,
            success_rate: s.picks ? round2(s.successes / s.picks) : 0,
            ...impact,
          };
        })
        .reverse();
    },

    async close() {},
  };
}
