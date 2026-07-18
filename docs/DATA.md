# Data layer — collections, schemas, impact model

Owner: worker `db`. Implementation: `web/server/db/` (see its README for the
code interface). Storage: **MongoDB Atlas** when `MONGODB_URI` is set, else an
in-memory fallback with the identical interface — the stack never blocks on the
database. Database name: `ht6`.

Documents are the root `CLAUDE.md` Socket.IO payloads stored verbatim, plus a
server-stamped `ts` (epoch **milliseconds**) when the robot sends none/zero.
`_id` is never returned by read APIs.

## Collections

### `pick_events` — one doc per pick attempt (the analytics gold; never dropped)

```jsonc
{
  "ts": 1752806400123,
  "fruit": "apple",          // "apple" | "banana"
  "ripeness": "ripe",        // "ripe" | "unripe"
  "bin": "apple_ripe",       // apple_ripe | apple_unripe | banana_ripe | banana_unripe
  "success": true,
  "duration_ms": 8000
}
```

Indexes: `{ts:-1}`, `{fruit:1, ripeness:1}`, `{bin:1}`.

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

## `GET /api/stats` response (from `db.getStats()`)

```jsonc
{
  "backend": "mongo",
  "totals": { "picks": 42, "successes": 38, "failures": 4, "success_rate": 0.9 },
  "by_fruit": { "apple": { "picks": 25, "successes": 24 }, "banana": { "picks": 17, "successes": 14 } },
  "by_ripeness": { "ripe": 30, "unripe": 12 },
  "by_bin": { "apple_ripe": 20, "apple_unripe": 5, "banana_ripe": 10, "banana_unripe": 4 },
  "avg_pick_duration_ms": 8400,
  "detections": { "total": 913, "by_class": { "apple_ripe": 500, "banana_unripe": 413 } },
  "waste_avoided_kg": 6.0,
  "co2e_avoided_kg": 15.0
}
```

Computed by a single `$facet` aggregation on `pick_events` + one `$group` on
`detections` (see `web/server/db/mongo.js`).

## Impact model (env-track / Deloitte numbers — cite these in the pitch)

Constants in `web/server/db/impact.js`:

- Mass per successfully picked+sorted fruit: **apple 0.18 kg, banana 0.12 kg**
  (USDA medium-fruit averages, rounded).
- `waste_avoided_kg` = Σ successful picks × per-fruit mass. Claim: fruit graded
  at the point of harvest instead of joining the 30–40% post-harvest loss gap.
- `co2e_avoided_kg` = `waste_avoided_kg × 2.5` kg CO₂e/kg — conservative end of
  FAO food-wastage-footprint estimates (2–4). Say "conservative" on stage.

## Atlas setup (task 3 — currently BLOCKED on `atlas auth login` in pane db.1)

Once logged in: free M0 cluster `ht6`, one DB user, network access `0.0.0.0/0`
(hackathon), URI goes into `web/server/.env` (gitignored — **never** in tracked
files; `web/server/.env.example` shows the shape).
