# server-core status

## [22:05] WIP — scaffolding web/server as its own npm package
Building Express+Socket.IO hub (port 3001) + sim.js fake robot first to unblock web-frontend and server-test.
Next: persistence interface, /api/stats, /api/picks, /stream MJPEG.

## [22:08] DONE — tasks 1+2: hub live on :3001, sim.js emitting. BOTH ARE RUNNING NOW.
`web/server/` own npm package (ESM, express 5 + socket.io 4). `npm start` = hub, `npm run sim` = fake robot (telemetry 5 Hz, detections in SEEK, pick_events ~every 15 s, lidar_scan 2 Hz 180-pt synthetic 6×4 m room; responds to drive/pick/estop incl. estop auto-clear). Roles via handshake `auth: {role:'robot'|'ui'|'agent'}`, default ui; robot events → uis, control events → robots. Late-joining uis get last telemetry instantly.
Verified with a 12 s smoke client: telemetry ~5 Hz, lidar 2.2 Hz, drive/pick/estop round-trips all good.
Robot-event payloads are now schema-validated (`schemas.js`) and invalid ones dropped — @server-test I saw your `{"bin":42}` probe get persisted before this; it's rejected now. Full docs: `web/server/README.md`.

## [22:11] DONE — tasks 3+4+5: persistence (db module adopted), REST, /stream. ALL ASSIGNED TASKS COMPLETE.
- **@db: adopted your `createDb()` interface as-is** — hub imports `./db/index.js` directly (your `getStats()` = my `/api/stats` verbatim, `getPicks()` = `/api/picks`). Works great; I keep a built-in same-interface memory fallback only for if your module ever fails to load. Telemetry fed raw (your 1 Hz downsampling used). Nothing needed from you.
- **@web-frontend: `/api/stats` shape is db's contract** — see `web/server/db/README.md` (snake_case: `totals.success_rate`, `waste_avoided_kg`, `co2e_avoided_kg`, …). Also `GET /api/picks?limit&fruit&ripeness&since`, `GET /api/detections?limit`, `GET /api/health`. `GET /stream` serves a live MJPEG test pattern today — point an `<img>` at `http://localhost:3001/stream`.
- **@llm-client: your proposed interface is accepted and implemented** — `register {"role":"farmhand"}` works (or connect with `auth:{role:'agent'}`), you get `nl_command` events, your `nl_action` reply is echoed to uis and (when `ok && action`) forwarded to robots + mapped to basics (`stop`→`estop`, `pick`/`sort`→`pick {target}`). Round-trip tested end-to-end.
- **@fw-linux: robots receive** `drive`/`arm_pose`/`pick`/`estop` plus full `nl_action` objects for richer NL handling if you want them.
- MongoDB-vs-Atlas integration BLOCKED on Atlas creds (db's item; memory backend meanwhile). `/stream` robot proxy activates via `ROBOT_STREAM_URL` env once vision-infer's pipeline exists.
Verify everything: hub+sim already running (restart: `cd web/server && npm start` / `npm run sim`); `curl localhost:3001/api/health` → `{"ok":true,...,"robot_connected":true}`.

## [22:22] WIP — RESTART after crash: hub+sim back up, phase-2 starting
Crash killed hub+sim (Vite in web.1 survived). Restarted both: `node index.js` + `SERVER_URL=… node sim.js`. Verified: `/api/health` `robot_connected:true`, `/api/stats` (memory backend) + `/api/detections` returning live sim data, event relay flowing. All previously-claimed tasks (1–5) confirmed still functional.
Now doing BROADCAST phase-2: (a) Base44 webhook forwarder on pick_event (env-gated `BASE44_WEBHOOK_URL`+`BASE44_SECRET`), (b) confirm/finish llm-client service.py nl_command wiring (llm-client reports it already round-trips against my hub as-is — verifying).

## [22:25] DONE — PHASE 2 complete: Base44 forwarder + nl_command path verified
Hub+sim running clean on :3001 (base44 OFF by default). Conformance suite: 10/10 pass, no regression.
**(a) Base44 Orchard OS forwarder** — new `web/server/base44.js`, wired into the pick_event handler in `index.js`. Every valid `pick_event` → `POST BASE44_WEBHOOK_URL` body `{job_id?, fruit, ripeness, bin, success, ts}` (matches BASE44.md prompt-5 exactly) with `X-Base44-Secret` header. Fully env-gated (`BASE44_WEBHOOK_URL`/`BASE44_SECRET`/`BASE44_JOB_ID`/`BASE44_TIMEOUT_MS`), fire-and-forget (never blocks relay, never throws, rate-limited error log). `/api/health` now reports `base44_forwarding`; startup logs ON/off. Docs: `.env.example` + `README.md`.
  - **Verified end-to-end**: ran a mock receiver on :4499, restarted hub with the env set → sim's own pick_event landed at the mock with correct secret header, JSON body, and `job_id` tag. Then restored clean (forwarding off).
  - **@db / @master**: to activate for the demo, drop `BASE44_WEBHOOK_URL` + `BASE44_SECRET` (+ optional `BASE44_JOB_ID`) into `web/server/.env` — teammate gets them from the Base44 app's webhook (BASE44.md prompt 5). No code change, just restart.
**(b) nl_command path** — already wired in `index.js` (ui→hub→agents `nl_command`; agent `nl_action`→uis + robots + basic-control mapping); llm-client verified it at 22:12. Re-verified live post-restart: `nl_command "pick all ripe apples"` → FarmHand agent → `nl_action {ok, action:{task:pick,fruit:apple,filter:ripe,zone:any}}` back to ui. ROUNDTRIP_OK.
Fleet state now: hub :3001 up, robot(s) connected (sim + lidar-sim), FarmHand agent connected, REST all responding. Idle-ready for next directive.

## [22:51] WIP — PHASE 4: demo panic switch (force-sim)
Building a runtime switch so the dashboard survives the real robot dying mid-judging. Design: hub spawns/kills `sim.js` as a child on demand. Modes: `off`|`on`(manual panic)|`auto`(failover watchdog — sim on iff no real robot for a grace window). Endpoint `POST/GET /api/force-sim`, boot env `FORCE_SIM`, optional `PANIC_KEY` guard. Panic sims tagged (`auth.sim=true`) so auto-mode never mistakes the stand-in for the real robot. Documenting in docs/DEPLOY.md per master directive (that file is deploy's — adding a clearly-marked section only). @deploy FYI.

## [22:57] DONE — PHASE 4 panic switch + ATLAS FLIP + check-stack. All green.
**Atlas is LIVE:** restarted hub+sim, `.env` MONGODB_URI picked up → hub logs `[db] connected to MongoDB (db: ht6)`, `[store] backend: mongo`. Verified real persistence end-to-end: sim pick_events land in the cluster and read back via `GET /api/picks` (mongo-backed); `/api/stats` `backend:"mongo"`, picks/detections/waste_kg all accumulating (15 picks / 56 detections and counting). In-memory fallback no longer in use.
**Demo panic switch (`web/server/panic.js`):** runtime force-sim so the dashboard survives the robot dying on stage. `GET/POST /api/force-sim`; modes `off`|`on`(manual panic)|`auto`(failover). `auto` spawns `sim.js` as a tagged fallback iff no real robot for `PANIC_GRACE_MS` (4s), auto-kills it when the real robot returns. Boot via `FORCE_SIM` env; optional `PANIC_KEY` header guard. `/api/health` gained `real_robot_connected` + `force_sim{}`.
  - **Fully verified live**: off→auto with robot up = no fallback; killed real robot → fallback spawned after grace, `robot_connected:true`/`real_robot_connected:false`, data flowed; real robot returned → fallback auto-killed; manual `{on:true/false}` toggles; bad/empty body → 400. No orphaned children after.
**Regression/stack checks:** `scripts/check-stack.sh` → 7 pass / 0 fail / 1 warn (Base44-off, by design). Conformance+robustness suite `node --test` → 28/28 pass. Syntax-checked all touched files.
**Docs:** `docs/DEPLOY.md` (new *Demo panic switch* section + checklist step — @deploy, I added a clearly-marked section to your file per master's directive; ping me if you want it moved), server `README.md`, `.env.example`.
Resting state: hub :3001 (backend mongo), 1 real sim + lidar-sim + FarmHand agent connected, panic mode=`off`. **@everyone: for judging, set panic to `auto` (`curl -X POST localhost:3001/api/force-sim -d '{"mode":"auto"}'`) so the demo self-heals.** Idle-ready.

## [00:50] DONE - style sweep complete across ALL of web/server; suite 28/28 green
Swept every em dash + emoji from web/server (excl node_modules and generated `test/*.log` records, which are exempt): 0 em dashes, 0 emojis remain. Covered server-core root files, plus (per master's whole-tree assignment) db/ and test/ source files. Replacement: em dash -> hyphen; the two `checkmark` emojis in sim.js SVG -> `OK`/`X`; two `checkmark` emojis in db/selftest.js -> `OK`. Also re-swept `auth.js` and index.js/.env.example lines that a concurrent Auth0/operator-attribution feature landed mid-sweep. All JS syntax-checked, JSON valid.
**Two blockers found + resolved (neither caused by the sweep):**
1. `image_url` schema drift - the sanctioned pick-photo feature emits `image_url` on `pick_event`, which root CLAUDE.md's schema didn't list, so server-test's strict validator rejected it. **Master RATIFIED image_url as optional.** Added it to the root CLAUDE.md `pick_event` schema (marked OPTIONAL) and to server-test's `validatePickEvent` (type-checked only when present). The hub's own `schemas.js` already allows extra fields, so no hub change.
2. Test isolation - `test/helpers.js spawnHub()` was documented as "deterministic regardless of the shared hub" but its private hubs still loaded `.env` -> shared Atlas collection; once that collection filled past `limit=100` with live sim picks, the integration tests' fixed-2025-ts markers fell out of the window. Fixed by forcing `MONGODB_URI:""` (memory backend) in spawnHub's env, realizing its stated intent. Atlas itself stays covered by `db/selftest.js`.
**Verification:** `cd web/server/test && npm test` -> **28/28 pass, 0 fail** (canonical invocation, no overrides). `scripts/check-stack.sh` -> 7 pass / 0 fail / 1 warn (Base44 off, by design). Clean restart done: hub :3001 backend mongo, robot connected (~5.3 Hz telemetry), panic mode off.
Files touched outside my usual area (flagging owners): root `CLAUDE.md` (schema, master-authorized), `test/schemas.js` + `test/helpers.js` (@server-test - image_url allowance + spawnHub isolation; both keep your strict-drift intent), db/ + test/ em-dash sweep. Nothing semantic changed beyond the two ratified fixes.

## [01:06] DONE - full style + attribution audit, CLEAN
Ran a character-level Unicode audit (scratchpad script) over all of web/server + every file I touched. Fixes applied this pass:
- Root `CLAUDE.md`: swept 18 em dashes + 1 en dash to hyphens and removed a warning-sign emoji (the rule-defining file was itself non-compliant). Content/meaning unchanged.
- `db/impact.js`: 2 en dashes (number ranges) to hyphens.
- `web/server/media/*.svg`: deleted 158 stale generated pick-photos that still had checkmark/ballot-x glyphs from before my OK/X fix. These are gitignored + ephemeral; the live sim regenerates them with `OK`/`X` (verified newest = `>X<`).
VERDICT: 0 em dashes, 0 emojis in every ENFORCED file. Remaining non-ASCII is legitimate technical notation only (arrows -> and <->, <=, >=, x, middle dot, degree). status/ logs carry historical em dashes but BROADCAST exempts them (records stay as written); my new entries use hyphens.
Attribution/other-repo audit (per human ask "no mention of other repo, no credit to anything else"): CLEAN. No AI/Claude/Anthropic/"generated with"/co-authored text anywhere in my code or docs; no external-repo references. Only github.com hits are npm's dependency funding URLs in package-lock.json (auto-generated, not a credit, not removable).
Re-verified after edits: `npm test` 28/28 pass; `/api/stats` still computes waste (db/impact.js live). Hub :3001 healthy, backend mongo.
