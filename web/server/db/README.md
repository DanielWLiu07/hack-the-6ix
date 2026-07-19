# ht6-db - persistence layer (owner: worker `db`)

Drop-in storage module for the telemetry server. **the hub:** import it
relatively - no install steps needed, dependencies live in `db/node_modules`:

```js
import { createDb } from './db/index.js';

const db = await createDb({ uri: process.env.MONGODB_URI }); // all args optional
```

- `MONGODB_URI` set + reachable -> MongoDB (Atlas) backend, database `ht6`
  (override with `MONGODB_DB` or `dbName` option).
- No URI, or Mongo unreachable -> in-memory backend, same interface, logs a
  one-line warning. **The stack never fails to boot because of the DB.**
- `db.backend` tells you which one you got (`'mongo' | 'memory'`).

This folder is its own npm package (`type: module`) so it works regardless of
how the hub's package.json is configured. CommonJS consumers on Node 22 can
`require('./db/index.js')` too.

## Interface

All record/get methods are async. Payloads are the docs/SCHEMAS.md Socket.IO
schemas, stored verbatim (a `ts` in epoch-ms is stamped in if missing/zero).

| Method | Notes |
|---|---|
| `recordTelemetry(t)` | Downsamples to ≤1 Hz (returns `false` when skipped); storage capped at 5000 docs (capped collection / ring buffer). Feed it every event, it self-limits. |
| `recordDetection(d)` | Capped at 2000 docs in memory mode. |
| `recordPickEvent(p)` | Never dropped - this is the analytics gold. |
| `recordCommand(c)` | NL-command audit: `{text, action, accepted, source?}`. Capped at 500 in memory. Call on the `nl_command` path. |
| `getStats()` | Shape below - return it directly from `GET /api/stats`. |
| `getPicks({ limit=50, fruit, ripeness, since })` | Newest first, no `_id` - for `GET /api/picks`. |
| `getDetections({ limit=50 })` | Newest first. |
| `getCommands({ limit=50 })` | NL-command audit log, newest first. For `GET /api/commands`. |
| `getTimeSeries({ bucketMs=60000, since, until })` | Picks bucketed into fixed time windows for charts - `{ bucket_ms, series:[{t,picks,successes,kg,apple,banana}] }`, oldest bucket first. For `GET /api/timeseries`. |
| `getSessions({ gapMs=120000 })` | Harvest runs inferred from pick gaps (≥`gapMs` starts a new run) - `[{start_ts,end_ts,duration_ms,picks,successes,success_rate,waste_avoided_kg,co2e_avoided_kg}]`, newest run first. For `GET /api/sessions`. |
| `getLatestTelemetry()` | Newest stored telemetry doc (or `null`) - status-header snapshot / late-joiner hydration. For `GET /api/telemetry/latest`. |
| `getActivity({ since })` | Time-in-state, e-stop count, battery curve from the telemetry window - `{total_ms,state_durations,active_pct,estop_count,battery:{now,min,max,series}}`. For `GET /api/activity`. |
| `close()` | On shutdown. |

**the hub:** the new read methods are each a one-line route (`return await
db.getX(req.query)`) - `GET /api/timeseries`, `/api/sessions`, `/api/activity`,
`/api/commands`, `/api/telemetry/latest`. The one **write** hookup is
`db.recordCommand({text, action, accepted, source})` on the `nl_command` path
(after the NL client validates). All `getStats` changes are **additive** (`window`,
`throughput`, `detections.avg_conf`) - safe to ignore if unused; nothing existing
changed shape.

## `getStats()` shape (contract for `GET /api/stats`)

```jsonc
{
  "backend": "memory",
  "totals": { "picks": 4, "successes": 3, "failures": 1, "success_rate": 0.75 },
  "by_fruit": { "apple": { "picks": 2, "successes": 2 }, "banana": { "picks": 2, "successes": 1 } },
  "by_ripeness": { "ripe": 3, "unripe": 1 },
  "by_bin": { "apple_ripe": 1, "apple_unripe": 1, "banana_ripe": 2 },
  "avg_pick_duration_ms": 9000,
  "detections": { "total": 2, "by_class": { "apple_ripe": 1, "banana_unripe": 1 }, "avg_conf": 0.87 },
  "waste_avoided_kg": 0.48,      // successful picks × per-fruit kg (impact.js)
  "co2e_avoided_kg": 1.2,        // waste_avoided_kg × 2.5 kgCO2e/kg
  "window": { "first_ts": 1752806400000, "last_ts": 1752806400003, "span_ms": 3 },
  "throughput": { "picks_per_hour": 45.2, "kg_per_hour": 7.1 }   // over `window` span
}
```

Impact-model assumptions live in `impact.js` and `docs/DATA.md`.

## Verify

```sh
cd web/server/db && npm install && npm run selftest
```

Runs the in-memory backend always; also runs Mongo when `MONGODB_URI` is set
(uses a throwaway `ht6_selftest_*` database - drop them from Atlas UI if they
bother you).
