// Persistence layer behind a single interface.
//
// Store interface (db worker: implement this in web/server/db/index.js as
// `export async function createStore(uri)` returning the same shape — the hub
// auto-prefers your module over the built-ins below, see createStore() at bottom):
//
//   init(): Promise<void>
//   insertTelemetry(doc): Promise<void>   // hub downsamples to <=1 Hz before calling
//   insertDetection(doc): Promise<void>
//   insertPickEvent(doc): Promise<void>
//   getPicks({ limit }): Promise<doc[]>   // newest first
//   getStats(): Promise<{
//     counts: { byFruit, byRipeness, byBin },   // objects of name -> count
//     picks: { total, success, successRate },
//     wasteAvoidedKg
//   }>
//   close(): Promise<void>
//
// Collections: pick_events, detections, telemetry (telemetry capped/downsampled).

const WASTE_KG_PER_PICK = Number(process.env.WASTE_KG_PER_PICK || 0.15);

const CAPS = { telemetry: 3600, detections: 5000, pick_events: 5000 };

function computeStatsFromPicks(picks) {
  const byFruit = {};
  const byRipeness = {};
  const byBin = {};
  let success = 0;
  for (const p of picks) {
    if (p.fruit) byFruit[p.fruit] = (byFruit[p.fruit] || 0) + 1;
    if (p.ripeness) byRipeness[p.ripeness] = (byRipeness[p.ripeness] || 0) + 1;
    if (p.bin) byBin[p.bin] = (byBin[p.bin] || 0) + 1;
    if (p.success) success++;
  }
  const total = picks.length;
  return {
    counts: { byFruit, byRipeness, byBin },
    picks: {
      total,
      success,
      successRate: total ? +(success / total).toFixed(3) : 0,
    },
    wasteAvoidedKg: +(success * WASTE_KG_PER_PICK).toFixed(2),
  };
}

export class MemoryStore {
  constructor() {
    this.telemetry = [];
    this.detections = [];
    this.pick_events = [];
  }
  async init() {}
  #push(arr, cap, doc) {
    arr.push(doc);
    if (arr.length > cap) arr.splice(0, arr.length - cap);
  }
  async insertTelemetry(doc) { this.#push(this.telemetry, CAPS.telemetry, doc); }
  async insertDetection(doc) { this.#push(this.detections, CAPS.detections, doc); }
  async insertPickEvent(doc) { this.#push(this.pick_events, CAPS.pick_events, doc); }
  async getPicks({ limit = 100 } = {}) {
    return this.pick_events.slice(-limit).reverse();
  }
  async getStats() {
    return computeStatsFromPicks(this.pick_events);
  }
  async close() {}
}

export class MongoStore {
  constructor(uri) {
    this.uri = uri;
    this.client = null;
    this.db = null;
  }
  async init() {
    const { MongoClient } = await import('mongodb');
    this.client = new MongoClient(this.uri, { serverSelectionTimeoutMS: 5000 });
    await this.client.connect();
    this.db = this.client.db(process.env.MONGODB_DB || 'ht6');
    await Promise.all([
      this.db.collection('pick_events').createIndex({ ts: -1 }),
      this.db.collection('pick_events').createIndex({ fruit: 1, ripeness: 1 }),
      this.db.collection('detections').createIndex({ ts: -1 }),
      this.db
        .createCollection('telemetry', {
          capped: true,
          size: 5 * 1024 * 1024,
          max: CAPS.telemetry,
        })
        .catch(() => {}), // already exists
    ]);
  }
  async insertTelemetry(doc) { await this.db.collection('telemetry').insertOne({ ...doc }); }
  async insertDetection(doc) { await this.db.collection('detections').insertOne({ ...doc }); }
  async insertPickEvent(doc) { await this.db.collection('pick_events').insertOne({ ...doc }); }
  async getPicks({ limit = 100 } = {}) {
    return this.db
      .collection('pick_events')
      .find({}, { projection: { _id: 0 } })
      .sort({ ts: -1 })
      .limit(limit)
      .toArray();
  }
  async getStats() {
    const picks = await this.db
      .collection('pick_events')
      .find({}, { projection: { _id: 0 } })
      .toArray();
    return computeStatsFromPicks(picks);
  }
  async close() { await this.client?.close(); }
}

/**
 * Pick the best available store:
 * 1. web/server/db/index.js `createStore(uri)` if the db worker has shipped it
 * 2. MongoStore if MONGODB_URI is set
 * 3. MemoryStore fallback (always works)
 */
export async function createStore() {
  const uri = process.env.MONGODB_URI;
  try {
    const dbModule = await import('./db/index.js');
    if (typeof dbModule.createStore === 'function') {
      const store = await dbModule.createStore(uri);
      await store.init?.();
      console.log('[store] using web/server/db module');
      return store;
    }
  } catch (err) {
    if (err.code !== 'ERR_MODULE_NOT_FOUND') {
      console.warn('[store] db module failed to load, falling back:', err.message);
    }
  }
  if (uri) {
    const store = new MongoStore(uri);
    try {
      await store.init();
      console.log('[store] using MongoDB');
      return store;
    } catch (err) {
      console.warn('[store] MongoDB unreachable, falling back to memory:', err.message);
    }
  }
  const store = new MemoryStore();
  await store.init();
  console.log('[store] using in-memory store');
  return store;
}
