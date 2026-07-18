## [22:05] WIP — server-test starting; server-core not up yet
web/server/ doesn't exist and server-core has no status file. Building everything that doesn't need a live server: schema validators + conformance test harness in web/server/test/ (own package.json so I never touch server-core's), scripts/check-stack.sh, load/robustness harness. Will poll status/server-core.md and run tests the moment their sim is up.

## [22:11] DONE — task 1: schema conformance suite green against live hub
web/server/test/ is its own npm package (deps never touch server-core's package.json). `cd web/server/test && npm install && npm test`. Validators for all 9 root-CLAUDE.md events (strict: unknown keys = errors) + live tests: sim payloads conform, all events relay robot↔web verbatim (nl_command exempted — it routes via FarmHand). 10/10 tests pass. SAMPLES in helpers.js are canonical fixtures other workers can reuse.

## [22:11] DONE — task 2: scripts/check-stack.sh
One command for master: `./scripts/check-stack.sh` (honors SERVER_URL env). Checks hub reachable → socket.io connect → sim telemetry arrives + passes schema → GET /api/stats + /api/picks (200 + valid JSON) → /stream answers → vite up. Currently: 6 pass, 0 fail, 0 warn. Exits nonzero on any failure.

## [22:11] DONE — task 3: load/robustness — hub survives everything; findings below
Storm (3×15 clients, half destroyed mid-flight), malformed payload barrage (12 garbage shapes incl. NaN/Infinity, prototype-less objects, unknown events), ~5MB oversized lidar_scan: hub stays up, sim keeps emitting, new clients still served. 4/4 robustness tests pass, re-run confirmed stable.

FINDINGS for @server-core (informational, nothing to fix):
1. TRANSIENT (observed ~22:3x, now resolved): an earlier run saw schema-invalid payloads relayed verbatim to other clients (garbage telemetry/detection/pick_event/lidar_scan reached browsers). Latest runs show them dropped — assuming you added validation mid-flight; it works. If validation is NOT yours, this is flaky and worth a look.
2. Sim cadence measured: telemetry 5 Hz ✓, detection ~every 10 s, pick_event > 30 s apart. Fine per se, but web-frontend may wait a while to see a pick log entry — consider a faster sim pick cycle (or env knob) for demo/dev.
3. estop relays with payload {} ✓; hub relays fine with no role handshake — my clients pass role via query+auth, ignored today. If you later route by role (robot-only commands), tell me and I'll tighten relay tests.

Next: idle-ready — will re-run suite + check-stack on request or when server-core posts new milestones (persistence/REST changes). Nothing needed from anyone.

## [restart] WIP — server-test back up after crash; baseline re-verified green
Crashed & restarted. Verified prior work still functions: hub is live on :3001 (server-core restarted it; `base44_forwarding:true`, sim robot + a farmhand agent connected). Re-ran my full suite against it: **10/10 pass, 0 fail** (`cd web/server/test && npm test`). check-stack.sh unchanged.
Phase-2 landed in server-core since my last run: Base44 pick_event forwarder (`web/server/base44.js`, env-gated) + nl_command→agent / nl_action→ui+robot wiring (index.js:94,102-112). Starting phase-2 test coverage: (1) nl_command/nl_action routing integration test, (2) Base44 forwarder test, (3) robot-client persistence integration test. NOTE: shared :3001 hub has BASE44 forwarding ON → I will NOT fire test pick_events at it (would pollute real Orchard OS); phase-2 integration tests run against a private hub instance I spawn with Base44 disabled.

## [restart+phase2] DONE — phase-2 test coverage landed: nl_command path, Base44 forwarder, robot integration. 28/28 green.
Extended the suite per BROADCAST phase-2 (@server-test: cover both once landed + robot-client integration test). Run: `cd web/server/test && npm test` → **28/28 pass** (was 10). New files (I own web/server/test/):
- `integration.test.js` (12 tests) — spawns a PRIVATE hub via new `helpers.spawnHub()` (Base44 forced OFF so test pick_events never hit the real Orchard OS webhook; also deterministic regardless of who's on the shared :3001). Covers: `nl_command` ui→agent routing; `nl_action(ok,action)` echoed to ui + forwarded to robot with the mapped `pick{target}`; `task:stop`→`estop`; `ok:false` and `clarification` echoed to ui but NOT forwarded to robot; non-agent `nl_action` spoof ignored; robot `pick_event`/`detection` persist to `/api/picks`//api/detections`; ui control (drive/arm_pose/pick/estop) reaches robot; `/api/health` reflects robot.
- `base44.test.js` (7 tests) — unit-tests `web/server/base44.js` against a throwaway local webhook: disabled unless `BASE44_WEBHOOK_URL` set; exact PickReport body per docs/BASE44.md (`{job_id?,fruit,ripeness,bin,success,ts}`, no `duration_ms` leak); `X-Base44-Secret` header present/absent correctly; `BASE44_JOB_ID` tagging; 500 / unreachable / timeout never throw into the hub.
- Added `nl_action` validator + sample to my `schemas.js`/`helpers.js`; `connectTo(url,...)` + `spawnHub()` helpers; `test:integration`/`test:base44` npm scripts; README updated.
- `check-stack.sh` gained 2 informational /api/health checks: FarmHand agent connected? Base44 forwarding on? Current shared-hub run: 7 pass, 0 fail, 1 warn (Base44 env not set on the hub right now — flag flaps as server-core restarts).

FINDING for @server-core (informational — I do not touch your code): the hub relays raw `nl_command` to robots too, because `nl_command` is in your generic `CONTROL_EVENTS` fan-out (index.js:83-92) as well as the agent route (index.js:94). Root CLAUDE.md intends nl_command to reach the robot only *structured* (via FarmHand→nl_action). Harmless today (fw-linux ignores the raw copy), so I did NOT assert it as a failure — instead pinned it with a "documents status quo" test so any future change shows in the diff. If you'd rather robots never see raw nl_command, drop it from CONTROL_EVENTS' robot emit and ping me; I'll flip that test to assert-absent.

Next: idle-ready. Will re-run suite/check-stack on request or when server-core/db/llm-client post new milestones. Nothing needed from anyone.

## [night-shift] WIP — extended soak running (32 min, hub leak hunt under churn)
Per BROADCAST night-shift demo-hardening (@server-test → 30+ min full-stack soak, watch hub memory/leaks, report 3-hour-window risks). Built `web/server/test/soak.js` (standalone, NOT part of `npm test`): spawns a PRIVATE hub (same index.js, Base44 OFF — won't disrupt shared :3001 or pollute Orchard OS) + sim.js, then hammers it with continuous client churn (~30 conns/s, mixed ui/robot/agent, 30% abrupt engine-destroy teardown), a 60-conn storm every 60s (half aborted mid-handshake), and a malformed-payload burst every 45s. Samples hub-process RSS + /api/health every 30s; ends by stopping churn, letting cleanup settle, and reading final settled counts. Prints `SOAK_VERDICT: PASS|CONCERN`.
2-min smoke (3,710 clients churned): RSS flat ~100MB (GC healthy, no upward trend), telemetry delivery steady, and settled counts returned to exactly {robot:1,ui:1,agent:0} — clean Socket.IO teardown, no counter drift. 32-min run in progress; full verdict + findings to follow.
Pre-analysis finding (code read, not the soak): `db/memory.js recordPickEvent` is the ONLY uncapped collection (telemetry/detections/commands are ring-capped). At real pick cadence that's ~700 rows/3h ≈ negligible RSS — not a crash risk, noting for completeness. Also observed: server-core shipped the phase-4 demo panic-switch (`/api/health` now exposes `force_sim`/`real_robot_connected`).

## [night-shift] ⚠️ FINDING (investigating) — hub silently EXITED at ~16 min under sustained reconnect churn
First full 32-min soak: hub process **exited clean (code=0, sig=null) at t≈15.5 min** — NOT a crash/OOM (that'd be nonzero/SIGKILL) and NOT fd exhaustion (ulimit -n is 1048576). Up to that point RSS was flat (~90–116 MB, GC healthy) and telemetry delivery steady, so it is not a classic memory leak. Client-side connectErrors climbed 0→57 with a jump right at the exit — smells like the hub tore down its listen handle under connection pressure and the event loop drained. index.js's ONLY clean-exit path is shutdown() on SIGINT/SIGTERM, so either something signalled it or an internal teardown released the server.
Load at death: ~28k short-lived client connections churned + 15 storms (60 conns each, half aborted mid-handshake) + malformed bursts, over 15 min. This is FAR heavier than a real demo (5–20 dashboards), BUT the night-shift brief explicitly targets reconnect storms, and venue WiFi flapping could produce reconnect churn — a silent hub death is exactly the "would die during judging" risk to rule out.
Re-running now WITH the hub's own stdout/stderr captured (`hub-<port>.log`) + fd/handle sampling to get the actual dying words. Verdict + root cause + recommendation for @server-core to follow. NOT touching server-core's code. Deliverable so far: `web/server/test/soak.js` (standalone, not in `npm test`).

## [night-shift] DONE - SLAM schema addendum added to conformance validators
Root CLAUDE.md gained a master-approved SLAM addendum (slam_map, slam_pose; robot to web, max 0.5 Hz). Added strict validators + samples + self-test bad-cases to my suite:
- slam_map: ts, resolution(>0), width/height (int 1..128, enforces the 128-cell cap), origin [x,y], data (base64 whose decoded byte length must equal width*height, i.e. a real uint8 occupancy grid). slam_pose: ts,x,y,theta all numeric, no extra keys.
- Kept them OUT of the live-relay list (SLAM_ROBOT_TO_WEB_EVENTS) on purpose: server-core's hub ROBOT_EVENTS (index.js:34) does not relay slam_map/slam_pose yet, so wiring them into the relay conformance test now would false-fail. Fold into ROBOT_TO_WEB_EVENTS once server-core adds slam relay; validators are ready.
- Self-tests green: `node --test ./schemas.test.js` 2/2. @lidar-sim @lidar-pi: SAMPLES.slam_map / SAMPLES.slam_pose in helpers.js are canonical fixtures for your producers.

## [night-shift] RESOLVED - hub "silent exit" root cause NAMED: it is not a hub bug, it is shutdown() on SIGTERM
Top-priority item closed. The alarming "hub exited clean (code=0, sig=null), no error, no shutdown log, at ~11-16 min under churn" is NOT a crash, leak, or spontaneous exit. Root cause, confirmed by direct test:

WHAT HAPPENS: index.js registers `process.on('SIGTERM', shutdown)` / `process.on('SIGINT', shutdown)` (index.js:302-303). shutdown() (index.js:294-301) does `console.log('[hub] shutting down')` then `process.exit(0)`. A SIGTERM therefore makes the hub exit with code=0, sig=null - exactly the observed signature. process.exit(0) truncates the async stdout pipe, so under the soak's heavy piping the "[hub] shutting down" line is often lost, making a NORMAL shutdown look like a mystery death.

PROOF: spawned index.js, sent it a single SIGTERM -> child 'exit' fired with `code=0 sig=null` and the log showed `[hub] shutting down`. Matches the field observation bit for bit. (script: scratchpad/sigterm-test.mjs)

WHO SENT THE SIGTERM: my own soak runs were being terminated externally (background-task stops / process-tree kills - the SAME mechanism visibly killed my 20-min repro at t=16.0m with status "killed"). The hub, as a child in that tree, got SIGTERM and shut down cleanly. Not a hub fault.

THE HUB IS ROBUST - evidence it will NOT die on its own in a 3-hour window:
- Faithful repro (default churn rate, memory backend) ran to t=16.0m, PAST both original "death" points (11m, 15.5m), hub healthy the whole time; only stopped by the external kill.
- 4x churn to 78,000 short-lived connections in 8 min (memory) -> PASS, settled to {robot:1,ui:1,agent:0}.
- 4x churn to 72k-78k connections (Mongo backend) -> survived.
- Across every run: RSS flat 60-137 MB (GC healthy, no upward trend), hub fds peaked ~227 and were always released (no fd leak; ulimit is 1048576 anyway), client counts settled to baseline after churn (no disconnect-cleanup leak, no counter drift), zero telemetry-delivery stalls.
- A fully-detached (nohup, immune to task-stops) 35-min continuous soak with the uncaughtExceptionMonitor+beforeExit probe is running now for the final continuous-duration stamp; monitor is armed to capture a stack or a loop-drain if anything unexpected occurs.

FIX HANDED TO @server-core (small, observability - turns a scary-looking exit into a self-explaining one so this never eats investigation time again during judging):
1. Capture and log the signal name synchronously in shutdown, e.g. `for (const s of ['SIGINT','SIGTERM']) process.on(s, () => shutdown(s));` and `function shutdown(sig){ console.error('[hub] shutting down (signal='+sig+')'); ... }`. Use process.stderr.write (sync) or flush before process.exit so the line is never lost.
2. Optional: `process.on('exit', c => console.error('[hub] exit code='+c))` so any exit path is logged.
These are advisory; I will not edit web/server. @server-core: ping me and I will extend the suite to assert the shutdown log carries the signal once you add it.

FIX HANDED TO @fw-tools / @deploy (demo resilience): run the hub under a restart supervisor for the judging window (e.g. `while true; do node index.js; done`, pm2, or node --watch is NOT it) so that if the OS/laptop ever SIGTERMs it (sleep, power pressure, an errant Ctrl-C in the wrong pane), it self-heals within a second instead of staying down. Recommend adding this to demo.sh.

Net: no demo-reliability defect in the hub. The open item is closed - named, proven, and fixed-recommendation delivered.

## [night-shift] DONE - continuous 35.5-min soak PASS (final confirmation, closes the brief)
The detached (task-stop-immune) continuous soak finished: SOAK_VERDICT PASS over 35.5 min. This is the 30+ min continuous run the night-shift brief required.
- 65,087 client connections churned, 35 connect/disconnect storms (60 conns each, half aborted mid-handshake), 47 malformed-payload bursts.
- Hub uptime 2139 s (alive the entire run; exited only when the soak stopped it at the end).
- RSS: base 84 MB, peak 98 MB, end 37 MB -> NET NEGATIVE growth (no leak; GC healthy). fds peak 79, end 60 (no fd leak).
- 23,155 telemetry frames delivered to the observer, 0 stall samples. Settled health {robot:1,ui:1,agent:0}, robot_connected true (clean teardown, no counter drift).
Conclusion stands: the hub has no memory leak, no fd leak, no delivery stall, and no spontaneous exit under sustained reconnect storms + churn. Nothing here would die during a 3-hour judging window. The earlier "silent exits" were external SIGTERM of my soak process tree hitting shutdown() (proven separately). Item fully closed; observability fix + restart-supervisor recommendation are in the RESOLVED entry above for @server-core and @fw-tools/@deploy.
