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

## [23:00] DONE — data-model expansion: time-series + throughput + harvest sessions
Deepened the data layer beyond flat totals to power the Analytics page + demo narrative. All **additive** (existing `getStats` fields/semantics unchanged) and verified on **both backends** (memory + real Atlas) via expanded selftest — single-window AND spaced multi-bucket/multi-session cases pass.
- **`getStats` +2 fields** (additive): `window {first_ts,last_ts,span_ms}` and `throughput {picks_per_hour,kg_per_hour}` over that span — the "sorts N fruit / X kg per hour" env/Deloitte number.
- **`getTimeSeries({bucketMs=60000,since,until})`** → `{bucket_ms, series:[{t,picks,successes,kg,apple,banana}]}`, oldest bucket first. Mongo does it in-DB (`$mod` bucketing + `$switch` kg); memory buckets in JS. For the Analytics charts (volume/success-rate/cumulative-yield → ROI animation).
- **`getSessions({gapMs=120000})`** → harvest runs inferred from pick-gaps (≥gap = new run): `[{start_ts,end_ts,duration_ms,picks,successes,success_rate,waste_avoided_kg,co2e_avoided_kg}]`, newest first. **Derived, not a stored collection** → zero coordination with fw-linux/server-core, maps cleanly to a Base44 HarvestJob + the "this run: N picks in M min, K kg" card.
- Shared impact math centralized in `impact.js` (`pickKg`, `throughput`) so stats/timeseries/sessions never disagree. Docs updated: `docs/DATA.md` + `web/server/db/README.md`.

**@server-core**: two new methods on the same `createDb()` object — wiring `GET /api/timeseries` and `GET /api/sessions` is one line each (`return await db.getTimeSeries(req.query)` / `getSessions`). Contract shapes in README/DATA.md.
**@web-frontend**: Analytics page (task 4) now has real chart fuel — `/api/timeseries` for time-bucketed charts, `/api/sessions` for a harvest-runs list, and `stats.throughput`/`stats.window` for headline rate numbers. Shapes in `docs/DATA.md`.

## [23:06] DONE — phase-4 item: docs/IMPACT.md (defensible waste-avoided/ROI methodology)
Wrote `docs/IMPACT.md` — the judge-facing "where does that number come from?" doc for every kg-waste-avoided / CO₂e / kg-per-hour / ROI figure. Web-verified the headline stats against primary sources rather than writing from memory:
- **Waste-avoided**: measured successful-pick mass × USDA fruit masses (apple 0.18 / banana 0.12 kg) — matches `impact.js` exactly (cross-checked constants).
- **CO₂e 2.5 kg/kg**: FAO 2013 Food Wastage Footprint (3.3 Gt ÷ 1.3 Gt ≈ 2.54) — flagged as a conservative *blended* proxy (fruit-specific is lower; we say so).
- **Context stats**: FAO 2011 (~1/3, 1.3 Gt lost; fruit&veg ~45%), FAO SOFA 2019 (~13% post-harvest pre-retail) — framed as problem-size context, NOT as our yield.
- **ROI**: transparent formula (harvested value + labour saved ÷ robot cost); prices anchored to BLS/FRED bananas (~$0.62/lb→$1.40/kg, near-exact) + USDA ERS apples (our $2.10/kg is deliberately below the $2.90–3.75/kg retail range). Matches BASE44.md's widget inputs.
- **Green AI**: 5W on-device UNO Q inference — leads with the *structural* claims (no cloud/data-centre, battery-operable off-grid) not an inflated per-inference kWh.
- **§7 "what we do NOT claim"** defensibility checklist + full **§8 sources** list (FAO, USDA, BLS/FRED, Green AI/CACM) with URLs. Under-claims on purpose so numbers survive judge Q&A.
Cross-referenced with `impact.js` / `docs/DATA.md` / `docs/BASE44.md` and noted all four must stay in sync. **@llm-client @vision-infer**: pull the Deloitte/env numbers for docs/DEVPOST.md straight from IMPACT.md §1–4 + §8 so the pitch and the doc cite identically.

## [23:22] LIVE + DONE — Atlas confirmed open; full data-model design pass (4 collections, 9 read shapes)
**Atlas is live and open**: cluster `ht6` IDLE, `0.0.0.0/0` open, real connection through `createDb` returns `backend: mongo`. server-core **has restarted** — hub `/api/stats` now reports `backend: mongo` with real picks (not memory). No further action on the Atlas front.

Per "think of all the data shapes and design it" — completed a full model design + implementation. `docs/DATA.md` now opens with a **model-at-a-glance** map (4 stored collections → 9 derived read shapes). New this pass, all **additive** + verified on **both backends** (memory + real Atlas, canonical unique-db selftest passed 3/3):
- **`commands` collection** (+`recordCommand`/`getCommands`) — NL-command → parsed-action audit log for the Freesolo LLM track (capped 500 mem, `{ts:-1}` index).
- **`getLatestTelemetry()`** — status-header snapshot / late-joiner hydration.
- **`getActivity({since})`** — time-in-state, e-stop count, battery curve from the telemetry window (reliability / hardware-track story). Shared `activity.js` helper so both backends are byte-identical.
- **`getStats().detections.avg_conf`** — mean detection confidence (vision-quality headline).
- Selftest expanded to cover all of the above; found+fixed a rerun-fragility (capped `telemetry` can't be `deleteMany`'d — scoped activity assertions with `since`, cleared `commands` at start). Purged all throwaway `ht6_selftest*` dbs from Atlas after.

**@server-core** — new wiring available (each a 1-liner): `GET /api/timeseries`, `/api/sessions`, `/api/activity`, `/api/commands`, `/api/telemetry/latest`, plus `db.recordCommand({text,action,accepted,source})` on the `nl_command` path. Note: `/api/timeseries` + `/api/sessions` still 404 on the running hub — not wired yet. All shapes in `web/server/db/README.md` + `docs/DATA.md`.
**@web-frontend** — Analytics/robot-status now fully spec'd: charts (`/api/timeseries`), harvest-run cards (`/api/sessions`), battery+state activity panel (`/api/activity`), command history (`/api/commands`), status header (`/api/telemetry/latest`). Shapes in `docs/DATA.md` "model at a glance".

## [23:27] DONE + COORDINATION — pick-photo (`image_url`) convention. DB confirmed live (backend: mongo, 125 picks).
Human wants a **photo per pickup**. Decision (human-approved): **local file on the hub**, pick_event stores only a reference — NOT image bytes in Atlas (M0 512 MB would fill and fail mid-demo). The db layer stores pick docs **verbatim**, so `image_url` needs **zero db-layer changes**; added a selftest asserting it round-trips through `recordPickEvent`/`getPicks` on both backends (passes). Documented the full convention + owner split in `docs/DATA.md` ("Pick photos").

**@master — schema note (not a blocker):** this adds an **optional** `image_url` field to the root-`CLAUDE.md` `pick_event` schema. Additive/nullable, back-compatible (absent = no photo), db already supports it. Flagging so it's not a unilateral schema change — OK to canonicalize?
**Owner split for the photo path (db is done; these are the remaining pieces):**
- **@fw-linux / @server-core**: on each pick, write the frame to `web/server/media/pick_<ts>.jpg` and set `image_url: "/media/pick_<ts>.jpg"` on the emitted `pick_event`.
- **@server-core**: serve `GET /media/*` (Express static).
- **@web-frontend**: render the thumbnail in the pick log (`/api/picks` already returns `image_url`).
