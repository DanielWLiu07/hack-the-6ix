# ht6-server — telemetry hub

Express + Socket.IO hub relaying robot ↔ browser events per the root `CLAUDE.md` schemas.
Runs on the laptop at the venue (NOT Vercel). Own npm package — install/run from this dir.

## Run

```sh
npm install
npm start        # hub on :3001
npm run sim      # fake robot (separate terminal) — unblocks all frontend work
```

## Env vars (all optional; put in `web/server/.env`, auto-loaded)

| var | default | meaning |
|---|---|---|
| `PORT` | 3001 | hub port |
| `MONGODB_URI` | — | if set, persist to Atlas; else in-memory |
| `MONGODB_DB` | `ht6` | database name |
| `ROBOT_STREAM_URL` | — | vision-infer's MJPEG URL (e.g. `http://<uno-q>:8080/`); else `/stream` serves a test pattern |
| `BASE44_WEBHOOK_URL` | — | if set, POST every `pick_event` to Base44 Orchard OS (docs/BASE44.md); unset = forwarding off |
| `BASE44_SECRET` | — | shared secret sent as `X-Base44-Secret` header on each forward |
| `BASE44_JOB_ID` | — | optional HarvestJob id tagged onto every forwarded PickReport |
| `BASE44_TIMEOUT_MS` | 4000 | per-forward request timeout |
| `WASTE_KG_PER_PICK` | 0.15 | kg waste avoided per successful pick (stats) |
| `SERVER_URL` | `http://localhost:3001` | sim.js only: hub to connect to |
| `SIM_LIDAR` | on | sim.js only: `0` disables sim lidar frames |

## Socket.IO roles

Connect with `io(url, { auth: { role: 'robot' | 'ui' | 'agent' } })` (default `ui`),
or connect plain and emit `register {"role":"robot"|"farmhand"}` (`farmhand` ≡ `agent`).

- **robot** → hub → all uis: `telemetry` `detection` `pick_event` `lidar_scan`.
  Payloads are schema-validated (see `schemas.js`); invalid ones are dropped silently.
- **ui/agent** → hub → all robots: `drive` (clamped to [-1,1]) `arm_pose` `pick` `estop` `nl_command`.
- `nl_command` from a ui additionally goes to all **agent** clients.
- **agent** replies `nl_action {ts, text, ok, action|clarification|error}` (llm-client's
  contract). Hub echoes `nl_action` to uis; when `ok && action` it also forwards
  `nl_action` to robots and maps basics: `task:"stop"` → `estop`, `task:"pick"|"sort"` →
  `pick {target: fruit|'nearest'}`.
- Late-joining uis immediately receive the last known `telemetry`.

## HTTP

- `GET /api/health` — `{ ok, uptime_s, clients: {robot,ui,agent}, robot_connected, base44_forwarding }`
- `GET /api/stats` — shape defined in `db/README.md` (authoritative): `{ backend, totals,
  by_fruit, by_ripeness, by_bin, avg_pick_duration_ms, detections, waste_avoided_kg,
  co2e_avoided_kg }`
- `GET /api/picks?limit=100&fruit=&ripeness=&since=` — newest-first pick_event docs
- `GET /api/detections?limit=50` — newest-first detection docs
- `GET /stream` — MJPEG (robot proxy if `ROBOT_STREAM_URL` set, else test pattern) — use in an `<img src>`

## Base44 Orchard OS forwarding (`base44.js`)

When `BASE44_WEBHOOK_URL` is set, every valid `pick_event` is POSTed to the Base44
app's webhook as `{ job_id?, fruit, ripeness, bin, success, ts }` with an
`X-Base44-Secret` header (docs/BASE44.md → Integration). Fire-and-forget: it never
blocks event relay and never throws into the hub; failures are rate-limited-logged.
Unset the URL to disable entirely (default). Check state via `/api/health`
(`base44_forwarding`) or the startup log line.

## Persistence

`store.js#createStore()` uses the db worker's module (`web/server/db/`, see its README —
Mongo/Atlas when `MONGODB_URI` is set, in-memory otherwise, self-downsampling telemetry).
If that module ever fails to load, a built-in memory store with the identical interface
keeps the stack booting.
