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
    // operator = Auth0-attributed identity (optional field, passes through verbatim)
    { ts: t0, fruit: 'apple', ripeness: 'ripe', bin: 'apple_ripe', success: true, duration_ms: 8000, operator: 'auth0|op1' },
    { ts: t0 + 1, fruit: 'apple', ripeness: 'unripe', bin: 'apple_unripe', success: true, duration_ms: 9000, operator: 'auth0|op1' },
    { ts: t0 + 2, fruit: 'banana', ripeness: 'ripe', bin: 'banana_ripe', success: false, duration_ms: 12000 },
    // carries an optional image_url (photo-per-pickup) - must round-trip verbatim.
    { ts: t0 + 3, fruit: 'banana', ripeness: 'ripe', bin: 'banana_ripe', success: true, duration_ms: 7000, image_url: '/media/pick_test.jpg' },
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
  assert.equal(stats.detections.avg_conf, 0.87, 'avg detection confidence (0.93+0.81)/2');
  // 2 apples (0.18) + 1 banana (0.12) successful = 0.48 kg
  assert.equal(stats.waste_avoided_kg, 0.48);
  assert.equal(stats.co2e_avoided_kg, 1.2);

  const recent = await db.getPicks({ limit: 2 });
  assert.equal(recent.length, 2);
  assert.equal(recent[0].ts, t0 + 3, 'getPicks newest first');
  assert.equal(recent[0].image_url, '/media/pick_test.jpg', 'image_url passes through verbatim');
  assert.ok(!('_id' in recent[0]), 'no _id leakage');

  const apples = await db.getPicks({ fruit: 'apple' });
  assert.equal(apples.length, 2);

  // operator attribution (Auth0 ↔ Mongo): filter picks by the authenticated operator
  const byOp = await db.getPicks({ operator: 'auth0|op1' });
  assert.equal(byOp.length, 2, 'getPicks filters by operator');
  assert.equal((await db.getPicks({ operator: 'auth0|nobody' })).length, 0);

  const dets = await db.getDetections({ limit: 10 });
  assert.equal(dets.length, 2);
  assert.equal(dets[0].fruit, 'banana', 'getDetections newest first');

  // --- window + throughput (additive getStats fields) ---
  assert.equal(stats.window.first_ts, t0);
  assert.equal(stats.window.last_ts, t0 + 3);
  assert.equal(stats.window.span_ms, 3);
  assert.ok(stats.throughput.picks_per_hour > 0, 'throughput computed over span');

  // --- getTimeSeries: 4 picks land in one 60s bucket ---
  const ts1 = await db.getTimeSeries({ bucketMs: 60000 });
  assert.equal(ts1.bucket_ms, 60000);
  assert.equal(ts1.series.length, 1, 'all 4 picks in one bucket');
  assert.equal(ts1.series[0].picks, 4);
  assert.equal(ts1.series[0].successes, 3);
  assert.equal(ts1.series[0].kg, 0.48, 'bucket kg = successful-pick mass');
  assert.equal(ts1.series[0].apple, 2);
  assert.equal(ts1.series[0].banana, 2);

  // --- getSessions: all 4 picks are one run (gaps << 2 min) ---
  const s1 = await db.getSessions({ gapMs: 120000 });
  assert.equal(s1.length, 1, 'single harvest run');
  assert.equal(s1[0].picks, 4);
  assert.equal(s1[0].successes, 3);
  assert.equal(s1[0].success_rate, 0.75);
  assert.equal(s1[0].waste_avoided_kg, 0.48);
  assert.equal(s1[0].duration_ms, 3);

  // Add 2 picks 5 min later → forces a 2nd time-bucket AND a 2nd session.
  const later = t0 + 5 * 60000;
  await db.recordPickEvent({ ts: later, fruit: 'apple', ripeness: 'ripe', bin: 'apple_ripe', success: true, duration_ms: 6000 });
  await db.recordPickEvent({ ts: later + 1, fruit: 'apple', ripeness: 'ripe', bin: 'apple_ripe', success: true, duration_ms: 6000 });

  const ts2 = await db.getTimeSeries({ bucketMs: 60000 });
  assert.equal(ts2.series.length, 2, 'two distinct time buckets');
  assert.equal(ts2.series[0].picks, 4, 'buckets sorted oldest first');
  assert.equal(ts2.series[1].picks, 2);

  const s2 = await db.getSessions({ gapMs: 120000 });
  assert.equal(s2.length, 2, 'two harvest runs');
  assert.equal(s2[0].picks, 2, 'sessions newest first');
  assert.equal(s2[0].successes, 2);
  assert.equal(s2[1].picks, 4);

  // --- getActivity: 3 SEEK samples 1 s apart → 2 s of SEEK, no e-stops ---
  // Scope to this run's telemetry (capped collection may hold prior-run docs).
  const act = await db.getActivity({ since: t0 });
  assert.equal(act.state_durations.SEEK, 2000, 'time attributed to SEEK');
  assert.equal(act.total_ms, 2000);
  assert.equal(act.active_pct, 1, 'SEEK counts as active');
  assert.equal(act.estop_count, 0);
  assert.equal(act.battery.now, 11.1);
  assert.equal(act.battery.series.length, 3);

  // --- getLatestTelemetry: newest kept telemetry sample. This run's t0 is
  // later than any prior run's, so its max sample (t0+2000) is the global
  // newest even if the capped collection still holds prior-run docs. ---
  const latest = await db.getLatestTelemetry();
  assert.equal(latest.ts, t0 + 2000, 'latest telemetry is the newest kept sample');
  assert.equal(latest.state, 'SEEK');
  assert.equal(latest.battery_v, 11.1);
  assert.ok(!('_id' in latest), 'no _id leakage');

  // --- commands: NL-command audit log (Freesolo LLM track) ---
  await db.recordCommand({ ts: t0, text: 'pick all ripe apples', action: { task: 'pick', fruit: 'apple', filter: 'ripe' }, accepted: true, operator: 'auth0|op1' });
  await db.recordCommand({ ts: t0 + 1, text: 'stop', action: { task: 'stop' }, accepted: true, operator: 'auth0|op2' });
  const cmds = await db.getCommands({ limit: 10 });
  assert.equal(cmds.length, 2);
  assert.equal(cmds[0].text, 'stop', 'getCommands newest first');
  assert.equal(cmds[0].action.task, 'stop');
  assert.ok(!('_id' in cmds[0]), 'no _id leakage');
  // operator-scoped command history (Auth0 audit trail)
  const op1cmds = await db.getCommands({ operator: 'auth0|op1' });
  assert.equal(op1cmds.length, 1, 'getCommands filters by operator');
  assert.equal(op1cmds[0].action.task, 'pick');

  await db.close();
  console.log(`OK ${label} backend passed`);
}

// Memory backend (always). Force it independent of ambient env: passing
// `uri: undefined` is NOT enough - destructuring defaults fire on undefined, so
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
  // rather than dropDatabase - Atlas least-privilege users (readWriteAnyDatabase,
  // like our app's) can't dropDatabase, and it's the app's own role we test with.
  // Only pick_events + detections need clearing; the assertions never depend on
  // stored telemetry counts (and telemetry is capped, so deleteMany is illegal).
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const cleanDb = client.db(dbName);
  await cleanDb.collection('pick_events').deleteMany({});
  await cleanDb.collection('detections').deleteMany({});
  await cleanDb.collection('commands').deleteMany({});
  // telemetry is a capped collection (deleteMany is illegal on it) - the
  // activity assertions below scope their query with `since: t0` instead so
  // leftover telemetry from a prior run against this db name can't skew them.
  await client.close();

  const db = await createDb({
    uri: process.env.MONGODB_URI,
    dbName,
    quiet: true,
  });
  assert.equal(db.backend, 'mongo', 'expected mongo backend when MONGODB_URI set');
  await exercise(db, 'mongo');

  // Confirm telemetry is a native Atlas Time Series collection (MongoDB track).
  // Hard-assert on the canonical fresh unique-db run; soft on fixed-name reruns
  // where telemetry may already exist as the capped fallback.
  const verify = new MongoClient(process.env.MONGODB_URI);
  await verify.connect();
  const [tInfo] = await verify.db(dbName).listCollections({ name: 'telemetry' }).toArray();
  await verify.close();
  const freshRun = /^ht6_selftest_\d+$/.test(dbName);
  if (freshRun) {
    assert.equal(tInfo?.type, 'timeseries', 'telemetry is an Atlas Time Series collection');
    console.log('OK telemetry is an Atlas Time Series collection');
  } else {
    console.log(`- telemetry collection type: ${tInfo?.type} (fixed-name run; timeseries on fresh dbs)`);
  }
} else {
  console.log('- mongo backend skipped (MONGODB_URI not set)');
}

console.log('selftest OK');
