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

## [22:08] DONE — task 1: `web/server/db/` module built + tested against BOTH backends
`createDb()` factory in `web/server/db/index.js`; in-memory backend (`memory.js`), Mongo backend (`mongo.js`: connection, indexes on pick_events {ts}/{fruit,ripeness}/{bin} + detections, capped `telemetry` collection, `$facet` aggregation pipeline for stats), shared impact model (`impact.js`: waste_avoided_kg + co2e_avoided_kg for the Deloitte/env story). Telemetry auto-downsampled to 1 Hz on write.
Verify: `cd web/server/db && npm install && npm run selftest` → memory backend always; I also ran it against a throwaway local `mongod` (homebrew mongodb-community is installed on this laptop!) — **both backends pass**, so the mongo path is proven without Atlas.
**server-core**: interface contract + `/api/stats` response shape are in `web/server/db/README.md` — `import { createDb } from './db/index.js'`, deps are vendored in `db/node_modules`, works from ESM or CJS. `getStats()` is your whole `/api/stats` handler; `getPicks()` is `/api/picks`.
Next: docs/DATA.md.

## [22:10] DONE — task 2: docs/DATA.md written
Collection schemas + example docs for `pick_events` / `detections` / `telemetry` (capped, ≤1 Hz), the exact `GET /api/stats` response shape, and the impact-model assumptions (0.18 kg/apple, 0.12 kg/banana, 2.5 kgCO2e/kg waste — pitch-ready numbers for env/Deloitte tracks). Also wrote `web/server/.env.example` (MONGODB_URI/MONGODB_DB placeholders + PORT/ROBOT_STREAM_URL for server-core). Root .gitignore already covers `.env` and `node_modules/` at all depths — no changes needed.

## [22:10] BLOCKED — task 3: Atlas cluster needs human login
`atlas auth whoami` → "not logged in". **Master: please have the human run `atlas auth login` in pane db.1** (browser OAuth flow). The moment that's done I will: create free M0 cluster `ht6`, create DB user, open network access 0.0.0.0/0, put the URI in `web/server/.env` (untracked) and post "URI ready" here.
NOT idle meanwhile — task 4 (works-without-Atlas) is already satisfied: selftest passed on the in-memory backend AND against a real local mongod (mongodb-community via homebrew), so the Mongo code path is fully proven. Will poll Atlas login state between other checks.

## [22:11] DONE — task 4 confirmed + bonus: `local-mongo.sh` venue fallback
Task 4 (works without Atlas) verified three ways: in-memory fallback (selftest), throwaway local mongod (selftest), and graceful fallback-to-memory when the URI is unreachable. Bonus: `web/server/db/local-mongo.sh start|stop` runs a local mongod on port 27777 as the venue-WiFi fallback for Atlas (note: `mongod --fork` is broken on macOS builds — script uses nohup; anyone else scripting mongod, beware). Tested full start→selftest→stop cycle: passes.
**Summary: tasks 1, 2, 4 DONE; task 3 BLOCKED awaiting human `atlas auth login` in pane db.1** (re-checked 22:10, still logged out). When unblocked I'll create the M0 cluster `ht6` + user + network access and drop the URI into `web/server/.env`. server-core: db layer is ready for you now — see `web/server/db/README.md`.

## [22:27] RESTART after crash — re-verified tasks 1/2/4 + FIXED a real selftest bug
Recovered post-crash. Nothing long-running to restart (db module is a library, no process). Re-verified all claimed-done work:
- **memory backend**: `npm run selftest` passes (default no-env path).
- **mongo backend**: re-tested against a throwaway local `mongod` (via `local-mongo.sh` on :27777) — passes, and now **idempotent across reruns** (was breaking on the 2nd run).
- **docs/DATA.md + web/server/.env.example**: present and correct; `.env.example` already documents the Base44 vars (`BASE44_WEBHOOK_URL/SECRET/JOB_ID/TIMEOUT_MS`) and matches server-core's `base44.js` names exactly — in sync, no change needed.
- **server-core**: came online during/after the crash; adopted `createDb()` as-is via `web/server/store.js` using the SAFE `createDb({ uri: process.env.MONGODB_URI })` pattern → unaffected by the bug below. Nothing needed from me.

**Bug found + fixed (was masking as a crash-recovery failure):** `selftest.js`'s "memory backend" case called `createDb({ uri: undefined })`. JS destructuring defaults fire on `undefined`, so `uri` fell back to `process.env.MONGODB_URI` — meaning when an env URI was set (my local-mongo test), the *supposedly-memory* run silently connected to Mongo and wrote 4 pick_events into the **default `ht6` db**, which was never dropped → counts accumulated 4→8→12 across reruns (`8 !== 4`). A single run passed (why it slipped through originally); reruns failed. Fix: the memory case now clears `MONGODB_URI` for that call + asserts `backend === 'memory'`, and the mongo case drops its DB first so exact-count asserts are rerun-safe. Cleaned the polluted `ht6` db in the ephemeral local mongod; stopped that mongod. **The db module itself was never buggy** — the footgun only bites callers who pass an explicit `uri: undefined` while the env var is set; server-core doesn't, so no fleet impact.

**Task 3 still BLOCKED**: `atlas auth whoami` → still "not logged in" (re-checked 22:27). Need human to run `atlas auth login` in pane db.1. On unblock: create M0 cluster `ht6` + DB user + network access 0.0.0.0/0, write URI into `web/server/.env` (untracked), post "URI ready" here. Everything works on memory/local-mongo meanwhile.

## [22:50] WIP — task 3 UNBLOCKED (human logged in); Atlas cluster provisioning
Human ran `atlas auth login` (logged in as danielliuyes@gmail.com). Existing "Project 0" already had a free M0 (`SMS-HOSA-FREE`) from another project — free tier = 1 M0/project — so per human's choice I created a **dedicated new project** `hack-the-6ix` (id `6a5ae9ca...`) with its own free M0 to keep our data isolated. Done so far:
- Project `hack-the-6ix`, cluster **`ht6`** (M0, AWS US_EAST_1) — **provisioning now (~7-10 min)**.
- DB user `ht6app` (readWriteAnyDatabase), network access `0.0.0.0/0` — both created.
- **`web/server/.env` written** (untracked, gitignore-confirmed) with `MONGODB_URI=mongodb+srv://ht6app:***@ht6.zyaj8ax.mongodb.net/...` + `MONGODB_DB=ht6`, plus PORT/ROBOT_STREAM_URL and empty Base44 placeholders.
Polling cluster state → IDLE in background. On IDLE I'll run `MONGODB_URI=… npm run selftest` against real Atlas to prove the mongo path end-to-end, then post "URI READY".
**@server-core**: `web/server/.env` now has a real Atlas `MONGODB_URI`. To switch off the memory fallback, ensure your process loads `.env` (dotenv) and **restart the hub** — `store.js` will then report `backend: mongo`. Verify via `GET /api/health`.

## [22:53] DONE — task 3 COMPLETE: Atlas `ht6` cluster LIVE + verified end-to-end. **URI READY.**
Cluster `ht6` reached IDLE. Verified the mongo path against **real Atlas** twice (idempotent) via `MONGODB_URI=… MONGODB_DB=ht6_selftest npm run selftest` → `✓ mongo backend passed` both runs; cleaned up the throwaway test collections after (deleteMany).
- **Provisioned**: project `hack-the-6ix`, free M0 `ht6` (AWS US_EAST_1, MDB 8.0.27), user `ht6app` (readWriteAnyDatabase), network `0.0.0.0/0`. Connection host `ht6.zyaj8ax.mongodb.net`.
- **`web/server/.env`** (untracked) holds the full `MONGODB_URI` + `MONGODB_DB=ht6`. App db = `ht6` (selftests use a separate `ht6_selftest` db so they never touch app data).
- **Second selftest fix**: the rerun-safety cleanup used `dropDatabase`, which our least-privilege `ht6app` user can't do on Atlas (needs dbAdmin) — switched it to `deleteMany` on pick_events+detections (a readWrite privilege, and telemetry is capped so it's excluded). Selftest now passes on both a local mongod AND real Atlas with the exact role the app uses. The app never drops, so `readWriteAnyDatabase` is the correct production role — no elevation needed.

**@server-core — ACTION: restart the hub.** Confirmed it currently reports `backend: memory` (started before `.env` existed; `/api/stats` shows the 108 sim picks in memory). Your `index.js` already `process.loadEnvFile('./.env')`s, so a plain restart of `node index.js` flips `store.js` to `backend: mongo`. Verify: `GET /api/stats` → `"backend":"mongo"`. Nothing else needed from db; Atlas is live and open.
