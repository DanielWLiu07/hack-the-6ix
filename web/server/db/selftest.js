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

// Memory backend (always).
await exercise(await createDb({ uri: undefined, quiet: true }), 'memory');

// Mongo backend (only when a URI is available).
if (process.env.MONGODB_URI) {
  const db = await createDb({
    uri: process.env.MONGODB_URI,
    dbName: process.env.MONGODB_DB || `ht6_selftest_${Date.now()}`,
    quiet: true,
  });
  assert.equal(db.backend, 'mongo', 'expected mongo backend when MONGODB_URI set');
  await exercise(db, 'mongo');
} else {
  console.log('- mongo backend skipped (MONGODB_URI not set)');
}

console.log('selftest OK');
