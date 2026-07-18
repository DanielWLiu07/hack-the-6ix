// MongoDB backend (Atlas or mongodb-memory-server). Collections per web/CLAUDE.md:
// pick_events, detections, telemetry (capped). Stats come from aggregation
// pipelines so /api/stats stays fast even with a weekend of pick_events.

import { computeImpact, round2 } from './impact.js';

export async function createMongoBackend({
  uri,
  dbName = 'ht6',
  telemetryCap = 5000,
} = {}) {
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db = client.db(dbName);

  // Telemetry is a capped collection: fixed-size ring buffer server-side.
  // Code 48 = NamespaceExists (already created on a previous run).
  try {
    await db.createCollection('telemetry', {
      capped: true,
      size: 5 * 1024 * 1024,
      max: telemetryCap,
    });
  } catch (err) {
    if (err.code !== 48) throw err;
  }

  const pickEvents = db.collection('pick_events');
  const detections = db.collection('detections');
  const telemetry = db.collection('telemetry');

  await Promise.all([
    pickEvents.createIndex({ ts: -1 }),
    pickEvents.createIndex({ fruit: 1, ripeness: 1 }),
    pickEvents.createIndex({ bin: 1 }),
    detections.createIndex({ ts: -1 }),
    detections.createIndex({ fruit: 1, ripeness: 1 }),
  ]);

  const noId = { projection: { _id: 0 } };

  return {
    backend: 'mongo',

    async recordTelemetry(doc) {
      await telemetry.insertOne({ ...doc });
    },

    async recordDetection(doc) {
      await detections.insertOne({ ...doc });
    },

    async recordPickEvent(doc) {
      await pickEvents.insertOne({ ...doc });
    },

    async getPicks({ limit = 50, fruit, ripeness, since } = {}) {
      const q = {};
      if (fruit) q.fruit = fruit;
      if (ripeness) q.ripeness = ripeness;
      if (since != null) q.ts = { $gte: since };
      return pickEvents.find(q, noId).sort({ ts: -1 }).limit(limit).toArray();
    },

    async getDetections({ limit = 50 } = {}) {
      return detections.find({}, noId).sort({ ts: -1 }).limit(limit).toArray();
    },

    async getStats() {
      const [facets] = await pickEvents
        .aggregate([
          {
            $facet: {
              totals: [
                {
                  $group: {
                    _id: null,
                    picks: { $sum: 1 },
                    successes: { $sum: { $cond: ['$success', 1, 0] } },
                    avg_duration: { $avg: '$duration_ms' },
                  },
                },
              ],
              by_fruit: [
                {
                  $group: {
                    _id: '$fruit',
                    picks: { $sum: 1 },
                    successes: { $sum: { $cond: ['$success', 1, 0] } },
                  },
                },
              ],
              by_ripeness: [{ $group: { _id: '$ripeness', n: { $sum: 1 } } }],
              by_bin: [{ $group: { _id: '$bin', n: { $sum: 1 } } }],
            },
          },
        ])
        .toArray();

      const detAgg = await detections
        .aggregate([
          {
            $group: {
              _id: { $concat: ['$fruit', '_', '$ripeness'] },
              n: { $sum: 1 },
            },
          },
        ])
        .toArray();

      const t = facets.totals[0] ?? { picks: 0, successes: 0, avg_duration: null };
      const totals = {
        picks: t.picks,
        successes: t.successes,
        failures: t.picks - t.successes,
        success_rate: t.picks ? round2(t.successes / t.picks) : 0,
      };

      const byFruit = {};
      const successesByFruit = {};
      for (const row of facets.by_fruit) {
        if (row._id == null) continue;
        byFruit[row._id] = { picks: row.picks, successes: row.successes };
        successesByFruit[row._id] = row.successes;
      }
      const byRipeness = Object.fromEntries(
        facets.by_ripeness.filter((r) => r._id != null).map((r) => [r._id, r.n])
      );
      const byBin = Object.fromEntries(
        facets.by_bin.filter((r) => r._id != null).map((r) => [r._id, r.n])
      );

      const byClass = Object.fromEntries(
        detAgg.filter((r) => r._id != null).map((r) => [r._id, r.n])
      );
      const detTotal = Object.values(byClass).reduce((a, b) => a + b, 0);

      return {
        backend: 'mongo',
        totals,
        by_fruit: byFruit,
        by_ripeness: byRipeness,
        by_bin: byBin,
        avg_pick_duration_ms: t.avg_duration != null ? Math.round(t.avg_duration) : 0,
        detections: { total: detTotal, by_class: byClass },
        ...computeImpact(successesByFruit),
      };
    },

    async close() {
      await client.close();
    },
  };
}
