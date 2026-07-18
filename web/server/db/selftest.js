// Smoke test for the db layer. Always exercises the in-memory backend; also
// exercises Mongo when MONGODB_URI is set. Run: node selftest.js
import assert from 'node:assert/strict';
import { createDb } from './index.js';

async function exercise(db, label) {
  const t0 = Date.now();

  // 5 Hz telemetry for 3 "seconds" → downsample should keep ~3, not 15.
  let stored = 0;
  for (let i = 0; i < 15; i++) {
    const ok = await db.recordTelemetry({
      ts: t0 + i * 200,
      battery_v: 11.1,
      state: 'SEEK',
      arm: [0, 0, 0, 0, 0],
      drive: { l: 0.2, r: 0.2 },
    });
    if (ok) stored++;
  }
  assert.ok(stored >= 3 && stored <= 4, `telemetry downsample: stored ${stored}, want 3-4`);

  await db.recordDetection({ ts: t0, fruit: 'apple', ripeness: 'ripe', conf: 0.93, bbox: [10, 10, 40, 40] });
  await db.recordDetection({ ts: t0 + 1, fruit: 'banana', ripeness: 'unripe', conf: 0.81, bbox: [5, 5, 60, 25] });

  const picks = [
    { ts: t0, fruit: 'apple', ripeness: 'ripe', bin: 'apple_ripe', success: true, duration_ms: 8000 },
    { ts: t0 + 1, fruit: 'apple', ripeness: 'unripe', bin: 'apple_unripe', success: true, duration_ms: 9000 },
    { ts: t0 + 2, fruit: 'banana', ripeness: 'ripe', bin: 'banana_ripe', success: false, duration_ms: 12000 },
    { ts: t0 + 3, fruit: 'banana', ripeness: 'ripe', bin: 'banana_ripe', success: true, duration_ms: 7000 },
  ];
  for (const p of picks) await db.recordPickEvent(p);

  const stats = await db.getStats();
  assert.equal(stats.totals.picks, 4);
  assert.equal(stats.totals.successes, 3);
  assert.equal(stats.totals.failures, 1);
  assert.equal(stats.totals.success_rate, 0.75);
  assert.equal(stats.by_fruit.apple.picks, 2);
  assert.equal(stats.by_fruit.apple.successes, 2);
  assert.equal(stats.by_ripeness.ripe, 3);
  assert.equal(stats.by_bin.banana_ripe, 2);
  assert.equal(stats.avg_pick_duration_ms, 9000);
  assert.equal(stats.detections.total, 2);
  assert.equal(stats.detections.by_class.apple_ripe, 1);
  // 2 apples (0.18) + 1 banana (0.12) successful = 0.48 kg
  assert.equal(stats.waste_avoided_kg, 0.48);
  assert.equal(stats.co2e_avoided_kg, 1.2);

  const recent = await db.getPicks({ limit: 2 });
  assert.equal(recent.length, 2);
  assert.equal(recent[0].ts, t0 + 3, 'getPicks newest first');
  assert.ok(!('_id' in recent[0]), 'no _id leakage');

  const apples = await db.getPicks({ fruit: 'apple' });
  assert.equal(apples.length, 2);

  const dets = await db.getDetections({ limit: 10 });
  assert.equal(dets.length, 2);
  assert.equal(dets[0].fruit, 'banana', 'getDetections newest first');

  await db.close();
  console.log(`✓ ${label} backend passed`);
}

// Memory backend (always). Force it independent of ambient env: passing
// `uri: undefined` is NOT enough — destructuring defaults fire on undefined, so
// createDb would fall back to process.env.MONGODB_URI and silently hit Mongo
// (writing to the default `ht6` db). Clear the env for this call, then restore.
const savedUri = process.env.MONGODB_URI;
delete process.env.MONGODB_URI;
const mem = await createDb({ quiet: true });
assert.equal(mem.backend, 'memory', 'expected memory backend when no URI');
await exercise(mem, 'memory');
if (savedUri !== undefined) process.env.MONGODB_URI = savedUri;

// Mongo backend (only when a URI is available).
if (process.env.MONGODB_URI) {
  const dbName = process.env.MONGODB_DB || `ht6_selftest_${Date.now()}`;
  // Start from a clean slate so the exact-count assertions hold even if this DB
  // name was used by a prior run. Clear via deleteMany (a readWrite privilege)
  // rather than dropDatabase — Atlas least-privilege users (readWriteAnyDatabase,
  // like our app's) can't dropDatabase, and it's the app's own role we test with.
  // Only pick_events + detections need clearing; the assertions never depend on
  // stored telemetry counts (and telemetry is capped, so deleteMany is illegal).
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const cleanDb = client.db(dbName);
  await cleanDb.collection('pick_events').deleteMany({});
  await cleanDb.collection('detections').deleteMany({});
  await client.close();

  const db = await createDb({
    uri: process.env.MONGODB_URI,
    dbName,
    quiet: true,
  });
  assert.equal(db.backend, 'mongo', 'expected mongo backend when MONGODB_URI set');
  await exercise(db, 'mongo');
} else {
  console.log('- mongo backend skipped (MONGODB_URI not set)');
}

console.log('selftest OK');
