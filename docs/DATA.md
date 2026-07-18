# Data layer — collections, schemas, impact model

Owner: worker `db`. Implementation: `web/server/db/` (see its README for the
code interface). Storage: **MongoDB Atlas** when `MONGODB_URI` is set, else an
in-memory fallback with the identical interface — the stack never blocks on the
database. Database name: `ht6`.

Documents are the root `CLAUDE.md` Socket.IO payloads stored verbatim, plus a
server-stamped `ts` (epoch **milliseconds**) when the robot sends none/zero.
`_id` is never returned by read APIs.

## The model at a glance

**Write path** (robot/hub → db): 4 collections. **Read path** (db → REST → web):
9 query shapes derived from them. Everything additive; the root schemas never
drift.

| Stored collection | Grows | Backs |
|---|---|---|
| `pick_events` | unbounded (analytics gold) | stats, timeseries, sessions, picks log |
| `detections` | capped 2000 (mem) | detection list, `stats.detections` |
| `telemetry` | capped ~5000 / ~80 min | latest snapshot, activity |
| `commands` | capped 500 (mem) | command audit log |

| Read shape | Endpoint | For |
|---|---|---|
| `getStats()` | `/api/stats` | headline counts + impact + throughput |
| `getPicks()` | `/api/picks` | pick log |
| `getDetections()` | `/api/detections` | detection feed |
| `getTimeSeries()` | `/api/timeseries` | Analytics charts over time |
| `getSessions()` | `/api/sessions` | harvest-run cards (→ Base44 HarvestJob) |
| `getActivity()` | `/api/activity` | time-in-state, e-stops, battery curve |
| `getLatestTelemetry()` | `/api/telemetry/latest` | status header / hydration |
| `getCommands()` | `/api/commands` | FarmHand NL-command history |

## Collections

### `pick_events` — one doc per pick attempt (the analytics gold; never dropped)

```jsonc
{
  "ts": 1752806400123,
  "fruit": "apple",          // "apple" | "banana"
  "ripeness": "ripe",        // "ripe" | "unripe"
  "bin": "apple_ripe",       // apple_ripe | apple_unripe | banana_ripe | banana_unripe
  "success": true,
  "duration_ms": 8000,
  "image_url": "/media/pick_1752806400123.jpg"   // OPTIONAL — see "Pick photos" below
}
```

Indexes: `{ts:-1}`, `{fruit:1, ripeness:1}`, `{bin:1}`.

**Pick photos (`image_url`).** The robot snaps a photo at each pickup. We do
**not** store image bytes in Atlas (M0 is 512 MB — it would fill and fail
mid-demo). Instead: the hub saves the JPEG to a file and the pick_event carries a
short **reference** string. The db stores pick docs **verbatim**, so `image_url`
needs **zero db-layer changes** — it round-trips through `recordPickEvent` /
`getPicks` as-is (there's a selftest asserting exactly this). Agreed convention:

| Piece | Owner | What |
|---|---|---|
| capture + write file `web/server/media/pick_<ts>.jpg` | fw-linux (robot) → server-core (save) | hub writes the frame to disk on pick |
| set `image_url: "/media/pick_<ts>.jpg"` on the emitted `pick_event` | fw-linux / server-core | reference only, never bytes |
| serve `GET /media/*` (Express static) | server-core | so the browser can load it |
| render the thumbnail next to each pick | web-frontend | pick log + `/api/picks` already returns `image_url` |

`image_url` is an **optional** extension to the root `CLAUDE.md` pick_event
schema — absent on picks with no photo; readers must treat it as nullable.

### `detections` — vision model outputs (sampled stream)

```jsonc
{
  "ts": 1752806400123,
  "fruit": "banana",
  "ripeness": "unripe",
  "conf": 0.93,
  "bbox": [212, 118, 96, 64]   // x, y, w, h in camera pixels
}
```

Indexes: `{ts:-1}`, `{fruit:1, ripeness:1}`. Memory mode caps at 2000 docs.

### `telemetry` — robot heartbeat (downsampled + capped)

```jsonc
{
  "ts": 1752806400123,
  "battery_v": 11.1,
  "state": "SEEK",             // IDLE | SEEK | PICK | SORT | ESTOP
  "arm": [90, 45, 120, 90, 30],
  "drive": { "l": 0.4, "r": 0.4 }
}
```

Robot emits 5 Hz; the db layer persists **≤1 Hz** and the collection is
**capped** (5 MB / 5000 docs ≈ last ~80 min) — live UI reads the socket, the DB
only backs charts, so bounded history is fine and Atlas M0's 512 MB stays safe.

### `commands` — NL-command audit log (Freesolo LLM track)

Every `nl_command` that reaches the hub, plus the structured action the FarmHand
LLM parsed it into and whether it was accepted. This is the visible "what did
people ask the robot, and what did it do" trail for the LLM-track demo.

```jsonc
{
  "ts": 1752806400123,
  "text": "pick all the ripe apples",     // raw NL input
  "action": { "task": "pick", "fruit": "apple", "filter": "ripe" },  // parsed (null if rejected)
  "accepted": true,                          // passed JSON-schema validation?
  "source": "web"                            // optional: web | voice | test
}
```

Index: `{ts:-1}`. Memory mode caps at 500 docs. **server-core:** call
`db.recordCommand({...})` on the `nl_command` path (after llm-client validates).

## `GET /api/stats` response (from `db.getStats()`)

```jsonc
{
  "backend": "mongo",
  "totals": { "picks": 42, "successes": 38, "failures": 4, "success_rate": 0.9 },
  "by_fruit": { "apple": { "picks": 25, "successes": 24 }, "banana": { "picks": 17, "successes": 14 } },
  "by_ripeness": { "ripe": 30, "unripe": 12 },
  "by_bin": { "apple_ripe": 20, "apple_unripe": 5, "banana_ripe": 10, "banana_unripe": 4 },
  "avg_pick_duration_ms": 8400,
  "detections": { "total": 913, "by_class": { "apple_ripe": 500, "banana_unripe": 413 }, "avg_conf": 0.9 },
  "waste_avoided_kg": 6.0,
  "co2e_avoided_kg": 15.0,
  "window": { "first_ts": 1752806400000, "last_ts": 1752809900000, "span_ms": 3500000 },
  "throughput": { "picks_per_hour": 43.2, "kg_per_hour": 6.2 }
}
```

Computed by a single `$facet` aggregation on `pick_events` + one `$group` on
`detections` (see `web/server/db/mongo.js`). `window` is the min/max pick `ts`;
`throughput` is picks (and kg) over that span — the "sorts N fruit / X kg per
hour" figure for the env/Deloitte pitch (0 for a zero-length span).

## `GET /api/timeseries` response (from `db.getTimeSeries({ bucketMs, since, until })`)

Picks bucketed into fixed windows (default 60 s) for the Analytics charts —
volume, success rate, and cumulative yield over time. Oldest bucket first; `t`
is the bucket's start epoch-ms.

```jsonc
{
  "bucket_ms": 60000,
  "series": [
    { "t": 1752806400000, "picks": 5, "successes": 4, "kg": 0.78, "apple": 3, "banana": 2 },
    { "t": 1752806460000, "picks": 3, "successes": 3, "kg": 0.54, "apple": 1, "banana": 2 }
  ]
}
```

`kg` = successful-pick mass in the bucket (same per-fruit constants as the impact
model). The UI cumulates client-side for the "yield climbing" / ROI animation.

## `GET /api/sessions` response (from `db.getSessions({ gapMs })`)

**Harvest runs**, inferred — a gap ≥ `gapMs` (default 120 s) between consecutive
picks starts a new run. This is a *derived* view, **not a stored collection**:
no run boundaries are written anywhere, so there's nothing to coordinate with
fw-linux/server-core and it stays correct even as picks stream in. Maps to a
Base44 "HarvestJob" and powers the "this run: N picks in M min, K kg" demo card.
Newest run first.

```jsonc
[
  {
    "start_ts": 1752806400000, "end_ts": 1752806640000, "duration_ms": 240000,
    "picks": 12, "successes": 11, "success_rate": 0.92,
    "waste_avoided_kg": 1.98, "co2e_avoided_kg": 4.95
  }
]
```

## `GET /api/telemetry/latest` (from `db.getLatestTelemetry()`)

The single newest stored telemetry doc (or `null`) — a status-header snapshot
and late-joiner hydration value. **The live socket stream is authoritative;**
this is just the "on page load, before the first socket tick" fallback. Same
shape as a `telemetry` doc (no `_id`).

## `GET /api/activity` (from `db.getActivity({ since })`)

Robot activity reduced from the (bounded, capped) telemetry window — the
reliability / hardware-track story ("actively picking N% of the time, 0
e-stops"). Attributes each inter-sample interval to the state held at its start;
gaps > 5 s (disconnection) are not counted.

```jsonc
{
  "total_ms": 300000,
  "state_durations": { "IDLE": 60000, "SEEK": 120000, "PICK": 80000, "SORT": 40000, "ESTOP": 0 },
  "active_pct": 0.8,          // (SEEK+PICK+SORT) / total
  "estop_count": 0,           // transitions INTO ESTOP
  "battery": {
    "now": 11.0, "min": 10.8, "max": 12.1,
    "series": [ { "t": 1752806400000, "v": 12.1 } ]   // downsampled ≤120 pts for a battery chart
  }
}
```

## `GET /api/commands` (from `db.getCommands({ limit })`)

The `commands` audit log, newest first (see the collection schema above). For a
"command history" panel in the FarmHand/LLM demo.

## Impact model (env-track / Deloitte numbers — cite these in the pitch)

Constants in `web/server/db/impact.js`:

- Mass per successfully picked+sorted fruit: **apple 0.18 kg, banana 0.12 kg**
  (USDA medium-fruit averages, rounded).
- `waste_avoided_kg` = Σ successful picks × per-fruit mass. Claim: fruit graded
  at the point of harvest instead of joining the 30–40% post-harvest loss gap.
- `co2e_avoided_kg` = `waste_avoided_kg × 2.5` kg CO₂e/kg — conservative end of
  FAO food-wastage-footprint estimates (2–4). Say "conservative" on stage.

## Atlas setup (task 3 — ✅ LIVE)

Atlas project **`hack-the-6ix`**, free M0 cluster **`ht6`** (AWS US_EAST_1),
DB user `ht6app` (`readWriteAnyDatabase`), network access `0.0.0.0/0`
(hackathon). The connection URI lives in `web/server/.env` (gitignored —
**never** in tracked files; `web/server/.env.example` shows the shape). Database
name `ht6`; selftests use a throwaway `ht6_selftest` db and clean up after via
`deleteMany` (the app user can't `dropDatabase`, and never needs to).
