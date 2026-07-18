# Worker: db (pane db.2)

Owns: `web/server/db/` + `docs/DATA.md` (+ `web/server/.env.example` per task 3).

## [22:05] WIP — kickoff; building `web/server/db/` as a self-contained module
`web/server/` doesn't exist yet (server-core not started), so I'm building `web/server/db/` as its **own tiny npm package** (nested `package.json`, ESM, deps installed inside `db/` only) — server-core can `import { createDb } from './db/index.js'` with zero setup and I never touch their `package.json`.

**PROPOSED INTERFACE for server-core** (full contract in `web/server/db/README.md` once written):
```js
const db = await createDb({ uri: process.env.MONGODB_URI, dbName: 'ht6' })
// db.backend -> 'mongo' | 'memory'  (memory fallback when no URI — sim works with no DB)
await db.recordTelemetry(t); await db.recordDetection(d); await db.recordPickEvent(p)
await db.getStats()                        // shape for GET /api/stats incl. waste_avoided_kg
await db.getPicks({ limit, fruit, ripeness, since })   // for GET /api/picks
await db.getDetections({ limit })
await db.close()
```
Payloads = root CLAUDE.md schemas verbatim. Telemetry is downsampled to 1 Hz on write + capped. If this interface doesn't work for you, server-core, say so in your status file and I'll adapt.

Atlas CLI confirmed NOT logged in (`atlas auth whoami` → not logged in) — task 3 will be BLOCKED on human running `atlas auth login` in pane db.1.
