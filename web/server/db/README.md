# ht6-db — persistence layer (owner: worker `db`)

Drop-in storage module for the telemetry server. **server-core:** import it
relatively — no install steps needed, dependencies live in `db/node_modules`:

```js
import { createDb } from './db/index.js';

const db = await createDb({ uri: process.env.MONGODB_URI }); // all args optional
```

- `MONGODB_URI` set + reachable → MongoDB (Atlas) backend, database `ht6`
  (override with `MONGODB_DB` or `dbName` option).
- No URI, or Mongo unreachable → in-memory backend, same interface, logs a
  one-line warning. **The stack never fails to boot because of the DB.**
- `db.backend` tells you which one you got (`'mongo' | 'memory'`).

This folder is its own npm package (`type: module`) so it works regardless of
how server-core's package.json is configured. CommonJS consumers on Node 22 can
`require('./db/index.js')` too.

## Interface

All record/get methods are async. Payloads are the root `CLAUDE.md` Socket.IO
schemas, stored verbatim (a `ts` in epoch-ms is stamped in if missing/zero).

| Method | Notes |
|---|---|
| `recordTelemetry(t)` | Downsamples to ≤1 Hz (returns `false` when skipped); storage capped at 5000 docs (capped collection / ring buffer). Feed it every event, it self-limits. |
| `recordDetection(d)` | Capped at 2000 docs in memory mode. |
| `recordPickEvent(p)` | Never dropped — this is the analytics gold. |
| `getStats()` | Shape below — return it directly from `GET /api/stats`. |
| `getPicks({ limit=50, fruit, ripeness, since })` | Newest first, no `_id` — for `GET /api/picks`. |
| `getDetections({ limit=50 })` | Newest first. |
| `close()` | On shutdown. |

## `getStats()` shape (contract for `GET /api/stats`)

```jsonc
{
  "backend": "memory",
  "totals": { "picks": 4, "successes": 3, "failures": 1, "success_rate": 0.75 },
  "by_fruit": { "apple": { "picks": 2, "successes": 2 }, "banana": { "picks": 2, "successes": 1 } },
  "by_ripeness": { "ripe": 3, "unripe": 1 },
  "by_bin": { "apple_ripe": 1, "apple_unripe": 1, "banana_ripe": 2 },
  "avg_pick_duration_ms": 9000,
  "detections": { "total": 2, "by_class": { "apple_ripe": 1, "banana_unripe": 1 } },
  "waste_avoided_kg": 0.48,      // successful picks × per-fruit kg (impact.js)
  "co2e_avoided_kg": 1.2         // waste_avoided_kg × 2.5 kgCO2e/kg
}
```

Impact-model assumptions live in `impact.js` and `docs/DATA.md`.

## Verify

```sh
cd web/server/db && npm install && npm run selftest
```

Runs the in-memory backend always; also runs Mongo when `MONGODB_URI` is set
(uses a throwaway `ht6_selftest_*` database — drop them from Atlas UI if they
bother you).
