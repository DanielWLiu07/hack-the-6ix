// Persistence: prefers the db worker's module (web/server/db - Mongo/Atlas with
// in-memory fallback, self-downsampling, tested against real mongod). If that
// module is ever missing/broken, a minimal built-in memory store with the SAME
// interface keeps the stack booting.
//
// Interface + /api/stats response shape: web/server/db/README.md (authoritative).
//   recordTelemetry(t)  recordDetection(d)  recordPickEvent(p)
//   getStats()  getPicks({limit,fruit,ripeness,since})  getDetections({limit})
//   close()   .backend -> 'mongo' | 'memory' | 'memory-fallback'

const WASTE_KG_PER_PICK = Number(process.env.WASTE_KG_PER_PICK || 0.15);
const CO2E_PER_KG_WASTE = 2.5;

class FallbackMemoryStore {
  backend = 'memory-fallback';
  #telemetry = [];
  #detections = [];
  #picks = [];
  #lastTelemetryTs = 0;

  async recordTelemetry(t) {
    const now = Date.now();
    if (now - this.#lastTelemetryTs < 1000) return false; // <=1 Hz
    this.#lastTelemetryTs = now;
    this.#telemetry.push(t);
    if (this.#telemetry.length > 5000) this.#telemetry.shift();
    return true;
  }
  async recordDetection(d) {
    this.#detections.push(d);
    if (this.#detections.length > 2000) this.#detections.shift();
  }
  async recordPickEvent(p) { this.#picks.push(p); }
  #commands = [];
  async recordCommand(c) { this.#commands.push(c); if (this.#commands.length > 500) this.#commands.shift(); }
  async getCommands({ limit = 50, operator } = {}) {
    const out = operator ? this.#commands.filter((c) => c.operator === operator) : this.#commands;
    return out.slice(-limit).reverse();
  }

  async getPicks({ limit = 50, fruit, ripeness, since } = {}) {
    let out = this.#picks;
    if (fruit) out = out.filter((p) => p.fruit === fruit);
    if (ripeness) out = out.filter((p) => p.ripeness === ripeness);
    if (since) out = out.filter((p) => p.ts >= since);
    return out.slice(-limit).reverse();
  }
  async getDetections({ limit = 50 } = {}) {
    return this.#detections.slice(-limit).reverse();
  }
  async getStats() {
    const picks = this.#picks;
    const totals = { picks: picks.length, successes: 0, failures: 0, success_rate: 0 };
    const by_fruit = {};
    const by_ripeness = {};
    const by_bin = {};
    let durationSum = 0;
    for (const p of picks) {
      p.success ? totals.successes++ : totals.failures++;
      by_fruit[p.fruit] = by_fruit[p.fruit] || { picks: 0, successes: 0 };
      by_fruit[p.fruit].picks++;
      if (p.success) by_fruit[p.fruit].successes++;
      by_ripeness[p.ripeness] = (by_ripeness[p.ripeness] || 0) + 1;
      by_bin[p.bin] = (by_bin[p.bin] || 0) + 1;
      durationSum += p.duration_ms || 0;
    }
    if (totals.picks) totals.success_rate = +(totals.successes / totals.picks).toFixed(3);
    const by_class = {};
    for (const d of this.#detections) {
      const k = `${d.fruit}_${d.ripeness}`;
      by_class[k] = (by_class[k] || 0) + 1;
    }
    const waste = +(totals.successes * WASTE_KG_PER_PICK).toFixed(2);
    return {
      backend: this.backend,
      totals,
      by_fruit,
      by_ripeness,
      by_bin,
      avg_pick_duration_ms: totals.picks ? Math.round(durationSum / totals.picks) : 0,
      detections: { total: this.#detections.length, by_class },
      waste_avoided_kg: waste,
      co2e_avoided_kg: +(waste * CO2E_PER_KG_WASTE).toFixed(2),
    };
  }
  async close() {}
}

export async function createStore() {
  try {
    const { createDb } = await import('./db/index.js');
    const db = await createDb({ uri: process.env.MONGODB_URI });
    console.log(`[store] using web/server/db module (backend: ${db.backend})`);
    return db;
  } catch (err) {
    console.warn('[store] db module unavailable, using built-in fallback:', err.message);
    return new FallbackMemoryStore();
  }
}
