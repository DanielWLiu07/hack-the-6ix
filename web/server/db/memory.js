// In-memory backend: same interface as mongo.js, zero dependencies.
// Used whenever MONGODB_URI is unset (or Mongo is unreachable) so the sim and
// dashboard never block on Atlas.

import { computeImpact, round2 } from './impact.js';

const DETECTION_CAP = 2000;

export function createMemoryBackend({ telemetryCap = 5000 } = {}) {
  const telemetry = []; // ring buffer, newest last
  const detections = [];
  const pickEvents = [];

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

    async getPicks({ limit = 50, fruit, ripeness, since } = {}) {
      let out = pickEvents;
      if (fruit) out = out.filter((p) => p.fruit === fruit);
      if (ripeness) out = out.filter((p) => p.ripeness === ripeness);
      if (since != null) out = out.filter((p) => p.ts >= since);
      return out.slice(-limit).reverse(); // newest first
    },

    async getDetections({ limit = 50 } = {}) {
      return detections.slice(-limit).reverse();
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
      for (const d of detections) {
        const key = `${d.fruit}_${d.ripeness}`;
        byClass[key] = (byClass[key] ?? 0) + 1;
      }

      return {
        backend: 'memory',
        totals,
        by_fruit: byFruit,
        by_ripeness: byRipeness,
        by_bin: byBin,
        avg_pick_duration_ms: durationCount ? Math.round(durationSum / durationCount) : 0,
        detections: { total: detections.length, by_class: byClass },
        ...computeImpact(successesByFruit),
      };
    },

    async close() {},
  };
}
