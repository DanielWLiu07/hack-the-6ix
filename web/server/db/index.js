// Persistence layer entry point. server-core usage:
//
//   import { createDb } from './db/index.js';
//   const db = await createDb({ uri: process.env.MONGODB_URI });
//
// Falls back to the in-memory backend when no URI is set OR Mongo is
// unreachable (venue WiFi), so the stack always comes up. See README.md for
// the full contract and docs/DATA.md for document schemas.

import { createMemoryBackend } from './memory.js';

const TELEMETRY_MIN_INTERVAL_MS = 1000; // robot emits 5 Hz; we persist ≤1 Hz

export async function createDb({
  uri = process.env.MONGODB_URI,
  dbName = process.env.MONGODB_DB || 'ht6',
  telemetryCap = 5000,
  quiet = false,
} = {}) {
  let backend;
  if (uri) {
    try {
      const { createMongoBackend } = await import('./mongo.js');
      backend = await createMongoBackend({ uri, dbName, telemetryCap });
      if (!quiet) console.log(`[db] connected to MongoDB (db: ${dbName})`);
    } catch (err) {
      if (!quiet) console.warn(`[db] Mongo unavailable (${err.message}); using in-memory fallback`);
    }
  }
  if (!backend) {
    backend = createMemoryBackend({ telemetryCap });
    if (!quiet && !uri) console.log('[db] MONGODB_URI not set; using in-memory backend');
  }

  // Downsample telemetry here so both backends store ≤1 Hz. Also stamp a ts on
  // any doc that arrives without one - robots may send ts:0 before NTP sync.
  let lastTelemetryTs = -Infinity;

  const stamp = (doc) =>
    typeof doc.ts === 'number' && doc.ts > 0 ? doc : { ...doc, ts: Date.now() };

  return {
    backend: backend.backend,

    async recordTelemetry(doc) {
      const d = stamp(doc);
      if (d.ts - lastTelemetryTs < TELEMETRY_MIN_INTERVAL_MS) return false;
      lastTelemetryTs = d.ts;
      await backend.recordTelemetry(d);
      return true;
    },
    recordDetection: (doc) => backend.recordDetection(stamp(doc)),
    recordPickEvent: (doc) => backend.recordPickEvent(stamp(doc)),
    recordCommand: (doc) => backend.recordCommand(stamp(doc)),
    getStats: () => backend.getStats(),
    getPicks: (opts) => backend.getPicks(opts),
    getDetections: (opts) => backend.getDetections(opts),
    getCommands: (opts) => backend.getCommands(opts),
    getTimeSeries: (opts) => backend.getTimeSeries(opts),
    getSessions: (opts) => backend.getSessions(opts),
    getLatestTelemetry: () => backend.getLatestTelemetry(),
    getActivity: (opts) => backend.getActivity(opts),
    close: () => backend.close(),
  };
}
