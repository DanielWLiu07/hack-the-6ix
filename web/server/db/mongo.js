// MongoDB backend (Atlas or mongodb-memory-server). Collections per web/CLAUDE.md:
// pick_events, detections, telemetry (capped). Stats come from aggregation
// pipelines so /api/stats stays fast even with a weekend of pick_events.

import { computeImpact, round2, throughput, KG_PER_FRUIT } from './impact.js';
import { computeActivity } from './activity.js';

export async function createMongoBackend({
  uri,
  dbName = 'ht6',
  telemetryCap = 5000,
} = {}) {
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const db = client.db(dbName);

  // Telemetry -> a native Atlas **Time Series collection** (purpose-built for
  // high-rate sensor data: automatic time-bucketing + columnar storage + TTL
  // expiry). This is a deliberate "use Atlas properly" choice for the MongoDB
  // track - not a plain collection. Falls back to a capped collection if the
  // server is too old, and no-ops (code 48) if telemetry already exists in
  // either form. See docs/MONGODB_AUTH0.md.
  try {
    await db.createCollection('telemetry', {
      timeseries: { timeField: 'time', metaField: 'meta', granularity: 'seconds' },
      expireAfterSeconds: 3600, // rolling ~1 h of history, like the old capped cap
    });
  } catch (err) {
    if (err.code === 48) {
      // already exists (timeseries or capped) - fine
    } else {
      try {
        await db.createCollection('telemetry', { capped: true, size: 5 * 1024 * 1024, max: telemetryCap });
      } catch (e2) {
        if (e2.code !== 48) throw e2;
      }
    }
  }

  const pickEvents = db.collection('pick_events');
  const detections = db.collection('detections');
  const telemetry = db.collection('telemetry');
  const commands = db.collection('commands');

  await Promise.all([
    pickEvents.createIndex({ ts: -1 }),
    pickEvents.createIndex({ fruit: 1, ripeness: 1 }),
    pickEvents.createIndex({ bin: 1 }),
    detections.createIndex({ ts: -1 }),
    detections.createIndex({ fruit: 1, ripeness: 1 }),
    commands.createIndex({ ts: -1 }),
    // Auth0 operator attribution (optional field -> sparse).
    pickEvents.createIndex({ operator: 1 }, { sparse: true }),
    commands.createIndex({ operator: 1 }, { sparse: true }),
  ]);

  const noId = { projection: { _id: 0 } };
  // Telemetry reads also strip the Time Series internal fields so the API shape
  // stays exactly the root-schema telemetry payload.
  const noTsInternal = { projection: { _id: 0, time: 0, meta: 0 } };

  return {
    backend: 'mongo',

    async recordTelemetry(doc) {
      // `time` (Date) is the Time Series timeField; `meta` groups by robot state.
      // Both are ignored if telemetry fell back to a capped collection.
      await telemetry.insertOne({ ...doc, time: new Date(doc.ts), meta: { state: doc.state } });
    },

    async recordDetection(doc) {
      await detections.insertOne({ ...doc });
    },

    async recordPickEvent(doc) {
      await pickEvents.insertOne({ ...doc });
    },

    async recordCommand(doc) {
      await commands.insertOne({ ...doc });
    },

    async getPicks({ limit = 50, fruit, ripeness, since, operator } = {}) {
      const q = {};
      if (fruit) q.fruit = fruit;
      if (ripeness) q.ripeness = ripeness;
      if (operator) q.operator = operator; // Auth0-attributed picks (see MONGODB_AUTH0.md)
      if (since != null) q.ts = { $gte: since };
      return pickEvents.find(q, noId).sort({ ts: -1 }).limit(limit).toArray();
    },

    async getDetections({ limit = 50 } = {}) {
      return detections.find({}, noId).sort({ ts: -1 }).limit(limit).toArray();
    },

    async getCommands({ limit = 50, operator } = {}) {
      const q = operator ? { operator } : {};
      return commands.find(q, noId).sort({ ts: -1 }).limit(limit).toArray();
    },

    async getLatestTelemetry() {
      const [row] = await telemetry.find({}, noTsInternal).sort({ ts: -1 }).limit(1).toArray();
      return row ?? null;
    },

    // Pull the telemetry window ts-ascending and reduce in the app layer - the
    // capped collection is small and the walk (dt-per-state, e-stop transitions,
    // battery curve) is far clearer than a Mongo pipeline. Shape identical to
    // the memory backend via the shared computeActivity() helper.
    async getActivity({ since } = {}) {
      const q = since != null ? { ts: { $gte: since } } : {};
      const rows = await telemetry.find(q, noTsInternal).sort({ ts: 1 }).toArray();
      return computeActivity(rows);
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
                    first_ts: { $min: '$ts' },
                    last_ts: { $max: '$ts' },
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
              confSum: { $sum: { $ifNull: ['$conf', 0] } },
            },
          },
        ])
        .toArray();

      const t = facets.totals[0] ?? {
        picks: 0,
        successes: 0,
        avg_duration: null,
        first_ts: null,
        last_ts: null,
      };
      const totals = {
        picks: t.picks,
        successes: t.successes,
        failures: t.picks - t.successes,
        success_rate: t.picks ? round2(t.successes / t.picks) : 0,
      };
      const spanMs = t.first_ts != null ? t.last_ts - t.first_ts : 0;

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
      const confSum = detAgg.reduce((a, r) => a + (r.confSum ?? 0), 0);
      const avgConf = detTotal ? round2(confSum / detTotal) : 0;

      const impact = computeImpact(successesByFruit);
      return {
        backend: 'mongo',
        totals,
        by_fruit: byFruit,
        by_ripeness: byRipeness,
        by_bin: byBin,
        avg_pick_duration_ms: t.avg_duration != null ? Math.round(t.avg_duration) : 0,
        detections: { total: detTotal, by_class: byClass, avg_conf: avgConf },
        ...impact,
        window: { first_ts: t.first_ts ?? null, last_ts: t.last_ts ?? null, span_ms: spanMs },
        throughput: throughput({ picks: totals.picks, kg: impact.waste_avoided_kg, spanMs }),
      };
    },

    // Picks bucketed into fixed time windows (see memory.js for the shape). kg
    // is summed server-side via the same per-fruit masses as computeImpact.
    async getTimeSeries({ bucketMs = 60000, since, until } = {}) {
      const match = {};
      if (since != null || until != null) {
        match.ts = {};
        if (since != null) match.ts.$gte = since;
        if (until != null) match.ts.$lte = until;
      }
      const kgBranches = Object.entries(KG_PER_FRUIT).map(([fruit, kg]) => ({
        case: { $and: ['$success', { $eq: ['$fruit', fruit] }] },
        then: kg,
      }));
      const rows = await pickEvents
        .aggregate([
          ...(Object.keys(match).length ? [{ $match: match }] : []),
          {
            $group: {
              _id: { $subtract: ['$ts', { $mod: ['$ts', bucketMs] }] },
              picks: { $sum: 1 },
              successes: { $sum: { $cond: ['$success', 1, 0] } },
              apple: { $sum: { $cond: [{ $eq: ['$fruit', 'apple'] }, 1, 0] } },
              banana: { $sum: { $cond: [{ $eq: ['$fruit', 'banana'] }, 1, 0] } },
              kg: { $sum: { $switch: { branches: kgBranches, default: 0 } } },
            },
          },
          { $sort: { _id: 1 } },
        ])
        .toArray();
      const series = rows.map((r) => ({
        t: r._id,
        picks: r.picks,
        successes: r.successes,
        kg: round2(r.kg),
        apple: r.apple,
        banana: r.banana,
      }));
      return { bucket_ms: bucketMs, series };
    },

    // Harvest runs inferred from gaps between picks (see memory.js). Done in the
    // app layer - pulling ts-ordered picks and walking them is simpler and
    // clearer than a window-function pipeline, and the pick set is small.
    async getSessions({ gapMs = 120000 } = {}) {
      const picks = await pickEvents
        .find({}, { projection: { _id: 0, ts: 1, fruit: 1, success: 1 } })
        .sort({ ts: 1 })
        .toArray();
      const sessions = [];
      let cur = null;
      for (const p of picks) {
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
        .map((s) => ({
          start_ts: s.start_ts,
          end_ts: s._last,
          duration_ms: s._last - s.start_ts,
          picks: s.picks,
          successes: s.successes,
          success_rate: s.picks ? round2(s.successes / s.picks) : 0,
          ...computeImpact(s._byFruit),
        }))
        .reverse();
    },

    async close() {
      await client.close();
    },
  };
}
